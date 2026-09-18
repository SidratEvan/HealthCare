-- 0004_facilities.sql
--
-- The facilities themselves, their departments, the doctors who sit in them,
-- and the emergency capabilities they publish to the network.
--
-- DATABASE.md §2.2.
--
-- Note on `hospitals.settings_id`: DATABASE.md §2.2 lists that column, and it
-- is deliberately not created here. `hospital_settings.hospital_id` is already
-- the primary key and the foreign key, so a second link in the opposite
-- direction would be a second source of truth for the same relationship, free
-- to drift. Flagged for a DATABASE.md edit rather than resolved silently; the
-- column is one line to add back if that call is wrong.

-- ===========================================================================
-- hospitals — a facility: hospital, clinic, diagnostic centre or government
-- ===========================================================================

CREATE TABLE hospitals (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name_bn          text          NOT NULL,
  name_en          text          NOT NULL,
  kind             facility_kind NOT NULL,
  division         text          NOT NULL,
  district         text          NOT NULL,
  thana            text,
  address_bn       text,
  address_en       text,
  lat              double precision,
  lng              double precision,
  phone            text,
  emergency_phone  text,
  is_live          boolean       NOT NULL DEFAULT false,
  onboarded_at     timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  created_by       uuid          REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at       timestamptz,

  -- Bangladesh sits roughly within 20.5-26.7 N, 88.0-92.7 E. A coordinate
  -- outside that is a data-entry error, and in emergency search a wrong
  -- coordinate is worse than a missing one: it produces a confident, wrong
  -- travel time (PRD.md §3.2, honest degradation).
  CONSTRAINT hospitals_lat_in_bangladesh CHECK (lat IS NULL OR lat BETWEEN 20.0 AND 27.0),
  CONSTRAINT hospitals_lng_in_bangladesh CHECK (lng IS NULL OR lng BETWEEN 87.5 AND 93.0),
  CONSTRAINT hospitals_coords_paired CHECK (num_nonnulls(lat, lng) <> 1),

  CONSTRAINT hospitals_phone_normalised
    CHECK (phone IS NULL OR phone ~ '^\+880[0-9]{8,11}$'),
  CONSTRAINT hospitals_emergency_phone_normalised
    CHECK (emergency_phone IS NULL OR emergency_phone ~ '^\+880[0-9]{8,11}$'),

  -- A facility cannot be live without having been onboarded; `is_live` gates
  -- public visibility, and an unverified facility must never appear in search.
  CONSTRAINT hospitals_live_requires_onboarding
    CHECK (NOT is_live OR onboarded_at IS NOT NULL)
);

-- DATABASE.md §6: geography(Point,4326) with a GiST index. Generated from
-- lat/lng so there is exactly one place a coordinate is entered and no way for
-- the two representations to disagree.
ALTER TABLE hospitals
  ADD COLUMN geo geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN lat IS NULL OR lng IS NULL THEN NULL
      ELSE ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    END
  ) STORED;

CREATE INDEX hospitals_geo_gix ON hospitals USING gist (geo);
CREATE INDEX hospitals_district_idx ON hospitals (district);

-- The public discovery query is always scoped to live facilities.
CREATE INDEX hospitals_live_idx ON hospitals (is_live) WHERE is_live AND deleted_at IS NULL;

CREATE TRIGGER trg_hospitals_touch
  BEFORE UPDATE ON hospitals
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE hospitals ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN hospitals.geo IS
  'Generated from lat/lng. Used by fn_nearby_hospitals for emergency ranking (FR-PAT-43).';
COMMENT ON COLUMN hospitals.is_live IS
  'False until onboarding completes. Gates every public surface.';

-- Deferred foreign keys from 0003, now that hospitals exists.
ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_hospital_id_fkey
  FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT;

ALTER TABLE staff_roles
  ADD CONSTRAINT staff_roles_hospital_id_fkey
  FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE CASCADE;

CREATE INDEX staff_users_hospital_idx ON staff_users (hospital_id);

-- ===========================================================================
-- hospital_settings — the knobs that change queue behaviour per facility
--
-- Every default here is the one named in the requirements, so a hospital that
-- never opens the settings screen still behaves as specified.
-- ===========================================================================

CREATE TABLE hospital_settings (
  hospital_id              uuid PRIMARY KEY
                             REFERENCES hospitals (id) ON DELETE CASCADE,

  -- FR-QUE-20: grace before no-show is 2 patients or 15 minutes, whichever is
  -- longer. Both halves are stored because the rule needs both.
  no_show_grace_patients   integer     NOT NULL DEFAULT 2,
  no_show_grace_minutes    integer     NOT NULL DEFAULT 15,

  -- FR-QUE-21: a late patient is re-inserted after k patients, never dropped.
  late_reinsert_after      integer     NOT NULL DEFAULT 3,

  -- FR-OFF-04: beyond this, a live figure is labelled stale and de-ranked.
  stale_threshold_minutes  integer     NOT NULL DEFAULT 10,

  refund_policy            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sms_budget_monthly       integer,
  prepay_required          boolean     NOT NULL DEFAULT false,
  numeral_style            text        NOT NULL DEFAULT 'latin',
  density_default          text        NOT NULL DEFAULT 'compact',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid        REFERENCES staff_users (id) ON DELETE SET NULL,

  CONSTRAINT hospital_settings_grace_non_negative
    CHECK (no_show_grace_patients >= 0 AND no_show_grace_minutes >= 0),
  CONSTRAINT hospital_settings_reinsert_positive
    CHECK (late_reinsert_after > 0),
  CONSTRAINT hospital_settings_stale_positive
    CHECK (stale_threshold_minutes > 0),
  CONSTRAINT hospital_settings_sms_budget_non_negative
    CHECK (sms_budget_monthly IS NULL OR sms_budget_monthly >= 0),
  CONSTRAINT hospital_settings_refund_policy_is_object
    CHECK (jsonb_typeof(refund_policy) = 'object'),

  -- TYP-04: console surfaces default to Latin digits for data-entry speed;
  -- patient surfaces always use Bengali numerals and are not configurable.
  CONSTRAINT hospital_settings_numeral_style_allowed
    CHECK (numeral_style IN ('latin', 'bengali')),
  CONSTRAINT hospital_settings_density_allowed
    CHECK (density_default IN ('comfortable', 'compact'))
);

CREATE TRIGGER trg_hospital_settings_touch
  BEFORE UPDATE ON hospital_settings
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE hospital_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE hospital_settings IS
  'Per-facility queue and messaging policy. Defaults match the requirements exactly (FR-QUE-20, FR-QUE-21, FR-OFF-04).';

-- ===========================================================================
-- departments — specialty units inside a hospital
-- ===========================================================================

CREATE TABLE departments (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id  uuid        NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
  name_bn      text        NOT NULL,
  name_en      text        NOT NULL,
  code         text        NOT NULL,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at   timestamptz
);

CREATE UNIQUE INDEX departments_hospital_code_key
  ON departments (hospital_id, code) WHERE deleted_at IS NULL;

CREATE INDEX departments_hospital_idx ON departments (hospital_id, sort_order);

CREATE TRIGGER trg_departments_touch
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- doctors — a verified practitioner
--
-- An unverified doctor cannot be published (FR-SUP-02); `bmdc_verified_at`
-- carries that fact and the platform admin workflow sets it.
-- ===========================================================================

CREATE TABLE doctors (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  full_name_bn             text        NOT NULL,
  full_name_en             text        NOT NULL,
  bmdc_number              text        NOT NULL,
  bmdc_verified_at         timestamptz,
  degrees                  text,
  specialties              text[]      NOT NULL DEFAULT '{}',
  photo_url                text,

  -- Seeds the rolling consultation rate for a doctor with no history
  -- (FR-QUE-10). 15 minutes is the configured fallback for a new doctor.
  default_consult_minutes  integer     NOT NULL DEFAULT 15,

  user_id                  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at               timestamptz,

  CONSTRAINT doctors_consult_minutes_plausible
    CHECK (default_consult_minutes BETWEEN 1 AND 180)
);

CREATE UNIQUE INDEX doctors_bmdc_number_key
  ON doctors (bmdc_number) WHERE deleted_at IS NULL;

CREATE INDEX doctors_specialties_gin ON doctors USING gin (specialties);

-- FR-PAT-11 / FR-PAT-15: browse and search by name in both scripts. A trigram
-- or full-text strategy tolerant of misspelled doctor names is a step-9
-- concern; this index serves the exact and prefix cases in the meantime.
CREATE INDEX doctors_name_en_idx ON doctors (lower(full_name_en));
CREATE INDEX doctors_name_bn_idx ON doctors (full_name_bn);

CREATE TRIGGER trg_doctors_touch
  BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN doctors.bmdc_verified_at IS
  'Null means unverified, which means not publishable (FR-SUP-02).';
COMMENT ON COLUMN doctors.user_id IS
  'The doctor''s own login, for the doctor console. Optional: many doctors never use it.';

-- ===========================================================================
-- doctor_hospitals — a doctor sitting at a facility, in a department, for a fee
-- ===========================================================================

CREATE TABLE doctor_hospitals (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_id      uuid        NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
  hospital_id    uuid        NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
  department_id  uuid        NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,

  -- DB-P5: money is integer poisha. 1 BDT = 100 poisha, never a float.
  fee_poisha     integer     NOT NULL,

  room           text,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at     timestamptz,

  CONSTRAINT doctor_hospitals_fee_non_negative CHECK (fee_poisha >= 0)
);

CREATE UNIQUE INDEX doctor_hospitals_unique
  ON doctor_hospitals (doctor_id, hospital_id, department_id) WHERE deleted_at IS NULL;

CREATE INDEX doctor_hospitals_hospital_idx ON doctor_hospitals (hospital_id, is_active);
CREATE INDEX doctor_hospitals_doctor_idx ON doctor_hospitals (doctor_id, is_active);

CREATE TRIGGER trg_doctor_hospitals_touch
  BEFORE UPDATE ON doctor_hospitals
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE doctor_hospitals ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN doctor_hospitals.fee_poisha IS
  'Integer poisha (DB-P5). Copied onto a session at creation so a fee change never rewrites history.';

-- ===========================================================================
-- capabilities — what a facility can actually treat (FR-EMG-05)
--
-- This table feeds emergency search. A stale or wrong row here can send a burn
-- case to a hospital with no burn unit, so `updated_by` and `updated_at` are
-- not audit decoration: they drive the freshness label and the de-ranking that
-- a patient sees (FR-PAT-45).
-- ===========================================================================

CREATE TABLE capabilities (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id   uuid            NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
  kind          capability_kind NOT NULL,
  is_available  boolean         NOT NULL DEFAULT false,
  updated_by    uuid            REFERENCES staff_users (id) ON DELETE SET NULL,
  created_at    timestamptz     NOT NULL DEFAULT now(),
  updated_at    timestamptz     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX capabilities_hospital_kind_key ON capabilities (hospital_id, kind);

-- The emergency query filters on capability first, then ranks (DATABASE.md §6).
CREATE INDEX capabilities_available_idx
  ON capabilities (kind, hospital_id) WHERE is_available;

CREATE TRIGGER trg_capabilities_touch
  BEFORE UPDATE ON capabilities
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE capabilities ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE capabilities IS
  'Per-facility treatment abilities, published to the emergency network (FR-EMG-05). Read by patients only through v_public_hospital_capacity.';
COMMENT ON COLUMN capabilities.updated_at IS
  'Drives the freshness stamp shown to a patient in emergency results (FR-PAT-44, FR-OFF-03).';
