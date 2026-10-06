-- 0044_patient_policies.sql
--
-- A person's clinical record is their own at the database (`PRD.md`
-- `FR-SEC-11`, `FR-NET-02`, `FR-GST-05`; DATABASE.md §5.3; plan B3).
--
-- 0043 kept one hospital from another and left one person kept from another
-- to the application: a patient, a tracking link and nobody at all shared one
-- scope, `open`, which reached everything. So a patient-facing query that
-- forgot whose record it wanted returned somebody else's, with nothing
-- underneath to stop it.
--
-- ## The scopes this adds
--
-- A connection now says, besides `app.scope`:
--
--   `patient`  + `app.person_id`   a signed-in account
--   `guest`    + `app.person_id`   a tracking link, or the short token it is
--              + `app.booking_id`  exchanged for (`FR-GST-05`)
--
-- and `open` is what is left: nobody.
--
-- ## What they reach
--
-- Of **the clinical record** — `visits`, `prescriptions`,
-- `prescription_items`, `test_orders`, `reports`, `patient_documents`,
-- `consents`, `admissions`:
--
--   patient   what is about a profile the account owns, and nobody else's.
--   guest     the visit made at the one booking the token names, and the
--             tests ordered at it. Not that person's other visits: a link
--             opens one booking. A guest token that names no booking (the
--             one a number is given to book with) reaches none.
--   open      nothing.
--
-- None of the three writes a visit, an order, a report or an admission; a
-- hospital does. An account writes its own consents, and a hospital the ones
-- given to it.
--
-- Of **everything else** the three reach what `open` reached before: a
-- booking, a queue, a payment, a profile. What each may see of those is still
-- the application's to decide, because the queue is worked out from every
-- booking in a chamber and a serial is allocated against all of them. That is
-- said here so that nobody reads this migration as more than it is.
--
-- ## What a hospital reaches
--
-- Exactly what it did: its own, and a visit under the patient's live consent.
--
-- Additive in rows: none change. In behaviour, for a deployment whose API is
-- bound by the policies: a request with no principal reads no clinical record.
-- The two that did, a tracking link's page and its report, now say whose link
-- they are once the token has resolved (`guest.service`), and the preview of
-- what a verified number may take over is read as the server's own work
-- (`patientAuth.service`).

-- ---------------------------------------------------------------------------
-- Reading the scope
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_person() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;

CREATE FUNCTION app_booking() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.booking_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_scope() IS
  'Who this connection is working for: hospital, national, patient, guest, open, system, or NULL (FR-SEC-11).';
COMMENT ON FUNCTION app_person() IS
  'The account a patient connection is scoped to, or the identity a link was issued to; NULL otherwise (FR-SEC-11).';
COMMENT ON FUNCTION app_booking() IS
  'The one booking a tracking link names; NULL otherwise (FR-GST-05).';

-- ---------------------------------------------------------------------------
-- The rules of 0043, for the two new scopes
--
-- Outside the clinical record a patient and a link reach what `open` reached.
-- Each function is replaced whole, with `patient` and `guest` beside `open`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_any() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    app_scope() IN ('hospital', 'national', 'patient', 'guest', 'open', 'system'), false)
$$;

CREATE OR REPLACE FUNCTION app_people() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_scope() IN ('hospital', 'patient', 'guest', 'open', 'system'), false) $$;

CREATE OR REPLACE FUNCTION app_org(hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN coalesce(hospital = app_hospital(), false)
    WHEN 'national' THEN true
    WHEN 'patient'  THEN true
    WHEN 'guest'    THEN true
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_care(hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN coalesce(hospital = app_hospital(), false)
    WHEN 'patient'  THEN true
    WHEN 'guest'    THEN true
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_care_session(session uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM sessions s WHERE s.id = session AND s.hospital_id = app_hospital())
    WHEN 'patient' THEN true
    WHEN 'guest'   THEN true
    WHEN 'open'    THEN true
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
    WHEN 'patient' THEN true
    WHEN 'guest'   THEN true
    WHEN 'open'    THEN true
    WHEN 'system'  THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_care_import_batch(batch uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM import_batches i WHERE i.id = batch AND i.hospital_id = app_hospital())
    WHEN 'patient' THEN true
    WHEN 'guest'   THEN true
    WHEN 'open'    THEN true
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
    WHEN 'patient' THEN true
    WHEN 'guest'   THEN true
    WHEN 'open'    THEN true
    WHEN 'system'  THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_org_sitting(doctor_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM doctor_hospitals d
       WHERE d.id = doctor_hospital AND d.hospital_id = app_hospital())
    WHEN 'national' THEN true
    WHEN 'patient'  THEN true
    WHEN 'guest'    THEN true
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_referral(from_hospital uuid, to_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN coalesce(app_hospital() IN (from_hospital, to_hospital), false)
    WHEN 'patient'  THEN true
    WHEN 'guest'    THEN true
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION app_patient(owner_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN owner_hospital IS NULL OR owner_hospital = app_hospital()
    WHEN 'patient'  THEN true
    WHEN 'guest'    THEN true
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

-- ---------------------------------------------------------------------------
-- The clinical record
-- ---------------------------------------------------------------------------

/**
 * The hospital that wrote a clinical row, and the server's own work. Not a
 * patient, not a link, not nobody: those reach a clinical row by its being
 * theirs (`app_mine`), never by saying nothing.
 */
CREATE FUNCTION app_clinic(hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN coalesce(hospital = app_hospital(), false)
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

/**
 * A profile that is the caller's: one an account owns, or the one a link's
 * booking is for.
 */
CREATE FUNCTION app_mine(patient uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'patient' THEN EXISTS (
      SELECT 1 FROM patients p WHERE p.id = patient AND p.owner_user_id = app_person())
    WHEN 'guest' THEN EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = app_booking() AND b.patient_id = patient)
    ELSE false
  END
$$;

/**
 * A visit that is the caller's. An account's: any visit of a profile it
 * owns. A link's: the visit made at the booking it names, and no other of
 * that person's (`FR-GST-05`).
 */
CREATE FUNCTION app_mine_visit(patient uuid, booking uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'patient' THEN app_mine(patient)
    WHEN 'guest'   THEN coalesce(booking = app_booking(), false)
    ELSE false
  END
$$;

/** A test order that is the caller's, by the same two rules. */
CREATE FUNCTION app_mine_order(patient uuid, visit uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'patient' THEN app_mine(patient)
    WHEN 'guest'   THEN EXISTS (
      SELECT 1 FROM visits v WHERE v.id = visit AND v.booking_id = app_booking())
    ELSE false
  END
$$;

/** A row that hangs from a visit, to the hospital that wrote the visit. */
CREATE OR REPLACE FUNCTION app_care_visit(visit uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM visits v WHERE v.id = visit AND v.hospital_id = app_hospital())
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/** A row that hangs from a test order, to the hospital that took the order. */
CREATE OR REPLACE FUNCTION app_care_test_order(test_order uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM test_orders t WHERE t.id = test_order AND t.hospital_id = app_hospital())
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/** Whether the caller is a person or their link, for a row reached through its parent. */
CREATE FUNCTION app_personal() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_scope() IN ('patient', 'guest'), false) $$;

-- A visit: written by the hospital that made it. Read by it, by a hospital
-- the patient has consented to, and by the person it is about.
DROP POLICY tenant_read ON visits;
DROP POLICY tenant_insert ON visits;
DROP POLICY tenant_update ON visits;
DROP POLICY tenant_delete ON visits;
CREATE POLICY tenant_read ON visits FOR SELECT TO app_tenant
  USING (app_clinic(hospital_id) OR app_consented(patient_id)
         OR app_mine_visit(patient_id, booking_id));
CREATE POLICY tenant_insert ON visits FOR INSERT TO app_tenant
  WITH CHECK (app_clinic(hospital_id));
CREATE POLICY tenant_update ON visits FOR UPDATE TO app_tenant
  USING (app_clinic(hospital_id)) WITH CHECK (app_clinic(hospital_id));
CREATE POLICY tenant_delete ON visits FOR DELETE TO app_tenant USING (app_clinic(hospital_id));

-- A prescription, through its visit. The person reads the ones on a visit
-- they can read, which the policy on `visits` decides inside the subquery.
DROP POLICY tenant_rows ON prescriptions;
CREATE POLICY tenant_read ON prescriptions FOR SELECT TO app_tenant
  USING (app_care_visit(visit_id)
         OR (app_personal() AND EXISTS (SELECT 1 FROM visits v WHERE v.id = visit_id)));
CREATE POLICY tenant_insert ON prescriptions FOR INSERT TO app_tenant
  WITH CHECK (app_care_visit(visit_id));
CREATE POLICY tenant_update ON prescriptions FOR UPDATE TO app_tenant
  USING (app_care_visit(visit_id)) WITH CHECK (app_care_visit(visit_id));
CREATE POLICY tenant_delete ON prescriptions FOR DELETE TO app_tenant
  USING (app_care_visit(visit_id));
-- `prescription_items` follows its prescription, as 0043 wrote it.

-- A test order: the hospital that took it, and the person it is for.
DROP POLICY tenant_rows ON test_orders;
CREATE POLICY tenant_read ON test_orders FOR SELECT TO app_tenant
  USING (app_clinic(hospital_id) OR app_mine_order(patient_id, visit_id));
CREATE POLICY tenant_insert ON test_orders FOR INSERT TO app_tenant
  WITH CHECK (app_clinic(hospital_id));
CREATE POLICY tenant_update ON test_orders FOR UPDATE TO app_tenant
  USING (app_clinic(hospital_id)) WITH CHECK (app_clinic(hospital_id));
CREATE POLICY tenant_delete ON test_orders FOR DELETE TO app_tenant
  USING (app_clinic(hospital_id));

-- A report, through its order.
DROP POLICY tenant_rows ON reports;
CREATE POLICY tenant_read ON reports FOR SELECT TO app_tenant
  USING (app_care_test_order(test_order_id)
         OR (app_personal() AND EXISTS (SELECT 1 FROM test_orders t WHERE t.id = test_order_id)));
CREATE POLICY tenant_insert ON reports FOR INSERT TO app_tenant
  WITH CHECK (app_care_test_order(test_order_id));
CREATE POLICY tenant_update ON reports FOR UPDATE TO app_tenant
  USING (app_care_test_order(test_order_id)) WITH CHECK (app_care_test_order(test_order_id));
CREATE POLICY tenant_delete ON reports FOR DELETE TO app_tenant
  USING (app_care_test_order(test_order_id));

-- A consent: the hospital it was given to, and the person who gave it, who
-- also gives and withdraws it (`FR-PAT-63`, `FR-PAT-64`).
DROP POLICY tenant_rows ON consents;
CREATE POLICY tenant_rows ON consents FOR ALL TO app_tenant
  USING (app_clinic(hospital_id) OR app_mine(patient_id))
  WITH CHECK (app_clinic(hospital_id) OR app_mine(patient_id));

-- A stay in a bed: the hospital's, and the person's to read.
DROP POLICY tenant_rows ON admissions;
CREATE POLICY tenant_read ON admissions FOR SELECT TO app_tenant
  USING (app_clinic(hospital_id) OR app_mine(patient_id));
CREATE POLICY tenant_insert ON admissions FOR INSERT TO app_tenant
  WITH CHECK (app_clinic(hospital_id));
CREATE POLICY tenant_update ON admissions FOR UPDATE TO app_tenant
  USING (app_clinic(hospital_id)) WITH CHECK (app_clinic(hospital_id));
CREATE POLICY tenant_delete ON admissions FOR DELETE TO app_tenant
  USING (app_clinic(hospital_id));

-- A document a person keeps in their wallet. Theirs; and, as 0043 left it,
-- reachable by a hospital's connection, where the application decides.
DROP POLICY tenant_rows ON patient_documents;
CREATE POLICY tenant_rows ON patient_documents FOR ALL TO app_tenant
  USING (coalesce(app_scope() IN ('hospital', 'system'), false) OR app_mine(patient_id))
  WITH CHECK (coalesce(app_scope() IN ('hospital', 'system'), false) OR app_mine(patient_id));
