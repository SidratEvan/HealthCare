-- 0049_org_application.sql
--
-- A hospital applies by itself (`PRD.md` `FR-ONB-09`, `FR-ONB-10`;
-- DATABASE.md §2.2; plan D1).
--
-- Until now a workspace was made by a platform administrator and nobody
-- else. A public form now makes one too. What it makes is the same row in
-- the same state, `setup`, which is not live and cannot be (0037's CHECK);
-- what this migration adds is only what tells the two apart and what the
-- form holds that nothing held before.
--
-- ## `self_registered`
--
-- True for a workspace the hospital applied for. The platform administrator
-- sees it among those waiting, with that it was self-registered, and it goes
-- live only by the review every workspace goes through (`FR-ONB-04`).
--
-- ## `application_key`
--
-- The Idempotency-Key the form was sent with. A form sent twice, because the
-- first answer was lost on the way back, is answered with the workspace the
-- first one made and makes no second (CLAUDE.md §7). Unique among the rows
-- that have one; a workspace the platform made has none.
--
-- ## `staff_users.phone`
--
-- The applying administrator's mobile, which the form asks for so that a
-- person at the platform can ring the person who applied. A staff account
-- had no phone before; it stays optional for every other account.
--
-- Additive: three nullable or defaulted columns, two checks, one index.

ALTER TABLE hospitals
  ADD COLUMN self_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN application_key text;

ALTER TABLE hospitals
  ADD CONSTRAINT hospitals_application_key_is_an_application CHECK (
    application_key IS NULL OR self_registered
  );

CREATE UNIQUE INDEX hospitals_application_key_key
  ON hospitals (application_key) WHERE application_key IS NOT NULL;

COMMENT ON COLUMN hospitals.self_registered IS
  'True when the hospital applied for this workspace itself (FR-ONB-09). It goes live only by review, like any other.';
COMMENT ON COLUMN hospitals.application_key IS
  'The Idempotency-Key of the application that made this workspace, so a repeat makes no second (FR-ONB-09).';

ALTER TABLE staff_users
  ADD COLUMN phone text;

ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_phone_shape CHECK (
    phone IS NULL OR phone ~ '^\+8801[3-9][0-9]{8}$'
  );

COMMENT ON COLUMN staff_users.phone IS
  'A mobile to reach this member of staff on, normalised +8801… . Given by an administrator who applied (FR-ONB-09); null otherwise.';
