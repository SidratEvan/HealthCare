-- 0038_import_mapping_profiles.sql
--
-- A hospital's confirmed column mappings, kept so the same export maps itself
-- next time (`PRD.md` §14b `FR-IMP-20`; DATABASE.md §2.6b).
--
-- A hospital's own export does not arrive in the import template's column
-- names. An administrator confirms which of the file's columns is which
-- template field (`FR-IMP-18`), and that decision is worth keeping: the
-- patient register a hospital exports next month has the same headings.
--
-- ## What a row holds, and what it never does
--
-- The set, the kind of row for a structure file, a hash of the file's heading
-- row, and for each template field the position of the column that feeds it.
-- Headings and positions only. **No value from any row of any file is here**,
-- and none could be: nothing in this table has anywhere to put one. That is
-- the same line `import_rows` draws by being cleared after thirty days
-- (`FR-IMP-08`); this table never crosses it in the first place, so it has no
-- retention rule.
--
-- One profile per hospital, set and heading row. Confirming a different
-- mapping for the same headings replaces it.
--
-- Additive: a new table, nothing existing is touched.

CREATE TABLE import_mapping_profiles (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id    uuid        NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
  set_kind       import_set  NOT NULL,
  -- sha-256 of the folded heading row (`headerSignature` in shared/domain).
  header_sha256  text        NOT NULL,
  -- department | doctor | schedule | ward | bed | staff for a structure file;
  -- NULL for the other sets, whose rows are all one kind already.
  row_type       text,
  -- { "<template field>": <column position> | null }
  mapping        jsonb       NOT NULL,
  -- { "<template field>": "rule" | "saved" | "model" | "manual" }: where each
  -- choice came from when it was confirmed (FR-IMP-15, FR-IMP-20).
  sources        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- SET NULL, not RESTRICT: who confirmed it is on the audit row as well, and
  -- an account being removed should not be stopped by a column mapping.
  approved_by    uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  approved_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT import_mapping_profiles_sha256_shape CHECK (header_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_mapping_profiles_mapping_is_object CHECK (jsonb_typeof(mapping) = 'object'),
  CONSTRAINT import_mapping_profiles_sources_is_object CHECK (jsonb_typeof(sources) = 'object'),
  CONSTRAINT import_mapping_profiles_row_type_known
    CHECK (row_type IS NULL OR row_type IN ('department', 'doctor', 'schedule', 'ward', 'bed', 'staff')),
  -- A structure file is one kind of row and says which; the others say none.
  CONSTRAINT import_mapping_profiles_row_type_for_structure
    CHECK ((set_kind = 'structure') = (row_type IS NOT NULL))
);

CREATE UNIQUE INDEX import_mapping_profiles_key
  ON import_mapping_profiles (hospital_id, set_kind, header_sha256);

CREATE TRIGGER trg_import_mapping_profiles_touch
  BEFORE UPDATE ON import_mapping_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE import_mapping_profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE import_mapping_profiles IS
  'Confirmed column mappings for a hospital''s own export, by heading row (FR-IMP-20). Headings'' hash and column positions only; never a cell value.';
