/**
 * A hospital runs the modules switched on for it (`PRD.md` `FR-BRD-11`,
 * `FR-SUP-03`; plan C4; migration 0047).
 *
 * A module that is off is refused by the API, absent from what the hospital
 * publishes, and reported to the consoles so that they offer nothing of it.
 * Nothing the hospital holds is deleted.
 *
 * ## How it stays complete
 *
 * Which module a staff request belongs to is one table, `MODULE_ROUTES` in
 * `shared/domain`. This file holds it against the routes the server really
 * mounts: every route is either in that table or in `NOBODYS` below, so a
 * route added later fails here until somebody says whose it is.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  FACILITY_ROLES,
  HOSPITAL_MODULES,
  MODULE_ROUTES,
  modulesOfRequest,
  type HospitalModule,
} from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { buildApiRouter } from '../routes/index.js';
import { forgetModules } from '../services/modules.service.js';

import { asOwner } from './support/ownerDb.js';
import { seededPlatformAdminId, staffIdFor } from './support/queueFixture.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/**
 * Routes that belong to no module: the public's, a patient's, a token's,
 * signing in, a hospital's own settings, the platform's and the nation's.
 */
const NOBODYS: readonly string[] = [
  'GET /config',
  'GET /search',
  'GET /hospitals',
  'GET /hospitals/:id',
  'GET /hospitals/:id/doctors',
  'GET /hospitals/:id/logo',
  'GET /doctors',
  'GET /doctors/:id',
  'GET /sessions',
  'GET /sessions/:id/availability',
  'GET /medicines',
  'GET /emergency/search',
  'POST /bookings',
  'POST /bed-requests',
  'POST /sessions/:id/standby',
  'POST /emergency/inbound',
  'GET /guest/link/:token',
  'GET /guest/link/:token/reports/:reportId',
  'GET /standby/:token',
  'POST /standby/:token/accept',
  'POST /standby/:token/decline',
  'POST /standby/:token/leave',
  'GET /bed-requests/track/:token',
  'GET /emergency/track/:token',
  'POST /emergency/track/:token/cancel',
  'GET /files/:key',
  'POST /staff/login',
  'POST /staff/refresh',
  'POST /staff/logout',
  'GET /staff/me',
  'POST /staff/password',
  'POST /staff/2fa',
  'POST /staff/2fa/setup',
  'POST /staff/2fa/enable',
  'POST /auth/otp',
  'POST /auth/verify',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /guest/start',
  'POST /guest/verify',
  'GET /demo/status',
  'GET /demo/consoles',
  'POST /demo/token',
  'POST /webhooks/bkash',
  'POST /webhooks/nagad',
  'POST /webhooks/sms-dlr',
  'GET /me/profiles',
  'GET /me/bookings',
  'POST /me/bookings/:id/link',
  'POST /guest/claim',
  'POST /patients/:id/consent-offer',
  'POST /consents',
  'POST /consents/:id/revoke',
  'GET /patients/:id/access',
  'GET /staff/chambers',
  'POST /payments/intent',
  'GET /hospital/setup',
  'GET /hospital/messages',
  'PATCH /hospital/profile',
  'PATCH /hospital/rules',
  'PUT /hospital/brand',
  'PUT /hospital/publishing',
  'GET /hospital/logo',
  'PUT /hospital/logo',
  'DELETE /hospital/logo',
  'POST /hospital/departments',
  'PATCH /hospital/departments/:id',
  'DELETE /hospital/departments/:id',
  'POST /hospital/doctors',
  'PATCH /hospital/doctors/:id',
  'POST /hospital/templates',
  'DELETE /hospital/templates/:id',
  'POST /hospital/staff',
  'PATCH /hospital/staff/:id',
  'POST /hospital/staff/:id/reset-password',
  'POST /hospital/staff/:id/reset-2fa',
  'POST /hospital/request-review',
  'POST /hospital-applications',
  'GET /platform/hospitals',
  'GET /platform/hospitals/:id',
  'GET /platform/hospitals/:id/audit',
  'POST /platform/hospitals',
  'POST /platform/hospitals/:id/approve',
  'POST /platform/hospitals/:id/send-back',
  'POST /platform/hospitals/:id/suspend',
  'POST /platform/hospitals/:id/reinstate',
  'POST /platform/hospitals/:id/close',
  'POST /platform/hospitals/:id/doctors/:doctorId/verify',
  'POST /platform/hospitals/:id/domain',
  'PUT /platform/hospitals/:id/modules',
  'PUT /platform/hospitals/:id/agreement',
  'GET /gov/capacity',
  'GET /gov/er-load',
  'GET /gov/signals',
  'GET /gov/benchmarks',
];

/** A seeded hospital that runs everything and holds something of everything. */
const CODE = 'KARNAPHULI';

let app: Express;
let platform: string;
let hospitalId: string;
/** A real account at the hospital, holding every role it can give. */
let staff: string;

interface LayerLike {
  readonly route?: { readonly path: unknown; readonly stack: readonly { method?: string }[] };
  readonly handle?: unknown;
}

function mountedRoutes(): string[] {
  const found = new Set<string>();
  const walk = (router: unknown): void => {
    const stack = (router as { stack?: unknown }).stack;
    for (const layer of Array.isArray(stack) ? (stack as LayerLike[]) : []) {
      if (layer.route === undefined) {
        walk(layer.handle);
        continue;
      }
      for (const handler of layer.route.stack) {
        if (handler.method !== undefined && typeof layer.route.path === 'string') {
          found.add(`${handler.method.toUpperCase()} ${layer.route.path}`);
        }
      }
    }
  };
  walk(buildApiRouter());
  return [...found].sort();
}

async function setOff(
  off: readonly string[],
  token: string | null = platform,
  id: string = hospitalId,
): Promise<request.Response> {
  const pending = request(app)
    .put(`${BASE}/platform/hospitals/${id}/modules`)
    .set('Idempotency-Key', randomUUID());
  return await (token === null ? pending : pending.set('Authorization', bearer(token))).send({
    off,
  });
}

/** A request to a route with something in every parameter: enough to reach the gate. */
async function call(key: string, token: string): Promise<request.Response> {
  const space = key.indexOf(' ');
  const method = key.slice(0, space).toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const path = key
    .slice(space + 1)
    .replace(':set', 'structure')
    .replace(/:[A-Za-z]+/g, () => randomUUID());
  const pending = request(app)[method](`${BASE}${path}`).set('Authorization', bearer(token));
  return method === 'get'
    ? await pending
    : await pending.set('Idempotency-Key', randomUUID()).send({});
}

beforeAll(async () => {
  app = createApp();
  const found = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE code = ${CODE} AND deleted_at IS NULL
  `.execute(db);
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed should hold ${CODE} (FR-DEM-01).`);
  hospitalId = id;

  const account = { id: await seededPlatformAdminId() };
  platform = await signToken({
    kind: 'access',
    claims: { sub: account.id, kind: 'staff', roles: ['platform_admin'] },
  });
  staff = await signToken({
    kind: 'access',
    claims: {
      sub: await staffIdFor(hospitalId, 'hospital_admin'),
      kind: 'staff',
      hospitalId,
      roles: [...FACILITY_ROLES],
    },
  });
});

// Whatever a test switched off, the hospital runs everything again for the next.
afterEach(async () => {
  await asOwner(async (owner) => {
    await sql`
      UPDATE hospital_settings SET modules_off = '{}' WHERE hospital_id = ${hospitalId}::uuid
    `.execute(owner);
  });
  forgetModules();
});

afterAll(async () => {
  await asOwner(async (owner) => {
    await sql`
      DELETE FROM audit_log
       WHERE hospital_id = ${hospitalId}::uuid AND action = 'SETTINGS_CHANGE'
         AND meta ->> 'change' = 'modules'
    `.execute(owner);
  });
});

describe('every route is some module’s, or nobody’s', () => {
  it('no route is mounted that is neither, and none is named that is not mounted', () => {
    expect([...Object.keys(MODULE_ROUTES), ...NOBODYS].sort()).toEqual(mountedRoutes());
  });

  it('none is both', () => {
    expect(NOBODYS.filter((key) => key in MODULE_ROUTES)).toEqual([]);
  });

  it('a request is read as the route it is, literal segments before parameters', () => {
    expect(modulesOfRequest('POST', '/hospital/imports/analyse')).toEqual(['import']);
    expect(modulesOfRequest('get', `/hospital/imports/${randomUUID()}`)).toEqual(['import']);
    expect(modulesOfRequest('POST', `/beds/${randomUUID()}/admit`)).toEqual(['beds']);
    expect(modulesOfRequest('POST', '/test-orders')).toEqual(['doctor', 'lab']);
    // Nobody's: settings, and a route that does not exist.
    expect(modulesOfRequest('GET', '/hospital/setup')).toEqual([]);
    expect(modulesOfRequest('GET', '/nothing/here')).toEqual([]);
    // The method is part of it.
    expect(modulesOfRequest('DELETE', `/beds/${randomUUID()}`)).toEqual([]);
  });
});

describe('a module that is off is refused to the hospital’s own staff (FR-BRD-11)', () => {
  it.each(HOSPITAL_MODULES)('%s: every route of it, and no route of another', async (module) => {
    // Serials off takes the doctor's console with it; nothing else is tied.
    const off: HospitalModule[] = module === 'queue' ? ['queue', 'doctor'] : [module];
    expect((await setOff(off)).status).toBe(200);

    for (const [key, needed] of Object.entries(MODULE_ROUTES)) {
      const response = await call(key, staff);
      const refused = response.body?.error?.code === 'MODULE_OFF';
      const shouldBe = needed.some((entry) => off.includes(entry));
      expect(refused, `${key} with ${off.join('+')} off`).toBe(shouldBe);
      if (shouldBe) {
        expect(response.status, key).toBe(403);
        expect(off, key).toContain(response.body.error.details.module);
      }
    }
  });

  it('with everything on, nothing is refused for a module', async () => {
    for (const key of Object.keys(MODULE_ROUTES)) {
      const response = await call(key, staff);
      expect(response.body?.error?.code, key).not.toBe('MODULE_OFF');
    }
  });

  it('settings, signing in and the public are nobody’s module, whatever is off', async () => {
    await setOff([...HOSPITAL_MODULES]);
    const setup = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', bearer(staff));
    expect(setup.status).toBe(200);
    expect([...(setup.body.data.hospital.modulesOff as string[])].sort()).toEqual(
      [...HOSPITAL_MODULES].sort(),
    );
    expect((await request(app).get(`${BASE}/hospitals`)).status).toBe(200);
  });

  it('a patient is not asked about a hospital’s modules by the gate', async () => {
    await setOff(['queue', 'doctor']);
    // Their own record, read as themselves: a 403 or a 404 of its own, never MODULE_OFF.
    const response = await request(app)
      .get(`${BASE}/patients/${randomUUID()}/records`)
      .set('Authorization', bearer(await patientToken()));
    expect(response.body?.error?.code).not.toBe('MODULE_OFF');
  });
});

describe('what it publishes goes with it, and comes back (FR-BRD-11)', () => {
  /** The hospital as the public is shown it: its card, and its bed figures beside it. */
  const card = async (): Promise<{
    capabilities: string[];
    sittingNow: number;
    openSerialsToday: number;
    beds: unknown;
  }> => {
    const response = await request(app).get(`${BASE}/hospitals/${hospitalId}`);
    const data = response.body.data as {
      hospital: { capabilities: string[]; sittingNow: number; openSerialsToday: number };
      beds: unknown;
    };
    return { ...data.hospital, beds: data.beds };
  };

  const count = async (table: string): Promise<number> =>
    Number(
      (
        await sql<{ n: string }>`
          SELECT count(*)::text AS n FROM ${sql.table(table)} WHERE hospital_id = ${hospitalId}::uuid
        `.execute(db)
      ).rows[0]?.n ?? '-1',
    );

  it('beds: no figure, not in a bed search, no request taken; and nothing deleted', async () => {
    const before = await card();
    expect(before.beds).not.toBeNull();
    const beds = await count('beds');

    await setOff(['beds']);
    expect((await card()).beds).toBeNull();
    const listed = await request(app).get(`${BASE}/hospitals?bedKind=general&limit=100`);
    expect(
      (listed.body.data.hospitals as { id: string }[]).some((entry) => entry.id === hospitalId),
    ).toBe(false);
    const asked = await request(app)
      .post(`${BASE}/bed-requests`)
      .set('Idempotency-Key', randomUUID())
      .send({
        hospitalId,
        bedKind: 'general',
        patient: {
          name: 'রহিমা খাতুন (ডেমো)',
          phone: '+8801912345678',
          ageYears: 40,
          sex: 'female',
        },
      });
    expect(asked.status).toBe(403);
    expect(asked.body.error).toMatchObject({ code: 'MODULE_OFF', details: { module: 'beds' } });
    expect(await count('beds')).toBe(beds);

    await setOff([]);
    expect((await card()).beds).toEqual(before.beds);
  });

  it('emergency: what it can treat, the emergency search, an alert that somebody is coming', async () => {
    const before = await card();
    expect(before.capabilities.length).toBeGreaterThan(0);
    const inSearch = async (): Promise<boolean> => {
      const found = await request(app).get(`${BASE}/emergency/search?problem=accident`);
      return JSON.stringify(found.body).includes(hospitalId);
    };
    expect(await inSearch()).toBe(true);

    await setOff(['emergency']);
    expect((await card()).capabilities).toEqual([]);
    expect(await inSearch()).toBe(false);
    const coming = await request(app)
      .post(`${BASE}/emergency/inbound`)
      .set('Idempotency-Key', randomUUID())
      .send({ hospitalId, problem: 'accident' });
    expect(coming.status).toBe(403);
    expect(coming.body.error).toMatchObject({
      code: 'MODULE_OFF',
      details: { module: 'emergency' },
    });

    await setOff([]);
    expect((await card()).capabilities).toEqual(before.capabilities);
    expect(await inSearch()).toBe(true);
  });

  it('serials: no chamber to book, none sitting, no serial taken', async () => {
    const sessions = async (): Promise<{ id: string }[]> =>
      (await request(app).get(`${BASE}/sessions?hospitalId=${hospitalId}`)).body.data.sessions as {
        id: string;
      }[];
    const before = await sessions();
    expect(before.length).toBeGreaterThan(0);
    const held = await count('sessions');

    await setOff(['queue', 'doctor']);
    expect(await sessions()).toEqual([]);
    expect(await card()).toMatchObject({ sittingNow: 0, openSerialsToday: 0 });
    const booked = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', randomUUID())
      .send({
        sessionId: before[0]?.id,
        method: 'at_hospital',
        guest: { name: 'রহিমা খাতুন (ডেমো)', phone: '+8801912345679', ageYears: 40, sex: 'female' },
      });
    expect(booked.status).toBe(403);
    expect(booked.body.error).toMatchObject({ code: 'MODULE_OFF', details: { module: 'queue' } });
    expect(
      (await request(app).get(`${BASE}/sessions/${before[0]?.id ?? ''}/availability`)).status,
    ).toBe(403);
    expect(await count('sessions')).toBe(held);

    await setOff([]);
    expect((await sessions()).length).toBe(before.length);
  });

  it('pharmacy: not among the pharmacies a medicine search names', async () => {
    const medicine = await sql<{ generic_name: string }>`
      SELECT m.generic_name FROM pharmacy_stock s JOIN medicines m ON m.id = s.medicine_id
       WHERE s.hospital_id = ${hospitalId}::uuid AND s.deleted_at IS NULL
       ORDER BY m.generic_name LIMIT 1
    `.execute(db);
    const name = medicine.rows[0]?.generic_name;
    if (name === undefined) throw new Error('The seed should stock this pharmacy (FR-DEM-05).');
    const named = async (): Promise<boolean> => {
      const found = await request(app).get(
        `${BASE}/medicines?q=${encodeURIComponent(name)}&limit=50`,
      );
      return JSON.stringify(found.body).includes(hospitalId);
    };
    expect(await named()).toBe(true);
    await setOff(['pharmacy']);
    expect(await named()).toBe(false);
    await setOff([]);
    expect(await named()).toBe(true);
  });
});

describe('the consoles are told, so they offer nothing that would be refused', () => {
  it('the picker’s list, a member’s own chambers and the settings all say what is off', async () => {
    await setOff(['lab', 'beds']);

    const picker = await request(app).get(`${BASE}/demo/consoles`);
    const mine = (picker.body.data.consoles as { hospitalId: string; modulesOff: string[] }[]).find(
      (entry) => entry.hospitalId === hospitalId,
    );
    expect([...(mine?.modulesOff ?? [])].sort()).toEqual(['beds', 'lab']);

    const chambers = await request(app)
      .get(`${BASE}/staff/chambers`)
      .set('Authorization', bearer(staff));
    expect([...(chambers.body.data.modulesOff as string[])].sort()).toEqual(['beds', 'lab']);

    const seededOff = (
      picker.body.data.consoles as { nameEn: string; modulesOff: string[] }[]
    ).find((entry) => entry.nameEn.startsWith('Meghna'));
    // The demonstration has a facility that does not run everything (`seed_01`).
    expect(seededOff?.modulesOff).toEqual(['pharmacy']);
  });
});

describe('switching them is the platform’s (FR-SUP-03)', () => {
  it('and nobody else’s', async () => {
    expect((await setOff(['lab'], await staffToken(['hospital_admin'], hospitalId))).status).toBe(
      403,
    );
    expect((await setOff(['lab'], await nationalToken(['gov_viewer']))).status).toBe(403);
    expect((await setOff(['lab'], null)).status).toBe(401);
    expect((await setOff(['lab'], platform, randomUUID())).status).toBe(404);
  });

  it('the doctor’s console is never on where serials are off', async () => {
    const response = await setOff(['queue']);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.error.details).toMatchObject({ reason: 'doctor_needs_queue' });
    expect((await setOff(['queue', 'doctor'])).status).toBe(200);
  });

  it('only modules there are, each once', async () => {
    expect((await setOff(['billing'])).status).toBe(400);
    expect((await setOff(['lab', 'lab'])).status).toBe(400);
    expect((await setOff([])).status).toBe(200);
  });

  it('answers with the workspace as it now is, and is written to the audit log', async () => {
    const response = await setOff(['pharmacy', 'import']);
    expect([...(response.body.data.modulesOff as string[])].sort()).toEqual(['import', 'pharmacy']);
    const rows = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM audit_log
       WHERE hospital_id = ${hospitalId}::uuid AND action = 'SETTINGS_CHANGE'
         AND meta ->> 'change' = 'modules'
    `.execute(db);
    expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0);
  });
});
