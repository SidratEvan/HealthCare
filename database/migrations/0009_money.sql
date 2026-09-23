-- 0009_money.sql
--
-- Payments, subscriptions, invoices and counter shifts (DATABASE.md §2.6).
--
-- Step 18. It arrives after 0018 in wall-clock time and before it in filename
-- order, which is the arrangement 0007 already had behind 0010: the runner
-- applies whatever a database has not seen, in filename order, so a fresh
-- build runs 0009 before 0010 and an existing one runs it after. Neither
-- ordering matters, because nothing in 0010..0018 references these tables.
--
-- ## What this file will not decide
--
-- `subscriptions.plan`, `subscriptions.monthly_poisha` and every column of
-- `invoices` are created here and **seeded with nothing**. What a module
-- costs, what tiers exist and what a hospital is charged are negotiated per
-- agreement and live outside this repository (CLAUDE.md §1.1). The code has
-- to be able to invoice; what it invoices for is not a code decision. So the
-- shape is here and the numbers are not.
--
-- `payments.platform_fee_poisha` is the same story from the other side: the
-- column exists because `FR-PAY-04` requires the patient to see who gets
-- what, and `PLATFORM_FEE_POISHA` defaults to 0 so this version itemises a
-- fee of nothing rather than inventing one.
--
-- ## Forward references, and the one this file cannot make
--
-- On a fresh database the runner applies migrations in filename order, so
-- this file runs before 0011 — which creates `ambulance_requests`. The
-- foreign key for `payments.ambulance_request_id` therefore lands in
-- `0019_payment_ambulance_fk.sql` instead of here. Everything else this file
-- references (`bookings` 0005, `bed_requests` 0008, `test_orders` 0007,
-- `users` and `guest_identities` 0003) already exists by the time it runs,
-- on a fresh database and an incrementally migrated one alike.
--
-- ## One payment, one thing paid for
--
-- DATABASE.md §2.6: `booking_id` / `bed_request_id` / `test_order_id` /
-- `ambulance_request_id`, "exactly one, CHECK". A payment that names two
-- things, or none, cannot be reconciled against either — and reconciliation
-- is the whole of `FR-PAY-05`.
--
-- ## Money is never edited, only added to
--
-- `amount_poisha` is fixed at creation. A refund is recorded in
-- `refunded_poisha`, never by lowering the amount, so the settlement report
-- can always say what was collected *and* what went back. The trigger below
-- refuses an amount change outright, the same way `ambulance_requests`
-- refuses a quoted fare change (`FR-PAT-74`) — a figure somebody was shown
-- and agreed to is not something a later code path may revise.

-- ===========================================================================
-- payments (`FR-PAY-01`, `FR-PAY-04`, `FR-PAY-06`)
-- ===========================================================================

CREATE TABLE payments (
  id                    uuid           PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Exactly one of these four.
  --
  -- Three carry their foreign key here; `ambulance_request_id` does not, and
  -- that is not an oversight. On a fresh database the runner applies files in
  -- filename order, so 0009 runs *before* 0011 — and `ambulance_requests` is
  -- 0011's. A reference to a table that does not exist yet fails the whole
  -- migration, which is how this was found. `0019_payment_ambulance_fk.sql`
  -- adds it once 0011 has run, and the CHECK below already stops the column
  -- being used meanwhile.
  booking_id            uuid           REFERENCES bookings (id) ON DELETE RESTRICT,
  bed_request_id        uuid           REFERENCES bed_requests (id) ON DELETE RESTRICT,
  test_order_id         uuid           REFERENCES test_orders (id) ON DELETE RESTRICT,
  ambulance_request_id  uuid,

  -- Who paid. A guest pays as often as an account holder does (`FR-GST-01`),
  -- so both are nullable and one of them is set.
  payer_user_id         uuid           REFERENCES users (id) ON DELETE RESTRICT,
  payer_guest_id        uuid           REFERENCES guest_identities (id) ON DELETE RESTRICT,

  -- Integer poisha, always (CLAUDE.md §7).
  amount_poisha         integer        NOT NULL,
  platform_fee_poisha   integer        NOT NULL DEFAULT 0,

  method                payment_method NOT NULL,
  state                 payment_state  NOT NULL DEFAULT 'pending',

  -- What the provider calls this transaction. Never logged (CLAUDE.md §7).
  provider_ref          text,

  -- `FR-PAY-06`: "every payment has an idempotency key; retries never
  -- double-charge". NOT NULL and unique, with no partial predicate — unlike
  -- the lab's, every payment row is made by a caller who has one.
  idempotency_key       text           NOT NULL,

  paid_at               timestamptz,
  refunded_poisha       integer        NOT NULL DEFAULT 0,
  refund_reason         text,
  refunded_at           timestamptz,

  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now(),
  created_by            uuid           REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at            timestamptz,

  CONSTRAINT payments_one_subject
    CHECK (num_nonnulls(booking_id, bed_request_id, test_order_id, ambulance_request_id) = 1),
  CONSTRAINT payments_one_payer
    CHECK (num_nonnulls(payer_user_id, payer_guest_id) = 1),

  CONSTRAINT payments_amount_non_negative CHECK (amount_poisha >= 0),
  CONSTRAINT payments_platform_fee_within_amount
    CHECK (platform_fee_poisha >= 0 AND platform_fee_poisha <= amount_poisha),

  -- A refund cannot exceed what was taken. This is the one arithmetic error
  -- that turns a bug into money leaving the business.
  CONSTRAINT payments_refund_within_amount
    CHECK (refunded_poisha >= 0 AND refunded_poisha <= amount_poisha),

  -- The state and the numbers have to agree, or a settlement report is
  -- fiction. `refunded` means all of it went back; `partially_refunded`
  -- means some did and some did not.
  CONSTRAINT payments_paid_has_time
    CHECK ((state IN ('paid', 'refunded', 'partially_refunded')) = (paid_at IS NOT NULL)),
  CONSTRAINT payments_refunded_in_full
    CHECK (state <> 'refunded' OR refunded_poisha = amount_poisha),
  CONSTRAINT payments_partially_refunded_is_partial
    CHECK (
      state <> 'partially_refunded'
      OR (refunded_poisha > 0 AND refunded_poisha < amount_poisha)
    ),
  CONSTRAINT payments_unrefunded_has_nothing_back
    CHECK (state IN ('refunded', 'partially_refunded') OR refunded_poisha = 0),
  CONSTRAINT payments_refund_names_a_reason
    CHECK ((refunded_poisha > 0) = (refund_reason IS NOT NULL AND refunded_at IS NOT NULL))
);

CREATE UNIQUE INDEX payments_idempotency_key ON payments (idempotency_key);

CREATE INDEX payments_booking_idx ON payments (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX payments_bed_request_idx
  ON payments (bed_request_id) WHERE bed_request_id IS NOT NULL;
CREATE INDEX payments_test_order_idx
  ON payments (test_order_id) WHERE test_order_id IS NOT NULL;
CREATE INDEX payments_ambulance_idx
  ON payments (ambulance_request_id) WHERE ambulance_request_id IS NOT NULL;

-- What a provider's webhook arrives holding.
CREATE INDEX payments_provider_ref_idx ON payments (provider_ref) WHERE provider_ref IS NOT NULL;

-- The settlement report's own query: everything one hospital took in a
-- period. The hospital is reached through the booking, so this index serves
-- the state-and-time half and the join does the rest.
CREATE INDEX payments_settlement_idx ON payments (state, paid_at) WHERE deleted_at IS NULL;

-- Refunds still owed: `FR-PAY-07` marks eligibility, and this is what a
-- worker or an administrator reads to find what has not gone back yet.
CREATE INDEX payments_refund_pending_idx
  ON payments (created_at)
  WHERE state = 'paid' AND refund_reason IS NOT NULL AND refunded_poisha = 0;

CREATE TRIGGER trg_payments_touch
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- An agreed amount is not editable. See the header.
CREATE FUNCTION fn_payment_amount_locked() RETURNS trigger AS $amount$
BEGIN
  IF NEW.amount_poisha IS DISTINCT FROM OLD.amount_poisha
     OR NEW.platform_fee_poisha IS DISTINCT FROM OLD.platform_fee_poisha THEN
    RAISE EXCEPTION
      'payments.amount_poisha and platform_fee_poisha are fixed at creation (FR-PAY-04); record a refund instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$amount$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_amount_locked
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_payment_amount_locked();

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN payments.provider_ref IS
  'The provider''s own transaction id. Never written to a log (CLAUDE.md §7).';
COMMENT ON COLUMN payments.refunded_poisha IS
  'Added to, never subtracted from amount_poisha, so a settlement can always state collections and refunds separately (FR-PAY-05).';

-- ===========================================================================
-- subscriptions / invoices — shape only, no numbers (see the header)
-- ===========================================================================

CREATE TABLE subscriptions (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id     uuid        NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,

  plan            text        NOT NULL,
  modules         text[]      NOT NULL DEFAULT '{}',
  monthly_poisha  integer     NOT NULL,

  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  state           text        NOT NULL DEFAULT 'active',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  deleted_at      timestamptz,

  CONSTRAINT subscriptions_plan_not_blank CHECK (btrim(plan) <> ''),
  CONSTRAINT subscriptions_monthly_non_negative CHECK (monthly_poisha >= 0),
  CONSTRAINT subscriptions_state_allowed
    CHECK (state IN ('active', 'paused', 'cancelled')),
  CONSTRAINT subscriptions_ends_after_start
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- One live subscription per hospital. Two would make an invoice ambiguous.
CREATE UNIQUE INDEX subscriptions_one_active_per_hospital
  ON subscriptions (hospital_id) WHERE state = 'active' AND deleted_at IS NULL;

CREATE TRIGGER trg_subscriptions_touch
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE subscriptions IS
  'Shape only in this version. Plans, modules and prices are negotiated per agreement and are not in this repository (CLAUDE.md §1.1).';

CREATE TABLE invoices (
  id                    uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id           uuid        NOT NULL REFERENCES hospitals (id) ON DELETE RESTRICT,

  period_start          date        NOT NULL,
  period_end            date        NOT NULL,

  subscription_poisha   integer     NOT NULL DEFAULT 0,
  booking_fee_poisha    integer     NOT NULL DEFAULT 0,
  total_poisha          integer     NOT NULL DEFAULT 0,

  state                 text        NOT NULL DEFAULT 'draft',
  issued_at             timestamptz,
  paid_at               timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT invoices_period_ordered CHECK (period_end >= period_start),
  CONSTRAINT invoices_amounts_non_negative
    CHECK (subscription_poisha >= 0 AND booking_fee_poisha >= 0 AND total_poisha >= 0),
  -- The total is the sum of its parts, or the invoice is not checkable.
  CONSTRAINT invoices_total_is_the_sum
    CHECK (total_poisha = subscription_poisha + booking_fee_poisha),
  CONSTRAINT invoices_state_allowed
    CHECK (state IN ('draft', 'issued', 'paid', 'void')),
  CONSTRAINT invoices_issued_has_time
    CHECK ((state IN ('issued', 'paid')) = (issued_at IS NOT NULL)),
  CONSTRAINT invoices_paid_has_time
    CHECK ((state = 'paid') = (paid_at IS NOT NULL))
);

CREATE UNIQUE INDEX invoices_one_per_hospital_period
  ON invoices (hospital_id, period_start, period_end) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_invoices_touch
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE invoices IS
  'Shape only in this version, as subscriptions is. Nothing generates one until there is an agreement to invoice against.';

-- ===========================================================================
-- counter_shifts (`FR-REC-23`)
-- ===========================================================================
--
-- A reception counter opens, takes cash, and closes. `expected_poisha` is
-- what the system says passed over that counter; `collected_poisha` is what
-- the person counted. They differ, and the difference is the point: a shift
-- that cannot be reconciled is the one worth looking at, and `variance_note`
-- is where the person says why.

CREATE TABLE counter_shifts (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  hospital_id       uuid        NOT NULL REFERENCES hospitals (id) ON DELETE CASCADE,

  counter_code      text        NOT NULL,
  staff_user_id     uuid        NOT NULL REFERENCES staff_users (id) ON DELETE RESTRICT,

  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,

  expected_poisha   integer     NOT NULL DEFAULT 0,
  collected_poisha  integer,
  variance_note     text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT counter_shifts_code_not_blank CHECK (btrim(counter_code) <> ''),
  CONSTRAINT counter_shifts_closes_after_opening
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT counter_shifts_amounts_non_negative
    CHECK (expected_poisha >= 0 AND (collected_poisha IS NULL OR collected_poisha >= 0)),
  -- An open shift has counted nothing yet; a closed one has.
  CONSTRAINT counter_shifts_closed_has_a_count
    CHECK ((closed_at IS NULL) = (collected_poisha IS NULL))
);

-- One open shift per counter. Two people taking cash at one window with two
-- open shifts is a reconciliation nobody can do.
CREATE UNIQUE INDEX counter_shifts_one_open_per_counter
  ON counter_shifts (hospital_id, counter_code)
  WHERE closed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX counter_shifts_hospital_idx
  ON counter_shifts (hospital_id, opened_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_counter_shifts_touch
  BEFORE UPDATE ON counter_shifts
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE counter_shifts ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN counter_shifts.variance_note IS
  'Why the counted cash and the expected figure differ. A shift that cannot be reconciled is the one worth looking at (FR-REC-23).';
