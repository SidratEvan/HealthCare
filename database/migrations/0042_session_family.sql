-- 0042_session_family.sql
--
-- A sign-in has an identity that outlives the renewal of its tokens
-- (`PRD.md` `FR-SEC-06`, DATABASE.md §2.1; plan A6, handover finding 17).
--
-- A staff access token was honoured for its whole fifteen minutes whatever
-- had happened since it was issued: an account deactivated by its
-- administrator, a sign-out, a password reset. And a console's live
-- connection, once made, stayed made.
--
-- To refuse a token at once it has to be tied to something that can be
-- revoked. It cannot be tied to its refresh session's row, because that row
-- is replaced every time the tokens are renewed (rotation), and a console
-- would be cut off every fifteen minutes. So the rows of one sign-in share a
-- `family_id`: set at sign-in, carried through every renewal. An access
-- token names its family, and is honoured while the family has a session
-- that is neither revoked nor expired. Signing out revokes the family's
-- current session, which leaves it with none; deactivating an account or
-- resetting its password revokes every session the account has.
--
-- NULL for a patient's sessions, which do not use it yet, and backfilled to
-- the row's own id for every staff session that already exists.
--
-- Additive.

ALTER TABLE sessions_auth
  ADD COLUMN family_id uuid;

UPDATE sessions_auth SET family_id = id WHERE subject_kind = 'staff';

CREATE INDEX sessions_auth_family_idx
  ON sessions_auth (family_id)
  WHERE family_id IS NOT NULL;

COMMENT ON COLUMN sessions_auth.family_id IS
  'One sign-in, across the rotation of its refresh tokens. A staff access token names it and is honoured while the family has a live session (FR-SEC-06).';
