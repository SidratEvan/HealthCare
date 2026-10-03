/**
 * What the API's database role cannot do (`docs/PLATFORM_PLAN.md` 1.7).
 *
 * Every other file in this suite proves the positive half without saying so:
 * the API connects as this role (`support/env.setup.ts`) and all of its
 * endpoints work. This file is the negative half — the statements an injected
 * query, a bug or a compromised API process would reach for, each of which the
 * database itself now refuses.
 *
 * Until this role existed the API on a hospital's server connected as the
 * owner, a superuser, and every statement below succeeded.
 *
 * Run through the API's own pool, so what is refused is what the API is
 * refused. Each statement is its own transaction; a refused one leaves
 * nothing behind.
 */

import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { db } from '../config/db.js';

/** PostgreSQL's `insufficient_privilege`. */
const REFUSED = '42501';

async function codeOf(statement: ReturnType<typeof sql>): Promise<string | null> {
  try {
    await statement.execute(db);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}

describe('who the API connects as', () => {
  it('is not the owner, and holds none of the attributes that outrank a grant', async () => {
    const result = await sql<{
      name: string;
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
    }>`
      SELECT rolname AS name, rolsuper, rolcreaterole, rolcreatedb, rolreplication
        FROM pg_roles WHERE rolname = current_user
    `.execute(db);

    expect(result.rows[0]).toEqual({
      name: 'healthcare_api',
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it('owns nothing in the schema', async () => {
    const result = await sql<{ owned: string }>`
      SELECT count(*)::text AS owned
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = current_user
    `.execute(db);

    expect(result.rows[0]?.owned).toBe('0');
  });
});

describe('the schema is not the API’s to change', () => {
  it.each([
    ['drop a table', sql`DROP TABLE bookings`],
    ['add a column', sql`ALTER TABLE patients ADD COLUMN leaked text`],
    ['create a table', sql`CREATE TABLE public.scratch (id int)`],
    ['empty a table', sql`TRUNCATE notifications`],
    [
      'switch off the guard on the event log',
      sql`ALTER TABLE queue_events DISABLE TRIGGER trg_queue_events_no_mutate`,
    ],
    [
      'replace a function',
      sql`CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
    ],
    ['make another account', sql`CREATE ROLE somebody LOGIN SUPERUSER`],
    ['rewrite the migration ledger', sql`DELETE FROM schema_migrations`],
  ])('cannot %s', async (_what, statement) => {
    expect(await codeOf(statement)).toBe(REFUSED);
  });

  it('cannot reach the server it runs on', async () => {
    // A superuser can read any file the database process can, and run a
    // program. Both are how a database account becomes a machine account.
    expect(await codeOf(sql`SELECT pg_read_file('/etc/passwd')`)).toBe(REFUSED);
    expect(await codeOf(sql`COPY (SELECT 1) TO PROGRAM 'true'`)).toBe(REFUSED);
  });
});

describe('history stays written', () => {
  it('cannot change or remove an audit row', async () => {
    // No trigger guards `audit_log`; this grant is the guard.
    expect(await codeOf(sql`DELETE FROM audit_log`)).toBe(REFUSED);
    expect(await codeOf(sql`UPDATE audit_log SET action = action`)).toBe(REFUSED);
  });

  it('cannot remove a queue event, or change or remove a bed event', async () => {
    expect(await codeOf(sql`DELETE FROM queue_events`)).toBe(REFUSED);
    expect(await codeOf(sql`DELETE FROM bed_events`)).toBe(REFUSED);
    expect(await codeOf(sql`UPDATE bed_events SET created_at = created_at`)).toBe(REFUSED);
  });

  it('can still write an audit row, which is all it ever needs to', async () => {
    const granted = await sql<{ can_insert: boolean; can_select: boolean }>`
      SELECT has_table_privilege(current_user, 'audit_log', 'INSERT') AS can_insert,
             has_table_privilege(current_user, 'audit_log', 'SELECT') AS can_select
    `.execute(db);

    expect(granted.rows[0]).toEqual({ can_insert: true, can_select: true });
  });
});

describe('what it is given instead of ownership', () => {
  it('rebuilds the dashboard snapshot through the one function that may', async () => {
    // Only a materialised view's owner may refresh it (migration 0034).
    expect(await codeOf(sql`REFRESH MATERIALIZED VIEW v_admin_daily`)).toBe(REFUSED);
    expect(await codeOf(sql`SELECT fn_refresh_admin_daily()`)).toBeNull();
  });

  it('reads the migration ledger, for the readiness probe', async () => {
    const result = await sql<{ versions: string }>`
      SELECT count(*)::text AS versions FROM schema_migrations
    `.execute(db);

    expect(Number(result.rows[0]?.versions)).toBeGreaterThan(0);
  });
});
