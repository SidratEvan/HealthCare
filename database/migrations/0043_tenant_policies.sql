-- 0043_tenant_policies.sql
--
-- Hospitals are kept apart by the database (`PRD.md` `FR-SEC-11`, `FR-NET-02`,
-- `FR-ONB-08`; DATABASE.md §6; plan B1, handover finding 7).
--
-- Every table has had row-level security switched on since it was created,
-- and not one policy: for any role but the owner that means "sees nothing",
-- so the API's role was given BYPASSRLS and hospitals were kept apart by
-- three habits in application code. A new route that took an id and forgot
-- its scope check, or a query that filtered by id and not by hospital, leaked
-- across hospitals with nothing underneath to stop it.
--
-- ## The scope
--
-- Each connection the API uses says who it is working for, before any
-- statement runs on it (`backend/api` `config/dbScope.ts`):
--
--   app.scope = 'hospital', app.hospital_id = <id>
--       a member of that hospital's staff. Rows of another hospital do not
--       exist for it: not to read, not to write.
--   app.scope = 'national'
--       a platform administrator. Organisations, never anything about a
--       patient (`FR-ONB-08`).
--   app.scope = 'open'
--       a patient, a guest holding a link, or nobody: the public and
--       patient-facing routes. What each may see is still decided by the
--       application here; a patient's own scope is the next step (plan B3).
--   app.scope = 'system'
--       the server's own work with nobody behind it: the schedule job, the
--       purge, a command run by an operator.
--   unset
--       sees nothing. A client that connects as the API's role and says
--       nothing about itself is told nothing.
--
-- ## Who the policies are for
--
-- `app_tenant`, a role nobody logs in as, which the API's own role is made a
-- member of (`pnpm db:role`). Not PUBLIC: on a hosted database other roles
-- exist that can reach these tables, and a policy is a grant.
--
-- The owner, who runs the migrations, the seeds and the backups, is not bound
-- by any of this, and neither is a deployment whose API still connects as
-- the owner (the public demonstration): row-level security never applies to a
-- table's owner. The policies protect a deployment that runs the API as its
-- own role, which is what a deployment holding real patients does.
--
-- ## What crosses between hospitals, and why
--
-- Named here, and nowhere else:
--
--   * what a hospital publishes (`FR-NET-01`): its departments, its doctors'
--     sittings and chambers, its capabilities, its stock flags, its settings.
--     Anybody may read these; only the hospital may change them.
--   * a referral, to the hospital that sent it and the one it was sent to;
--     and through it, the two cases it links (`FR-EMG-07`..`09`).
--   * a visit, to a hospital the patient has given a live consent to
--     (`FR-SEC-04`, `FR-DOC-10`).
--   * people. A patient, an account, a guest identity belong to no hospital;
--     a patient a hospital imported belongs to that hospital (`FR-IMP-10`).
--   * whether a hospital runs an emergency desk. That is read from who works
--     there, which is the hospital's own; the answer, one yes or no, is what
--     it publishes (`fn_runs_emergency_desk`).
--   * the booking behind a visit, to a hospital the patient has consented to:
--     a visit is read with the serial and the chamber it was made in.
--
-- Additive: no row changes. Until the API's role loses BYPASSRLS, which
-- `pnpm db:role` does in the same step, nothing behaves differently.

-- ---------------------------------------------------------------------------
-- The role the policies are for
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Reading the scope
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_scope() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.scope', true), '') $$;

CREATE FUNCTION app_hospital() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.hospital_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_scope() IS
  'Who this connection is working for: hospital, national, open, system, or NULL (FR-SEC-11).';
COMMENT ON FUNCTION app_hospital() IS
  'The hospital a staff connection is scoped to; NULL otherwise (FR-SEC-11).';

/** Any connection that has said who it is. */
CREATE FUNCTION app_any() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_scope() IN ('hospital', 'national', 'open', 'system'), false) $$;

/** Rows about people: never a platform administrator's to read (FR-ONB-08). */
CREATE FUNCTION app_people() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_scope() IN ('hospital', 'open', 'system'), false) $$;

/** An organisation's own rows. The platform sees organisations. */
CREATE FUNCTION app_org(hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN coalesce(hospital = app_hospital(), false)
    WHEN 'national' THEN true
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

/** A hospital's rows about its patients. The platform does not see these. */
CREATE FUNCTION app_care(hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN coalesce(hospital = app_hospital(), false)
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

/** The same, for a row that reaches its hospital through a session. */
CREATE FUNCTION app_care_session(session uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM sessions s WHERE s.id = session AND s.hospital_id = app_hospital())
    WHEN 'open'   THEN true
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/** …through a booking. */
CREATE FUNCTION app_care_booking(booking uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE b.id = booking AND s.hospital_id = app_hospital())
    WHEN 'open'   THEN true
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/** …through a test order. */
CREATE FUNCTION app_care_test_order(test_order uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM test_orders t WHERE t.id = test_order AND t.hospital_id = app_hospital())
    WHEN 'open'   THEN true
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/** …through a visit. */
CREATE FUNCTION app_care_visit(visit uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM visits v WHERE v.id = visit AND v.hospital_id = app_hospital())
    WHEN 'open'   THEN true
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/** …through an import batch. */
CREATE FUNCTION app_care_import_batch(batch uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM import_batches i WHERE i.id = batch AND i.hospital_id = app_hospital())
    WHEN 'open'   THEN true
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/**
 * A payment is for one of several things, each of which belongs to a
 * hospital. A member of staff sees a payment for something of theirs.
 */
CREATE FUNCTION app_care_payment(
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
    WHEN 'open'   THEN true
    WHEN 'system' THEN true
    ELSE false
  END
$$;

/** A schedule row reaches its hospital through the doctor's sitting there. */
CREATE FUNCTION app_org_sitting(doctor_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN EXISTS (
      SELECT 1 FROM doctor_hospitals d
       WHERE d.id = doctor_hospital AND d.hospital_id = app_hospital())
    WHEN 'national' THEN true
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

/**
 * A referral, to the hospital that sent it and the one it was sent to
 * (FR-EMG-07). Nobody else's staff, and never the platform.
 */
CREATE FUNCTION app_referral(from_hospital uuid, to_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN coalesce(app_hospital() IN (from_hospital, to_hospital), false)
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

/**
 * An emergency case another hospital may see: one a referral links to it,
 * from either end. The sender follows the person to the bed they reached;
 * the receiver closes the case the person left (FR-EMG-08, FR-EMG-09).
 */
CREATE FUNCTION app_referred_case(emergency_case uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT app_scope() = 'hospital' AND EXISTS (
    SELECT 1 FROM referrals r
     WHERE (r.emergency_case_id = emergency_case OR r.arrived_case_id = emergency_case)
       AND app_hospital() IN (r.from_hospital_id, r.to_hospital_id))
$$;

/** A patient who has given this hospital a live consent (FR-SEC-04, FR-DOC-10). */
CREATE FUNCTION app_consented(patient uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT app_scope() = 'hospital' AND EXISTS (
    SELECT 1 FROM consents c
     WHERE c.patient_id = patient
       AND c.hospital_id = app_hospital()
       AND c.revoked_at IS NULL
       AND c.deleted_at IS NULL
       AND (c.expires_at IS NULL OR c.expires_at > now()))
$$;

/**
 * A patient. One a hospital imported is that hospital's (FR-IMP-10); any
 * other belongs to no hospital and is reached by whoever is treating them.
 */
CREATE FUNCTION app_patient(owner_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE app_scope()
    WHEN 'hospital' THEN owner_hospital IS NULL OR owner_hospital = app_hospital()
    WHEN 'open'     THEN true
    WHEN 'system'   THEN true
    ELSE false
  END
$$;

/**
 * Whether a hospital has somebody to answer at its emergency desk
 * (FR-EMG-01, FR-EMG-07).
 *
 * Read from `staff_roles`, which is the hospital's own and which another
 * hospital's staff cannot see. The answer is not private: a hospital with an
 * emergency desk says so to the public search and to an ER looking for
 * somewhere to refer to. So this runs with its owner's rights and gives back
 * one boolean, never a row.
 */
CREATE FUNCTION fn_runs_emergency_desk(hospital uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM staff_roles sr
      JOIN staff_users su ON su.id = sr.staff_user_id
     WHERE sr.hospital_id = hospital
       AND sr.role = 'emergency'
       AND sr.deleted_at IS NULL
       AND su.deleted_at IS NULL)
$$;

REVOKE ALL ON FUNCTION fn_runs_emergency_desk(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_runs_emergency_desk(uuid) TO app_tenant;

-- ---------------------------------------------------------------------------
-- The policies
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  -- An organisation's own rows: its staff, its wards and beds, what it has
  -- imported, its agreement. The platform sees these; another hospital does not.
  FOREACH t IN ARRAY ARRAY[
    'ambulances', 'beds', 'wards', 'staff_users', 'staff_roles', 'subscriptions',
    'invoices', 'sync_cursors', 'import_mapping_profiles', 'import_batches', 'external_refs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_rows ON %I FOR ALL TO app_tenant
         USING (app_org(hospital_id)) WITH CHECK (app_org(hospital_id))', t);
  END LOOP;

  -- What a hospital publishes (FR-NET-01): anybody reads, only it changes.
  FOREACH t IN ARRAY ARRAY[
    'capabilities', 'departments', 'doctor_hospitals', 'hospital_settings',
    'pharmacy_stock', 'sessions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_read ON %I FOR SELECT TO app_tenant USING (app_any())', t);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON %I FOR INSERT TO app_tenant
         WITH CHECK (app_org(hospital_id))', t);
    EXECUTE format(
      'CREATE POLICY tenant_update ON %I FOR UPDATE TO app_tenant
         USING (app_org(hospital_id)) WITH CHECK (app_org(hospital_id))', t);
    EXECUTE format(
      'CREATE POLICY tenant_delete ON %I FOR DELETE TO app_tenant
         USING (app_org(hospital_id))', t);
  END LOOP;

  -- A hospital's rows about its patients. Not the platform's to read.
  FOREACH t IN ARRAY ARRAY[
    'admissions', 'bed_events', 'bed_requests', 'blood_requests', 'consents',
    'counter_shifts', 'feedback', 'test_orders'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_rows ON %I FOR ALL TO app_tenant
         USING (app_care(hospital_id)) WITH CHECK (app_care(hospital_id))', t);
  END LOOP;

  -- The queue and everything on it, through the session.
  FOREACH t IN ARRAY ARRAY[
    'queue_events', 'queue_state', 'standby_list', 'slot_offers'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_rows ON %I FOR ALL TO app_tenant
         USING (app_care_session(session_id)) WITH CHECK (app_care_session(session_id))', t);
  END LOOP;

  -- People, and what is addressed to them. They belong to no hospital.
  FOREACH t IN ARRAY ARRAY[
    'users', 'guest_identities', 'device_tokens', 'otp_challenges',
    'patient_documents', 'notifications'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_rows ON %I FOR ALL TO app_tenant
         USING (app_people()) WITH CHECK (app_people())', t);
  END LOOP;

  -- What is the platform's and everybody's: the register of doctors, the
  -- formulary, the message templates, sign-in sessions.
  FOREACH t IN ARRAY ARRAY[
    'doctors', 'medicines', 'notification_templates', 'blood_donors',
    'analytics_refresh', 'sessions_auth'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_rows ON %I FOR ALL TO app_tenant
         USING (app_any()) WITH CHECK (app_any())', t);
  END LOOP;
END
$$;

-- A booking: the hospital's whose session it is in. And, to read only, a
-- hospital the patient has consented to: a visit is shown with the serial
-- and the chamber it was made in, and those are on its booking.
CREATE POLICY tenant_read ON bookings FOR SELECT TO app_tenant
  USING (app_care_session(session_id) OR app_consented(patient_id));
CREATE POLICY tenant_insert ON bookings FOR INSERT TO app_tenant
  WITH CHECK (app_care_session(session_id));
CREATE POLICY tenant_update ON bookings FOR UPDATE TO app_tenant
  USING (app_care_session(session_id)) WITH CHECK (app_care_session(session_id));
CREATE POLICY tenant_delete ON bookings FOR DELETE TO app_tenant
  USING (app_care_session(session_id));

-- A schedule row, through the doctor's sitting. Published like a session.
CREATE POLICY tenant_read ON session_templates FOR SELECT TO app_tenant USING (app_any());
CREATE POLICY tenant_insert ON session_templates FOR INSERT TO app_tenant
  WITH CHECK (app_org_sitting(doctor_hospital_id));
CREATE POLICY tenant_update ON session_templates FOR UPDATE TO app_tenant
  USING (app_org_sitting(doctor_hospital_id)) WITH CHECK (app_org_sitting(doctor_hospital_id));
CREATE POLICY tenant_delete ON session_templates FOR DELETE TO app_tenant
  USING (app_org_sitting(doctor_hospital_id));

-- A hospital: anybody reads that it exists (its name is on every card). It is
-- made by the platform or by a hospital applying, never by another
-- hospital's staff, and changed only by its own or by the platform.
CREATE POLICY tenant_read ON hospitals FOR SELECT TO app_tenant USING (app_any());
CREATE POLICY tenant_insert ON hospitals FOR INSERT TO app_tenant
  WITH CHECK (coalesce(app_scope() IN ('national', 'open', 'system'), false));
CREATE POLICY tenant_update ON hospitals FOR UPDATE TO app_tenant
  USING (app_org(id)) WITH CHECK (app_org(id));
CREATE POLICY tenant_delete ON hospitals FOR DELETE TO app_tenant USING (app_org(id));

-- The audit log: anybody appends; a hospital reads its own, a patient's
-- reads of their own access log come by the open scope.
CREATE POLICY tenant_read ON audit_log FOR SELECT TO app_tenant USING (app_org(hospital_id));
CREATE POLICY tenant_insert ON audit_log FOR INSERT TO app_tenant WITH CHECK (app_any());

-- Which migrations the database is on, for the readiness check.
CREATE POLICY tenant_read ON schema_migrations FOR SELECT TO app_tenant USING (app_any());

-- A patient.
CREATE POLICY tenant_rows ON patients FOR ALL TO app_tenant
  USING (app_patient(owner_hospital_id)) WITH CHECK (app_patient(owner_hospital_id));

-- An emergency case: the hospital's own, and one a referral links to it.
CREATE POLICY tenant_read ON emergency_cases FOR SELECT TO app_tenant
  USING (app_care(hospital_id) OR app_referred_case(id));
CREATE POLICY tenant_insert ON emergency_cases FOR INSERT TO app_tenant
  WITH CHECK (app_care(hospital_id));
CREATE POLICY tenant_update ON emergency_cases FOR UPDATE TO app_tenant
  USING (app_care(hospital_id) OR app_referred_case(id))
  WITH CHECK (app_care(hospital_id) OR app_referred_case(id));
CREATE POLICY tenant_delete ON emergency_cases FOR DELETE TO app_tenant
  USING (app_care(hospital_id));

-- A referral.
CREATE POLICY tenant_rows ON referrals FOR ALL TO app_tenant
  USING (app_referral(from_hospital_id, to_hospital_id))
  WITH CHECK (app_referral(from_hospital_id, to_hospital_id));

-- An ambulance request, to the hospital it is going to.
CREATE POLICY tenant_rows ON ambulance_requests FOR ALL TO app_tenant
  USING (app_care(destination_hospital_id)) WITH CHECK (app_care(destination_hospital_id));

-- A visit: written by the hospital that made it; read by it, and by a
-- hospital the patient has consented to.
CREATE POLICY tenant_read ON visits FOR SELECT TO app_tenant
  USING (app_care(hospital_id) OR app_consented(patient_id));
CREATE POLICY tenant_insert ON visits FOR INSERT TO app_tenant
  WITH CHECK (app_care(hospital_id));
CREATE POLICY tenant_update ON visits FOR UPDATE TO app_tenant
  USING (app_care(hospital_id)) WITH CHECK (app_care(hospital_id));
CREATE POLICY tenant_delete ON visits FOR DELETE TO app_tenant USING (app_care(hospital_id));

-- What hangs from a visit, a booking, a test order, an import.
CREATE POLICY tenant_rows ON prescriptions FOR ALL TO app_tenant
  USING (app_care_visit(visit_id)) WITH CHECK (app_care_visit(visit_id));
CREATE POLICY tenant_rows ON prescription_items FOR ALL TO app_tenant
  USING (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_id))
  WITH CHECK (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_id));
CREATE POLICY tenant_rows ON guest_links FOR ALL TO app_tenant
  USING (app_care_booking(booking_id)) WITH CHECK (app_care_booking(booking_id));
CREATE POLICY tenant_rows ON reports FOR ALL TO app_tenant
  USING (app_care_test_order(test_order_id)) WITH CHECK (app_care_test_order(test_order_id));
CREATE POLICY tenant_rows ON import_rows FOR ALL TO app_tenant
  USING (app_care_import_batch(batch_id)) WITH CHECK (app_care_import_batch(batch_id));
CREATE POLICY tenant_rows ON payments FOR ALL TO app_tenant
  USING (app_care_payment(booking_id, standby_id, bed_request_id, test_order_id))
  WITH CHECK (app_care_payment(booking_id, standby_id, bed_request_id, test_order_id));
