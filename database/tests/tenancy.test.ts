/**
 * Hospitals are kept apart by the database (`PRD.md` `FR-SEC-11`, `FR-NET-02`,
 * `FR-ONB-08`; DATABASE.md §6; migration 0043; plan B1).
 *
 * Asked of the policies themselves, with no application in the way: a
 * connection that says it is working for one hospital is shown that
 * hospital's rows and no other's, whatever the statement leaves out. Every
 * query here is deliberately one that *forgets* to say which hospital it
 * wants — the mistake the policies exist to make harmless.
 *
 * Run as a member of `app_tenant`, the role the policies are written for,
 * inside a transaction that is rolled back. The member is `tenancy_probe`,
 * which holds rows and nothing else, as the API's own role does; its rights
 * are given once by the suite's setup (`support/tenancyProbe.ts`). On the
 * seeded demo data, which has six hospitals with beds, staff, chambers,
 * bookings and visits.
 */

import { describe, expect, it } from 'vitest';

import { expectRejection, withRollback } from './support/database.js';
import { TENANCY_PROBE_ROLE } from './support/tenancyProbe.js';

import type { Client } from 'pg';

interface Two {
  readonly a: string;
  readonly b: string;
}

async function twoHospitals(client: Client): Promise<Two> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT h.id FROM hospitals h
      WHERE h.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM beds b WHERE b.hospital_id = h.id)
        AND EXISTS (SELECT 1 FROM sessions s WHERE s.hospital_id = h.id)
      ORDER BY h.code LIMIT 2`,
  );
  const [a, b] = rows.map((row) => row.id);
  if (a === undefined || b === undefined) {
    throw new Error('The seed should give two hospitals beds and chambers (FR-DEM-01).');
  }
  return { a, b };
}

/** From here to the end of the transaction, this connection is the API's kind of role. */
async function asTenant(client: Client): Promise<void> {
  await client.query(`SET LOCAL ROLE ${TENANCY_PROBE_ROLE}`);
}

async function scope(client: Client, kind: string | null, hospitalId = ''): Promise<void> {
  await client.query(
    `SELECT set_config('app.scope', $1, true), set_config('app.hospital_id', $2, true)`,
    [kind ?? '', hospitalId],
  );
}

async function count(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM (${sql}) q`,
    params,
  );
  return Number(rows[0]?.n ?? '-1');
}

/** Tables a member of staff must see only their own hospital's rows of, by `hospital_id`. */
const OWN_ROWS = [
  'beds',
  'wards',
  'staff_users',
  'staff_roles',
  'admissions',
  'bed_events',
  'emergency_cases',
  'test_orders',
  'visits',
  'consents',
] as const;

describe('a connection that says nothing is told nothing (FR-SEC-11)', () => {
  it('sees no row of any table', async () => {
    await withRollback(async (client) => {
      await asTenant(client);
      await scope(client, null);

      for (const table of ['hospitals', 'beds', 'sessions', 'bookings', 'patients', 'visits']) {
        expect(await count(client, `SELECT 1 FROM ${table}`), table).toBe(0);
      }
    });
  });

  it('and neither does one that says something the policies do not know', async () => {
    await withRollback(async (client) => {
      await asTenant(client);
      await scope(client, 'everything');
      expect(await count(client, 'SELECT 1 FROM beds')).toBe(0);
      expect(await count(client, 'SELECT 1 FROM hospitals')).toBe(0);
    });
  });
});

describe('a hospital’s staff reach that hospital’s rows and no other’s (FR-SEC-11, FR-NET-02)', () => {
  it('a query that forgets its hospital returns only the caller’s own', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const total: Record<string, number> = {};
      const own: Record<string, number> = {};
      for (const table of OWN_ROWS) {
        total[table] = await count(client, `SELECT 1 FROM ${table}`);
        own[table] = await count(client, `SELECT 1 FROM ${table} WHERE hospital_id = $1`, [a]);
      }

      await asTenant(client);
      await scope(client, 'hospital', a);

      for (const table of OWN_ROWS) {
        // No WHERE at all: what comes back is what the policy let through.
        expect(await count(client, `SELECT 1 FROM ${table}`), table).toBe(own[table]);
        expect(
          await count(client, `SELECT 1 FROM ${table} WHERE hospital_id = $1`, [b]),
          `${table}, asking for the other hospital by name`,
        ).toBe(0);
      }
      // The seed is not so thin that this proved nothing.
      expect(total['beds']).toBeGreaterThan(own['beds'] ?? 0);
      expect(own['beds']).toBeGreaterThan(0);
    });
  });

  it('the queue is theirs through the session: bookings, events and state', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const mine = await count(
        client,
        `SELECT 1 FROM bookings k JOIN sessions s ON s.id = k.session_id WHERE s.hospital_id = $1`,
        [a],
      );
      const theirs = await count(
        client,
        `SELECT 1 FROM bookings k JOIN sessions s ON s.id = k.session_id WHERE s.hospital_id = $1`,
        [b],
      );
      expect(mine).toBeGreaterThan(0);
      expect(theirs).toBeGreaterThan(0);

      await asTenant(client);
      await scope(client, 'hospital', a);

      expect(await count(client, 'SELECT 1 FROM bookings')).toBe(mine);
      for (const table of ['queue_events', 'queue_state']) {
        expect(
          await count(
            client,
            `SELECT 1 FROM ${table} q JOIN sessions s ON s.id = q.session_id WHERE s.hospital_id = $1`,
            [b],
          ),
          table,
        ).toBe(0);
      }
    });
  });

  it('cannot write into another hospital, by insert or by update', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const ward = await client.query<{ id: string }>(
        'SELECT id FROM wards WHERE hospital_id = $1 LIMIT 1',
        [b],
      );
      const theirBed = await client.query<{ id: string }>(
        'SELECT id FROM beds WHERE hospital_id = $1 LIMIT 1',
        [b],
      );

      await asTenant(client);
      await scope(client, 'hospital', a);

      // A bed for the other hospital: refused by name.
      const refused = await expectRejection(client, () =>
        client.query(
          `INSERT INTO beds (hospital_id, ward_id, label, kind, state, nightly_poisha, oos_reason)
           VALUES ($1, $2, 'X-1', 'general', 'out_of_service', 0, 'setup:unconfirmed')`,
          [b, ward.rows[0]?.id],
        ),
      );
      expect(refused.message).toContain('row-level security');

      // Their bed, changed: no row is there to change.
      const changed = await client.query('UPDATE beds SET label = label WHERE id = $1', [
        theirBed.rows[0]?.id,
      ]);
      expect(changed.rowCount).toBe(0);
      const removed = await client.query('DELETE FROM wards WHERE hospital_id = $1', [b]);
      expect(removed.rowCount).toBe(0);
    });
  });

  it('cannot move one of its own rows into another hospital', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const mine = await client.query<{ id: string }>(
        'SELECT id FROM departments WHERE hospital_id = $1 LIMIT 1',
        [a],
      );
      await asTenant(client);
      await scope(client, 'hospital', a);

      const refused = await expectRejection(client, () =>
        client.query('UPDATE departments SET hospital_id = $1 WHERE id = $2', [
          b,
          mine.rows[0]?.id,
        ]),
      );
      expect(refused.message).toContain('row-level security');
    });
  });
});

describe('what crosses between hospitals is named, and only that crosses (FR-NET-01, FR-NET-02)', () => {
  it('what a hospital publishes is read by anybody and changed only by the hospital', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const theirs = await count(client, 'SELECT 1 FROM sessions WHERE hospital_id = $1', [b]);
      const theirSession = await client.query<{ id: string }>(
        'SELECT id FROM sessions WHERE hospital_id = $1 LIMIT 1',
        [b],
      );

      await asTenant(client);
      await scope(client, 'hospital', a);

      // Chamber times are on the patient's search: another hospital's are readable.
      expect(await count(client, 'SELECT 1 FROM sessions WHERE hospital_id = $1', [b])).toBe(
        theirs,
      );
      // And not changeable.
      const changed = await client.query('UPDATE sessions SET room = room WHERE id = $1', [
        theirSession.rows[0]?.id,
      ]);
      expect(changed.rowCount).toBe(0);
    });
  });

  it('a referral is seen from both ends and by nobody else', async () => {
    await withRollback(async (client) => {
      const sent = await client.query<{ id: string; from_h: string; to_h: string }>(
        `SELECT id, from_hospital_id AS from_h, to_hospital_id AS to_h FROM referrals LIMIT 1`,
      );
      const referral = sent.rows[0];
      if (referral === undefined) throw new Error('The seed should hold a referral (FR-DEM-04).');
      const third = await client.query<{ id: string }>(
        'SELECT id FROM hospitals WHERE id NOT IN ($1, $2) LIMIT 1',
        [referral.from_h, referral.to_h],
      );

      await asTenant(client);
      for (const end of [referral.from_h, referral.to_h]) {
        await scope(client, 'hospital', end);
        expect(await count(client, 'SELECT 1 FROM referrals WHERE id = $1', [referral.id])).toBe(1);
      }
      await scope(client, 'hospital', third.rows[0]?.id ?? '');
      expect(await count(client, 'SELECT 1 FROM referrals WHERE id = $1', [referral.id])).toBe(0);
    });
  });

  it('a visit made elsewhere is read only under the patient’s live consent', async () => {
    await withRollback(async (client) => {
      const found = await client.query<{ id: string; patient_id: string; made_at: string }>(
        `SELECT id, patient_id, hospital_id AS made_at FROM visits
          WHERE signed_at IS NOT NULL AND deleted_at IS NULL LIMIT 1`,
      );
      const visit = found.rows[0];
      if (visit === undefined) throw new Error('The seed should hold signed visits (FR-DEM-03).');
      const other = await client.query<{ id: string }>(
        `SELECT h.id FROM hospitals h
          WHERE h.id <> $1
            AND NOT EXISTS (SELECT 1 FROM consents c
                             WHERE c.hospital_id = h.id AND c.patient_id = $2)
          LIMIT 1`,
        [visit.made_at, visit.patient_id],
      );
      const reader = other.rows[0]?.id ?? '';

      // Granted by the owner here, as the patient's own act would.
      const consent = await client.query<{ id: string }>(
        `INSERT INTO consents (patient_id, hospital_id, scope, expires_at, granted_via)
         VALUES ($1, $2, 'hospital', now() + interval '1 day', 'qr') RETURNING id`,
        [visit.patient_id, reader],
      );

      await asTenant(client);
      await scope(client, 'hospital', reader);
      expect(await count(client, 'SELECT 1 FROM visits WHERE id = $1', [visit.id])).toBe(1);
      // To read. Not to change: the record is the hospital's that wrote it.
      const changed = await client.query('UPDATE visits SET advice_text_bn = $2 WHERE id = $1', [
        visit.id,
        'x',
      ]);
      expect(changed.rowCount).toBe(0);

      await client.query('RESET ROLE');
      await client.query('UPDATE consents SET revoked_at = now() WHERE id = $1', [
        consent.rows[0]?.id,
      ]);
      await asTenant(client);
      await scope(client, 'hospital', reader);
      expect(await count(client, 'SELECT 1 FROM visits WHERE id = $1', [visit.id])).toBe(0);
    });
  });

  it('a patient a hospital imported is that hospital’s (FR-IMP-10)', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const imported = await client.query<{ id: string }>(
        `INSERT INTO patients (full_name, sex, age_years, owner_hospital_id)
         VALUES ('আমদানি রোগী (ডেমো)', 'female', 40, $1) RETURNING id`,
        [b],
      );
      const id = imported.rows[0]?.id;

      await asTenant(client);
      await scope(client, 'hospital', b);
      expect(await count(client, 'SELECT 1 FROM patients WHERE id = $1', [id])).toBe(1);
      await scope(client, 'hospital', a);
      expect(await count(client, 'SELECT 1 FROM patients WHERE id = $1', [id])).toBe(0);
    });
  });

  it('whether a hospital runs an emergency desk is one answer, never a row', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const truth = await client.query<{ runs: boolean }>(
        'SELECT fn_runs_emergency_desk($1) AS runs',
        [b],
      );

      await asTenant(client);
      await scope(client, 'hospital', a);
      // Who works there is not readable…
      expect(await count(client, 'SELECT 1 FROM staff_roles WHERE hospital_id = $1', [b])).toBe(0);
      // …and what the hospital publishes about it is.
      const asked = await client.query<{ runs: boolean }>(
        'SELECT fn_runs_emergency_desk($1) AS runs',
        [b],
      );
      expect(asked.rows[0]?.runs).toBe(truth.rows[0]?.runs);
    });
  });
});

describe('a platform administrator sees organisations, never a patient (FR-ONB-08)', () => {
  it('reads hospitals, their staff and their beds, and nothing about a person', async () => {
    await withRollback(async (client) => {
      const hospitals = await count(client, 'SELECT 1 FROM hospitals');
      const staff = await count(client, 'SELECT 1 FROM staff_users');

      await asTenant(client);
      await scope(client, 'national');

      expect(await count(client, 'SELECT 1 FROM hospitals')).toBe(hospitals);
      expect(await count(client, 'SELECT 1 FROM staff_users')).toBe(staff);
      expect(await count(client, 'SELECT 1 FROM beds')).toBeGreaterThan(0);

      for (const table of [
        'patients',
        'bookings',
        'visits',
        'admissions',
        'emergency_cases',
        'test_orders',
        'consents',
        'queue_events',
        'notifications',
        'guest_identities',
        'users',
        'referrals',
        'payments',
      ]) {
        expect(await count(client, `SELECT 1 FROM ${table}`), table).toBe(0);
      }
    });
  });
});

describe('no table is left without a policy', () => {
  it('every table in the schema has one for app_tenant', async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query<{ table_name: string }>(
        `SELECT c.relname AS table_name
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
          WHERE c.relkind = 'r'
            AND NOT EXISTS (
              SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname
                 AND 'app_tenant' = ANY (p.roles))
          ORDER BY 1`,
      );
      // A table added later with no policy is invisible to the API, which
      // fails loudly; this says which table, and why, before that.
      expect(rows.map((row) => row.table_name)).toEqual([]);
    });
  });

  it('and row-level security is on for every one of them', async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query<{ table_name: string }>(
        `SELECT c.relname AS table_name
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
          WHERE c.relkind = 'r' AND NOT c.relrowsecurity
          ORDER BY 1`,
      );
      expect(rows.map((row) => row.table_name)).toEqual([]);
    });
  });
});
