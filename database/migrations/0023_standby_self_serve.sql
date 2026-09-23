-- 0023_standby_self_serve.sql
--
-- A patient joins the standby list from the app, may pay when joining, and
-- answers an offer on their own phone (`FR-PAT-25`, `FR-PAT-26`, `FR-PAT-27`,
-- `FR-QUE-30`). The owner's ruling on STATUS decision 62, 2026-09-23:
--
--   "Prepaid gets it automatically": somebody who paid when joining is given
--   the next freed chair without being asked; anybody else is offered it on
--   their phone and says yes or no within the window. Reception can still
--   record a yes for somebody who rings the counter.
--
-- ## A payment before there is a booking
--
-- Until now a payment had to be *for* something that already existed — a
-- booking, a bed request, a test, an ambulance (`payments_one_subject`). A
-- standby prepayment is for a chair nobody has yet, so the standby row becomes
-- a fifth subject. When the person is seated the payment moves to the booking
-- they were given — the same money, now for the thing it bought — and from
-- there every settlement, revenue and refund query that already reads bookings
-- counts it without knowing it began as a standby. A prepayment for a chair
-- that never came is owed back in full (`standby_unseated`).
--
-- The amounts themselves are still never edited (`trg_payments_amount_locked`
-- is untouched): moving a payment's subject changes what it paid for, not how
-- much was paid.

ALTER TABLE payments
  ADD COLUMN standby_id uuid REFERENCES standby_list (id) ON DELETE RESTRICT;

ALTER TABLE payments
  DROP CONSTRAINT payments_one_subject;

ALTER TABLE payments
  ADD CONSTRAINT payments_one_subject
    CHECK (
      num_nonnulls(booking_id, bed_request_id, test_order_id, ambulance_request_id, standby_id) = 1
    );

CREATE INDEX payments_standby_idx ON payments (standby_id) WHERE standby_id IS NOT NULL;

-- ## Who joined, and where they ended up
--
-- `guest_id` is the identity the phone joined with, so the seat they are given
-- is booked *by* them — a guest booking with a tracking link, the same as one
-- made through the booking flow — rather than a counter entry with no owner.
-- Null for somebody reception put on the list by phone.
--
-- `seated_booking_id` is the chair they got. `removed_at` already says they
-- left the list; this says whether they left it with a serial.
--
-- `idempotency_key` makes the join replay-safe (`FR-QUE-51`): a patient who
-- taps twice on a bad connection is on the list once, and pays once.

ALTER TABLE standby_list
  ADD COLUMN guest_id uuid REFERENCES guest_identities (id) ON DELETE SET NULL,
  ADD COLUMN seated_booking_id uuid REFERENCES bookings (id) ON DELETE SET NULL,
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX standby_list_idempotency_key
  ON standby_list (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Seated is a way of leaving the list, never a way of staying on it.
ALTER TABLE standby_list
  ADD CONSTRAINT standby_list_seated_has_left
    CHECK (seated_booking_id IS NULL OR removed_at IS NOT NULL);

COMMENT ON COLUMN payments.standby_id IS
  'A standby prepayment (FR-PAT-26) before the person is seated; moved to booking_id when they are.';
COMMENT ON COLUMN standby_list.seated_booking_id IS
  'The booking a standby patient was given, automatically or on accepting an offer (FR-QUE-30).';
