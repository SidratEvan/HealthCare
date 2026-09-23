/**
 * The step-1 claim: the schema applies clean on a fresh database.
 *
 * The global setup has already dropped the public schema and applied every
 * migration before these tests run, so reaching this file at all proves the
 * headline. What is left to prove is that the runner keeps the promises
 * DATABASE.md §7 makes about it: order, idempotency, and a refusal to run
 * against a database whose migrations have drifted from the repository.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readMigrations, applyMigrations } from '../scripts/lib/migrations.js';

import { connect, withRollback } from './support/database.js';

describe('migration files (DATABASE.md §7)', () => {
  const migrations = readMigrations();

  it('covers the migrations the build has reached, and no others', () => {
    // 0001–0006 were step 1. 0010 arrived with step 11 (notifications) ahead of
    // 0007–0009, because the build order reaches messaging before clinical
    // records, beds and money — and nothing in 0010 depends on any of them.
    // 0007 then landed with step 12, *behind* an already-applied 0010.
    //
    // The runner applies whatever a database has not seen, in filename order,
    // so a fresh build and an incrementally migrated one converge either way:
    // a new database runs 0007 before 0010, an existing one runs it after, and
    // neither ordering matters because the dependency runs the other way —
    // 0010 deliberately left `feedback` out *because* its foreign key needs
    // `visits`, and 0007 creates both.
    //
    // 0008 and 0012 arrived with step 14, the bed board. 0012 holds one view,
    // `v_public_hospital_capacity`, rather than every `v_*` DATABASE.md §7
    // lists: the others read tables later steps create, and a shipped
    // migration is never edited to add them.
    //
    // 0013 and 0016 arrived with step 15, the emergency console. 0013 holds one
    // function, `fn_nearby_hospitals`, on the same reasoning as 0012. 0016 adds
    // what `emergency_cases` could not yet say — the owner's ruling of
    // 2026-09-21 — and is numbered past 0014 (RLS policies) and 0015 (indexes)
    // because those two keep the numbers DATABASE.md §7 gives them and will
    // land later. Nothing in either depends on 0016, so the runner's filename
    // order converges the same way it did for 0007 behind 0010.
    //
    // 0017 arrived with step 16, referrals — what `referrals` could not yet
    // say, on the owner's ruling of 2026-09-22.
    //
    // 0011 and 0018 arrived with step 17, the lab and the pharmacy. 0011 is
    // the ancillary set DATABASE.md §7 names, written whole although only
    // `pharmacy_stock` is read yet, because a shipped migration is never
    // edited. 0018 adds what `test_orders` and `reports` could not yet say —
    // an idempotency key and who a report reached — and is numbered past
    // 0014 and 0015 for the reason 0016 and 0017 are.
    //
    // 0009 and 0019 arrived with step 18, the money. 0009 takes the number
    // DATABASE.md §7 gives it even though it lands after 0018 in wall-clock
    // time — the same trade 0007 made behind 0010. 0019 exists because of
    // what that ordering costs: on a fresh database 0009 runs *before* 0011,
    // so `payments.ambulance_request_id` could not carry its foreign key,
    // and 0019 adds it once `ambulance_requests` exists.
    //
    // 0020 arrived with step 19, the admin dashboard: the three views
    // DATABASE.md §4 specifies and 0012 deferred until the step that reads
    // them. `feedback` needed no migration — 0007 already created it beside
    // the `visits` row it rates.
    expect(migrations.map((m) => m.version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
    ]);
  });

  it('applies in filename order', () => {
    const versions = migrations.map((m) => m.version);
    expect([...versions].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(versions);
  });

  it('rejects a filename that is not NNNN_lower_snake_case.sql', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    writeFileSync(join(dir, 'add-beds.sql'), 'SELECT 1;');

    expect(() => readMigrations(dir)).toThrow(/NNNN_lower_snake_case\.sql/);
  });

  it('rejects two migrations sharing a version, because order would be ambiguous', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    writeFileSync(join(dir, '0007_beds.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '0007_wards.sql'), 'SELECT 1;');

    expect(() => readMigrations(dir)).toThrow(/share version 0007/);
  });
});

describe('the applied database', () => {
  it('records every migration in the ledger with a checksum', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      );

      expect(rows.map((r) => r.version)).toEqual(readMigrations().map((m) => m.version));
      for (const row of rows) {
        expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
      }
    } finally {
      await client.end();
    }
  });

  it('is idempotent: a second run applies nothing', async () => {
    const client = await connect();
    try {
      const result = await applyMigrations(client);
      expect(result.applied).toEqual([]);
      expect(result.alreadyApplied).toBe(readMigrations().length);
    } finally {
      await client.end();
    }
  });

  it('refuses to proceed when a shipped migration has been edited', async () => {
    const client = await connect();
    try {
      // Simulated inside a transaction that is rolled back, so the real ledger
      // is untouched.
      await client.query('BEGIN');
      await client.query(
        `UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '0002'`,
      );

      await expect(applyMigrations(client)).rejects.toThrow(
        /0002_enums\.sql has changed since it was applied/,
      );
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('created every table the step-1 migrations define', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ name: string }>(`
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
      `);
      const tables = new Set(rows.map((r) => r.name));

      for (const expected of [
        // 0003 identity
        'users',
        'guest_identities',
        'patients',
        'staff_users',
        'staff_roles',
        'sessions_auth',
        'guest_links',
        // 0004 facilities
        'hospitals',
        'hospital_settings',
        'departments',
        'doctors',
        'doctor_hospitals',
        'capabilities',
        // 0005 sessions and bookings
        'session_templates',
        'sessions',
        'bookings',
        // 0006 the event log
        'queue_events',
        'queue_state',
        'standby_list',
        'slot_offers',
        // 0008 beds, emergency, referrals
        'wards',
        'beds',
        'bed_events',
        'admissions',
        'bed_requests',
        'emergency_cases',
        'referrals',
      ]) {
        expect(tables, `missing table ${expected}`).toContain(expected);
      }
    } finally {
      await client.end();
    }
  });

  it('installed the extensions the geo and crypto paths need', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ extname: string }>('SELECT extname FROM pg_extension');
      const installed = new Set(rows.map((r) => r.extname));

      for (const extension of ['pgcrypto', 'uuid-ossp', 'postgis', 'cube', 'earthdistance']) {
        expect(installed, `missing extension ${extension}`).toContain(extension);
      }
    } finally {
      await client.end();
    }
  });
});

describe('uuid_generate_v7 (DB-P9)', () => {
  it('produces version 7, RFC 4122 variant UUIDs', async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'SELECT uuid_generate_v7()::text AS id FROM generate_series(1, 32)',
      );

      for (const { id } of rows) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    });
  });

  it('is time-sortable, which is what keeps queue_events inserts at the index edge', async () => {
    await withRollback(async (client) => {
      const first = await client.query<{ id: string }>('SELECT uuid_generate_v7()::text AS id');
      await client.query(`SELECT pg_sleep(0.01)`);
      const second = await client.query<{ id: string }>('SELECT uuid_generate_v7()::text AS id');

      const earlier = first.rows[0]?.id ?? '';
      const later = second.rows[0]?.id ?? '';
      expect(earlier < later).toBe(true);
    });
  });

  it('encodes the current time in the first six bytes', async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query<{ encoded_ms: string; now_ms: string }>(`
        SELECT ('x' || substring(replace(uuid_generate_v7()::text, '-', '') FROM 1 FOR 12))::bit(48)::bigint::text AS encoded_ms,
               (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint::text AS now_ms
      `);

      const encoded = Number(rows[0]?.encoded_ms ?? 0);
      const now = Number(rows[0]?.now_ms ?? 0);
      expect(Math.abs(now - encoded)).toBeLessThan(1_000);
    });
  });
});
