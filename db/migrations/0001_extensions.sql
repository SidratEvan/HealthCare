-- 0001_extensions.sql
--
-- Extensions and the two pieces of infrastructure every later migration needs:
-- time-sortable UUID generation (DB-P9) and the updated_at touch function (DB-P3).
--
-- DATABASE.md §7 places `trg_touch_updated_at` in 0013 ("fn_* functions and
-- remaining triggers"). The *function* has to exist here, because every table
-- created in 0003-0006 attaches the trigger at creation time — a table that
-- carries `updated_at` and does not maintain it is worse than one without the
-- column, since stale values read as fresh. 0013 keeps the remaining triggers.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- gen_random_uuid(), digest(), crypt() — used for UUIDs and for hashing tokens.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- uuid-ossp is named in DATABASE.md §7. It is kept for uuid_nil() and for
-- parity with the document; v7 generation below is our own, because no
-- PostgreSQL 16 extension provides it.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Geospatial. `hospitals` carries a geography(Point,4326) column with a GiST
-- index; emergency search filters by radius and then ranks (DATABASE.md §6).
CREATE EXTENSION IF NOT EXISTS postgis;

-- earthdistance (and its cube dependency) is named in DATABASE.md §7. PostGIS
-- geography is what the ranking query uses; earthdistance remains available for
-- the cheap bounding-box prefilter.
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ---------------------------------------------------------------------------
-- DB-P9: IDs are UUID v7 — time-sortable, generated server-side
--
-- PostgreSQL 16 has no native uuidv7(), so this builds one from a v4: the first
-- six bytes become the big-endian Unix timestamp in milliseconds, the version
-- nibble is set to 7, and the remaining 74 bits stay random.
--
-- Time-sortability is not cosmetic here. Primary keys arriving in rough time
-- order keep index inserts at the right-hand edge of the B-tree instead of
-- scattering them, which matters most on `queue_events` — the hot write path
-- of the whole product (DATABASE.md §6).
--
-- Ordering within a single millisecond is not guaranteed; `queue_events.seq`
-- is the authority on event order, never the id (DB-P1).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  ts_millis   bigint;
  ts_bytes    bytea;
  uuid_bytes  bytea;
BEGIN
  ts_millis := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  -- int8send gives 8 big-endian bytes; the low 6 carry every millisecond value
  -- until the year 10889, which is longer than this hospital will be standing.
  ts_bytes := substring(int8send(ts_millis) FROM 3 FOR 6);

  uuid_bytes := uuid_send(gen_random_uuid());
  uuid_bytes := overlay(uuid_bytes PLACING ts_bytes FROM 1 FOR 6);

  -- Byte 6: version 7 (0111) in the high nibble, random low nibble preserved.
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);

  -- Byte 8: RFC 4122 variant (10xx). gen_random_uuid() already sets this, and
  -- overlaying bytes 0-5 did not disturb it; set explicitly so the intent is
  -- readable rather than inherited.
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);

  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'Time-sortable UUID v7 (DB-P9). Default for every primary key in this schema.';

-- ---------------------------------------------------------------------------
-- DB-P3: every table carries created_at and updated_at, in UTC (DB-P4)
--
-- Attached by every table that follows. Written as a BEFORE trigger so the
-- value is authoritative regardless of what the client sent.
--
-- `now()` rather than `clock_timestamp()` is deliberate. now() is the
-- transaction timestamp, so every row written by one transaction — the event
-- append and the queue_state upsert that follows it — carries the same stamp,
-- and a long transaction stamps its rows slightly *earlier* than the commit.
-- For a product whose freshness line is a promise to the patient reading it,
-- the only safe rounding direction is older than reality, never newer
-- (FR-OFF-03, PRD.md §3.1).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_touch_updated_at() IS
  'Maintains updated_at on every mutation (DB-P3). Server clock only; a client timestamp is never trusted for this.';
