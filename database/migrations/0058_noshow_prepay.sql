-- 0058_noshow_prepay.sql
--
-- Payment first, after no-shows (plan F3; `PRD.md` `FR-GST-14`, its second
-- half; `FR-PAY-02`).
--
-- "Three no-shows on a phone number within a rolling window may require
-- prepayment for the next guest booking, configurable per hospital." Two
-- settings carry it, and both are off until a hospital turns them on:
--
--   noshow_prepay          whether this hospital asks for payment first from
--                          a number with three no-shows here in the window;
--   noshow_window_days     the window, 90 days unless the hospital says.
--
-- The rule never applies on a deployment that takes no payment online: a
-- person is never turned away for a payment nobody can take (the API decides
-- that, `booking.service`). It counts no-shows at this hospital only: another
-- hospital's attendance is that hospital's, not this one's (`FR-NET-02`).
--
-- Additive: two columns.

ALTER TABLE hospital_settings
  ADD COLUMN noshow_prepay boolean NOT NULL DEFAULT false;

ALTER TABLE hospital_settings
  ADD COLUMN noshow_window_days int NOT NULL DEFAULT 90
  CONSTRAINT hospital_settings_noshow_window_range CHECK (noshow_window_days BETWEEN 7 AND 365);
