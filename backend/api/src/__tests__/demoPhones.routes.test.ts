/**
 * A demonstration takes only its own phone numbers (`FR-DEM-08`, owner,
 * 12 October 2026).
 *
 * Every route that takes a person's phone, with a number off the list: the
 * refusal is `DEMO_PHONE_NOT_ALLOWED`, and nothing the request would have
 * written exists afterwards. The rest of the API suite runs with the list off
 * (`DEMO_PHONES=any`, `support/env.setup.ts`), so it is switched back on here.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_PERSON_PHONES, latinDigits, normaliseBdMobile } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import * as envModule from '../env.js';

import { bearer } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/** A real-looking number nobody listed: what a visitor would type. */
const STRANGER = '+8801712345678';
const STRANGER_TYPED = '01712-345678';
/** One of the presenter's numbers. */
const PRESENTER = '+8801380000001';

let app: Express;
let shapla: { hospitalId: string; receptionistId: string; adminId: string };

async function seeded(hospitalCode: string, role: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT su.id FROM staff_users su
      JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.role = ${role}::staff_role
      JOIN hospitals h ON h.id = su.hospital_id
     WHERE h.code = ${hospitalCode} AND su.deleted_at IS NULL
     ORDER BY su.email LIMIT 1
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`no seeded ${role} at ${hospitalCode}`);
  return id;
}

async function staff(sub: string, roles: readonly string[]): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub, kind: 'staff', hospitalId: shapla.hospitalId, roles },
  });
}

async function count(query: ReturnType<typeof sql<{ n: number }>>): Promise<number> {
  return (await query.execute(db)).rows[0]?.n ?? -1;
}

function settings(overrides: Partial<typeof envModule.env>): void {
  vi.spyOn(envModule, 'env', 'get').mockReturnValue({
    ...envModule.env,
    DEMO_MODE: true,
    DEMO_PHONES: undefined,
    ...overrides,
  });
}

function refusedForDemo(response: request.Response, field: string): void {
  expect(response.status).toBe(422);
  expect(response.body.error.code).toBe('DEMO_PHONE_NOT_ALLOWED');
  expect(response.body.error.details.fields).toContain(field);
}

beforeAll(async () => {
  const hospital = await sql<{
    id: string;
  }>`SELECT id FROM hospitals WHERE code = 'SHAPLA'`.execute(db);
  shapla = {
    hospitalId: hospital.rows[0]!.id,
    receptionistId: await seeded('SHAPLA', 'receptionist'),
    adminId: await seeded('SHAPLA', 'hospital_admin'),
  };
});

beforeEach(() => {
  app = createApp();
  settings({});
});

describe('a demonstration takes only its own numbers (FR-DEM-08)', () => {
  it('patient sign-in: a stranger is refused and no code is made; a demo patient is sent one', async () => {
    const before = await count(
      sql<{ n: number }>`SELECT count(*)::int AS n FROM otp_challenges WHERE phone = ${STRANGER}`,
    );
    refusedForDemo(
      await request(app).post(`${BASE}/auth/otp`).send({ phone: STRANGER_TYPED }),
      'body.phone',
    );
    expect(
      await count(
        sql<{ n: number }>`SELECT count(*)::int AS n FROM otp_challenges WHERE phone = ${STRANGER}`,
      ),
    ).toBe(before);

    const listed = await request(app).post(`${BASE}/auth/otp`).send({ phone: '01310000001' });
    expect(listed.status).toBe(200);
  });

  it('a guest: the phone check, the booking, standby, a bed request and an emergency alert', async () => {
    const person = {
      name: 'অতিথি (ডেমো)',
      phone: STRANGER,
      ageYears: 30,
      sex: 'female',
    };
    refusedForDemo(
      await request(app).post(`${BASE}/guest/start`).send({ phone: STRANGER_TYPED }),
      'body.phone',
    );
    refusedForDemo(
      await request(app)
        .post(`${BASE}/bookings`)
        .set('Idempotency-Key', randomUUID())
        .send({ sessionId: randomUUID(), method: 'at_hospital', guest: person }),
      'body.guest.phone',
    );
    refusedForDemo(
      await request(app)
        .post(`${BASE}/sessions/${randomUUID()}/standby`)
        .set('Idempotency-Key', randomUUID())
        .send({ guest: person, method: 'at_hospital' }),
      'body.guest.phone',
    );
    refusedForDemo(
      await request(app)
        .post(`${BASE}/bed-requests`)
        .set('Idempotency-Key', randomUUID())
        .send({ hospitalId: shapla.hospitalId, kind: 'general', patient: person }),
      'body.patient.phone',
    );
    refusedForDemo(
      await request(app)
        .post(`${BASE}/emergency/inbound`)
        .set('Idempotency-Key', randomUUID())
        .send({ hospitalId: shapla.hospitalId, problem: 'burn', phone: STRANGER }),
      'body.phone',
    );
  });

  it('the counter: looking a stranger up and registering them are refused, and nobody is made', async () => {
    const token = await staff(shapla.receptionistId, ['receptionist']);
    const identities = sql<{ n: number }>`
      SELECT count(*)::int AS n FROM guest_identities WHERE phone = ${STRANGER}`;
    const before = await count(identities);

    refusedForDemo(
      await request(app)
        .get(`${BASE}/registration/patients`)
        .query({ phone: STRANGER_TYPED })
        .set('Authorization', bearer(token)),
      'query.phone',
    );
    refusedForDemo(
      await request(app)
        .post(`${BASE}/registration/patients`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send({ phone: STRANGER_TYPED, fullName: 'অতিথি (ডেমো)', ageYears: 40, sex: 'male' }),
      'body.phone',
    );
    expect(await count(identities)).toBe(before);

    const listed = await request(app)
      .get(`${BASE}/registration/patients`)
      .query({ phone: PRESENTER })
      .set('Authorization', bearer(token));
    expect(listed.status).toBe(200);
  });

  it('a hospital applying: its administrator’s mobile is held to the list, its own number is not', async () => {
    const tag = randomUUID().slice(0, 8);
    const form = (adminMobile: string): Record<string, unknown> => ({
      nameBn: 'ধলেশ্বরী হাসপাতাল (ডেমো)',
      nameEn: `Dhaleshwari ${tag} Hospital (Demo)`,
      kind: 'hospital',
      division: 'Dhaka',
      district: 'Munshiganj',
      // A facility's public number is not a person's: not covered.
      phone: STRANGER,
      registrationNo: `DEMO-REG-${tag}`,
      adminName: 'Demo Applicant',
      adminEmail: `applicant-${tag}@dhaleshwari.example`,
      adminMobile,
      password: 'a-long-demo-password-2026',
    });
    const made = sql<{ n: number }>`
      SELECT count(*)::int AS n FROM hospitals WHERE name_en = ${`Dhaleshwari ${tag} Hospital (Demo)`}`;

    refusedForDemo(
      await request(app)
        .post(`${BASE}/hospital-applications`)
        .set('Idempotency-Key', randomUUID())
        .send(form(STRANGER)),
      'body.adminMobile',
    );
    expect(await count(made)).toBe(0);

    const listed = await request(app)
      .post(`${BASE}/hospital-applications`)
      .set('Idempotency-Key', randomUUID())
      .send(form(PRESENTER));
    expect(listed.status).toBe(201);
    expect(await count(made)).toBe(1);
  });

  it('an import: a register with one stranger in it is refused before its batch exists', async () => {
    const token = await staff(shapla.adminId, ['hospital_admin']);
    const batches = sql<{ n: number }>`
      SELECT count(*)::int AS n FROM import_batches WHERE hospital_id = ${shapla.hospitalId}`;
    const before = await count(batches);
    const register = (second: string): string =>
      [
        'ref,full_name,date_of_birth,age_years,sex,mobile,blood_group',
        `DP-${randomUUID().slice(0, 6)},প্রথম রোগী (ডেমো),,40,F,01380000002,`,
        `DP-${randomUUID().slice(0, 6)},দ্বিতীয় রোগী (ডেমো),,52,M,${second},`,
      ].join('\n');
    const upload = async (csv: string): Promise<request.Response> =>
      await request(app)
        .post(`${BASE}/hospital/imports`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send({ set: 'patients', fileName: 'register.csv', csv });

    const refused = await upload(register('০১৭১২৩৪৫৬৭৮'));
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('DEMO_PHONE_NOT_ALLOWED');
    expect(refused.body.error.details.rows).toEqual([3]);
    expect(await count(batches)).toBe(before);

    const listed = await upload(register('01380000003'));
    expect(listed.status).toBe(200);
    expect(await count(batches)).toBe(before + 1);
  });

  it('a deployment’s own list replaces the built-in one', async () => {
    settings({ DEMO_PHONES: [STRANGER] });
    expect(
      (await request(app).post(`${BASE}/auth/otp`).send({ phone: STRANGER_TYPED })).status,
    ).toBe(200);
    refusedForDemo(
      await request(app).post(`${BASE}/auth/otp`).send({ phone: '01310000001' }),
      'body.phone',
    );
  });

  it('off a demonstration nothing is held to it', async () => {
    settings({ DEMO_MODE: false });
    const token = await staff(shapla.receptionistId, ['receptionist']);
    const lookup = await request(app)
      .get(`${BASE}/registration/patients`)
      .query({ phone: STRANGER_TYPED })
      .set('Authorization', bearer(token));
    expect(lookup.status).toBe(200);
  });
});

describe('the built-in list and the import samples agree (FR-DEM-08)', () => {
  it('holds every number in the import samples, so the demo guide’s import still runs', () => {
    // A sample's phone column, by the heading each export uses for it.
    const headings = new Set(['Contact No', 'Pt. Cell', 'মোবাইল নম্বর']);
    const directory = resolve('database/seeds/samples');
    let checked = 0;
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.csv'))) {
      const [head, ...rows] = readFileSync(resolve(directory, file), 'utf8')
        .trimStart()
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '');
      const column = (head ?? '').split(',').findIndex((cell) => headings.has(cell.trim()));
      if (column < 0) continue;
      for (const row of rows) {
        // These samples quote only fields that come after the phone column.
        const typed = row.split(',')[column] ?? '';
        const phone = normaliseBdMobile(latinDigits(typed));
        if (phone === null) continue;
        checked += 1;
        expect(DEMO_PERSON_PHONES, `${file}: ${typed}`).toContain(phone);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
