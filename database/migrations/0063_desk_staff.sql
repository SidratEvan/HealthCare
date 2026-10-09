-- 0063_desk_staff.sql
--
-- Receptionists assigned to reception desks (plan R4b; `PRD.md` `FR-REC-32`
-- as amended by the owner's answer to question 20, 8 October).
--
-- In a large hospital a receptionist assigned to a desk manages only that
-- desk's doctors and their chambers, and the server refuses the rest. A
-- receptionist assigned to no desk, which is every receptionist in a hospital
-- that has not set desks up, keeps the one common workspace (decision 2a).
--
-- An organisation's own rows (0043's `app_org`), as the desks are.
--
-- Additive: one table.

CREATE TABLE reception_desk_staff (
  desk_id        uuid        NOT NULL REFERENCES reception_desks (id) ON DELETE CASCADE,
  staff_user_id  uuid        NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  hospital_id    uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (desk_id, staff_user_id)
);

CREATE INDEX reception_desk_staff_staff_idx ON reception_desk_staff (staff_user_id);

CREATE TRIGGER trg_reception_desk_staff_touch
  BEFORE UPDATE ON reception_desk_staff
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE reception_desk_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_rows ON reception_desk_staff FOR ALL TO app_tenant
  USING (app_org(hospital_id)) WITH CHECK (app_org(hospital_id));

COMMENT ON TABLE reception_desk_staff IS
  'Which receptionists work at a desk (FR-REC-32). An assigned receptionist manages only its doctors.';
