-- 0056_person_policies.sql
--
-- One patient is kept from another by the database for bookings, payments,
-- messages, links, standby places and profiles too (`PRD.md` `FR-SEC-11`,
-- `FR-NET-02`, `FR-GST-05`; DATABASE.md §5.4; plan I3).
--
-- 0044 did this for the clinical record and stopped there, saying why: the
-- live serial is worked out from every booking in a chamber, and a serial is
-- allocated against all of them, so a patient's connection reached every
-- booking, every payment and every message, and the application alone kept
-- one person's from another's.
--
-- ## What changes
--
-- For `patient`, `guest` and `open`, these tables now hold what is the
-- caller's and nothing else, whatever a query leaves out:
--
--   bookings        an account: a booking for a profile it owns, or one it
--                   made. A link: the one booking it names. Nobody: none.
--   patients        an account: the profiles it owns. A link: the profile of
--                   its booking. Nobody: none.
--   payments        an account: what it paid, or what was paid for its own
--                   booking. A link: what was paid for its booking. Nobody:
--                   none.
--   guest_links     an account: the links to its own bookings. A link: itself.
--                   Nobody: none.
--   standby_list    an account: its own profiles' places. Otherwise none.
--   notifications   an account: what was addressed to it or to a profile it
--                   owns. Otherwise none.
--   queue_events, queue_state, slot_offers
--                   none. A patient is given the queue by the API, as the
--                   patients' copy (plan I2c), and never the log or a raw
--                   state (DATABASE.md §5, the intent as first written).
--
-- A person writes, of these, only a payment they make for their own booking
-- and a link to their own booking. Everything else on them is written by a
-- hospital, or by the queue.
--
-- ## The queue, and the counts the public reads
--
-- The queue still has to see a whole chamber to allocate a serial, reduce a
-- log and tell each phone where it stands. So the queue's own work, when a
-- person asks for it (book, cancel, say they are late, take a freed chair),
-- runs as the server's own (`app.scope = system`), and only once the
-- application has decided the request is theirs to make; what leaves it for
-- a person is the patients' copy, which names nobody. That is said in
-- `backend/api` `config/dbScope.ts` (`asQueue`), the one place that does it.
--
-- What the public, and the demonstration's picker, read of a chamber are
-- numbers, and they are read through `fn_chamber_counts`, which runs with its
-- owner's rights and gives back how many places are taken and how many are
-- waiting, and nothing about who.
--
-- ## What a hospital reaches
--
-- Exactly what it did. Every rule here for `hospital`, `national` and
-- `system` is 0043's, unchanged.
--
-- Additive in rows: none change.

-- ---------------------------------------------------------------------------
-- The hospital's half of 0043's rules, without the people
--
-- 0044 put `patient`, `guest` and `open` beside `system` in these, so that
-- they reached what `open` reached before. They are taken out again: what a
-- person reaches of these tables is decided by the policies below, by the row
-- being theirs.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_care_session(session uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM sessions s WHERE s.id = session AND s.hospital_id = app_hospital())
    WHEN 'system'  THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_care_booking(booking uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE b.id = booking AND s.hospital_id = app_hospital())
    WHEN 'system'  THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_care_payment(
  booking uuid, standby uuid, bed_request uuid, test_order uuid
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN
         EXISTS (SELECT 1 FROM bookings b JOIN sessions s ON s.id = b.session_id
                  WHERE b.id = booking AND s.hospital_id = app_hospital())
      OR EXISTS (SELECT 1 FROM standby_list w JOIN sessions s ON s.id = w.session_id
                  WHERE w.id = standby AND s.hospital_id = app_hospital())
      OR EXISTS (SELECT 1 FROM bed_requests r
                  WHERE r.id = bed_request AND r.hospital_id = app_hospital())
      OR EXISTS (SELECT 1 FROM test_orders t
                  WHERE t.id = test_order AND t.hospital_id = app_hospital())
    WHEN 'system'  THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_patient(owner_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN owner_hospital IS NULL OR owner_hospital = app_hospital()
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

-- ---------------------------------------------------------------------------
-- What is the caller's
-- ---------------------------------------------------------------------------

/**
 * A booking that is the caller's. An account's: one for a profile it owns,
 * or one it made for somebody else. A link's: the one booking it names
 * (`FR-GST-05`), and none of that person's others.
 */
CREATE FUNCTION app_mine_booking(booking uuid, patient uuid, booked_by_user uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'patient' THEN coalesce(booked_by_user = app_person(), false) OR app_mine(patient)
    WHEN 'guest'   THEN coalesce(booking = app_booking(), false)
    ELSE false
  END
$$;

/** A profile that is the caller's: one an account owns, or the one its link's booking is for. */
CREATE FUNCTION app_mine_profile(patient uuid, owner_user uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'patient' THEN coalesce(owner_user = app_person(), false)
    WHEN 'guest'   THEN EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = app_booking() AND b.patient_id = patient)
    ELSE false
  END
$$;

/**
 * A payment that is the caller's. An account's: one it paid, or one for a
 * booking of its own. A link's: one for the booking it names. Whether the
 * booking is the caller's is the policy on `bookings`, inside the subquery.
 */
CREATE FUNCTION app_mine_payment(booking uuid, payer_user uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'patient' THEN coalesce(payer_user = app_person(), false)
      OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking)
    WHEN 'guest'   THEN coalesce(booking = app_booking(), false)
    ELSE false
  END
$$;

/** A message that is the caller's: addressed to the account, or to a profile it owns. */
CREATE FUNCTION app_mine_message(patient uuid, user_ uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'patient' THEN coalesce(user_ = app_person(), false) OR app_mine(patient)
    ELSE false
  END
$$;

/**
 * How full a chamber is (`FR-PAT-12`, `FR-NET-01`).
 *
 * What the public reads of a chamber's bookings is numbers. The bookings
 * themselves are nobody's to read but their own patients' and the
 * hospital's, so this runs with its owner's rights and gives back three
 * counts and nothing about who is in the chamber:
 *
 *   taken    places held: a cancelled booking frees its place (`FR-QUE-30`)
 *   waiting  still to be seen: booked or waiting
 *   total    every booking ever made in it, cancelled ones included
 *
 * A removed booking was never there.
 */
CREATE FUNCTION fn_chamber_counts(session uuid)
RETURNS TABLE (taken integer, waiting integer, total integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (count(*) FILTER (WHERE b.status <> 'cancelled'))::integer,
         (count(*) FILTER (WHERE b.status IN ('booked', 'waiting')))::integer,
         count(*)::integer
    FROM bookings b
   WHERE b.session_id = session
     AND b.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION fn_chamber_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_chamber_counts(uuid) TO app_tenant;

COMMENT ON FUNCTION fn_chamber_counts(uuid) IS
  'How full a chamber is, as three counts and nothing about who is in it (FR-PAT-12, FR-SEC-11).';

-- ---------------------------------------------------------------------------
-- The policies
-- ---------------------------------------------------------------------------

-- A booking: the hospital's whose chamber it is in, a hospital the patient
-- has consented to (to read), and the person it is for or who made it (to
-- read). A person's booking is written by the queue.
DROP POLICY tenant_read ON bookings;
CREATE POLICY tenant_read ON bookings FOR SELECT TO app_tenant
  USING (app_care_session(session_id) OR app_consented(patient_id)
         OR app_mine_booking(id, patient_id, booked_by_user_id));

-- A profile: the hospital's rule of 0043, and the person's own. An account
-- adds and keeps its own profiles (`FR-PAT-02`).
DROP POLICY tenant_rows ON patients;
CREATE POLICY tenant_rows ON patients FOR ALL TO app_tenant
  USING (app_patient(owner_hospital_id) OR app_mine_profile(id, owner_user_id))
  WITH CHECK (app_patient(owner_hospital_id)
              OR (app_scope() = 'patient' AND owner_user_id = app_person()));

-- A payment: the hospital's, and the payer's. A person pays for their own
-- booking and for nothing else (`FR-PAY-01`).
DROP POLICY tenant_rows ON payments;
CREATE POLICY tenant_rows ON payments FOR ALL TO app_tenant
  USING (app_care_payment(booking_id, standby_id, bed_request_id, test_order_id)
         OR app_mine_payment(booking_id, payer_user_id))
  WITH CHECK (app_care_payment(booking_id, standby_id, bed_request_id, test_order_id)
              OR (app_mine_payment(booking_id, payer_user_id)
                  AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id)));

-- A tracking link: the hospital's, a link to itself, and an account's to its
-- own bookings, which it may also be given afresh (plan F1).
DROP POLICY tenant_rows ON guest_links;
CREATE POLICY tenant_rows ON guest_links FOR ALL TO app_tenant
  USING (app_care_booking(booking_id)
         OR (app_scope() = 'guest' AND booking_id = app_booking() AND guest_id = app_person())
         OR (app_scope() = 'patient' AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id)))
  WITH CHECK (app_care_booking(booking_id)
              OR (app_scope() = 'patient'
                  AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id)));

-- A standby place: the hospital's, and to read, the person's own.
DROP POLICY tenant_rows ON standby_list;
CREATE POLICY tenant_read ON standby_list FOR SELECT TO app_tenant
  USING (app_care_session(session_id)
         OR (app_scope() = 'patient' AND app_mine(patient_id)));
CREATE POLICY tenant_insert ON standby_list FOR INSERT TO app_tenant
  WITH CHECK (app_care_session(session_id));
CREATE POLICY tenant_update ON standby_list FOR UPDATE TO app_tenant
  USING (app_care_session(session_id)) WITH CHECK (app_care_session(session_id));
CREATE POLICY tenant_delete ON standby_list FOR DELETE TO app_tenant
  USING (app_care_session(session_id));

-- A message: a hospital's connection and the server's, as 0043 left it (a
-- hospital's cap and its month of messages are counted from these), and, to
-- read, the person it was addressed to.
DROP POLICY tenant_rows ON notifications;
CREATE POLICY tenant_read ON notifications FOR SELECT TO app_tenant
  USING (coalesce(app_scope() IN ('hospital', 'system'), false)
         OR app_mine_message(recipient_patient_id, recipient_user_id));
CREATE POLICY tenant_insert ON notifications FOR INSERT TO app_tenant
  WITH CHECK (coalesce(app_scope() IN ('hospital', 'system'), false));
CREATE POLICY tenant_update ON notifications FOR UPDATE TO app_tenant
  USING (coalesce(app_scope() IN ('hospital', 'system'), false))
  WITH CHECK (coalesce(app_scope() IN ('hospital', 'system'), false));
CREATE POLICY tenant_delete ON notifications FOR DELETE TO app_tenant
  USING (coalesce(app_scope() IN ('hospital', 'system'), false));

-- `queue_events`, `queue_state` and `slot_offers` keep 0043's policy, through
-- `app_care_session`, which no longer admits a person: a hospital's and the
-- server's, and nobody else's.
