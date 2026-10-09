-- 0053_notification_sending.sql
--
-- What the notification sender needs on a message's row: how often it has
-- been tried, and when it is next due (`PRD.md` `FR-NOT-06`, `FR-NOT-07`;
-- BACKEND.md §8; DATABASE.md §2.7; plan H1).
--
-- Sending used to happen inside the request that caused the message. A queue
-- tap waited for a gateway; a gateway that refused once was never asked
-- again; and a message held back for quiet hours was recorded as skipped and
-- never sent in the morning. The sender that replaces that works from this
-- table: it takes the rows that are due, tries each, and writes what became
-- of it.
--
-- ## `attempts` and `next_attempt_at`
--
-- A row in `queued` is due at `next_attempt_at`. Taking it to send it raises
-- `attempts` and moves `next_attempt_at` two minutes on in the same
-- statement, which is the claim: nobody else takes it meanwhile, and if the
-- sender dies before saying what happened the row is anybody's again when
-- the two minutes are up. A try that fails puts `next_attempt_at` at the
-- next try (`shared/domain` `messaging/sending`: after a quarter of a minute,
-- then one minute, five, fifteen) and leaves `error` saying what the gateway
-- said; after the fifth the row is `failed`. A message held for quiet hours
-- is `queued`, due at seven in the morning in Dhaka, with `error` saying
-- `quiet_hours` until it goes.
--
-- `next_attempt_at` is set on every row, due or not: on a row that was sent
-- or skipped it is when it was last due, and nothing reads it.
--
-- ## `fn_workspace_health` (0052) and "still waiting"
--
-- It counted a queued row older than five minutes as still waiting. With
-- rows now queued on purpose until morning that would flag every hospital
-- that uploads a report at night. Still waiting is now a queued row a
-- gateway has already refused once (its `error` says what was said), or one
-- more than five minutes past when it was due, which is a sender not running.
--
-- Additive: two columns with defaults, one index replaced by its successor.

ALTER TABLE notifications
  ADD COLUMN attempts        smallint    NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

-- What is already there was due when it was queued.
UPDATE notifications SET next_attempt_at = queued_at;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_attempts_counted CHECK (attempts >= 0);

COMMENT ON COLUMN notifications.attempts IS
  'How many times sending has been tried (FR-NOT-06). Raised by the claim, so a try that died is counted.';
COMMENT ON COLUMN notifications.next_attempt_at IS
  'When a queued row is due: now, the next retry, the end of a claim, or seven in the morning for one held for quiet hours (FR-NOT-07).';

-- The outbox query: what is due, oldest first. Replaces the index on
-- `queued_at`, which answered "what is queued" and not "what is due".
DROP INDEX notifications_pending_idx;
CREATE INDEX notifications_due_idx
  ON notifications (next_attempt_at)
  WHERE state = 'queued';

CREATE OR REPLACE FUNCTION fn_workspace_health(hospital uuid)
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
    SELECT n.state, n.attempts, n.next_attempt_at, n.error
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
    -- Not one waiting for the morning, and not one being sent this second:
    -- one a gateway has already refused, or one nobody has got to.
    (SELECT count(*)::int FROM msgs
      WHERE state = 'queued'
        AND ((attempts >= 1 AND error IS NOT NULL AND error <> 'quiet_hours')
             OR next_attempt_at < now() - interval '5 minutes')),
    (SELECT count(*)::int FROM late),
    (SELECT least(coalesce(max(lag_seconds), 0), 7 * 86400)::int FROM late),
    (SELECT max(server_ts) FROM late)
  WHERE app_scope() IN ('national', 'system')
$$;
