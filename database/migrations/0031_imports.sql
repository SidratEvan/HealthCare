-- 0031_imports.sql
--
-- Import batches and their rows (pilot step 24, `FR-IMP-05`…`08`,
-- DATABASE.md §2.6b).
--
-- A batch is one uploaded file for one set. It is checked row by row before
-- anything else is written (`checked`), written all or nothing when an
-- administrator approves (`committed`), and may be undone as a whole while
-- nothing has been built on its rows (`undone`), or dropped unapproved
-- (`discarded`).
--
-- `import_rows.raw` is the row as read. It is kept while the batch is open,
-- cleared at once on discard, and cleared 30 days after a commit
-- (`rows_purged_at`) — the counts, the errors and `external_refs` stay, which
-- is what the audit needs (`FR-IMP-08`). Error messages are never stored:
-- `errors` holds `{field, code}` and the screen words it in either language.

CREATE TYPE import_set   AS ENUM ('structure', 'patients', 'appointments', 'records');
CREATE TYPE import_state AS ENUM ('checked', 'committed', 'undone', 'discarded');

CREATE TABLE import_batches (
  id              uuid         PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id     uuid         NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
  set_kind        import_set   NOT NULL,
  file_name       text         NOT NULL,
  file_sha256     text         NOT NULL,
  state           import_state NOT NULL DEFAULT 'checked',
  counts          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid         NOT NULL REFERENCES staff_users (id) ON DELETE RESTRICT,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  committed_by    uuid         REFERENCES staff_users (id) ON DELETE RESTRICT,
  committed_at    timestamptz,
  undone_by       uuid         REFERENCES staff_users (id) ON DELETE RESTRICT,
  undone_at       timestamptz,
  rows_purged_at  timestamptz,

  CONSTRAINT import_batches_sha256_shape CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_batches_counts_is_object CHECK (jsonb_typeof(counts) = 'object'),
  -- Each state says who put it there.
  CONSTRAINT import_batches_committed_has_who
    CHECK ((state IN ('committed', 'undone')) = (committed_by IS NOT NULL AND committed_at IS NOT NULL)),
  CONSTRAINT import_batches_undone_has_who
    CHECK ((state = 'undone') = (undone_by IS NOT NULL AND undone_at IS NOT NULL))
);

CREATE INDEX import_batches_hospital_idx ON import_batches (hospital_id, created_at DESC);

CREATE TRIGGER trg_import_batches_touch
  BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE TABLE import_rows (
  id           uuid          PRIMARY KEY DEFAULT uuid_generate_v7(),
  batch_id     uuid          NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  row_number   integer       NOT NULL,
  raw          jsonb,
  action       text          NOT NULL,
  errors       jsonb         NOT NULL DEFAULT '[]'::jsonb,
  target_kind  external_kind,
  target_id    uuid,
  -- What an updated row held before this batch wrote it, so an undo can put
  -- it back (FR-IMP-07). Cleared with `raw`.
  previous     jsonb,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT import_rows_action_allowed CHECK (action IN ('add', 'update', 'skip', 'error')),
  CONSTRAINT import_rows_errors_is_array CHECK (jsonb_typeof(errors) = 'array'),
  CONSTRAINT import_rows_row_number_positive CHECK (row_number >= 2)
);

CREATE UNIQUE INDEX import_rows_batch_row_key ON import_rows (batch_id, row_number);
CREATE INDEX import_rows_target_idx ON import_rows (target_id) WHERE target_id IS NOT NULL;

CREATE TRIGGER trg_import_rows_touch
  BEFORE UPDATE ON import_rows
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;

ALTER TABLE external_refs
  ADD CONSTRAINT external_refs_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES import_batches (id) ON DELETE RESTRICT;

-- The audit row an import writes names the action (`FR-IMP-08`).
ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_allowed;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_action_allowed
  CHECK (action IN ('RECORD_VIEW', 'QUEUE_ACTION', 'SETTINGS_CHANGE', 'EXPORT', 'LOGIN', 'IMPORT'));

COMMENT ON TABLE import_batches IS
  'One uploaded file for one set (FR-IMP-01): checked, then committed all or nothing, undoable while nothing is built on it (FR-IMP-05..08).';
COMMENT ON COLUMN import_rows.raw IS
  'The row as read. Cleared on discard and 30 days after commit (FR-IMP-08); counts, errors and external_refs remain.';
