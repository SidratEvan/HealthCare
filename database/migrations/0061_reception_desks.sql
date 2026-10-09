-- 0061_reception_desks.sql
--
-- Reception desks and the doctors they look after (plan R4; `PRD.md`
-- `FR-REC-32`; the owner's decision 2b of 8 October).
--
-- An administrator names a hospital's reception desks (the ground-floor
-- counter, the second-floor desk) and assigns doctors to each. The console
-- then opens a receptionist on their desk's chambers first. It organises and
-- does not restrict: every chamber of the hospital stays reachable from any
-- desk (decision 2a, one common reception workspace), so a receptionist
-- covering another desk is never locked out of a queue.
--
-- An organisation's own rows (0043's `app_org`): the hospital and the
-- platform see them; another hospital does not.
--
-- Additive: two tables.

CREATE TABLE reception_desks (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id  uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  name_bn      text        NOT NULL,
  name_en      text        NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at   timestamptz,

  CONSTRAINT reception_desks_names_not_blank
    CHECK (btrim(name_bn) <> '' AND btrim(name_en) <> '')
);

-- One live desk by a name at a hospital: two "Counter 1"s are one typed twice.
CREATE UNIQUE INDEX reception_desks_name_key
  ON reception_desks (hospital_id, lower(name_en)) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_reception_desks_touch
  BEFORE UPDATE ON reception_desks
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- Which doctors a desk looks after. A doctor may be at more than one desk:
-- two counters can share a busy consultant.
CREATE TABLE reception_desk_doctors (
  desk_id      uuid        NOT NULL REFERENCES reception_desks (id) ON DELETE CASCADE,
  doctor_id    uuid        NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
  hospital_id  uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (desk_id, doctor_id)
);

CREATE TRIGGER trg_reception_desk_doctors_touch
  BEFORE UPDATE ON reception_desk_doctors
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE INDEX reception_desk_doctors_hospital_idx ON reception_desk_doctors (hospital_id);

ALTER TABLE reception_desks ENABLE ROW LEVEL SECURITY;
ALTER TABLE reception_desk_doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_rows ON reception_desks FOR ALL TO app_tenant
  USING (app_org(hospital_id)) WITH CHECK (app_org(hospital_id));
CREATE POLICY tenant_rows ON reception_desk_doctors FOR ALL TO app_tenant
  USING (app_org(hospital_id)) WITH CHECK (app_org(hospital_id));

COMMENT ON TABLE reception_desks IS
  'A hospital''s reception desks (FR-REC-32). They organise the console; they restrict nothing.';
