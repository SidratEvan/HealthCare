-- 0027_staff_auth.sql
--
-- Staff sign in with their own account (pilot step 21, CLAUDE.md §4.1–4.2,
-- FR-SEC-06). Until the pitch, the console chose a hospital and a role without
-- a password, and staff_users.password_hash held a value that verified
-- nothing. A real deployment for a hospital runs on a server in Bangladesh,
-- where Supabase Auth does not, so the login is built here.
--
-- ## What the columns are for
--
-- must_change_password — an administrator (or the first-admin command) sets a
--   temporary password; the first login asks for the person's own before any
--   console opens. The API enforces it, not only the screen: an access token
--   issued while it is set opens nothing but the password change.
-- failed_login_count, locked_until — five consecutive failures lock the
--   account for fifteen minutes (BACKEND.md §7.1, AUTH_LOCKED). A success
--   resets the count. Counting per account, not per address, is what stops a
--   password being guessed from many machines.
-- password_changed_at — when the person last set it; a change revokes every
--   other refresh token for the account.
--
-- hospitals.code — a short code (MARKS) the login asks for only when one email
--   exists at more than one facility on the same deployment (AUTH_HOSPITAL_REQUIRED).
--   Nullable: a facility without one is reached by email alone.
--
-- The hash itself is scrypt from node:crypto, stored self-describing as
-- scrypt$<N>$<r>$<p>$<salt>$<hash>, so its parameters can rise later without a
-- migration (DATABASE.md §2.1). Nothing here constrains the format, because a
-- seeded "!disabled" placeholder must still be storable and must verify
-- nothing.

ALTER TABLE staff_users
  ADD COLUMN must_change_password boolean     NOT NULL DEFAULT false,
  ADD COLUMN failed_login_count   integer     NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         timestamptz,
  ADD COLUMN password_changed_at  timestamptz;

ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_failed_login_count_non_negative
    CHECK (failed_login_count >= 0);

ALTER TABLE hospitals
  ADD COLUMN code text;

ALTER TABLE hospitals
  ADD CONSTRAINT hospitals_code_shape
    CHECK (code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$');

CREATE UNIQUE INDEX hospitals_code_key
  ON hospitals (code) WHERE code IS NOT NULL AND deleted_at IS NULL;

-- Looking an account up by email is the login's first read.
CREATE INDEX staff_users_email_idx
  ON staff_users (lower(email)) WHERE deleted_at IS NULL;

-- sessions_auth needs nothing new: a refresh token is found by its primary
-- key, and 0003's sessions_auth_subject_idx already serves "revoke every
-- other session" after a password change.
