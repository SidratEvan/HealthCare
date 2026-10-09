-- 0059_patient_documents.sql
--
-- A patient's own old papers (plan R3; `PRD.md` `FR-PAT-62`, the owner's
-- decision 4 of 8 October; DATABASE.md §2.4).
--
-- `patient_documents` has existed since 0007 with nothing writing it. What an
-- upload needs beside it: what kind of file it is (so it is served as what it
-- is), how big, and which account added it. `doc_type` becomes one of four
-- kinds rather than free text, because the screens name them.
--
-- Additive: the table holds no rows before this (nothing wrote it), so the
-- constraints apply to nothing that exists.

ALTER TABLE patient_documents
  ADD COLUMN content_type text,
  ADD COLUMN byte_size int,
  ADD COLUMN uploaded_by_user uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE patient_documents
  ADD CONSTRAINT patient_documents_content_type_known
    CHECK (content_type IS NULL
           OR content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  ADD CONSTRAINT patient_documents_byte_size_range
    CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 8388608),
  ADD CONSTRAINT patient_documents_doc_type_known
    CHECK (doc_type IS NULL OR doc_type IN ('prescription', 'report', 'discharge', 'other'));

COMMENT ON COLUMN patient_documents.file_url IS
  'An object key (documents/<patientId>/<id>.<ext>), opened only by a signed link (FR-PAT-62).';
