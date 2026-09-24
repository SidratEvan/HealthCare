/**
 * The national layer (BACKEND.md §7.7, `S-B-13`, `FR-GOV-01`..`FR-GOV-06`).
 *
 * Build step 20's definition of done is one sentence — "no identifiable row
 * reachable" — and this file is where it is proven, three ways:
 *
 *   - **By who gets in.** A government viewer and nobody else opens these
 *     four routes, and a government viewer opens no route written for a
 *     hospital's staff. Both directions, every role (`FR-ROLE-04`).
 *   - **By what the database allows.** The layer reads as `gov_reader`, and
 *     from inside that role `patients`, `bookings`, `visits` and the rest are
 *     refused by PostgreSQL itself (`DATABASE.md` §5).
 *   - **By what reaches the wire.** No UUID, no phone, no patient's name and
 *     no facility's name appears in any response (`FR-GOV-06`, `FR-GOV-04`).
 *
 * The figures are then checked against the tables they summarise, so a
 * district map that agrees with nothing is not mistaken for one that works.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { STAFF_ROLES, type StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { AppError } from '../errors/AppError.js';
import { aggregateOnly } from '../services/gov.service.js';
import * as queueService from '../services/queue.service.js';

import { createQueueFixture, staffIdFor } from './support/queueFixture.js';
import {
  bearer,
  guestToken,
  IDS,
  nationalToken,
  patientToken,
  staffToken,
} from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

const ROUTES = ['/gov/capacity', '/gov/er-load', '/gov/signals', '/gov/benchmarks'] as const;

const HOSPITAL_ROLES = STAFF_ROLES.filter(
  (role): role is Exclude<StaffRole, 'platform_admin' | 'gov_viewer'> =>
    role !== 'platform_admin' && role !== 'gov_viewer',
);

let app: Express;

beforeEach(() => {
  app = createApp();
});

async function get(path: string, token?: string): Promise<request.Response> {
  const call = request(app).get(`${BASE}${path}`);
  return token === undefined ? await call : await call.set('authorization', bearer(token));
}

describe('who may open the national layer (FR-ROLE-01, FR-ROLE-04)', () => {
  it.each(ROUTES)('admits a government viewer to %s', async (path) => {
    const response = await get(path, await nationalToken());

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it.each(ROUTES)('refuses %s with no credential', async (path) => {
    expect((await get(path)).status).toBe(401);
  });

  it.each(ROUTES)('refuses a patient and a guest on %s', async (path) => {
    expect((await get(path, await patientToken())).status).toBe(403);
    expect((await get(path, await guestToken())).status).toBe(403);
  });

  it.each(HOSPITAL_ROLES)('refuses a hospital %s on every route', async (role) => {
    for (const path of ROUTES) {
      const response = await get(path, await staffToken([role]));
      expect(response.status, `${role} on ${path}`).toBe(403);
    }
  });

  it('refuses a hospital token that merely lists gov_viewer', async () => {
    // A staff token with a hospital is a hospital's staff, whatever it says
    // about roles. The national layer is a different kind of principal.
    const response = await get('/gov/capacity', await staffToken(['gov_viewer']));
    expect(response.status).toBe(403);
  });

  it('refuses a national account without the government role', async () => {
    const response = await get('/gov/capacity', await nationalToken(['platform_admin']));
    expect(response.status).toBe(403);
  });

  it('refuses a hospital-less token carrying a hospital role at all', async () => {
    // Mixing a national role in does not let a receptionist belong nowhere.
    const response = await get(
      '/gov/capacity',
      await nationalToken(['gov_viewer', 'receptionist']),
    );
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });
});

describe('a government viewer opens nothing written for a hospital (FR-ROLE-04)', () => {
  it('cannot read a queue, a ward, an ER, a lab bench, a dashboard or a record', async () => {
    const fixture = await createQueueFixture(1);
    const token = await nationalToken();

    const paths = [
      `/sessions/${fixture.sessionId}/queue`,
      `/hospitals/${fixture.hospitalId}/beds`,
      `/hospitals/${fixture.hospitalId}/emergency`,
      `/hospitals/${fixture.hospitalId}/test-orders`,
      '/admin/dashboard',
      `/patients/${fixture.patientIds[0] ?? IDS.patient}/records`,
    ];

    for (const path of paths) {
      const response = await get(path, token);
      expect(response.status, path).toBe(403);
    }
  });
});

describe('the database refuses the base tables (DATABASE.md §5)', () => {
  /** Runs one statement as `gov_reader`, the way `gov.repo` reads. */
  async function asGovReader(statement: string): Promise<string> {
    try {
      await db.transaction().execute(async (tx) => {
        await sql`SET LOCAL ROLE gov_reader`.execute(tx);
        await sql.raw(statement).execute(tx);
      });
      return 'ok';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  it.each([
    'patients',
    'bookings',
    'visits',
    'emergency_cases',
    'guest_identities',
    'users',
    'staff_users',
    'hospitals',
    'queue_events',
    'audit_log',
    'v_public_hospital_capacity',
    'v_admin_daily',
  ])('cannot select from %s', async (table) => {
    expect(await asGovReader(`SELECT 1 FROM ${table} LIMIT 1`)).toMatch(/permission denied/);
  });

  it.each([
    'v_gov_capacity',
    'v_gov_er_hourly',
    'v_gov_er_now',
    'v_gov_symptom_daily',
    'v_gov_reporting',
    'v_gov_benchmark',
  ])('can select from %s', async (view) => {
    expect(await asGovReader(`SELECT * FROM ${view} LIMIT 1`)).toBe('ok');
  });

  it('cannot write a tag, or anything else', async () => {
    expect(await asGovReader(`UPDATE visits SET symptom_signal = NULL`)).toMatch(
      /permission denied/,
    );
  });
});

describe('nothing identifying reaches the wire (FR-GOV-06)', () => {
  it.each(ROUTES)('%s carries no id, phone, patient name or facility name', async (path) => {
    const response = await get(path, await nationalToken());
    const wire = JSON.stringify(response.body);

    expect(wire).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(wire).not.toMatch(/(?:\+?88)?01[3-9]\d{8}/);

    const people = await sql<{ full_name: string }>`
      SELECT full_name FROM patients ORDER BY random() LIMIT 25
    `.execute(db);
    const places = await sql<{ name_bn: string; name_en: string }>`
      SELECT name_bn, name_en FROM hospitals
    `.execute(db);

    for (const person of people.rows) expect(wire).not.toContain(person.full_name);
    for (const place of places.rows) {
      expect(wire).not.toContain(place.name_bn);
      expect(wire).not.toContain(place.name_en);
    }
  });

  it('is never cached', async () => {
    const response = await get('/gov/capacity', await nationalToken());
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('refuses to send a payload that grew an identifier', () => {
    expect(() =>
      aggregateOnly('test', { districts: [{ district: 'Dhaka', patientId: 'x' }] }),
    ).toThrow(AppError);
    expect(aggregateOnly('test', { districts: [{ district: 'Dhaka', cases: 3 }] })).toEqual({
      districts: [{ district: 'Dhaka', cases: 3 }],
    });
  });
});

describe('the capacity map agrees with what the public sees (FR-GOV-01)', () => {
  it('sums every live facility in a district', async () => {
    const response = await get('/gov/capacity', await nationalToken());
    const districts = response.body.data.districts as {
      district: string;
      facilities: number;
      bedFree: number;
      bedTotal: number;
    }[];

    const expected = await sql<{ district: string; facilities: number; bed_free: number }>`
      SELECT h.district, count(*)::int AS facilities, sum(c.bed_free)::int AS bed_free
        FROM v_public_hospital_capacity c
        JOIN hospitals h ON h.id = c.hospital_id
       WHERE h.is_live AND h.deleted_at IS NULL
       GROUP BY h.district
    `.execute(db);

    for (const row of expected.rows) {
      const found = districts.find((entry) => entry.district === row.district);
      expect(found?.facilities, row.district).toBe(row.facilities);
      expect(found?.bedFree, row.district).toBe(row.bed_free);
    }
  });

  it('gives a national total that is the districts added up', async () => {
    const response = await get('/gov/capacity', await nationalToken());
    const { districts, totals } = response.body.data as {
      districts: { bedFree: number; facilities: number }[];
      totals: { bedFree: number; facilities: number };
    };

    expect(totals.bedFree).toBe(districts.reduce((sum, entry) => sum + entry.bedFree, 0));
    expect(totals.facilities).toBe(districts.reduce((sum, entry) => sum + entry.facilities, 0));
  });

  it('says ventilators and blood are unrecorded rather than zero', async () => {
    const response = await get('/gov/capacity', await nationalToken());
    expect(response.body.data.unrecorded).toEqual(['ventilators', 'blood']);
  });
});

describe('the emergency load heat map (FR-GOV-02)', () => {
  it('has twenty-four hours, and a cell for every one in every district', async () => {
    const response = await get('/gov/er-load', await nationalToken());
    const data = response.body.data as {
      hours: string[];
      districts: { hourly: unknown[] }[];
    };

    expect(data.hours).toHaveLength(24);
    for (const district of data.districts) expect(district.hourly).toHaveLength(24);
  });

  it('counts the open cases the ER consoles hold', async () => {
    const response = await get('/gov/er-load', await nationalToken());

    const open = await sql<{ n: number }>`
      SELECT count(*)::int AS n
        FROM emergency_cases ec
        JOIN hospitals h ON h.id = ec.hospital_id
       WHERE ec.deleted_at IS NULL AND h.is_live AND h.deleted_at IS NULL
         AND ec.state IN ('inbound', 'acknowledged', 'arrived', 'in_treatment')
    `.execute(db);

    expect(response.body.data.totals.open).toBe(open.rows[0]?.n);
  });
});

describe('symptom signals (FR-GOV-03)', () => {
  interface Reading {
    district: string;
    signal: string;
    thisWeek: number;
    status: string;
  }

  async function readings(): Promise<Reading[]> {
    const response = await get('/gov/signals', await nationalToken());
    return response.body.data.readings as Reading[];
  }

  it('shows the dengue rising in Dhaka that the demo plants, and nothing else', async () => {
    const all = await readings();

    const spikes = all.filter((entry) => entry.status === 'spike');
    expect(spikes.map((entry) => `${entry.district}/${entry.signal}`)).toEqual(['Dhaka/dengue']);
  });

  it('lists all three categories for every district that reports', async () => {
    const all = await readings();
    const districts = new Set(all.map((entry) => entry.district));

    for (const district of districts) {
      expect(all.filter((entry) => entry.district === district)).toHaveLength(3);
    }
  });

  it('counts a visit the doctor tags, the moment it is signed', async () => {
    const fixture = await createQueueFixture(2);

    const district = await sql<{ district: string }>`
      SELECT district FROM hospitals WHERE id = ${fixture.hospitalId}::uuid
    `.execute(db);
    const name = district.rows[0]?.district ?? '';

    const before =
      (await readings()).find((entry) => entry.district === name && entry.signal === 'diarrhoeal')
        ?.thisWeek ?? 0;

    const receptionist = {
      kind: 'staff' as const,
      staffUserId: fixture.receptionistId as never,
      role: 'receptionist' as const,
    };
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: receptionist,
      clientEventId: crypto.randomUUID(),
    });
    await queueService.callNext({
      sessionId: fixture.sessionId,
      actor: receptionist,
      clientEventId: crypto.randomUUID(),
    });

    const doctor = await signToken({
      kind: 'access',
      claims: {
        sub: await staffIdFor(fixture.hospitalId, 'doctor'),
        kind: 'staff',
        hospitalId: fixture.hospitalId,
        roles: ['doctor'],
      },
    });
    const key = crypto.randomUUID();
    const signed = await request(app)
      .post(`${BASE}/visits`)
      .set('authorization', bearer(doctor))
      .set('idempotency-key', key)
      .send({
        bookingId: fixture.bookingIds[0],
        diagnosisText: 'Acute watery diarrhoea',
        symptomSignal: 'diarrhoeal',
        sign: true,
        idempotencyKey: key,
      });
    expect(signed.status).toBe(201);

    const after =
      (await readings()).find((entry) => entry.district === name && entry.signal === 'diarrhoeal')
        ?.thisWeek ?? 0;

    expect(after).toBe(before + 1);
  });

  it('refuses a tag outside the three FR-GOV-03 names', async () => {
    const fixture = await createQueueFixture(1);
    const doctor = await signToken({
      kind: 'access',
      claims: {
        sub: fixture.doctorStaffId,
        kind: 'staff',
        hospitalId: fixture.hospitalId,
        roles: ['doctor'],
      },
    });
    const key = crypto.randomUUID();

    const response = await request(app)
      .post(`${BASE}/visits`)
      .set('authorization', bearer(doctor))
      .set('idempotency-key', key)
      .send({ bookingId: fixture.bookingIds[0], symptomSignal: 'cholera', idempotencyKey: key });

    expect(response.status).toBe(400);
  });
});

describe('anonymised benchmarking (FR-GOV-04)', () => {
  it('considers every live facility and names none of them', async () => {
    const response = await get('/gov/benchmarks', await nationalToken());
    const data = response.body.data as {
      facilities: number;
      measures: { measure: string; entries: Record<string, unknown>[] }[];
    };

    const live = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM hospitals WHERE is_live AND deleted_at IS NULL
    `.execute(db);
    expect(data.facilities).toBe(live.rows[0]?.n);

    for (const measure of data.measures) {
      for (const entry of measure.entries) {
        expect(Object.keys(entry).sort(), measure.measure).toEqual(['kind', 'sample', 'value']);
      }
    }
  });

  it('ranks the wait shortest first', async () => {
    const response = await get('/gov/benchmarks', await nationalToken());
    const wait = (
      response.body.data.measures as { measure: string; entries: { value: number }[] }[]
    ).find((entry) => entry.measure === 'wait');

    const values = wait?.entries.map((entry) => entry.value) ?? [];
    expect(values.length).toBeGreaterThan(1);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});
