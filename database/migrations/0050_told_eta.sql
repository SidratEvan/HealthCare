-- 0050_told_eta.sql
--
-- What a waiting patient was last told about when they will be called
-- (`PRD.md` `FR-QUE-15`; DATABASE.md §2.3; plan F2c).
--
-- "A patient's ETA never moves earlier than their booked window without an
-- explicit notification, to avoid people missing a turn that arrived early."
-- The estimate has always known how to say that it moved earlier
-- (`shared/domain` `eta.ts`), and nothing ever told it earlier than what:
-- nowhere was it kept which time a patient had been given.
--
-- ## `bookings.told_eta_at`
--
-- The time in the last message that named one: the doctor has arrived,
-- expected around …; running late, now around …; your turn may come sooner,
-- now around …. Null until such a message is written, and then what the
-- patient was told is the chamber's planned start, which is the time in the
-- booking's confirmation.
--
-- It is not queue state and the reducer never reads it. It is a record of
-- what was said, written by the notification step of a queue write, in that
-- write's transaction, under the session's lock.
--
-- Additive: one nullable column.

ALTER TABLE bookings
  ADD COLUMN told_eta_at timestamptz;

COMMENT ON COLUMN bookings.told_eta_at IS
  'The time in the last message that told this patient when to expect their turn (FR-QUE-15). Null: only the chamber''s planned start, from the confirmation.';
