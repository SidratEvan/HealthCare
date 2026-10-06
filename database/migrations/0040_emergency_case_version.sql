-- 0040_emergency_case_version.sql
--
-- An emergency case says which statement about it is the newer one
-- (`BACKEND.md` `SY-09`, DATABASE.md §2.5; plan A3).
--
-- The same reason and the same rule as a bed (0039): a triage step reaches
-- the ER console by two roads, the answer and a broadcast, and two steps on
-- one case can arrive in the opposite order to the one they happened in.
-- A case that the console put back behind its own last step would show a
-- patient waiting who has been sent to a ward, or untriaged who was marked
-- red.
--
-- `fn_raise_version` is 0039's: `NEW.version = OLD.version + 1`, whatever the
-- statement supplied. Everything the console draws for a case is on this row.
--
-- Additive. Every existing case starts at version 1.

ALTER TABLE emergency_cases
  ADD COLUMN version bigint NOT NULL DEFAULT 1;

COMMENT ON COLUMN emergency_cases.version IS
  'Raised by trg_emergency_cases_version on every UPDATE. A console keeps the statement about a case with the highest version, whichever road it came by (SY-09).';

CREATE TRIGGER trg_emergency_cases_version
  BEFORE UPDATE ON emergency_cases
  FOR EACH ROW EXECUTE FUNCTION fn_raise_version();
