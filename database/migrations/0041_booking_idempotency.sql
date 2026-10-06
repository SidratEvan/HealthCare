-- 0041_booking_idempotency.sql
--
-- A booking remembers the request that made it (`PRD.md` `FR-QUE-51`,
-- DATABASE.md §2.3; plan A5, handover finding 19).
--
-- `POST /bookings` requires an Idempotency-Key and did nothing with it. A
-- patient whose confirm went through and whose answer was lost on the way —
-- an ordinary thing on a phone — retried with the same key and was told
-- "this patient already has a booking with this doctor today". They had a
-- serial and no way to see it: the tracking link is returned once, and only
-- its hash is stored (`FR-GST-05`).
--
-- So the key is kept on the row it produced. The same request, sent again,
-- finds its booking and is answered with it. The key is unique, so two
-- requests cannot both claim it; and it is the durable record of the
-- guarantee, where `middleware/idempotency.ts` says such a record belongs:
-- with the resource, not in a table beside it.
--
-- NULL for every booking made before this, and for one made by a route that
-- has no key to give (a counter walk-in is keyed by its queue event). The
-- index is partial for that reason.
--
-- Additive: no row changes.

ALTER TABLE bookings
  ADD COLUMN idempotency_key text;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_idempotency_key_shape
    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 16 AND 128);

CREATE UNIQUE INDEX bookings_idempotency_key
  ON bookings (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN bookings.idempotency_key IS
  'The Idempotency-Key of the POST /bookings that made this row. The same request sent again is answered with this booking (FR-QUE-51).';

-- ---------------------------------------------------------------------------
-- More than one live tracking link for a booking
-- ---------------------------------------------------------------------------
--
-- A booking had exactly one link (`guest_links_booking_key`), and minting one
-- replaced the last. That is what made the retry above impossible to answer
-- properly: the patient whose answer was lost needs a link that works, only a
-- hash of the first one is stored so it cannot be given again, and a new one
-- would have killed the link already on its way to them by SMS.
--
-- So a booking may hold a few live links. Each is still scoped to that one
-- booking and to nothing else (`FR-GST-05`), each expires with the chamber,
-- and they are revoked together, by booking, as before. The API keeps only
-- the newest few live (`guest.repo`), so a retry loop cannot grow the table.

DROP INDEX guest_links_booking_key;

CREATE INDEX guest_links_booking_idx ON guest_links (booking_id);
