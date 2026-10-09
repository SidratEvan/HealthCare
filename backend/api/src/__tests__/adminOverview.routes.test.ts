/**
 * The hospital now, at a glance (plan R6; `PRD.md` `FR-ADM-12`;
 * `GET /admin/overview`).
 *
 * The administrator's own hospital, counts only, live; and a figure the
 * hospital has nothing to know from is absent, never a zero.
 *
 * Runs against the seeded demo database (CLAUDE.md §6).
 */

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { bearer, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(3);
});

afterEach(async () => {
  await sql`
    UPDATE hospital_settings SET modules_off = '{}' WHERE hospital_id = ${fixture.hospitalId}::uuid
  `.execute(db);
});

async function read(roles: Parameters<typeof staffToken>[0] = ['hospital_admin']) {
  return await request(app)
    .get(`${BASE}/admin/overview`)
    .set('authorization', bearer(await staffToken(roles, fixture.hospitalId)));
}

describe('GET /admin/overview (FR-ADM-12)', () => {
  it('answers today’s counts for the administrator’s own hospital, and names nobody', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    const data = response.body.data as {
      doctors: { scheduled: number; sitting: number };
      waiting: number;
      appointments: { booked: number; seen: number };
      serverTs: string;
    };
    // The fixture's chamber is today's, with its three serials.
    expect(data.doctors.scheduled).toBeGreaterThanOrEqual(1);
    expect(data.doctors.sitting).toBeLessThanOrEqual(data.doctors.scheduled);
    expect(data.appointments.booked).toBeGreaterThanOrEqual(3);
    expect(data.appointments.seen).toBeLessThanOrEqual(data.appointments.booked);
    expect(data.waiting).toBeGreaterThanOrEqual(0);
    expect(Date.parse(data.serverTs)).not.toBeNaN();
    // Counts only: no patient's name or phone anywhere in the answer.
    expect(JSON.stringify(response.body)).not.toMatch(/\+8801|patientName|fullName/);
  });

  it('says a figure is absent, not zero, where the hospital has nothing to know it from', async () => {
    await sql`
      INSERT INTO hospital_settings (hospital_id) VALUES (${fixture.hospitalId}::uuid)
      ON CONFLICT (hospital_id) DO NOTHING
    `.execute(db);
    await sql`
      UPDATE hospital_settings SET modules_off = '{emergency}'
       WHERE hospital_id = ${fixture.hospitalId}::uuid
    `.execute(db);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.emergency).toBeNull();
  });

  it('is the administrator’s: a receptionist is refused, and nobody without a token', async () => {
    expect((await read(['receptionist'])).status).toBe(403);
    expect((await request(app).get(`${BASE}/admin/overview`)).status).toBe(401);
  });
});
