-- 0005_sessions_bookings.sql
--
-- The session is the central operational object of the whole product: one
-- doctor, one chamber, one date. All queue activity belongs to a session
-- (FR-QUE-01). A booking is a patient's claim on a serial within one.
--
-- DATABASE.md §2.3.
--
-- What is deliberately NOT here: any queue state. `sessions.actual_start`,
-- `delay_minutes`, `avg_consult_seconds` and `last_event_seq` are all
-- projections maintained from the event log (DB-P1), never the place a
-- decision is made. Nothing in this file may be interpreted as queue logic;
-- that lives once, in packages/domain.

-- ===========================================================================
-- session_templates — recurring chamber schedules
--
-- A nightly job materialises tomorrow's `sessions` from these
-- (BACKEND.md §8, sessions.materialise at 02:00).
-- ===========================================================================

CREATE TABLE session_templates (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_hospital_id   uuid        NOT NULL
                         REFERENCES doctor_hospitals (id) ON DELETE CASCADE,

  -- ISO-8601 weekday: 1 = Monday … 7 = Sunday. Stored explicitly rather than
  -- using PostgreSQL's 0-6 dow, because the materialiser, the console and the
  -- client all read this and an off-by-one would publish a chamber on the
  -- wrong day.
  weekday              integer     NOT NULL,

  start_time           time        NOT NULL,
  end_time             time        NOT NULL,
  capacity             integer,
  active_from          date        NOT NULL,
  active_to            date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at           timestamptz,

  CONSTRAINT session_templates_weekday_iso CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT session_templates_window_ordered CHECK (end_time > start_time),
  CONSTRAINT session_templates_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT session_templates_active_range_ordered
    CHECK (active_to IS NULL OR active_to >= active_from)
);

CREATE INDEX session_templates_materialise_idx
  ON session_templates (weekday, active_from)
  WHERE deleted_at IS NULL;

CREATE INDEX session_templates_doctor_hospital_idx
  ON session_templates (doctor_hospital_id);

CREATE TRIGGER trg_session_templates_touch
  BEFORE UPDATE ON session_templates
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE session_templates ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN session_templates.weekday IS 'ISO-8601: 1 = Monday, 7 = Sunday.';
COMMENT ON COLUMN session_templates.capacity IS 'Serials offered; null means unlimited.';

-- ===========================================================================
-- sessions — one doctor, one chamber, one date (FR-QUE-01)
-- ===========================================================================

CREATE TABLE sessions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id          uuid           NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  doctor_id            uuid           NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  department_id        uuid           NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  room                 text,

  -- The local calendar date in Asia/Dhaka that staff and patients call "today".
  -- Timestamps are UTC (DB-P4); this date is what a console session selector
  -- and a doctor's schedule are keyed on, so it is stored rather than derived.
  session_date         date           NOT NULL,

  planned_start        timestamptz    NOT NULL,
  planned_end          timestamptz    NOT NULL,

  -- Set by DOCTOR_ARRIVED. The gap against planned_start is the punctuality
  -- figure an admin sees (FR-ADM-05) and the reason reception taps one button
  -- instead of phoning fifty people (FR-REC-02).
  actual_start         timestamptz,
  actual_end           timestamptz,

  status               session_status NOT NULL DEFAULT 'scheduled',
  capacity             integer,
  fee_poisha           integer        NOT NULL,

  -- Cumulative declared delay (FR-REC-03). A projection of DELAY_DECLARED
  -- events, kept here so the ETA query does not replay the log per request.
  delay_minutes        integer        NOT NULL DEFAULT 0,

  -- Rolling consultation rate (FR-QUE-12), maintained incrementally on
  -- PATIENT_DONE and never recomputed by full scan (DATABASE.md §6).
  avg_consult_seconds  integer,

  -- Mirrors the highest queue_events.seq for this session. The realtime
  -- resume-from-seq handshake reads it (BACKEND.md §6, SY-01).
  last_event_seq       bigint         NOT NULL DEFAULT 0,

  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now(),
  created_by           uuid           REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at           timestamptz,

  CONSTRAINT sessions_window_ordered CHECK (planned_end > planned_start),
  CONSTRAINT sessions_actual_window_ordered
    CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start),
  CONSTRAINT sessions_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT sessions_fee_non_negative CHECK (fee_poisha >= 0),
  CONSTRAINT sessions_delay_non_negative CHECK (delay_minutes >= 0),
  CONSTRAINT sessions_avg_consult_plausible
    CHECK (avg_consult_seconds IS NULL OR avg_consult_seconds BETWEEN 1 AND 10800),
  CONSTRAINT sessions_last_event_seq_non_negative CHECK (last_event_seq >= 0),

  -- A running session has a doctor in the chamber, which means DOCTOR_ARRIVED
  -- has landed. Without this, a console could show "in chamber" for a doctor
  -- who never turned up, and every downstream ETA would be a lie.
  CONSTRAINT sessions_running_has_started
    CHECK (status <> 'running' OR actual_start IS NOT NULL)
);

CREATE INDEX sessions_hospital_date_idx ON sessions (hospital_id, session_date);
CREATE INDEX sessions_doctor_date_idx ON sessions (doctor_id, session_date);
CREATE INDEX sessions_status_idx ON sessions (status);

-- The console's session selector and the workers' "open sessions" sweep both
-- ask for the live ones (BACKEND.md §8: every 60 s during open sessions).
CREATE INDEX sessions_live_idx
  ON sessions (hospital_id, session_date)
  WHERE status IN ('scheduled', 'running', 'paused');

CREATE TRIGGER trg_sessions_touch
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE sessions IS
  'The central operational object. A live session — one kept accurate in real time — is the north-star unit of value (PRD.md §6).';
COMMENT ON COLUMN sessions.fee_poisha IS
  'Copied from doctor_hospitals at creation (DB-P5), so a later fee change cannot alter a booking already made.';
COMMENT ON COLUMN sessions.last_event_seq IS
  'Projection of max(queue_events.seq). Authority remains the event log (DB-P1).';

-- ===========================================================================
-- bookings — a claim on a serial
--
-- Made in the app, from an SMS tracking link, at the counter, over the phone,
-- or as a walk-in (booking_source). A guest booking is the same row as an
-- account booking; only the owner column differs (FR-GST-01).
-- ===========================================================================

CREATE TABLE bookings (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  session_id           uuid           NOT NULL REFERENCES sessions (id) ON DELETE RESTRICT,
  patient_id           uuid           NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  booked_by_user_id    uuid           REFERENCES users (id) ON DELETE SET NULL,
  booked_by_guest_id   uuid           REFERENCES guest_identities (id) ON DELETE SET NULL,

  -- Per-session integer, allocated atomically by fn_next_serial (0013). The
  -- one identifier in this product a patient reads aloud, so it is a plain
  -- number and not a hash of anything (DB-P9).
  serial_number        integer        NOT NULL,

  status               booking_status NOT NULL DEFAULT 'booked',
  source               booking_source NOT NULL,

  -- Pre-visit answers, so the doctor's screen is already populated when the
  -- patient sits down (FR-DOC-03).
  intake               jsonb          NOT NULL DEFAULT '{}'::jsonb,

  reason_text          text,
  fee_poisha           integer        NOT NULL,

  -- FK added by 0009, once payments exists.
  payment_id           uuid,

  called_at            timestamptz,
  done_at              timestamptz,
  arrived_at           timestamptz,

  -- Measured, not typed (FR-REC-11). Feeds the rolling rate (FR-QUE-12).
  consult_seconds      integer,

  cancelled_reason     text,
  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now(),
  created_by           uuid,
  deleted_at           timestamptz,

  CONSTRAINT bookings_serial_positive CHECK (serial_number > 0),
  CONSTRAINT bookings_fee_non_negative CHECK (fee_poisha >= 0),
  CONSTRAINT bookings_consult_seconds_plausible
    CHECK (consult_seconds IS NULL OR consult_seconds BETWEEN 0 AND 10800),
  CONSTRAINT bookings_intake_is_object CHECK (jsonb_typeof(intake) = 'object'),

  -- A booking is made by an account holder or by a guest. Both may be null for
  -- a counter walk-in that reception typed in, so this is at most one rather
  -- than exactly one.
  CONSTRAINT bookings_one_booker
    CHECK (num_nonnulls(booked_by_user_id, booked_by_guest_id) <= 1),

  -- A consultation cannot finish before it was called.
  CONSTRAINT bookings_done_after_called
    CHECK (done_at IS NULL OR called_at IS NULL OR done_at >= called_at),

  -- A cancellation states why. The refund rule depends on it (FR-PAY-03), and
  -- so does the no-show loss figure an admin is shown (FR-ADM-03).
  CONSTRAINT bookings_cancelled_has_reason
    CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)
);

-- DATABASE.md §2.3: unique per session except for cancelled rows, so a
-- released serial can be reissued to a standby patient (FR-QUE-30) while the
-- cancelled row stays in history (DB-P2).
CREATE UNIQUE INDEX bookings_session_serial_key
  ON bookings (session_id, serial_number)
  WHERE status <> 'cancelled';

CREATE INDEX bookings_patient_idx ON bookings (patient_id);
CREATE INDEX bookings_session_status_idx ON bookings (session_id, status);
CREATE INDEX bookings_guest_idx ON bookings (booked_by_guest_id);
CREATE INDEX bookings_user_idx ON bookings (booked_by_user_id);

-- One live booking per patient per session, enforced in the index rather than
-- only in the service, because a check-then-insert races between two counters.
--
-- This is the same-session half of FR-PAT-24. The full rule — same profile,
-- same doctor, same day — spans two sessions (a morning and an evening
-- chamber) and cannot be expressed as a unique index without denormalising
-- doctor_id and session_date onto this table, which DATABASE.md §2.3 does not
-- define. booking.service enforces that half and returns BOOKING_DUPLICATE
-- (BACKEND.md §9), inside the same transaction that allocates the serial.
CREATE UNIQUE INDEX bookings_one_live_per_patient_per_session
  ON bookings (patient_id, session_id)
  WHERE status NOT IN ('cancelled', 'rescheduled');

CREATE TRIGGER trg_bookings_touch
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE bookings IS
  'A patient''s claim on a serial. Status is maintained from the event log by trg_booking_status_from_events (0013), never written directly by a route.';
COMMENT ON COLUMN bookings.serial_number IS
  'Per-session position number. Allocated atomically by fn_next_serial.';
COMMENT ON COLUMN bookings.consult_seconds IS
  'Measured automatically when the patient is marked done (FR-REC-11).';

-- Deferred foreign key from 0003, now that bookings exists.
ALTER TABLE guest_links
  ADD CONSTRAINT guest_links_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE;
