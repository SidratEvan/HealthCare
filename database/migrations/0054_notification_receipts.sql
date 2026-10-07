-- 0054_notification_receipts.sql
--
-- Finding a message by what its aggregator calls it (`PRD.md` `FR-NOT-06`;
-- BACKEND.md §7.7 `/webhooks/sms-dlr`; DATABASE.md §2.7; plan H2).
--
-- "Per-hospital SMS budget caps and delivery reporting." A delivery receipt
-- names a message by the aggregator's reference, `provider_ref`, and by
-- nothing else. That column had no index, because nothing had ever looked a
-- message up by it: `SMS_PROVIDER=log` sends no receipts. A real aggregator
-- sends one for every message, and a receipt that scans the table is a
-- table scan per message sent.
--
-- Partial: a row that was never handed to a provider has no reference.
--
-- Additive: one index.

CREATE INDEX notifications_provider_ref_idx
  ON notifications (provider_ref)
  WHERE provider_ref IS NOT NULL;
