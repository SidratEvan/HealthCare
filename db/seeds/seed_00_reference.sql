-- seed_00_reference.sql
--
-- DATABASE.md §7 describes this file as "districts, capability list, medicine
-- formulary sample". Two of those three have no table to go into yet, and the
-- third is an enum rather than data, so this file does what it can and says so
-- rather than appearing to have seeded something it did not.
--
--   districts           no `districts` table exists and DATABASE.md §2 defines
--                       none: `hospitals.division` / `hospitals.district` are
--                       text, as `blood_donors.district` (0011) will be. The
--                       canonical list therefore lives in
--                       `db/seeds/data/reference.ts`, where the rows that use
--                       it are written, and a pair that is not in it is a typo
--                       rather than a new place.
--
--   capability list     `capability_kind` is an enum (DATABASE.md §1), so the
--                       "list" is a type, not rows. The per-facility rows that
--                       publish a capability to the emergency network
--                       (`FR-EMG-05`) belong to a hospital and are written by
--                       `seed_01_hospitals.ts`. This file asserts the label set
--                       instead, below.
--
--   medicine formulary  `medicines` is created by migration 0007_clinical.sql,
--                       which does not exist. The formulary lands with it, in
--                       the same branch as the e-prescription screen that needs
--                       autocomplete over it (`FR-DOC-05`, build step 12).
--                       Writing fifty medicine rows now would be inventing
--                       clinical content for a table with no shape
--                       (CLAUDE.md §8).
--
-- What is left is worth having on its own: this file is the seed run's
-- pre-flight check. It fails loudly, before a single row is written, if the
-- database is not the schema the seeds were written against — which is a far
-- better error than `relation "hospitals" does not exist` forty modules deep.

-- ---------------------------------------------------------------------------
-- The schema the seeds expect
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'schema_migrations') THEN
    RAISE EXCEPTION
      'No migration ledger. Run `pnpm db:migrate` before seeding.'
      USING ERRCODE = 'undefined_table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0006') THEN
    RAISE EXCEPTION
      'The seeds need migrations 0001-0006 (DATABASE.md §7). Run `pnpm db:migrate`.'
      USING ERRCODE = 'undefined_table';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The capability list (DATABASE.md §1, FR-EMG-05)
--
-- Asserted rather than inserted. The demo set in `data/hospitals.ts` names a
-- capability per facility, and a label quietly renamed in a later migration
-- would make those rows fail with a cast error somewhere in the middle of the
-- run. `db:verify` checks the same label sets against @platform/domain; this
-- is the seed run's own copy of that check, for the one enum the demo set
-- depends on by name.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  expected text[] := ARRAY[
    'burn_unit','cardiac','cath_lab','stroke','dialysis','nicu','trauma_ot',
    'blood_bank','ambulance','isolation'
  ];
  actual   text[];
BEGIN
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
    INTO actual
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'capability_kind';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'capability_kind is % but the demo set was written against % (DATABASE.md §1).',
      actual, expected
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The queue event types the demo's event log is built from (FR-QUE-03)
--
-- `seed_04_history` and `seed_07_demo_live` write a real event log and replay
-- it through the reducer in @platform/domain. The reducer's switch is
-- exhaustive over these eighteen labels, so a mismatch here is a mismatch
-- between the database and the shared brain — and it is better found before
-- the demo than during it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(needed)
    INTO missing
    FROM unnest(ARRAY[
      'SESSION_OPENED','DOCTOR_ARRIVED','DELAY_DECLARED','SESSION_PAUSED','SESSION_RESUMED',
      'PATIENT_CALLED','PATIENT_DONE','PATIENT_LATE','PATIENT_NO_SHOW','PATIENT_REINSERTED',
      'WALKIN_ADDED','BOOKING_CANCELLED','SLOT_OFFERED','SLOT_ACCEPTED','SLOT_EXPIRED',
      'PRIORITY_REORDERED','SESSION_ENDED','ACTION_UNDONE'
    ]) AS needed
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'queue_event_type' AND e.enumlabel::text = needed
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'queue_event_type is missing %: the seeds cannot write a log the reducer would refuse (DATABASE.md §1).',
      missing
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The demo database holds no real patient data, ever (FR-SEC-08)
--
-- Recorded on the database itself, so anyone who opens it in a table editor or
-- inherits the connection string is told what it is before they read a row.
-- ---------------------------------------------------------------------------

COMMENT ON SCHEMA public IS
  'Demonstration data only (FR-DEM-07). Contains no real patient data and never may (FR-SEC-08). Rebuild with `pnpm db:reset`.';
