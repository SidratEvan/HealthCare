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

/** A person's scope: an account's, or a tracking link's with the booking it names. */
async function person(
  client: Client,
  kind: 'patient' | 'guest',
  personId: string,
  bookingId = '',
): Promise<void> {
  await client.query(
    `SELECT set_config('app.scope', $1, true), set_config('app.hospital_id', '', true),
            set_config('app.person_id', $2, true), set_config('app.booking_id', $3, true)`,
    [kind, personId, bookingId],
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

  it('is told how much a hospital has used as three counts, never a row (FR-SUP-04, 0051)', async () => {
    await withRollback(async (client) => {
      const { a } = await twoHospitals(client);
      // What is true, counted by the owner.
      const truth = await client.query<{ serials: number; chambers: number }>(
        `SELECT
           (SELECT count(*)::int FROM bookings b JOIN sessions s ON s.id = b.session_id
             WHERE s.hospital_id = $1 AND b.deleted_at IS NULL
               AND b.created_at >= now() - interval '30 days') AS serials,
           (SELECT count(*)::int FROM sessions s
             WHERE s.hospital_id = $1 AND s.actual_start >= now() - interval '30 days') AS chambers`,
        [a],
      );
      // The seed gives every hospital with chambers serials in the last month.
      expect(truth.rows[0]?.serials).toBeGreaterThan(0);

      await asTenant(client);
      await scope(client, 'national');
      const told = await client.query<{
        serials_30d: number;
        chambers_30d: number;
        messages_month: number;
      }>('SELECT * FROM fn_workspace_usage($1)', [a]);
      expect(told.rows).toHaveLength(1);
      expect(told.rows[0]?.serials_30d).toBe(truth.rows[0]?.serials);
      expect(told.rows[0]?.chambers_30d).toBe(truth.rows[0]?.chambers);
      expect(told.rows[0]?.messages_month).toBeGreaterThanOrEqual(0);
      // Counted for it, and still not readable by it.
      expect(await count(client, 'SELECT 1 FROM bookings')).toBe(0);
    });
  });

  it('and how busy a hospital is, is told to nobody else: not its own staff, not another’s, not a patient', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      await asTenant(client);

      for (const [kind, hospitalId] of [
        ['hospital', a],
        ['hospital', b],
        ['open', ''],
        [null, ''],
      ] as const) {
        await scope(client, kind, hospitalId);
        expect(
          await count(client, 'SELECT 1 FROM fn_workspace_usage($1)', [a]),
          `${String(kind)} ${hospitalId}`,
        ).toBe(0);
      }
      await person(client, 'patient', '11111111-1111-7111-8111-111111111111');
      expect(await count(client, 'SELECT 1 FROM fn_workspace_usage($1)', [a])).toBe(0);
    });
  });

  it('is told what became of a hospital’s messages and how late its work arrived, as counts (FR-SUP-06, 0052)', async () => {
    await withRollback(async (client) => {
      // The hospital with the most of the last week's messages: not every
      // seeded hospital held a chamber in it.
      const busiest = await client.query<{ id: string }>(
        `SELECT s.hospital_id AS id
           FROM notifications n
           JOIN bookings b ON b.id = (n.params ->> 'bookingId')::uuid
           JOIN sessions s ON s.id = b.session_id
          GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1`,
      );
      const a = busiest.rows[0]?.id ?? '';
      const truth = await client.query<{ sent: number; late: number }>(
        `SELECT
           (SELECT count(*)::int FROM notifications n
              JOIN bookings b ON b.id = (n.params ->> 'bookingId')::uuid
              JOIN sessions s ON s.id = b.session_id
             WHERE s.hospital_id = $1 AND n.state IN ('sent', 'delivered')
               AND n.queued_at >= now() - interval '7 days') AS sent,
           (SELECT count(*)::int FROM queue_events e JOIN sessions s ON s.id = e.session_id
             WHERE s.hospital_id = $1 AND e.server_ts >= now() - interval '7 days'
               AND e.server_ts - e.client_ts > interval '60 seconds') AS late`,
        [a],
      );
      // The seed sends a confirmation for each of the last week's serials.
      expect(truth.rows[0]?.sent).toBeGreaterThan(0);

      await asTenant(client);
      await scope(client, 'national');
      const told = await client.query<{
        messages_sent: number;
        messages_failed: number;
        late_actions: number;
        slowest_seconds: number;
      }>('SELECT * FROM fn_workspace_health($1)', [a]);
      expect(told.rows).toHaveLength(1);
      expect(told.rows[0]?.messages_sent).toBe(truth.rows[0]?.sent);
      expect(told.rows[0]?.late_actions).toBe(truth.rows[0]?.late);
      expect(told.rows[0]?.slowest_seconds).toBeGreaterThanOrEqual(0);
      // Counted for it, and still not readable by it.
      expect(await count(client, 'SELECT 1 FROM notifications')).toBe(0);
      expect(await count(client, 'SELECT 1 FROM queue_events')).toBe(0);
    });
  });

  it('and nobody else is told: not a hospital’s own staff, not another’s, not a patient', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      await asTenant(client);

      for (const [kind, hospitalId] of [
        ['hospital', a],
        ['hospital', b],
        ['open', ''],
        [null, ''],
      ] as const) {
        await scope(client, kind, hospitalId);
        expect(
          await count(client, 'SELECT 1 FROM fn_workspace_health($1)', [a]),
          `${String(kind)} ${hospitalId}`,
        ).toBe(0);
      }
      await person(client, 'patient', '11111111-1111-7111-8111-111111111111');
      expect(await count(client, 'SELECT 1 FROM fn_workspace_health($1)', [a])).toBe(0);
    });
  });
});

/**
 * Two people with a signed visit each, the first made the profile of an
 * account, as the owner would have it after a claim (`FR-GST-09`).
 */
async function twoPeople(client: Client): Promise<{
  accountId: string;
  mine: { visitId: string; patientId: string; bookingId: string };
  theirs: { visitId: string; patientId: string; bookingId: string };
}> {
  const { rows } = await client.query<{ id: string; patient_id: string; booking_id: string }>(
    `SELECT DISTINCT ON (v.patient_id) v.id, v.patient_id, v.booking_id
       FROM visits v
      WHERE v.signed_at IS NOT NULL AND v.deleted_at IS NULL
      ORDER BY v.patient_id, v.id
      LIMIT 2`,
  );
  const [first, second] = rows;
  if (first === undefined || second === undefined) {
    throw new Error('The seed should hold signed visits for two people (FR-DEM-03).');
  }
  const account = await client.query<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.owner_user_id = u.id AND p.id = $1)
      ORDER BY u.created_at, u.id LIMIT 1`,
    [second.patient_id],
  );
  const accountId = account.rows[0]?.id;
  if (accountId === undefined) throw new Error('The seed should hold a patient account.');
  await client.query(
    `UPDATE patients SET owner_user_id = $2, owner_guest_id = NULL, owner_hospital_id = NULL,
              is_primary = false
      WHERE id = $1`,
    [first.patient_id, accountId],
  );
  return {
    accountId,
    mine: { visitId: first.id, patientId: first.patient_id, bookingId: first.booking_id },
    theirs: { visitId: second.id, patientId: second.patient_id, bookingId: second.booking_id },
  };
}

/** The tables that are a person's clinical record (migration 0044). */
const CLINICAL = [
  'visits',
  'prescriptions',
  'prescription_items',
  'test_orders',
  'reports',
  'patient_documents',
  'consents',
  'admissions',
] as const;

describe('a person’s clinical record is their own (FR-SEC-11, FR-NET-02; plan B3)', () => {
  it('an account reads the visits of its own profiles and nobody else’s, whatever the query forgets', async () => {
    await withRollback(async (client) => {
      const { accountId, mine, theirs } = await twoPeople(client);
      const owned = await count(
        client,
        `SELECT 1 FROM visits v JOIN patients p ON p.id = v.patient_id
          WHERE p.owner_user_id = $1`,
        [accountId],
      );

      await asTenant(client);
      await person(client, 'patient', accountId);
      // No WHERE at all: every visit the connection can reach.
      expect(await count(client, 'SELECT 1 FROM visits')).toBe(owned);
      expect(await count(client, 'SELECT 1 FROM visits WHERE id = $1', [mine.visitId])).toBe(1);
      expect(await count(client, 'SELECT 1 FROM visits WHERE id = $1', [theirs.visitId])).toBe(0);
    });
  });

  it('and their tests and reports the same way', async () => {
    await withRollback(async (client) => {
      const { accountId } = await twoPeople(client);
      const orders = await count(
        client,
        `SELECT 1 FROM test_orders t JOIN patients p ON p.id = t.patient_id
          WHERE p.owner_user_id = $1`,
        [accountId],
      );
      const reports = await count(
        client,
        `SELECT 1 FROM reports r JOIN test_orders t ON t.id = r.test_order_id
           JOIN patients p ON p.id = t.patient_id
          WHERE p.owner_user_id = $1`,
        [accountId],
      );
      const everybodys = await count(client, 'SELECT 1 FROM test_orders');

      await asTenant(client);
      await person(client, 'patient', accountId);
      expect(await count(client, 'SELECT 1 FROM test_orders')).toBe(orders);
      expect(await count(client, 'SELECT 1 FROM reports')).toBe(reports);
      expect(orders).toBeLessThan(everybodys);
    });
  });

  it('an account reads its record and does not write it', async () => {
    await withRollback(async (client) => {
      const { accountId, mine } = await twoPeople(client);
      await asTenant(client);
      await person(client, 'patient', accountId);

      const changed = await client.query('UPDATE visits SET advice_text_bn = $2 WHERE id = $1', [
        mine.visitId,
        'x',
      ]);
      expect(changed.rowCount).toBe(0);
      const removed = await client.query('DELETE FROM visits WHERE id = $1', [mine.visitId]);
      expect(removed.rowCount).toBe(0);
    });
  });

  it('an account gives a consent for its own profile and for nobody else’s', async () => {
    await withRollback(async (client) => {
      const { accountId, mine, theirs } = await twoPeople(client);
      const { a } = await twoHospitals(client);
      await asTenant(client);
      await person(client, 'patient', accountId);

      const given = await client.query<{ id: string }>(
        `INSERT INTO consents (patient_id, hospital_id, scope, expires_at, granted_via)
         VALUES ($1, $2, 'hospital', now() + interval '1 day', 'app') RETURNING id`,
        [mine.patientId, a],
      );
      expect(given.rowCount).toBe(1);

      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO consents (patient_id, hospital_id, scope, expires_at, granted_via)
           VALUES ($1, $2, 'hospital', now() + interval '1 day', 'app')`,
          [theirs.patientId, a],
        ),
      );
      expect(error.message).toContain('row-level security');
    });
  });

  it('a tracking link reads the visit made at its booking, and no other of that person’s', async () => {
    await withRollback(async (client) => {
      const { mine } = await twoPeople(client);
      // The same person seen a second time, at another booking.
      const again = await client.query<{ id: string }>(
        `SELECT k.id FROM bookings k
          WHERE k.id <> $1 AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.booking_id = k.id)
          ORDER BY k.created_at, k.id LIMIT 1`,
        [mine.bookingId],
      );
      const secondBooking = again.rows[0]?.id;
      if (secondBooking === undefined)
        throw new Error('The seed should hold a booking with no visit.');
      await client.query(
        `INSERT INTO visits (booking_id, patient_id, hospital_id, doctor_id, diagnosis_text, signed_at, created_by)
         SELECT $2, v.patient_id, v.hospital_id, v.doctor_id, 'আরেকবার (ডেমো)', now(), v.created_by
           FROM visits v WHERE v.id = $1`,
        [mine.visitId, secondBooking],
      );
      const guest = await client.query<{ id: string }>(
        'SELECT id FROM guest_identities WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT 1',
      );
      const guestId = guest.rows[0]?.id ?? '';

      await asTenant(client);
      await person(client, 'guest', guestId, mine.bookingId);
      const seen = await client.query<{ id: string }>('SELECT id FROM visits');
      expect(seen.rows.map((row) => row.id)).toEqual([mine.visitId]);

      // The token a number is given to book with names no booking, and opens none.
      await person(client, 'guest', guestId);
      expect(await count(client, 'SELECT 1 FROM visits')).toBe(0);
      expect(await count(client, 'SELECT 1 FROM test_orders')).toBe(0);
    });
  });

  it('nobody reads any of it', async () => {
    await withRollback(async (client) => {
      await asTenant(client);
      await scope(client, 'open');
      for (const table of CLINICAL) {
        expect(await count(client, `SELECT 1 FROM ${table}`), table).toBe(0);
      }
      // What is not the clinical record is as it was for a connection that is
      // nobody's: the queue is worked out from every booking in a chamber.
      expect(await count(client, 'SELECT 1 FROM bookings')).toBeGreaterThan(0);
    });
  });

  it('a hospital still reads its own, and a person’s scope does not widen a hospital’s', async () => {
    await withRollback(async (client) => {
      const { a, b } = await twoHospitals(client);
      const ofA = await count(client, 'SELECT 1 FROM visits WHERE hospital_id = $1', [a]);
      const consented = await count(
        client,
        `SELECT 1 FROM visits v
          WHERE v.hospital_id <> $1
            AND EXISTS (SELECT 1 FROM consents c
                         WHERE c.patient_id = v.patient_id AND c.hospital_id = $1
                           AND c.revoked_at IS NULL AND c.deleted_at IS NULL
                           AND (c.expires_at IS NULL OR c.expires_at > now()))`,
        [a],
      );

      await asTenant(client);
      // A hospital's connection that also says a person and a booking gets
      // what a hospital gets: the scope decides, not what else is set.
      await client.query(
        `SELECT set_config('app.scope', 'hospital', true), set_config('app.hospital_id', $1, true),
                set_config('app.person_id', $2, true), set_config('app.booking_id', $2, true)`,
        [a, b],
      );
      expect(await count(client, 'SELECT 1 FROM visits')).toBe(ofA + consented);
    });
  });
});

describe('what the backup did is the server’s own to read (plan I2, migration 0055)', () => {
  it('only the system scope reads a backup run; a hospital, the platform, a person and nobody do not', async () => {
    await withRollback(async (client) => {
      const { a } = await twoHospitals(client);
      await client.query(
        `INSERT INTO backup_runs (result, verified, stamp) VALUES ('ok', 'restore', 'tenancy-probe')`,
      );
      await asTenant(client);
      const runs = `SELECT 1 FROM backup_runs WHERE stamp = 'tenancy-probe'`;

      await scope(client, 'system');
      expect(await count(client, runs)).toBe(1);
      for (const [kind, hospital] of [
        ['hospital', a],
        ['national', ''],
        ['open', ''],
        [null, ''],
      ] as const) {
        await scope(client, kind, hospital);
        expect(await count(client, runs), String(kind)).toBe(0);
      }
      await person(client, 'patient', '00000000-0000-7000-8000-000000000001');
      expect(await count(client, runs)).toBe(0);
    });
  });

  it('a run is either good with no reason, or failed with one', async () => {
    await withRollback(async (client) => {
      await expectRejection(client, () =>
        client.query(
          `INSERT INTO backup_runs (result, stamp, reason) VALUES ('ok', 'x', 'but it failed')`,
        ),
      );
      await expectRejection(client, () =>
        client.query(`INSERT INTO backup_runs (result, stamp) VALUES ('failed', 'x')`),
      );
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
