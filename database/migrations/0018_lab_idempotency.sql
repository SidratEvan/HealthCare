-- 0018_lab_idempotency.sql
--
-- What `test_orders` and `reports` (0007) could not yet say (`FR-LAB-01..03`).
--
-- 0007 created both tables to the letter of DATABASE.md §2.4, before any
-- console ordered a test. Building the lab (step 17) found the same thing
-- step 16 found for referrals, and this file is 0017's counterpart:
--
--   idempotency_key   CLAUDE.md §7 — "every write endpoint accepts an
--                     idempotency key" — and the lab console is
--                     offline-capable (`FR-OFF-01`). A doctor who taps
--                     রেকর্ড দিন on a dead connection replays the order on
--                     reconnect and must find the orders they already made,
--                     not a second set. A lab that uploads a report twice
--                     must find the report it already uploaded, because the
--                     second upload would deliver a second copy into the
--                     patient's wallet.
--
--   delivered_to      Which wallets a report actually reached (`FR-LAB-03`:
--                     "auto-delivers to the patient wallet **and the ordering
--                     doctor**"). `reports.delivered_to_wallet_at` records
--                     that it happened; this records to whom, which is what
--                     makes the promise auditable rather than merely stamped.
--
-- ## Why the key is unique per table rather than globally
--
-- A key is minted by one console for one action. Two labs at two hospitals
-- generating the same uuid is not a scenario worth designing against, and a
-- shared idempotency table would be a second source of truth for what the
-- rows already know — the arrangement `referrals.idempotency_key` settled on.
--
-- A NULL key is allowed and does not participate: the partial unique index
-- below means "at most one row per key", not "every row has a key". A test
-- order created by a seed has no console behind it and therefore no key.

-- ===========================================================================
-- test_orders
-- ===========================================================================

ALTER TABLE test_orders
  ADD COLUMN idempotency_key text;

-- One order per key, and the lookup a replay does.
CREATE UNIQUE INDEX test_orders_idempotency_key
  ON test_orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN test_orders.idempotency_key IS
  'One console action, replayable (CLAUDE.md §7, FR-OFF-01). A doctor ticking '
  'four test chips sends one key; each of the four rows carries it suffixed by '
  'its test code, so a replay finds all four and creates none.';

-- ===========================================================================
-- reports
-- ===========================================================================

ALTER TABLE reports
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX reports_idempotency_key
  ON reports (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Who the report reached, as `FR-LAB-03` names them: the patient's wallet and
-- the doctor who ordered the test. An array rather than two booleans, because
-- the list grows when a referral or a second treating doctor is in scope and
-- a boolean per recipient kind would need a migration each time.
ALTER TABLE reports
  ADD COLUMN delivered_to text[] NOT NULL DEFAULT '{}';

-- A delivery stamp and an empty recipient list contradict each other, and the
-- figure `FR-LAB-03` is measured by is the stamp.
ALTER TABLE reports
  ADD CONSTRAINT reports_delivery_names_recipients
  CHECK (delivered_to_wallet_at IS NULL OR cardinality(delivered_to) > 0);

COMMENT ON COLUMN reports.delivered_to IS
  'Whom FR-LAB-03 actually reached: "patient" and, when the test came out of a '
  'consultation, "doctor". Empty until delivery, and never empty after it.';
