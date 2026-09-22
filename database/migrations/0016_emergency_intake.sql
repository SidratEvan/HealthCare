-- 0016_emergency_intake.sql
--
-- What `emergency_cases` (0008) could not yet say, and the ER's handoff to the
-- ward (DATABASE.md §2.5; `FR-PAT-46`, `FR-EMG-01..04`, `FR-BED-07`).
--
-- 0008 created `emergency_cases` to the letter of DATABASE.md §2.5 before the
-- ER console existed. Building the console (step 15) found four things the
-- documents require that the table had nowhere to put. Each was raised with
-- the owner and ruled on (2026-09-21) before this file was written, and
-- DATABASE.md §2.5 now lists the columns:
--
--   patient_age_years,  `FR-PAT-46`: "I'm on my way" carries "patient age/sex
--   patient_sex         if known". An inbound person is usually anonymous —
--                       `patient_id` is null — so age and sex cannot come from
--                       a profile that does not exist.
--
--   'declined',         `FR-EMG-02`: a coordinator may decline an inbound case,
--   decline_reason      and must say why. `emergency_state` had no such value,
--                       and recording a decline as `cancelled` would make "the
--                       hospital said no" and "the family turned back" the same
--                       fact — which they are not, least of all to the family.
--
--   admit_bed_kind,     `BTN-B07-ADMIT` "hands off to ward board with the case
--   admit_requested_at  attached", and `FR-BED-07` puts ER cases on the ward's
--                       pending list. The handoff has to be written somewhere
--                       the ward can read it: which kind of bed, since when.
--
--   idempotency_key     CLAUDE.md §7: every write endpoint accepts one. An
--                       inbound alert is sent from a phone in a moving car on
--                       one bar of signal and will be retried; a walk-in is
--                       registered from a console that may be offline
--                       (`FR-OFF-01`). Neither may create the person twice.
--
-- `closed_at` is added alongside them: the moment a case left the active set,
-- whatever the reason. Without it "how long was this person in the ER" and "how
-- many cases closed today" would have to be read out of `updated_at`, which any
-- later edit moves.
--
-- ## Why the checks below compare `state::text`
--
-- A value added to an enum cannot be *used* in the transaction that adds it,
-- and the migration runner wraps each file in one. Writing `state = 'declined'`
-- would make PostgreSQL cast the literal to the enum and refuse it as an unsafe
-- use of a new value. Comparing the column's text form avoids the cast and
-- means exactly the same thing.
--
-- ## Nothing here stores where a caller was
--
-- The inbound ETA is computed from a position the phone sends, and the
-- position is then discarded. `inbound_eta_minutes` is kept, because the ER is
-- preparing for an arrival time; the coordinates are not, because nothing the
-- ER does needs them.

ALTER TYPE emergency_state ADD VALUE 'declined' AFTER 'referred';

ALTER TABLE emergency_cases
  ADD COLUMN patient_age_years   smallint,
  ADD COLUMN patient_sex         sex,
  ADD COLUMN decline_reason      text,
  ADD COLUMN closed_at           timestamptz,
  ADD COLUMN admit_bed_kind      bed_kind,
  ADD COLUMN admit_requested_at  timestamptz,
  ADD COLUMN idempotency_key     text;

ALTER TABLE emergency_cases
  ADD CONSTRAINT emergency_cases_age_sane
    CHECK (patient_age_years IS NULL OR patient_age_years BETWEEN 0 AND 130),

  -- Declined if and only if somebody said why (`FR-EMG-02`).
  ADD CONSTRAINT emergency_cases_decline_has_reason
    CHECK (
      (state::text = 'declined')
      = (decline_reason IS NOT NULL AND length(trim(decline_reason)) > 0)
    ),

  -- Open if and only if not closed. The open set is `FR-EMG-04`'s load, and
  -- the same four states `emergency_cases_active_idx` and the public view's
  -- `er_active` count.
  ADD CONSTRAINT emergency_cases_closed_when_final
    CHECK (
      (closed_at IS NULL)
      = (state::text IN ('inbound', 'acknowledged', 'arrived', 'in_treatment'))
    ),

  -- Each state says what it has to: an announced case says when it was
  -- announced, an acknowledged one when it was acknowledged, a person in the
  -- ER when they arrived.
  ADD CONSTRAINT emergency_cases_inbound_stamped
    CHECK (state::text NOT IN ('inbound', 'acknowledged') OR inbound_at IS NOT NULL),
  ADD CONSTRAINT emergency_cases_acknowledged_stamped
    CHECK (state::text <> 'acknowledged' OR acknowledged_at IS NOT NULL),
  ADD CONSTRAINT emergency_cases_arrival_stamped
    CHECK (
      state::text NOT IN ('arrived', 'in_treatment', 'admitted', 'discharged')
      OR arrived_at IS NOT NULL
    ),

  -- A decline or a cancellation happens before arrival. Somebody already in
  -- the ER who has to go elsewhere is a referral (`FR-EMG-07`), not a decline.
  ADD CONSTRAINT emergency_cases_turned_away_before_arrival
    CHECK (state::text NOT IN ('declined', 'cancelled') OR arrived_at IS NULL),

  -- A person in the ER is called by a token before anybody knows their name
  -- ("ER-14"), so arrival and a token go together.
  ADD CONSTRAINT emergency_cases_arrival_has_token
    CHECK (arrived_at IS NULL OR token_label IS NOT NULL),

  -- Triage is an assessment of somebody present (`FR-EMG-03`). A colour on a
  -- person still in a car would be a guess from a phone call, shown to the
  -- next shift as if it were an examination.
  ADD CONSTRAINT emergency_cases_triage_on_arrival
    CHECK (triage IS NULL OR arrived_at IS NOT NULL),

  -- The handoff names a kind of bed and a time, both or neither, and only for
  -- somebody who is here. `admitted` means the ward placed them, which it can
  -- only do from a handoff.
  ADD CONSTRAINT emergency_cases_handoff_complete
    CHECK ((admit_bed_kind IS NULL) = (admit_requested_at IS NULL)),
  ADD CONSTRAINT emergency_cases_handoff_after_arrival
    CHECK (admit_requested_at IS NULL OR arrived_at IS NOT NULL),
  ADD CONSTRAINT emergency_cases_admitted_was_handed_off
    CHECK (state::text <> 'admitted' OR admit_requested_at IS NOT NULL),

  ADD CONSTRAINT emergency_cases_acknowledged_after_inbound
    CHECK (acknowledged_at IS NULL OR inbound_at IS NULL OR acknowledged_at >= inbound_at),
  ADD CONSTRAINT emergency_cases_closed_after_created
    CHECK (closed_at IS NULL OR closed_at >= created_at),

  -- The same bounds the `Idempotency-Key` middleware enforces, so a key that
  -- reached the table by another path is still one the API would accept.
  ADD CONSTRAINT emergency_cases_idempotency_key_shape
    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 16 AND 128);

-- A retried alert, or a replayed walk-in, finds the case it already created.
CREATE UNIQUE INDEX emergency_cases_idempotency_key
  ON emergency_cases (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- A token is called aloud in one ER. Two open cases answering to "ER-14" at
-- the same hospital is two people walking to the same bay.
CREATE UNIQUE INDEX emergency_cases_open_token_key
  ON emergency_cases (hospital_id, token_label)
  WHERE closed_at IS NULL AND token_label IS NOT NULL AND deleted_at IS NULL;

-- The ER half of the ward's pending list (`LIST-B06-PENDING`, `FR-BED-07`).
CREATE INDEX emergency_cases_handoff_idx
  ON emergency_cases (hospital_id, admit_requested_at)
  WHERE admit_requested_at IS NOT NULL AND closed_at IS NULL AND deleted_at IS NULL;

-- One stay per case, and a stay that came from a case came through the ER.
-- The reverse is deliberately not required: an ER admission from before the
-- ER console existed — every one the seeds write — has no case to point at.
CREATE UNIQUE INDEX admissions_emergency_case_key
  ON admissions (emergency_case_id) WHERE emergency_case_id IS NOT NULL;

ALTER TABLE admissions
  ADD CONSTRAINT admissions_case_is_er
    CHECK (emergency_case_id IS NULL OR source = 'er');

COMMENT ON COLUMN emergency_cases.patient_age_years IS
  'Age as the caller or the ER stated it, if known (FR-PAT-46). Not a profile field: the person is usually anonymous.';
COMMENT ON COLUMN emergency_cases.patient_sex IS
  'Sex as stated, if known (FR-PAT-46).';
COMMENT ON COLUMN emergency_cases.decline_reason IS
  'Why the ER declined an inbound case (FR-EMG-02). Present if and only if state = declined.';
COMMENT ON COLUMN emergency_cases.closed_at IS
  'When the case left the active set (FR-EMG-04). Null exactly while it is inbound, acknowledged, arrived or in treatment.';
COMMENT ON COLUMN emergency_cases.admit_bed_kind IS
  'The kind of bed the ER handed this case to the ward for (BTN-B07-ADMIT, FR-BED-07).';
COMMENT ON COLUMN emergency_cases.admit_requested_at IS
  'When the ER handed the case to the ward. Orders the ward''s pending list.';
COMMENT ON COLUMN emergency_cases.idempotency_key IS
  'The inbound alert''s Idempotency-Key, or an offline walk-in''s clientEventId. Unique: a retry finds the case it made.';
