-- 0051_agreement_state.sql
--
-- The state of a hospital's agreement, and what it has used (`PRD.md`
-- `FR-SUP-04`, the state half, in V1 since 6 October 2026; DATABASE.md §2.2;
-- plan G1).
--
-- **Entitlements without commerce** (`CLAUDE.md` §4.5). What is kept here is
-- product state: whether a hospital's agreement is in trial, active, overdue
-- or ended, and a few counts of what it has used. No plan name, no price, no
-- amount, no invoice: those are settled outside the product, per agreement.
--
-- ## `hospitals.agreement_state`
--
-- Set by a platform administrator on the hospital's workspace, with a note
-- and who set it when. `trial` is where every workspace starts. It is a
-- record and changes nothing by itself: what takes a hospital out of the
-- network is suspending its workspace (`FR-ONB-06`), which is a separate,
-- deliberate act.
--
-- ## `fn_workspace_usage`
--
-- A platform administrator's connection reaches organisations and nothing
-- about a person (`FR-ONB-08`, 0043): it cannot read a booking or a message.
-- How many serials a hospital took last month is not about a person, and it
-- is what "usage" means. So the counting is done by this function, with its
-- owner's rights, and what comes back is three numbers and never a row.
--
-- It answers the platform and the server's own work only. Anybody else is
-- given nothing: how busy a hospital is, is not a figure it publishes
-- (`FR-NET-01`).

CREATE TYPE agreement_state AS ENUM ('trial', 'active', 'overdue', 'ended');

ALTER TABLE hospitals
  ADD COLUMN agreement_state      agreement_state NOT NULL DEFAULT 'trial',
  ADD COLUMN agreement_note       text,
  ADD COLUMN agreement_changed_at timestamptz,
  ADD COLUMN agreement_changed_by uuid REFERENCES staff_users (id) ON DELETE SET NULL;

ALTER TABLE hospitals
  ADD CONSTRAINT hospitals_agreement_note_length CHECK (
    agreement_note IS NULL OR char_length(agreement_note) BETWEEN 1 AND 500
  );

COMMENT ON COLUMN hospitals.agreement_state IS
  'Where the hospital''s agreement stands: trial, active, overdue or ended (FR-SUP-04). A record; it gates nothing by itself.';
COMMENT ON COLUMN hospitals.agreement_note IS
  'What the platform administrator wrote when setting the agreement''s state. No amounts, no plan names.';

CREATE FUNCTION fn_workspace_usage(hospital uuid)
RETURNS TABLE (serials_30d integer, chambers_30d integer, messages_month integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*)::int
       FROM bookings b
       JOIN sessions s ON s.id = b.session_id
      WHERE s.hospital_id = hospital AND b.deleted_at IS NULL
        AND b.created_at >= now() - interval '30 days'),
    (SELECT count(*)::int
       FROM sessions s
      WHERE s.hospital_id = hospital AND s.actual_start IS NOT NULL
        AND s.actual_start >= now() - interval '30 days'),
    (SELECT count(*)::int
       FROM notifications n
       JOIN bookings b ON b.id = (n.params ->> 'bookingId')::uuid
       JOIN sessions s ON s.id = b.session_id
      WHERE s.hospital_id = hospital
        AND n.channel = 'sms'
        AND n.state IN ('sent', 'delivered')
        AND n.queued_at >= date_trunc('month', now()))
  WHERE app_scope() IN ('national', 'system')
$$;

COMMENT ON FUNCTION fn_workspace_usage(uuid) IS
  'What a hospital has used: serials taken and chambers held in thirty days, messages sent this month. Three counts, never a row; answers the platform and the server only (FR-SUP-04, FR-ONB-08).';

-- Not PUBLIC's to call, as with 0043's own definer function. The scope check
-- inside is the rule; this is the door.
REVOKE ALL ON FUNCTION fn_workspace_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_workspace_usage(uuid) TO app_tenant;
