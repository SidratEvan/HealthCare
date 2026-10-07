-- 0052_workspace_health.sql
--
-- What became of a hospital's messages, and how late its consoles' work
-- reached the server (`PRD.md` `FR-SUP-06`; DATABASE.md §2.2; plan G2).
--
-- "System health view: sync lag per hospital, stale-data offenders,
-- notification delivery rates." The ages of a hospital's published figures
-- are read from what it publishes, which anybody may read. The other two are
-- counted from tables a platform administrator's connection does not reach
-- (`FR-ONB-08`, 0043): a message is addressed to a person, and a queue event
-- is about one.
--
-- ## `fn_workspace_health`
--
-- As `fn_workspace_usage` (0051): counted with its owner's rights, and what
-- comes back is numbers and one time, never a row. Over the last seven days:
--
-- - messages for the hospital's chambers by what became of them: sent (or
--   reported delivered), failed, skipped on purpose, and still queued after
--   five minutes;
-- - queue actions that reached the server more than a minute after the
--   console's own time for them: how many, how late the slowest, and when the
--   last one arrived. A console's clock is not trusted for anything else
--   (`SY-01`), and here it is only compared with the server's.
--
-- It answers the platform and the server's own work, and gives every other
-- connection no row.
--
-- Additive: one function.

CREATE FUNCTION fn_workspace_health(hospital uuid)
RETURNS TABLE (
  messages_sent     integer,
  messages_failed   integer,
  messages_held     integer,
  messages_waiting  integer,
  late_actions      integer,
  slowest_seconds   integer,
  last_late_at      timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH msgs AS (
    SELECT n.state, n.queued_at
      FROM notifications n
      JOIN bookings b ON b.id = (n.params ->> 'bookingId')::uuid
      JOIN sessions s ON s.id = b.session_id
     WHERE s.hospital_id = hospital
       AND n.queued_at >= now() - interval '7 days'
  ),
  late AS (
    SELECT e.server_ts,
           extract(epoch FROM e.server_ts - e.client_ts) AS lag_seconds
      FROM queue_events e
      JOIN sessions s ON s.id = e.session_id
     WHERE s.hospital_id = hospital
       AND e.server_ts >= now() - interval '7 days'
       AND e.client_ts IS NOT NULL
       AND e.server_ts - e.client_ts > interval '60 seconds'
  )
  SELECT
    (SELECT count(*)::int FROM msgs WHERE state IN ('sent', 'delivered')),
    (SELECT count(*)::int FROM msgs WHERE state = 'failed'),
    (SELECT count(*)::int FROM msgs WHERE state = 'skipped'),
    (SELECT count(*)::int FROM msgs
      WHERE state = 'queued' AND queued_at < now() - interval '5 minutes'),
    (SELECT count(*)::int FROM late),
    -- A console a day wrong is a day late by this sum; capped at a week, the
    -- window, so that one broken clock does not print a number of years.
    (SELECT least(coalesce(max(lag_seconds), 0), 7 * 86400)::int FROM late),
    (SELECT max(server_ts) FROM late)
  WHERE app_scope() IN ('national', 'system')
$$;

COMMENT ON FUNCTION fn_workspace_health(uuid) IS
  'A hospital''s messages by outcome and its late queue actions, over seven days. Counts and one time, never a row; answers the platform and the server only (FR-SUP-06, FR-ONB-08).';

REVOKE ALL ON FUNCTION fn_workspace_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_workspace_health(uuid) TO app_tenant;
