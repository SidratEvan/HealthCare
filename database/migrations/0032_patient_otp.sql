-- 0032_patient_otp.sql
--
-- A patient proves a phone is theirs with a one-time code (pilot step 25,
-- `FR-PAT-01`, `FR-SEC-05`, DATABASE.md §2.1 `otp_challenges`).
--
-- One row per code sent. Only a keyed hash of the code is stored, so a
-- database read cannot sign anybody in; the code itself exists in one SMS and
-- nowhere else (CLAUDE.md §7: never log an OTP).
--
-- attempts, locked_until — five wrong codes lock the number for fifteen
--   minutes (`S-A-04`: "5 wrong attempts → lock 15 min"). Counted per number,
--   so guessing from many devices is stopped as surely as from one.
-- The send rate (`OTP_MAX_PER_HOUR`) is counted from these rows' `created_at`.

CREATE TABLE otp_challenges (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone         text        NOT NULL,
  code_hash     text        NOT NULL,
  attempts      integer     NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  locked_until  timestamptz,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT otp_challenges_phone_normalised CHECK (phone ~ '^\+8801[3-9][0-9]{8}$'),
  CONSTRAINT otp_challenges_attempts_non_negative CHECK (attempts >= 0)
);

CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone, created_at DESC);

CREATE TRIGGER trg_otp_challenges_touch
  BEFORE UPDATE ON otp_challenges
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE otp_challenges ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE otp_challenges IS
  'One row per code sent (FR-PAT-01). A keyed hash only; five wrong codes lock the number for fifteen minutes (FR-SEC-05).';
