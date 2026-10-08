-- 0057_payment_holds.sql
--
-- Paying by being sent away and coming back (plan H3; `PRD.md` `FR-PAY-08`
-- to `FR-PAY-11`; DATABASE.md §2.6).
--
-- Until now a charge that did not settle on the spot kept nothing of itself:
-- the provider's reference was written only once money had moved, so the
-- patient's return from bKash or Nagad, or a later look by the server, could
-- not find the payment it was about. And a serial waiting for its payment had
-- no deadline, so question 15's rule (owner, 7 October) had nothing to stand on.
--
-- Additive: four columns on `payments`, one on `bookings`, one on
-- `hospital_settings`, and one append-only table with its policy.

-- ---------------------------------------------------------------------------
-- payments: the attempt under way, its deadline, and why it failed
-- ---------------------------------------------------------------------------

-- What the provider calls the attempt while it is under way (bKash's
-- `paymentID`, Nagad's `paymentReferenceId`). `provider_ref` stays what it
-- was: the reference for money that moved. Neither is ever logged.
ALTER TABLE payments ADD COLUMN provider_checkout_id text;
-- When an online attempt's hold runs out (`FR-PAY-08`).
ALTER TABLE payments ADD COLUMN hold_until timestamptz;
ALTER TABLE payments ADD COLUMN failure_reason text;
-- When the provider was last asked: paces the timer's second look.
ALTER TABLE payments ADD COLUMN checked_at timestamptz;

ALTER TABLE payments ADD CONSTRAINT payments_failure_reason_known
  CHECK (failure_reason IS NULL OR failure_reason IN (
    'declined', 'cancelled', 'expired', 'superseded', 'provider_error', 'amount_mismatch'));

-- A failed payment says why, and nothing else carries a reason. A failure
-- written before this migration has none, so those rows are given the one
-- that is true of all of them: the provider said no.
UPDATE payments SET failure_reason = 'declined' WHERE state = 'failed' AND failure_reason IS NULL;
ALTER TABLE payments ADD CONSTRAINT payments_failed_says_why
  CHECK ((state = 'failed') = (failure_reason IS NOT NULL));

-- Only an online attempt has a hold: the counter and cash wait for nobody.
ALTER TABLE payments ADD CONSTRAINT payments_hold_is_online
  CHECK (hold_until IS NULL OR method IN ('bkash', 'nagad', 'card'));

CREATE UNIQUE INDEX payments_checkout_key
  ON payments (method, provider_checkout_id) WHERE provider_checkout_id IS NOT NULL;

-- The timer's question: which pending attempts have run out.
CREATE INDEX payments_hold_due_idx
  ON payments (hold_until) WHERE state = 'pending' AND hold_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- bookings: whether this serial had to be paid for first
-- ---------------------------------------------------------------------------

-- Decided when the booking is made and never after: the hospital takes no
-- payment at the counter, or (plan F3) the number's no-shows ask for payment
-- first (`FR-GST-14`). What it changes is what happens when a hold runs out:
-- released, not turned to the counter.
ALTER TABLE bookings ADD COLUMN prepayment_required boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- hospital_settings: how long a serial waits for its payment
-- ---------------------------------------------------------------------------

ALTER TABLE hospital_settings
  ADD COLUMN payment_hold_minutes int NOT NULL DEFAULT 15
  CONSTRAINT hospital_settings_payment_hold_range CHECK (payment_hold_minutes BETWEEN 5 AND 60);

-- ---------------------------------------------------------------------------
-- payment_events: every step of every payment (`FR-PAY-11`)
-- ---------------------------------------------------------------------------

CREATE TABLE payment_events (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  payment_id  uuid        NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  -- Copied from what was paid for, so the tenant policy reads one column.
  hospital_id uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,
  kind        text        NOT NULL CHECK (kind IN (
    'created', 'redirected', 'asked', 'paid', 'failed', 'expired', 'superseded',
    'counter', 'released', 'owed_back', 'refunded', 'amount_mismatch')),
  -- A reason or a provider's status word. Never a reference, a wallet number
  -- or a name (CLAUDE.md §7): kept small so nothing else fits.
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (length(detail::text) <= 400),
  at          timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Nothing updates an event (the API's role cannot: `database/scripts/lib/role.ts`);
-- the rule is every table's (DB-P3).
CREATE TRIGGER trg_payment_events_touch
  BEFORE UPDATE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE INDEX payment_events_payment_idx ON payment_events (payment_id, at);
CREATE INDEX payment_events_hospital_idx ON payment_events (hospital_id, at DESC);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

-- Read by the hospital's staff and the server; a patient, a link and nobody
-- read none of it.
CREATE POLICY tenant_read ON payment_events FOR SELECT TO app_tenant
  USING (coalesce(app_scope() = 'system', false)
         OR coalesce(app_scope() = 'hospital' AND hospital_id = app_hospital(), false));

-- Written by whoever moved the payment: its hospital, the server, or the
-- person paying, for a payment their own connection can see (0056).
CREATE POLICY tenant_insert ON payment_events FOR INSERT TO app_tenant
  WITH CHECK (coalesce(app_scope() = 'system', false)
              OR coalesce(app_scope() = 'hospital' AND hospital_id = app_hospital(), false)
              OR (coalesce(app_scope() IN ('patient', 'guest'), false)
                  AND EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id)));

COMMENT ON TABLE payment_events IS
  'Every step of every payment, append-only (FR-PAY-11, plan H3).';
