-- 0025_symptom_signal.sql
--
-- The one fact `FR-GOV-03` needs and nothing recorded: which visits were a
-- case of dengue, diarrhoeal disease or fever.
--
-- "Symptom-category spike detection by area (dengue, diarrhoeal, fever) as an
-- early signal." A spike is a count against its own past, per area, per
-- category — and until now the product had no category to count. A booking's
-- reason is whatever the patient typed, and `visits.diagnosis_text` is free
-- text on purpose (0007): no document fixes a coding system, and inventing
-- one would put a doctor's conclusion into a vocabulary nobody agreed to.
-- Reading a category out of free text would be diagnostic inference, which
-- `PRD.md` §27 puts out of scope.
--
-- ## Why this is not that coding system
--
-- It is not a diagnosis. It is a single optional tag, on the visit, set by the
-- doctor who saw the patient (`CHIP-B05-SIGNAL`), and its vocabulary is the
-- three words `FR-GOV-03` itself names — nothing more. A doctor who does not
-- think the visit is any of the three leaves it empty, which is the common
-- case. The free-text diagnosis stays the record; this is what a district
-- counts.
--
-- ## Where it goes
--
-- Nowhere identifiable. The government layer reads it only through
-- `v_gov_symptom_daily` (0026), counted by district, category and day, and
-- never with the visit, the patient or the facility (`FR-GOV-06`). The patient
-- does not see it in their wallet either: it is a reporting flag for the
-- district, not a finding about them.

CREATE TYPE symptom_signal AS ENUM ('dengue', 'diarrhoeal', 'fever');

ALTER TABLE visits ADD COLUMN symptom_signal symptom_signal;

-- What `v_gov_symptom_daily` scans: signed, tagged visits by day.
CREATE INDEX visits_symptom_signal_idx
  ON visits (symptom_signal, signed_at)
  WHERE symptom_signal IS NOT NULL AND signed_at IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN visits.symptom_signal IS
  'Optional public-health tag set by the treating doctor (CHIP-B05-SIGNAL): dengue, diarrhoeal or fever, the three FR-GOV-03 names. Counted by district only (v_gov_symptom_daily); never shown with the visit.';
