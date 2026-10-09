-- 0060_arrival_windows.sql
--
-- A preferred hour to arrive (plan R1; `PRD.md` `FR-PAT-28`; the owner's
-- decision 1c of 8 October).
--
-- A hospital may offer, at booking, a choice of one-hour windows across the
-- chamber, so a patient can say when they mean to come. It is a preference
-- and never a promise: the queue does not read it, a serial is called in its
-- order, and the live serial and its estimate stay what a patient goes by.
--
--   hospital_settings.arrival_windows   whether this hospital offers it; off
--                                       until the hospital turns it on.
--   bookings.arrival_window_start       the start of the hour the patient
--                                       chose, or null; the window is the
--                                       hour from it, cut at the chamber's end.
--
-- Additive: two columns and a function.

ALTER TABLE hospital_settings
  ADD COLUMN arrival_windows boolean NOT NULL DEFAULT false;

ALTER TABLE bookings
  ADD COLUMN arrival_window_start timestamptz;

COMMENT ON COLUMN bookings.arrival_window_start IS
  'The preferred hour the patient chose (FR-PAT-28). A preference: the queue never reads it.';

CREATE FUNCTION fn_offers_arrival_windows(hospital uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    (SELECT s.arrival_windows FROM hospital_settings s WHERE s.hospital_id = hospital),
    false)
$$;

COMMENT ON FUNCTION fn_offers_arrival_windows(uuid) IS
  'Whether a hospital offers a preferred arrival hour at booking (FR-PAT-28).';
