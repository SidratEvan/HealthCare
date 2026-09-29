-- 0030_hospital_patients.sql
--
-- Patients a hospital holds because it imported them, and the hospital's own
-- identifiers for everything it imports (pilot step 24, `FR-IMP-04`,
-- `FR-IMP-10`, DATABASE.md §2.1).
--
-- ## A third owner
--
-- A patient row belonged to an account (`owner_user_id`) or a guest identity
-- (`owner_guest_id`). An imported patient belongs to neither: the hospital
-- holds the record, and it reaches no patient app until somebody verifies
-- the same mobile number and claims it (`FR-GST-09`, `FR-PAT-04`). So
-- `owner_hospital_id` is the third owner, and `patients_one_owner` still says
-- exactly one.
--
-- ## The hospital's own numbers
--
-- `external_refs` maps (hospital, kind, the hospital's identifier) to the row
-- it became. Importing the same file again looks each row up here first and
-- updates what it finds, so a re-import never duplicates (`FR-IMP-04`). The
-- foreign key to the batch that first wrote a mapping is added by 0031, once
-- `import_batches` exists.

ALTER TABLE patients
  ADD COLUMN owner_hospital_id uuid REFERENCES hospitals (id) ON DELETE RESTRICT;

ALTER TABLE patients DROP CONSTRAINT patients_one_owner;
ALTER TABLE patients
  ADD CONSTRAINT patients_one_owner
  CHECK (num_nonnulls(owner_user_id, owner_guest_id, owner_hospital_id) = 1);

CREATE INDEX patients_owner_hospital_idx ON patients (owner_hospital_id)
  WHERE owner_hospital_id IS NOT NULL;

COMMENT ON COLUMN patients.owner_hospital_id IS
  'Set for a patient the hospital imported (FR-IMP-10). Visible only to that hospital''s staff until the patient claims it with the same verified mobile number.';

CREATE TYPE external_kind AS ENUM (
  'patient', 'appointment', 'department', 'doctor', 'schedule', 'ward', 'bed', 'staff'
);

CREATE TABLE external_refs (
  id            uuid          PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id   uuid          NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
  kind          external_kind NOT NULL,
  -- As the hospital's system prints it: 'P-004512', 'DR/17'.
  external_ref  text          NOT NULL,
  entity_id     uuid          NOT NULL,
  batch_id      uuid          NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT external_refs_ref_present CHECK (length(trim(external_ref)) > 0)
);

CREATE UNIQUE INDEX external_refs_key ON external_refs (hospital_id, kind, external_ref);
CREATE INDEX external_refs_entity_idx ON external_refs (entity_id);
CREATE INDEX external_refs_batch_idx ON external_refs (batch_id);

CREATE TRIGGER trg_external_refs_touch
  BEFORE UPDATE ON external_refs
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE external_refs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE external_refs IS
  'The hospital''s own identifier for each row it imported (FR-IMP-04): a re-import finds and updates, never duplicates.';
