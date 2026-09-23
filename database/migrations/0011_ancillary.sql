-- 0011_ancillary.sql
--
-- Ambulances, blood and pharmacy stock (DATABASE.md §2.8).
--
-- Step 17 (`feat/lab-pharmacy`) needs exactly one of these five tables —
-- `pharmacy_stock`, for `FR-PHR-02`. The other four are written here anyway,
-- because DATABASE.md §7 defines 0011 as this set and a shipped migration is
-- never edited: leaving them out would mean a second migration later for
-- tables already specified. It is the trade 0007 made for the lab and 0008
-- made for referrals, and it is what `seed_06_ancillary` has been declaring
-- as `pendingMigration` since step 5 (`FR-DEM-05`).
--
-- The screens are not step 17's. `S-A-16` (ambulance, `FR-PAT-74`) and
-- `S-A-17` (blood, `FR-PAT-75`) are later; nothing in this branch reads
-- `ambulances`, `ambulance_requests`, `blood_donors` or `blood_requests`
-- beyond the seed that fills them.
--
-- ## What this file does not create
--
-- **Blood stock by group is still absent** (`FR-EMG-06`, `INP-B07-BLOOD`).
-- DATABASE.md §2.8 gives donors and requests, not a hospital's inventory by
-- group, and inventing the table here would be schema nobody specified. The
-- ER console's blood control stays unbuilt and is recorded as a deliberate gap.
--
-- ## Enums
--
-- Four enums are created here rather than in 0002, which is shipped. Each is
-- the inline list DATABASE.md §2.8 gives in parentheses; `blood_group` is the
-- eight ABO/Rh groups, which is not a product decision.

-- ===========================================================================
-- Enums (DATABASE.md §2.8's parenthesised lists)
-- ===========================================================================

CREATE TYPE ambulance_kind    AS ENUM ('basic','als','freezer');

CREATE TYPE ambulance_state   AS ENUM (
  'requested','quoted','dispatched','arrived','completed','cancelled'
);

CREATE TYPE blood_group       AS ENUM ('A+','A-','B+','B-','AB+','AB-','O+','O-');

CREATE TYPE blood_request_state AS ENUM ('open','matched','fulfilled','cancelled');

-- `urgency` has no list in the document. Emergency already speaks in three
-- colours (`triage_color`), and a fourth vocabulary for the same idea would be
-- one more thing to translate at a desk, so a blood request borrows it.

-- ===========================================================================
-- ambulances — the vehicles, and what they cost before one is sent
-- ===========================================================================

CREATE TABLE ambulances (
  id                uuid            PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Nullable: DATABASE.md §2.8. Most ambulances in Bangladesh belong to
  -- private operators rather than to a hospital, and those are the ones a
  -- family actually reaches.
  hospital_id       uuid            REFERENCES hospitals (id) ON DELETE SET NULL,

  operator_name     text            NOT NULL,
  kind              ambulance_kind  NOT NULL,
  plate             text            NOT NULL,
  driver_name       text            NOT NULL,
  driver_phone      text            NOT NULL,

  -- `FR-PAT-74`: the fare is quoted before dispatch and then locked. These two
  -- are what the quote is computed from, so they are money and therefore
  -- integer poisha (CLAUDE.md §7).
  base_fare_poisha  integer         NOT NULL,
  per_km_poisha     integer         NOT NULL,

  is_available      boolean         NOT NULL DEFAULT true,

  created_at        timestamptz     NOT NULL DEFAULT now(),
  updated_at        timestamptz     NOT NULL DEFAULT now(),
  created_by        uuid            REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at        timestamptz,

  CONSTRAINT ambulances_operator_not_blank CHECK (btrim(operator_name) <> ''),
  CONSTRAINT ambulances_plate_not_blank    CHECK (btrim(plate) <> ''),
  CONSTRAINT ambulances_driver_not_blank   CHECK (btrim(driver_name) <> ''),
  CONSTRAINT ambulances_phone_normalised
    CHECK (driver_phone ~ '^\+8801[3-9][0-9]{8}$'),
  CONSTRAINT ambulances_fares_non_negative
    CHECK (base_fare_poisha >= 0 AND per_km_poisha >= 0)
);

CREATE UNIQUE INDEX ambulances_plate_key ON ambulances (plate) WHERE deleted_at IS NULL;
CREATE INDEX ambulances_available_idx
  ON ambulances (kind, is_available) WHERE deleted_at IS NULL;
CREATE INDEX ambulances_hospital_idx
  ON ambulances (hospital_id) WHERE hospital_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_ambulances_touch
  BEFORE UPDATE ON ambulances
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE ambulances ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN ambulances.driver_phone IS
  'Given to the family only after dispatch (S-A-16), never in a search result.';

-- ===========================================================================
-- ambulance_requests — and the fare that may not move (FR-PAT-74)
-- ===========================================================================

CREATE TABLE ambulance_requests (
  id                      uuid             PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Exactly one requester, as every other patient-facing table in this schema
  -- has: an account or a guest, never both and never neither.
  requester_user_id       uuid             REFERENCES users (id) ON DELETE RESTRICT,
  guest_id                uuid             REFERENCES guest_identities (id) ON DELETE RESTRICT,

  pickup_lat              double precision NOT NULL,
  pickup_lng              double precision NOT NULL,
  destination_hospital_id uuid             REFERENCES hospitals (id) ON DELETE SET NULL,

  kind                    ambulance_kind   NOT NULL,
  ambulance_id            uuid             REFERENCES ambulances (id) ON DELETE SET NULL,

  -- `FR-PAT-74`: "the quoted fare is locked; any change attempt is a violation
  -- flagged to support". The lock is the trigger below, not a convention.
  quoted_fare_poisha      integer          NOT NULL,

  state                   ambulance_state  NOT NULL DEFAULT 'requested',
  dispatched_at           timestamptz,
  completed_at            timestamptz,

  created_at              timestamptz      NOT NULL DEFAULT now(),
  updated_at              timestamptz      NOT NULL DEFAULT now(),
  deleted_at              timestamptz,

  CONSTRAINT ambulance_requests_one_requester
    CHECK (num_nonnulls(requester_user_id, guest_id) = 1),
  CONSTRAINT ambulance_requests_fare_non_negative CHECK (quoted_fare_poisha >= 0),
  CONSTRAINT ambulance_requests_pickup_in_bangladesh
    CHECK (pickup_lat BETWEEN 20.5 AND 26.7 AND pickup_lng BETWEEN 88.0 AND 92.7),
  CONSTRAINT ambulance_requests_timeline_ordered
    CHECK (completed_at IS NULL OR dispatched_at IS NULL OR completed_at >= dispatched_at),
  -- A dispatched request names the vehicle that went. A family told "one is on
  -- its way" with no row saying which is a promise nobody can keep.
  CONSTRAINT ambulance_requests_dispatched_names_vehicle
    CHECK (state NOT IN ('dispatched','arrived','completed') OR ambulance_id IS NOT NULL)
);

CREATE INDEX ambulance_requests_open_idx
  ON ambulance_requests (state, created_at DESC)
  WHERE state IN ('requested','quoted','dispatched','arrived') AND deleted_at IS NULL;
CREATE INDEX ambulance_requests_requester_idx
  ON ambulance_requests (requester_user_id, created_at DESC)
  WHERE requester_user_id IS NOT NULL;
CREATE INDEX ambulance_requests_guest_idx
  ON ambulance_requests (guest_id, created_at DESC) WHERE guest_id IS NOT NULL;

CREATE TRIGGER trg_ambulance_requests_touch
  BEFORE UPDATE ON ambulance_requests
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- The fare lock, in the database rather than in a service (`FR-PAT-74`).
-- A quote a family accepted is not something a later code path may revise.
CREATE FUNCTION fn_ambulance_fare_locked() RETURNS trigger AS $fare$
BEGIN
  IF NEW.quoted_fare_poisha IS DISTINCT FROM OLD.quoted_fare_poisha THEN
    RAISE EXCEPTION
      'ambulance_requests.quoted_fare_poisha is locked once quoted (FR-PAT-74)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fare$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ambulance_requests_fare_locked
  BEFORE UPDATE ON ambulance_requests
  FOR EACH ROW EXECUTE FUNCTION fn_ambulance_fare_locked();

ALTER TABLE ambulance_requests ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- blood_donors / blood_requests (FR-PAT-75)
-- ===========================================================================

CREATE TABLE blood_donors (
  id                 uuid         PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Nullable: a donor may be somebody who registered through the app, or a
  -- name and number a hospital holds without an account behind it.
  user_id            uuid         REFERENCES users (id) ON DELETE SET NULL,

  name               text         NOT NULL,
  phone              text         NOT NULL,
  blood_group        blood_group  NOT NULL,
  district           text         NOT NULL,
  last_donation_date date,
  is_available       boolean      NOT NULL DEFAULT true,

  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  CONSTRAINT blood_donors_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT blood_donors_district_not_blank CHECK (btrim(district) <> ''),
  CONSTRAINT blood_donors_phone_normalised
    CHECK (phone ~ '^\+8801[3-9][0-9]{8}$'),
  -- A donation in the future is a typo, and the eligibility countdown `S-A-17`
  -- shows would be computed from it.
  CONSTRAINT blood_donors_last_donation_not_future
    CHECK (last_donation_date IS NULL OR last_donation_date <= current_date)
);

CREATE UNIQUE INDEX blood_donors_phone_key ON blood_donors (phone) WHERE deleted_at IS NULL;
CREATE INDEX blood_donors_search_idx
  ON blood_donors (blood_group, district, is_available) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_blood_donors_touch
  BEFORE UPDATE ON blood_donors
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE blood_donors ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE blood_donors IS
  'A donor is a real person''s phone and blood group. Demo rows come from the synthetic phone block and carry the FR-DEM-07 label like every other person here.';

CREATE TABLE blood_requests (
  id            uuid                 PRIMARY KEY DEFAULT uuid_generate_v7(),

  patient_id    uuid                 REFERENCES patients (id) ON DELETE SET NULL,
  hospital_id   uuid                 NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,

  blood_group   blood_group          NOT NULL,
  units         integer              NOT NULL,
  urgency       triage_color         NOT NULL,
  state         blood_request_state  NOT NULL DEFAULT 'open',
  fulfilled_at  timestamptz,

  created_at    timestamptz          NOT NULL DEFAULT now(),
  updated_at    timestamptz          NOT NULL DEFAULT now(),
  created_by    uuid                 REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at    timestamptz,

  CONSTRAINT blood_requests_units_sane CHECK (units BETWEEN 1 AND 20),
  CONSTRAINT blood_requests_fulfilled_has_time
    CHECK ((state = 'fulfilled') = (fulfilled_at IS NOT NULL))
);

CREATE INDEX blood_requests_open_idx
  ON blood_requests (blood_group, urgency, created_at DESC)
  WHERE state IN ('open','matched') AND deleted_at IS NULL;
CREATE INDEX blood_requests_hospital_idx
  ON blood_requests (hospital_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_blood_requests_touch
  BEFORE UPDATE ON blood_requests
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE blood_requests ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- pharmacy_stock — the one table step 17 reads (FR-PHR-02)
-- ===========================================================================
--
-- "Out-of-stock flagging feeds medicine availability search in the patient
-- app." So this table is read by the public, and that is what shapes it.
--
-- It holds a boolean and a time, not a count. `DATABASE.md` §2.8 says
-- `in_stock boolean`, and the reason is the same one `FR-EMG-06` gives for
-- blood — "published as availability, not exact inventory". A pharmacy that
-- had to keep a number true would stop updating it, and a stale number is a
-- family crossing Dhaka for a medicine that is not there (`PRD.md` §3.2).
--
-- `updated_at` is therefore not bookkeeping: it is the freshness stamp the
-- patient app renders beside every flag (`FR-OFF-03`, `GR-05`). A row nobody
-- has touched for two days says so rather than claiming today's truth.

CREATE TABLE pharmacy_stock (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  hospital_id  uuid        NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,
  medicine_id  uuid        NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,

  in_stock     boolean     NOT NULL DEFAULT true,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at   timestamptz
);

-- One row per medicine per pharmacy. Two rows disagreeing about one medicine
-- is the failure this table exists to publish, so it cannot be allowed to
-- happen in the first place.
CREATE UNIQUE INDEX pharmacy_stock_hospital_medicine_key
  ON pharmacy_stock (hospital_id, medicine_id) WHERE deleted_at IS NULL;

-- The patient's search: "who near me has this medicine".
CREATE INDEX pharmacy_stock_medicine_idx
  ON pharmacy_stock (medicine_id, in_stock) WHERE deleted_at IS NULL;

-- The pharmacy console's own list, oldest flag first — what needs checking.
CREATE INDEX pharmacy_stock_hospital_idx
  ON pharmacy_stock (hospital_id, updated_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_pharmacy_stock_touch
  BEFORE UPDATE ON pharmacy_stock
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE pharmacy_stock ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN pharmacy_stock.in_stock IS
  'Availability, not inventory (FR-PHR-02). updated_at is the freshness stamp the patient app renders beside it; a flag nobody has touched says its age.';
