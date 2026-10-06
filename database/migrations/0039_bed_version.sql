-- 0039_bed_version.sql
--
-- A bed says which statement about it is the newer one (`BACKEND.md` `SY-09`,
-- DATABASE.md §2.5; plan A2).
--
-- A change to a bed reaches a ward board by two roads: the answer to the
-- request that made it, and a broadcast. They are different connections, so
-- either can be first, and two changes to one bed can arrive in the opposite
-- order to the one they happened in. A queue has a sequence that settles
-- this; a bed had nothing, and a board that took whichever statement arrived
-- last could put a bed back to the state before the last change.
--
-- So every bed carries a version, and the database raises it, in the
-- statement that changes the row. No path can change a bed without raising
-- it, because no path can change a bed without an UPDATE; and a change that
-- rolls back raises nothing, because the version is in the row it was
-- changing. A timestamp would not do: the server's clock is read after the
-- row is, and two writes to one bed can be stamped in the opposite order.
--
-- Everything a board draws for a bed is on this row, with one exception: the
-- request a reserved bed is held for is read through `bed_requests`. A hold
-- is made and released in the same transaction as the bed's own change of
-- state, so the bed's version moves with it.
--
-- The function is not about beds: migration 0040 uses it for an emergency
-- case.
--
-- Additive. Every existing bed starts at version 1.

ALTER TABLE beds
  ADD COLUMN version bigint NOT NULL DEFAULT 1;

COMMENT ON COLUMN beds.version IS
  'Raised by trg_beds_version on every UPDATE. A console keeps the statement about a bed with the highest version, whichever road it came by (SY-09).';

CREATE FUNCTION fn_raise_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- From the row as it was, never from what the statement supplied: a caller
  -- cannot set a version, lower one, or leave one where it is.
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_raise_version() IS
  'BEFORE UPDATE: NEW.version = OLD.version + 1, whatever the statement said (SY-09).';

CREATE TRIGGER trg_beds_version
  BEFORE UPDATE ON beds
  FOR EACH ROW EXECUTE FUNCTION fn_raise_version();
