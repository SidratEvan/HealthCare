-- 0003_identity.sql
--
-- Who a person is to this system: account holders, guests who never registered,
-- the clinical subjects they book for, hospital staff, login sessions, and the
-- tracking links that let a guest watch a queue without an account.
--
-- DATABASE.md §2.1.
--
-- Forward references: `staff_users.hospital_id`, `staff_roles.hospital_id` and
-- `guest_links.booking_id` point at tables created in 0004 and 0005. The
-- columns are declared here and the foreign keys are added by those migrations,
-- which keeps DATABASE.md §7's file order intact without a circular dependency.
--
-- Row-level security is enabled on every table as it is created, with no
-- policies yet: an enabled table with no policy denies all access to
-- non-owner, non-superuser roles, which fails safe. 0014 adds the policies
-- (DATABASE.md §5). The API connects as the table owner until then, so nothing
-- is blocked; a leaked anon credential reads nothing.

-- ===========================================================================
-- users — one row per phone number that has registered (FR-PAT-01)
-- ===========================================================================

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone              text        NOT NULL,
  kind               user_kind   NOT NULL DEFAULT 'patient',
  locale             text        NOT NULL DEFAULT 'bn',
  phone_verified_at  timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  -- DB-P6: stored normalised as +8801XXXXXXXXX. Validated here as well as in
  -- the application, because a mis-normalised number silently splits a
  -- person's history across two identities.
  CONSTRAINT users_phone_normalised CHECK (phone ~ '^\+8801[3-9][0-9]{8}$'),

  -- DATABASE.md §2.1 scopes this table to account holders and platform staff;
  -- a guest lives in guest_identities and hospital staff in staff_users.
  CONSTRAINT users_kind_allowed CHECK (kind IN ('patient', 'platform')),

  -- FR-LOC-01 / I18N-01: two locales, bn default. Not a negotiation framework.
  CONSTRAINT users_locale_allowed CHECK (locale IN ('bn', 'en'))
);

-- Unique among the living. A privacy erasure (DB-P2) tombstones the row, and
-- the same number must be able to register again afterwards.
CREATE UNIQUE INDEX users_phone_key ON users (phone) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_users_touch
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE users IS 'Account holders. Phone + OTP only, no passwords (FR-PAT-01).';
COMMENT ON COLUMN users.locale IS 'Applies to both the app and outbound SMS (FR-PAT-05, FR-NOT-04).';

-- ===========================================================================
-- guest_identities — a person who booked without registering (FR-GST)
--
-- Guest mode is a first-class path, not a degraded one (FR-GST-01). This table
-- is what makes a second guest booking ask only for confirmation (FR-GST-12)
-- and what a later sign-up claims (FR-GST-09).
-- ===========================================================================

CREATE TABLE guest_identities (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone               text        NOT NULL,
  display_name        text,
  phone_verified_at   timestamptz,
  claimed_by_user_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  claimed_at          timestamptz,
  booking_count       integer     NOT NULL DEFAULT 0,
  no_show_count       integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  CONSTRAINT guest_identities_phone_normalised CHECK (phone ~ '^\+8801[3-9][0-9]{8}$'),
  CONSTRAINT guest_identities_counts_non_negative
    CHECK (booking_count >= 0 AND no_show_count >= 0),

  -- Claimed means claimed by someone, at a known time — never half of each.
  CONSTRAINT guest_identities_claim_consistent
    CHECK (num_nonnulls(claimed_by_user_id, claimed_at) <> 1)
);

CREATE UNIQUE INDEX guest_identities_phone_key
  ON guest_identities (phone) WHERE deleted_at IS NULL;

CREATE INDEX guest_identities_claimed_by_idx
  ON guest_identities (claimed_by_user_id) WHERE claimed_by_user_id IS NOT NULL;

CREATE TRIGGER trg_guest_identities_touch
  BEFORE UPDATE ON guest_identities
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE guest_identities ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE guest_identities IS
  'A booking identity keyed by phone, created without an account (FR-GST-04) and claimable later (FR-GST-09).';
COMMENT ON COLUMN guest_identities.no_show_count IS
  'Rolling-window counter behind the prepayment rule for repeated no-shows (FR-GST-14).';

-- ===========================================================================
-- patients — a clinical subject
--
-- Belongs to a user or to a guest identity, never both and never neither. Every
-- booking, record and notification attaches to a patient, not to an account
-- (FR-PAT-03), which is what keeps a mother's records under her own profile
-- when her son does the booking.
-- ===========================================================================

CREATE TABLE patients (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_user_id   uuid        REFERENCES users (id) ON DELETE RESTRICT,
  owner_guest_id  uuid        REFERENCES guest_identities (id) ON DELETE RESTRICT,
  full_name       text        NOT NULL,
  date_of_birth   date,
  age_years       integer,
  sex             sex         NOT NULL,
  blood_group     text,
  phone           text,
  national_id     text,
  relationship    text        NOT NULL DEFAULT 'self',
  is_primary      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  deleted_at      timestamptz,

  CONSTRAINT patients_one_owner CHECK (num_nonnulls(owner_user_id, owner_guest_id) = 1),

  -- An age is needed for clinical context; either form satisfies it (FR-GST-02).
  CONSTRAINT patients_age_known CHECK (num_nonnulls(date_of_birth, age_years) >= 1),
  CONSTRAINT patients_age_plausible CHECK (age_years IS NULL OR age_years BETWEEN 0 AND 130),

  CONSTRAINT patients_relationship_allowed
    CHECK (relationship IN ('self', 'mother', 'father', 'child', 'spouse', 'other')),

  CONSTRAINT patients_blood_group_allowed
    CHECK (blood_group IS NULL OR blood_group IN
      ('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown')),

  CONSTRAINT patients_phone_normalised
    CHECK (phone IS NULL OR phone ~ '^\+8801[3-9][0-9]{8}$')
);

CREATE INDEX patients_owner_user_idx ON patients (owner_user_id);
CREATE INDEX patients_owner_guest_idx ON patients (owner_guest_id);
CREATE INDEX patients_phone_idx ON patients (phone);

-- One own-profile per owner, so "my profile" is never ambiguous (FR-PAT-02).
CREATE UNIQUE INDEX patients_one_primary_per_user
  ON patients (owner_user_id)
  WHERE is_primary AND owner_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX patients_one_primary_per_guest
  ON patients (owner_guest_id)
  WHERE is_primary AND owner_guest_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_patients_touch
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE patients IS
  'Clinical subjects. Owned by a user or a guest identity, never both (patients_one_owner).';
COMMENT ON COLUMN patients.national_id IS
  'Encrypted by the application before it reaches this column; never logged (CLAUDE.md §7).';
COMMENT ON COLUMN patients.phone IS
  'Contact for this patient, which may differ from the owner''s number.';

-- ===========================================================================
-- staff_users — hospital employees
--
-- Shared counter accounts are prohibited by design: every counter session
-- identifies the operator (FR-SEC-06).
-- ===========================================================================

CREATE TABLE staff_users (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- FK added by 0004, once hospitals exists.
  hospital_id    uuid        NOT NULL,
  email          text        NOT NULL,
  staff_code     text,
  full_name      text        NOT NULL,
  password_hash  text        NOT NULL,
  totp_secret    text,
  is_active      boolean     NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at     timestamptz
);

-- Email is unique within a hospital, not globally: the same doctor may hold an
-- account at two facilities (DATABASE.md §2.1).
CREATE UNIQUE INDEX staff_users_hospital_email_key
  ON staff_users (hospital_id, lower(email)) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX staff_users_hospital_code_key
  ON staff_users (hospital_id, staff_code)
  WHERE staff_code IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_staff_users_touch
  BEFORE UPDATE ON staff_users
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN staff_users.password_hash IS 'argon2id (BACKEND.md §0).';
COMMENT ON COLUMN staff_users.totp_secret IS
  'Encrypted by the application before storage. Never logged, never returned by an API.';

-- ===========================================================================
-- staff_roles — what a staff member may do, scoped to one hospital
--
-- A user may hold several roles (FR-ROLE-02); every role is hospital-scoped
-- except the platform and government roles (FR-ROLE-01).
-- ===========================================================================

CREATE TABLE staff_roles (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  staff_user_id  uuid        NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  -- FK added by 0004.
  hospital_id    uuid        NOT NULL,
  role           staff_role  NOT NULL,
  scope          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at     timestamptz,

  CONSTRAINT staff_roles_scope_is_object CHECK (jsonb_typeof(scope) = 'object')
);

CREATE UNIQUE INDEX staff_roles_unique
  ON staff_roles (staff_user_id, hospital_id, role) WHERE deleted_at IS NULL;

CREATE INDEX staff_roles_hospital_role_idx ON staff_roles (hospital_id, role);

CREATE TRIGGER trg_staff_roles_touch
  BEFORE UPDATE ON staff_roles
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN staff_roles.scope IS
  'Narrows a role within its hospital, e.g. {"wards":["3F"],"counters":["R2"]}.';

-- ===========================================================================
-- sessions_auth — login sessions for every kind of subject
--
-- Named `sessions_auth` rather than `sessions` because `sessions` is the
-- product''s central operational object: a doctor sitting in a chamber.
-- ===========================================================================

CREATE TABLE sessions_auth (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  subject_id          uuid        NOT NULL,
  subject_kind        text        NOT NULL,
  token_hash          text        NOT NULL,
  device_fingerprint  text,
  ip                  inet,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sessions_auth_subject_kind_allowed
    CHECK (subject_kind IN ('user', 'guest', 'staff'))
);

-- Only the hash is stored, so a database read cannot impersonate anyone.
CREATE UNIQUE INDEX sessions_auth_token_hash_key ON sessions_auth (token_hash);

CREATE INDEX sessions_auth_subject_idx ON sessions_auth (subject_kind, subject_id);

-- Supports both the refresh path and the expiry sweep.
CREATE INDEX sessions_auth_live_idx
  ON sessions_auth (expires_at) WHERE revoked_at IS NULL;

CREATE TRIGGER trg_sessions_auth_touch
  BEFORE UPDATE ON sessions_auth
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE sessions_auth ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE sessions_auth IS
  'Refresh-token sessions. Device binding supports the OTP takeover defence (FR-SEC-05).';

-- ===========================================================================
-- guest_links — the SMS tracking link (FR-GST-05)
--
-- One booking per link, expiring at session end plus grace, revocable. This is
-- how a person with no account watches their serial move: the link opens the
-- same live screen an account holder sees, with no login.
-- ===========================================================================

CREATE TABLE guest_links (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  token_hash    text        NOT NULL,
  -- FK added by 0005, once bookings exists.
  booking_id    uuid        NOT NULL,
  guest_id      uuid        NOT NULL REFERENCES guest_identities (id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX guest_links_token_hash_key ON guest_links (token_hash);
CREATE UNIQUE INDEX guest_links_booking_key ON guest_links (booking_id);
CREATE INDEX guest_links_guest_idx ON guest_links (guest_id);

CREATE TRIGGER trg_guest_links_touch
  BEFORE UPDATE ON guest_links
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE guest_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE guest_links IS
  'Single-booking, expiring, revocable tracking links (FR-GST-05). Retention: session end + 30 days (DATABASE.md §8).';
COMMENT ON COLUMN guest_links.token_hash IS
  'SHA-256 of a 32-byte random token. The token itself exists only in the SMS.';
