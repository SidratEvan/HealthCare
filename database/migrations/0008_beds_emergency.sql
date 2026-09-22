-- 0008_beds_emergency.sql
--
-- Beds, admissions, bed requests, emergency cases and referrals
-- (DATABASE.md §2.5).
--
-- Step 14 builds the ward board on the first five of these. `emergency_cases`
-- and `referrals` are created here too, because DATABASE.md §7 defines 0008 as
-- this set of tables and a shipped migration is never edited — leaving them out
-- would mean a second migration later for tables already specified, and
-- `admissions.emergency_case_id` needs `emergency_cases` to exist in any case.
-- Steps 15 and 16 are therefore screens rather than schema, which is the same
-- trade 0007 made for the lab.
--
-- ## The one rule this file exists to make hard to break
--
-- `PRD.md` §3.2: "A wrong 'bed available' can kill someone." A free bed is a
-- public claim that a family will drive across Dhaka on. So the constraints
-- below are about what a bed row may *say*: an occupied bed names its
-- admission, a reserved bed says until when, a bed out of service says why, and
-- a bed cannot be occupied by two people or one person occupy two beds. Every
-- one of those is a mistake a ward console could make under pressure, and the
-- database refuses each of them rather than trusting that it will not happen.
--
-- ## `beds` is the present, `bed_events` is the history
--
-- DATABASE.md §2.5 calls `bed_events` "append-only like the queue". It is not
-- the queue's arrangement exactly: the queue is *derived* from its log by a
-- reducer (DB-P1), while a bed's state is a single value a person sets. So
-- `beds.state` is written directly, in the same transaction as the event that
-- explains it, with the bed row locked — and `bed_events` is the record of who
-- changed what and when, which is what the public freshness stamp and the
-- occupancy figures are read from. The two are kept equal by the service, and
-- `seeds.test.ts` proves the seeded data agrees with itself.

-- ===========================================================================
-- wards — a room of beds, as the ward board's tabs name it (TAB-B06-<ward>)
-- ===========================================================================

CREATE TABLE wards (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id  uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  name_bn      text        NOT NULL,
  name_en      text        NOT NULL,

  -- An integer rather than a label, so the board can say "৩ তলা" or "Floor 3"
  -- in the reader's numerals. 0 is the ground floor; nothing here is below it.
  floor        smallint    NOT NULL,

  -- What the ward is for. A bed carries its own kind as well, because a
  -- general ward can hold an isolation bed, and it is the bed's kind the public
  -- counts are made of.
  kind         bed_kind    NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at   timestamptz,

  CONSTRAINT wards_floor_sane CHECK (floor BETWEEN 0 AND 60),
  CONSTRAINT wards_names_present CHECK (length(trim(name_bn)) > 0 AND length(trim(name_en)) > 0)
);

-- The target of `beds`' composite foreign key, which is what makes a bed in
-- one hospital's ward impossible to file under another hospital.
CREATE UNIQUE INDEX wards_id_hospital_key ON wards (id, hospital_id);

CREATE UNIQUE INDEX wards_hospital_name_key
  ON wards (hospital_id, name_en) WHERE deleted_at IS NULL;

CREATE INDEX wards_hospital_idx ON wards (hospital_id, floor) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_wards_touch
  BEFORE UPDATE ON wards
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE wards ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE wards IS
  'A ward, cabin block or unit — one tab on the ward board (S-B-06, TAB-B06-<ward>).';

-- ===========================================================================
-- emergency_cases — a person on their way to, or inside, an ER (FR-EMG-01)
--
-- Created here because DATABASE.md §7 puts it here; the ER console that fills
-- it is build step 15. Anonymous by design: `FR-GST-03` requires nothing at all
-- of somebody in an emergency, so a case may have no patient and no phone.
-- ===========================================================================

CREATE TABLE emergency_cases (
  id                   uuid            PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id          uuid            NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  patient_id           uuid            REFERENCES patients (id) ON DELETE RESTRICT,
  contact_phone        text,

  -- `FR-PAT-42`'s list. A CHECK rather than an enum because DATABASE.md §1
  -- does not declare one, and a text column is what the document gives.
  problem_type         text            NOT NULL,

  state                emergency_state NOT NULL DEFAULT 'inbound',

  -- Null until somebody triages the case. Unknown is not green.
  triage               triage_color,

  inbound_eta_minutes  integer,
  inbound_at           timestamptz,
  acknowledged_at      timestamptz,
  arrived_at           timestamptz,

  -- What the ER calls the case aloud before anybody knows a name ("ER-14").
  token_label          text,
  notes                text,

  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now(),
  created_by           uuid            REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at           timestamptz,

  CONSTRAINT emergency_cases_problem_allowed
    CHECK (problem_type IN (
      'burn', 'accident', 'cardiac', 'stroke', 'child', 'obstetric', 'breathing', 'other'
    )),
  CONSTRAINT emergency_cases_phone_normalised
    CHECK (contact_phone IS NULL OR contact_phone ~ '^\+8801[3-9][0-9]{8}$'),
  CONSTRAINT emergency_cases_eta_sane
    CHECK (inbound_eta_minutes IS NULL OR inbound_eta_minutes BETWEEN 0 AND 600)
);

-- `FR-EMG-04`: the load counter is derived from active cases, never typed.
CREATE INDEX emergency_cases_active_idx
  ON emergency_cases (hospital_id, state)
  WHERE state IN ('inbound', 'acknowledged', 'arrived', 'in_treatment') AND deleted_at IS NULL;

CREATE INDEX emergency_cases_patient_idx
  ON emergency_cases (patient_id) WHERE patient_id IS NOT NULL;

CREATE TRIGGER trg_emergency_cases_touch
  BEFORE UPDATE ON emergency_cases
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE emergency_cases ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE emergency_cases IS
  'Inbound alerts and ER cases (FR-EMG-01..04). Anonymous allowed (FR-GST-03). Written by build step 15.';

-- ===========================================================================
-- beds — one bed, and what it is doing right now (FR-BED-01, FR-BED-03)
-- ===========================================================================

CREATE TABLE beds (
  id                       uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id              uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  ward_id                  uuid        NOT NULL,

  -- What is painted on the wall: "301", "ICU-4", "C-12".
  label                    text        NOT NULL,
  kind                     bed_kind    NOT NULL,
  state                    bed_state   NOT NULL DEFAULT 'free',

  -- DB-P5. What a patient is quoted on `S-A-11` (`FR-PAT-51`).
  nightly_poisha           integer     NOT NULL,

  last_cleaned_at          timestamptz,

  -- `FR-BED-04`. A forecast, not a fact, so it lives beside the admission it
  -- forecasts rather than in the event log.
  expected_discharge_date  date,

  -- Foreign key added below, once `admissions` exists.
  current_admission_id     uuid,

  -- DATABASE.md §2.5 gives `beds` no column for either of these, and the ward
  -- board cannot work without both. `BTN-B06-RESERVE` is "hold with expiry;
  -- expiry auto-releases", which needs the expiry somewhere a query can see
  -- it — the public count reads it (`v_public_hospital_capacity` treats an
  -- expired hold as free), so it cannot live only inside an event payload.
  -- `BTN-B06-OOS` "marks out of service with reason", and the tile shows it.
  reserved_until           timestamptz,
  oos_reason               text,

  -- When the current state began. The cleaning timer on `BTN-B06-DISCHARGE`
  -- counts from here, and so does "occupied for four days".
  state_changed_at         timestamptz NOT NULL DEFAULT now(),

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at               timestamptz,

  -- A bed and its ward belong to the same hospital. Enforced by the key rather
  -- than trusted, because a bed filed under the wrong facility is a free bed
  -- published for a hospital that does not have it.
  CONSTRAINT beds_ward_same_hospital
    FOREIGN KEY (ward_id, hospital_id) REFERENCES wards (id, hospital_id) ON DELETE RESTRICT,

  CONSTRAINT beds_nightly_non_negative CHECK (nightly_poisha >= 0),
  CONSTRAINT beds_label_present CHECK (length(trim(label)) > 0),

  -- What each state must say about itself. These are the rules that keep a
  -- tile honest: an occupied bed names who is in it, a reserved bed says until
  -- when, and a bed out of service says why.
  CONSTRAINT beds_occupied_has_admission
    CHECK ((state = 'occupied') = (current_admission_id IS NOT NULL)),
  CONSTRAINT beds_reserved_has_expiry
    CHECK ((state = 'reserved') = (reserved_until IS NOT NULL)),
  CONSTRAINT beds_oos_has_reason
    CHECK ((state = 'out_of_service') = (oos_reason IS NOT NULL AND length(trim(oos_reason)) > 0)),

  -- A discharge forecast for an empty bed is a forecast about nobody.
  CONSTRAINT beds_discharge_forecast_needs_patient
    CHECK (expected_discharge_date IS NULL OR state = 'occupied')
);

-- DATABASE.md §2.5 and §6: this is what the public bed counts are made of.
CREATE INDEX beds_hospital_kind_state_idx ON beds (hospital_id, kind, state)
  WHERE deleted_at IS NULL;

CREATE INDEX beds_ward_idx ON beds (ward_id) WHERE deleted_at IS NULL;

-- One label per hospital, because "301" is how a nurse names the bed aloud.
CREATE UNIQUE INDEX beds_hospital_label_key
  ON beds (hospital_id, label) WHERE deleted_at IS NULL;

-- The expired-hold sweep reads only reserved beds.
CREATE INDEX beds_reserved_until_idx ON beds (reserved_until) WHERE state = 'reserved';

CREATE TRIGGER trg_beds_touch
  BEFORE UPDATE ON beds
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE beds ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE beds IS
  'Every bed and its current state (FR-BED-01, FR-BED-03). Public reads go through v_public_hospital_capacity only (DATABASE.md §5).';
COMMENT ON COLUMN beds.reserved_until IS
  'When a hold lapses (BTN-B06-RESERVE). Past it, the public count already treats the bed as free; the ward board writes the RELEASE.';
COMMENT ON COLUMN beds.state_changed_at IS
  'When the current state began: the cleaning timer and the length-of-stay figure count from here.';

-- ===========================================================================
-- bed_requests — a patient asking a hospital for a bed (FR-PAT-52, FR-BED-07)
-- ===========================================================================

CREATE TABLE bed_requests (
  id                     uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id            uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  patient_id             uuid        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  bed_kind               bed_kind    NOT NULL,

  requested_by_user_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
  requested_by_guest_id  uuid        REFERENCES guest_identities (id) ON DELETE SET NULL,

  -- `MOD-A11-REQUEST`: "patient profile, expected arrival, condition note".
  -- DATABASE.md §2.5 lists the note and not the arrival time; the modal asks
  -- for both, and the ward decides how long to hold a bed from the second.
  note                   text,
  expected_arrival_at    timestamptz,

  state                  text        NOT NULL DEFAULT 'requested',

  -- The bed being held for this request. DATABASE.md §2.5 gives no column for
  -- it, but a hold that is not a particular bed is a promise the public count
  -- does not know about — two families could be told the last ICU bed is
  -- theirs. So holding a request reserves a real bed, and this names it.
  bed_id                 uuid        REFERENCES beds (id) ON DELETE RESTRICT,
  hold_expires_at        timestamptz,

  responded_by           uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  responded_at           timestamptz,

  -- The write endpoint's idempotency key (CLAUDE.md §7), stored with the
  -- resource like `payments.idempotency_key`: a request re-sent over a bad
  -- connection returns the first one rather than filing a second.
  idempotency_key        text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  CONSTRAINT bed_requests_state_allowed
    CHECK (state IN ('requested', 'held', 'confirmed', 'declined', 'expired')),

  -- Somebody asked. Exactly one kind of somebody (`FR-GST-01`).
  CONSTRAINT bed_requests_one_requester
    CHECK (num_nonnulls(requested_by_user_id, requested_by_guest_id) = 1),

  -- A hold is a bed and a deadline; without either it is a hope.
  CONSTRAINT bed_requests_hold_is_a_bed
    CHECK (state <> 'held' OR (bed_id IS NOT NULL AND hold_expires_at IS NOT NULL)),

  -- Anything past `requested` was answered by someone, at some time.
  CONSTRAINT bed_requests_answered
    CHECK (state = 'requested' OR responded_at IS NOT NULL),

  CONSTRAINT bed_requests_note_short CHECK (note IS NULL OR length(note) <= 500)
);

-- `LIST-B06-PENDING`: the requests a ward still has to answer or admit.
CREATE INDEX bed_requests_pending_idx
  ON bed_requests (hospital_id, created_at)
  WHERE state IN ('requested', 'held') AND deleted_at IS NULL;

-- One open request per patient per hospital. A second tap on "request a bed"
-- is the same request, not a second family in the pending list.
CREATE UNIQUE INDEX bed_requests_one_open_key
  ON bed_requests (patient_id, hospital_id)
  WHERE state IN ('requested', 'held') AND deleted_at IS NULL;

CREATE UNIQUE INDEX bed_requests_idempotency_key
  ON bed_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- A bed can be held for one request at a time.
CREATE UNIQUE INDEX bed_requests_one_hold_per_bed_key
  ON bed_requests (bed_id) WHERE state = 'held';

CREATE TRIGGER trg_bed_requests_touch
  BEFORE UPDATE ON bed_requests
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE bed_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE bed_requests IS
  'A patient asking for a bed (FR-PAT-52). requested → held (a real bed reserved) → confirmed (admitted), or declined, or expired.';

-- ===========================================================================
-- admissions — a patient's stay (DATABASE.md §2.5)
-- ===========================================================================

CREATE TABLE admissions (
  id                       uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id               uuid        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  hospital_id              uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,

  -- Where the patient is *now*. A transfer moves it; the path they took is in
  -- `bed_events`.
  bed_id                   uuid        NOT NULL REFERENCES beds (id) ON DELETE RESTRICT,

  admitted_at              timestamptz NOT NULL DEFAULT now(),
  discharged_at            timestamptz,
  expected_discharge_date  date,

  source                   text        NOT NULL,
  emergency_case_id        uuid        REFERENCES emergency_cases (id) ON DELETE RESTRICT,

  -- The request this admission answered, when it came from the app. Not in
  -- DATABASE.md §2.5; without it, "confirmed" on the patient's screen could not
  -- say which stay it was confirmed as.
  bed_request_id           uuid        REFERENCES bed_requests (id) ON DELETE RESTRICT,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at               timestamptz,

  CONSTRAINT admissions_source_allowed
    CHECK (source IN ('er', 'opd', 'app_request', 'referral')),
  CONSTRAINT admissions_discharge_after_admit
    CHECK (discharged_at IS NULL OR discharged_at >= admitted_at),
  CONSTRAINT admissions_app_request_named
    CHECK (source <> 'app_request' OR bed_request_id IS NOT NULL)
);

-- One person per bed, and one bed per person. The second is the one a busy
-- ward gets wrong: the same patient admitted from the pending list and again
-- from a phone search.
CREATE UNIQUE INDEX admissions_one_per_bed_key
  ON admissions (bed_id) WHERE discharged_at IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX admissions_one_per_patient_key
  ON admissions (patient_id) WHERE discharged_at IS NULL AND deleted_at IS NULL;

CREATE INDEX admissions_hospital_idx ON admissions (hospital_id, admitted_at DESC);
CREATE UNIQUE INDEX admissions_bed_request_key
  ON admissions (bed_request_id) WHERE bed_request_id IS NOT NULL;

CREATE TRIGGER trg_admissions_touch
  BEFORE UPDATE ON admissions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE beds
  ADD CONSTRAINT beds_current_admission_fk
  FOREIGN KEY (current_admission_id) REFERENCES admissions (id) ON DELETE RESTRICT;

COMMENT ON TABLE admissions IS
  'A stay. Identifiable: a staff read of one writes audit_log (DB-P7).';

-- ===========================================================================
-- bed_events — who changed which bed, and when (DATABASE.md §2.5)
-- ===========================================================================

CREATE TABLE bed_events (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Not in DATABASE.md §2.5's column list. DB-P8 puts `hospital_id` on every
  -- operational table, and the freshness stamp the public sees is "the latest
  -- event at this hospital for this kind of bed" — asked of this table without
  -- a join, on every discovery read.
  hospital_id      uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  bed_id           uuid        NOT NULL REFERENCES beds (id) ON DELETE RESTRICT,

  type             text        NOT NULL,

  -- What the bed was and became. The document puts the transition implicitly
  -- in `type`; storing both ends makes the history readable without replaying
  -- it, and lets the CHECK below refuse an event whose type and outcome
  -- disagree.
  from_state       bed_state   NOT NULL,
  to_state         bed_state   NOT NULL,

  admission_id     uuid        REFERENCES admissions (id) ON DELETE RESTRICT,
  bed_request_id   uuid        REFERENCES bed_requests (id) ON DELETE RESTRICT,

  -- Null only for the system: a hold that lapsed.
  actor_staff_id   uuid        REFERENCES staff_users (id) ON DELETE SET NULL,

  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Offline replay, exactly as `queue_events` does it (`FR-OFF-01`, SY-02). A
  -- ward console that queued an admit on a dead connection and sends it again
  -- must not admit twice.
  client_event_id  uuid,
  client_ts        timestamptz,

  -- Authoritative. What the public freshness stamp is read from (`FR-OFF-03`).
  server_ts        timestamptz NOT NULL DEFAULT now(),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bed_events_type_allowed
    CHECK (type IN (
      'ADMIT', 'DISCHARGE', 'TRANSFER', 'RESERVE', 'RELEASE',
      'CLEAN_START', 'CLEAN_DONE', 'OOS', 'RESTORE'
    )),

  CONSTRAINT bed_events_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),

  -- Each type produces one state. A TRANSFER is two events, one per bed: the
  -- bed left goes to cleaning, the bed entered becomes occupied.
  CONSTRAINT bed_events_type_matches_outcome
    CHECK (
      (type = 'ADMIT'       AND to_state = 'occupied')
      OR (type = 'DISCHARGE'   AND from_state = 'occupied' AND to_state = 'cleaning')
      OR (type = 'TRANSFER'    AND to_state IN ('occupied', 'cleaning'))
      OR (type = 'RESERVE'     AND to_state = 'reserved')
      OR (type = 'RELEASE'     AND from_state = 'reserved' AND to_state = 'free')
      OR (type = 'CLEAN_START' AND to_state = 'cleaning')
      OR (type = 'CLEAN_DONE'  AND from_state = 'cleaning' AND to_state = 'free')
      OR (type = 'OOS'         AND to_state = 'out_of_service')
      OR (type = 'RESTORE'     AND from_state = 'out_of_service' AND to_state = 'free')
    ),

  -- An admission event says which admission.
  CONSTRAINT bed_events_admission_named
    CHECK (type NOT IN ('ADMIT', 'DISCHARGE', 'TRANSFER') OR admission_id IS NOT NULL),

  -- Only a lapsed hold is nobody's doing.
  CONSTRAINT bed_events_attributed
    CHECK (actor_staff_id IS NOT NULL OR type = 'RELEASE')
);

CREATE INDEX bed_events_bed_idx ON bed_events (bed_id, server_ts DESC);

-- The freshness read: the newest event per hospital.
CREATE INDEX bed_events_hospital_idx ON bed_events (hospital_id, server_ts DESC);

CREATE UNIQUE INDEX bed_events_client_event_id_key
  ON bed_events (client_event_id) WHERE client_event_id IS NOT NULL;

CREATE INDEX bed_events_admission_idx
  ON bed_events (admission_id) WHERE admission_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only, like the queue (DATABASE.md §2.5)
--
-- No exception this time: a bed event has nothing like `undone_by_event_id`
-- that is set after the fact. A mistaken admit is corrected by the next event
-- — a discharge, a transfer — and both stay on the record.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_bed_events_no_mutate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'bed_events is append-only: % is not permitted (DATABASE.md §2.5)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_bed_events_no_mutate
  BEFORE UPDATE OR DELETE ON bed_events
  FOR EACH ROW EXECUTE FUNCTION fn_bed_events_no_mutate();

-- TRUNCATE skips row triggers, so it is guarded separately — the same pair
-- 0006 gives `queue_events`, and lifted by `pnpm db:reset` the same way.
CREATE OR REPLACE FUNCTION fn_bed_events_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'bed_events is append-only: TRUNCATE is not permitted (DATABASE.md §2.5)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_bed_events_no_truncate
  BEFORE TRUNCATE ON bed_events
  FOR EACH STATEMENT EXECUTE FUNCTION fn_bed_events_no_truncate();

ALTER TABLE bed_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE bed_events IS
  'Append-only history of every bed change: who, which bed, from what to what, when. Public freshness is read from server_ts (FR-OFF-03).';

-- ===========================================================================
-- referrals — one hospital asking another to take a patient (FR-EMG-07..09)
--
-- Created here because DATABASE.md §7 puts it here; build step 16 writes it.
-- ===========================================================================

CREATE TABLE referrals (
  id                   uuid            PRIMARY KEY DEFAULT uuid_generate_v7(),
  from_hospital_id     uuid            NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  to_hospital_id       uuid            NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  emergency_case_id    uuid            REFERENCES emergency_cases (id) ON DELETE RESTRICT,
  patient_id           uuid            REFERENCES patients (id) ON DELETE RESTRICT,
  required_capability  capability_kind NOT NULL,
  summary              jsonb           NOT NULL DEFAULT '{}'::jsonb,
  state                referral_state  NOT NULL DEFAULT 'sent',

  -- The timeline `FR-EMG-08` records: sent → seen → accepted → arrived.
  sent_at              timestamptz     NOT NULL DEFAULT now(),
  seen_at              timestamptz,
  responded_at         timestamptz,
  arrived_at           timestamptz,
  decline_reason       text,

  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now(),
  created_by           uuid            REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at           timestamptz,

  CONSTRAINT referrals_not_to_self CHECK (from_hospital_id <> to_hospital_id),
  CONSTRAINT referrals_summary_is_object CHECK (jsonb_typeof(summary) = 'object'),
  -- `BTN-B07-DECLINE` "requires reason", and so does the row.
  CONSTRAINT referrals_decline_has_reason
    CHECK (state <> 'declined' OR (decline_reason IS NOT NULL AND length(trim(decline_reason)) > 0))
);

CREATE INDEX referrals_incoming_idx ON referrals (to_hospital_id, state, sent_at DESC);
CREATE INDEX referrals_outgoing_idx ON referrals (from_hospital_id, sent_at DESC);

CREATE TRIGGER trg_referrals_touch
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE referrals IS
  'Refer-out and refer-in with its timeline (FR-EMG-07..09). Written by build step 16.';
