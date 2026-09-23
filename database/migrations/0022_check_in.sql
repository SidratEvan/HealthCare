-- 0022_check_in.sql
--
-- What a check-in records beside the arrival itself (`FR-REC-18`,
-- `FR-PAT-38`, `FR-ADM-01`).
--
-- ## The quote
--
-- When reception checks somebody in, it tells them roughly how long they will
-- wait — the way a restaurant tells a delivery app "ready in twenty". The
-- console pre-fills it from the queue's own estimate and reception may change
-- it, because the person at the counter can see things the rolling rate
-- cannot: a consultant on the phone, a family of five for one serial.
--
-- It is stored on the booking as a projection of the `PATIENT_ARRIVED` event,
-- exactly as `arrived_at` is: the event is the fact, the column is what the
-- dashboard can aggregate without replaying a log per row. Keeping the quote
-- lets `S-B-10` say how often the hospital's word was kept, which is the
-- honest counterpart to measuring the wait at all.
--
-- Bounded at eight hours. A quote longer than a whole chamber is a typing
-- error, and a patient told "480 minutes" by mistake would go home.

ALTER TABLE bookings
  ADD COLUMN quoted_wait_minutes integer;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_quoted_wait_plausible
    CHECK (quoted_wait_minutes IS NULL OR quoted_wait_minutes BETWEEN 0 AND 480);

-- A quote is given at a check-in, so there is no quote without an arrival.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_quote_needs_arrival
    CHECK (quoted_wait_minutes IS NULL OR arrived_at IS NOT NULL);

COMMENT ON COLUMN bookings.quoted_wait_minutes IS
  'The wait reception quoted at check-in, in minutes. Projected from PATIENT_ARRIVED; never written by a route.';

-- `PATIENT_ARRIVED` is about one patient, so it must say which (DATABASE.md
-- §3). The constraint from 0006 is replaced rather than edited: a shipped
-- migration is never changed, and the checksum would stop `db:migrate`.
ALTER TABLE queue_events
  DROP CONSTRAINT queue_events_patient_events_have_booking;

ALTER TABLE queue_events
  ADD CONSTRAINT queue_events_patient_events_have_booking
    CHECK (
      type NOT IN (
        'PATIENT_CALLED', 'PATIENT_DONE', 'PATIENT_LATE', 'PATIENT_NO_SHOW',
        'PATIENT_REINSERTED', 'PATIENT_ARRIVED', 'WALKIN_ADDED', 'BOOKING_CANCELLED',
        'PRIORITY_REORDERED'
      )
      OR booking_id IS NOT NULL
    );
