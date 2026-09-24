/**
 * The national layer's schema (migrations 0024–0026; `FR-GOV-01`..`FR-GOV-06`).
 *
 * Run against the seeded demo database, like every other suite (`CLAUDE.md`
 * §6). What is checked here is what the API suite cannot see from outside:
 *
 *   - that `gov_reader` can select from exactly six relations in the whole
 *     schema, and they are the six aggregate views — so a view added next year
 *     is unreadable by the government layer until somebody grants it on
 *     purpose (`DATABASE.md` §5);
 *   - that no column of those views could carry an identifier;
 *   - that a national role and a hospital are mutually exclusive in the table,
 *     not only in the API (`FR-ROLE-01`, STATUS decision 5);
 *   - that the demo's planted signal is there to be seen.
 */

import { describe, expect, it } from 'vitest';

import { connect } from './support/database.js';

import type { Client } from 'pg';

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

async function query<T extends Record<string, unknown>>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  return await withClient(async (client) => (await client.query<T>(sql, [...values])).rows);
}

const GOV_VIEWS = [
  'v_gov_benchmark',
  'v_gov_capacity',
  'v_gov_er_hourly',
  'v_gov_er_now',
  'v_gov_reporting',
  'v_gov_symptom_daily',
];

describe('gov_reader can read the six aggregate views and nothing else (DATABASE.md §5)', () => {
  it('holds SELECT on exactly those six relations in the schema', async () => {
    const rows = await query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
         AND has_table_privilege('gov_reader', c.oid, 'SELECT')
       ORDER BY c.relname
    `);

    expect(rows.map((row) => row.relname)).toEqual(GOV_VIEWS);
  });

  it('holds no write privilege anywhere', async () => {
    const rows = await query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'v', 'm', 'p')
         AND (has_table_privilege('gov_reader', c.oid, 'INSERT')
           OR has_table_privilege('gov_reader', c.oid, 'UPDATE')
           OR has_table_privilege('gov_reader', c.oid, 'DELETE'))
    `);

    expect(rows).toEqual([]);
  });

  it('cannot log in: it is only ever switched to', async () => {
    const [role] = await query<{ rolcanlogin: boolean }>(
      `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'gov_reader'`,
    );
    expect(role?.rolcanlogin).toBe(false);
  });
});

describe('no gov view has a column that could identify (FR-GOV-06)', () => {
  it.each(GOV_VIEWS)('%s', async (view) => {
    const rows = await query<{ attname: string }>(
      `SELECT a.attname
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped`,
      [view],
    );
    const columns = rows.map((row) => row.attname);

    expect(columns.length).toBeGreaterThan(0);
    expect(columns.filter((name) => name === 'id' || name.endsWith('_id'))).toEqual([]);
    expect(
      columns.filter((name) => /name|phone|email|patient|token|serial|booking/.test(name)),
    ).toEqual([]);
  });
});

describe('a national role has no hospital, and only a national role (0024, FR-ROLE-01)', () => {
  /** Runs `sql` in a transaction that is always rolled back. */
  async function attempt(sql: string, values: readonly unknown[]): Promise<'ok' | string> {
    return await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(sql, [...values]);
        return 'ok';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }

  async function aStaffUser(): Promise<{ id: string; hospital_id: string }> {
    const [row] = await query<{ id: string; hospital_id: string }>(
      `SELECT id, hospital_id FROM staff_users WHERE hospital_id IS NOT NULL LIMIT 1`,
    );
    if (row === undefined) throw new Error('no seeded hospital staff');
    return row;
  }

  it('refuses a government role at a hospital', async () => {
    const staff = await aStaffUser();
    expect(
      await attempt(
        `INSERT INTO staff_roles (staff_user_id, hospital_id, role) VALUES ($1, $2, 'gov_viewer')`,
        [staff.id, staff.hospital_id],
      ),
    ).toMatch(/staff_roles_national_has_no_hospital/);
  });

  it('refuses a hospital role with no hospital', async () => {
    const staff = await aStaffUser();
    expect(
      await attempt(
        `INSERT INTO staff_roles (staff_user_id, hospital_id, role) VALUES ($1, NULL, 'receptionist')`,
        [staff.id],
      ),
    ).toMatch(/staff_roles_national_has_no_hospital/);
  });

  it('refuses the same national role twice for one person, null hospital or not', async () => {
    const [viewer] = await query<{ staff_user_id: string }>(
      `SELECT staff_user_id FROM staff_roles WHERE role = 'gov_viewer' LIMIT 1`,
    );
    expect(
      await attempt(
        `INSERT INTO staff_roles (staff_user_id, hospital_id, role) VALUES ($1, NULL, 'gov_viewer')`,
        [viewer?.staff_user_id],
      ),
    ).toMatch(/staff_roles_national_unique/);
  });

  it('refuses two national accounts with one email', async () => {
    expect(
      await attempt(
        `INSERT INTO staff_users (hospital_id, email, full_name, password_hash)
         VALUES (NULL, 'GOV@national.demo.invalid', 'x', '!disabled:test')`,
        [],
      ),
    ).toMatch(/staff_users_national_email_key/);
  });
});

describe('the seeded national account (FR-DEM-07, S-B-13)', () => {
  it('is one government viewer, belonging to no facility', async () => {
    const rows = await query<{ hospital_id: string | null; role_hospital: string | null; email: string }>(`
      SELECT su.hospital_id, sr.hospital_id AS role_hospital, su.email
        FROM staff_users su
        JOIN staff_roles sr ON sr.staff_user_id = su.id
       WHERE sr.role = 'gov_viewer'
    `);

    expect(rows).toEqual([
      { hospital_id: null, role_hospital: null, email: 'gov@national.demo.invalid' },
    ]);
  });
});

describe('the demo plants one signal (FR-GOV-03, seed_09_signals)', () => {
  it('has dengue in Dhaka this week at least five and at least double its usual week', async () => {
    const [row] = await query<{ this_week: number; before: number }>(`
      SELECT coalesce(sum(cases) FILTER (
               WHERE day > (now() AT TIME ZONE 'Asia/Dhaka')::date - 7), 0)::int AS this_week,
             coalesce(sum(cases) FILTER (
               WHERE day <= (now() AT TIME ZONE 'Asia/Dhaka')::date - 7
                 AND day > (now() AT TIME ZONE 'Asia/Dhaka')::date - 21), 0)::int AS before
        FROM v_gov_symptom_daily
       WHERE district = 'Dhaka' AND signal = 'dengue'
    `);

    const thisWeek = row?.this_week ?? 0;
    const usualWeek = (row?.before ?? 0) / 2;
    expect(thisWeek).toBeGreaterThanOrEqual(5);
    expect(thisWeek).toBeGreaterThanOrEqual(2 * usualWeek);
  });

  it('re-labels a planted case whole: complaint, assessment and tag agree', async () => {
    const rows = await query<{ complaint: string; diagnosis: string }>(`
      SELECT b.intake ->> 'complaintEn' AS complaint, v.diagnosis_text AS diagnosis
        FROM visits v
        JOIN bookings b ON b.id = v.booking_id
       WHERE v.symptom_signal = 'dengue'
    `);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.complaint).toBe('Fever with body ache');
      expect(row.diagnosis).toMatch(/ডেঙ্গু/);
    }
  });
});
