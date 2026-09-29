-- 0033_staff_2fa.sql
--
-- A second factor for staff sign-in (pilot step 28, CLAUDE.md §4.2,
-- FR-SEC-06, FR-SEC-10): a six-digit code from an authenticator app
-- (TOTP, RFC 6238), required for administrators and open to every account.
--
-- ## What the columns are for
--
-- totp_secret (0003) — the shared secret, encrypted by the API before it is
--   written (AES-256-GCM, TOTP_ENCRYPTION_KEY). It is written when the person
--   starts setting up and is shown to them once, as a QR code and as text, to
--   put into their app. Until totp_enabled_at is set it is only a proposal:
--   a sign-in does not ask for it.
-- totp_enabled_at — when the person proved their app holds the secret by
--   typing a code from it. From then on every sign-in asks for a code.
-- totp_last_step — the 30-second step of the last code accepted. A code is
--   accepted only for a later step, so one read over a shoulder or out of a
--   log cannot be used again in the same half-minute.
-- totp_recovery_hashes — ten single-use recovery codes, for a lost phone,
--   shown once when the second factor is turned on. Only a keyed hash of each
--   is kept (HMAC-SHA-256 with the same key), and a used one is removed.
--
-- A lost phone and lost recovery codes are an administrator's reset from
-- S-B-11 (audited, SETTINGS_CHANGE), or `pnpm staff:reset-2fa` on the server
-- for a facility's only administrator. Either clears all four columns.

ALTER TABLE staff_users
  ADD COLUMN totp_enabled_at       timestamptz,
  ADD COLUMN totp_last_step        bigint,
  ADD COLUMN totp_recovery_hashes  text[]      NOT NULL DEFAULT '{}';

-- On only with a secret to check against.
ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_totp_enabled_has_secret
    CHECK (totp_enabled_at IS NULL OR totp_secret IS NOT NULL);

COMMENT ON COLUMN staff_users.totp_secret IS
  'Encrypted by the application before storage (AES-256-GCM). Shown once, to its own holder, while setting up the second factor; never logged, never returned otherwise.';
COMMENT ON COLUMN staff_users.totp_enabled_at IS
  'When the second factor was confirmed with a code; null means sign-in asks for none (0033).';
COMMENT ON COLUMN staff_users.totp_last_step IS
  'The TOTP time step last accepted; a code is accepted only for a later one (0033).';
COMMENT ON COLUMN staff_users.totp_recovery_hashes IS
  'HMAC-SHA-256 of each unused recovery code; a used one is removed (0033).';
COMMENT ON COLUMN staff_users.password_hash IS
  'scrypt via node:crypto, stored as scrypt$<N>$<r>$<p>$<salt>$<hash> (0027).';
