/**
 * Counter registration and walk-ins (pilot step 23, `S-B-03`,
 * `MOD-B02-WALKIN`, `FR-REC-14`, `FR-REC-20`, `FR-GST-13`).
 *
 * Against a real chamber from the seeds (`createQueueFixture`). A registered
 * patient is found again by the number however it is typed, the same name
 * under the same number is one person, every lookup that shows somebody is
 * audited, and a walk-in sent twice with the same key is one booking.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { bearer, nationalToken, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

async function staff(roles: readonly StaffRole[] = ['receptionist']): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: fixture.receptionistId, kind: 'staff', hospitalId: fixture.hospitalId, roles },
  });
}

/** A number nobody else in the run uses, as the patient would say it. */
function spokenPhone(): { typed: string; stored: string } {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return { typed: `018 ${tail}`, stored: `+88018${tail}` };
}

async function register(body: Record<string, unknown>, token?: string): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/registration/patients`)
    .set('Authorization', bearer(token ?? (await staff())))
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

async function lookup(phone: string, token?: string): Promise<request.Response> {
  return await request(app)
    .get(`${BASE}/registration/patients`)
    .query({ phone })
    .set('Authorization', bearer(token ?? (await staff())));
}

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(3);
});

describe('who may register at the counter (FR-ROLE-01)', () => {
  it('needs a signed-in receptionist', async () => {
    expect((await request(app).get(`${BASE}/registration/patients?phone=01712345678`)).status).toBe(
      401,
    );
    for (const token of [
      await staff(['doctor', 'ward', 'lab', 'pharmacy', 'emergency']),
      await patientToken(),
      await nationalToken(),
    ]) {
      expect((await lookup('01712345678', token)).status).toBe(403);
    }
  });

  it('refuses a registration without an idempotency key', async () => {
    const response = await request(app)
      .post(`${BASE}/registration/patients`)
      .set('Authorization', bearer(await staff()))
      .send({ phone: '01712345678', fullName: 'কেউ (ডেমো)', ageYears: 30, sex: 'male' });
    expect(response.status).toBe(400);
  });
});

describe('phone first (FR-REC-20)', () => {
  it('refuses a number that cannot be a Bangladeshi mobile', async () => {
    const response = await lookup('12345');
    expect(response.status).toBe(400);
  });

  it('finds nobody under a new number, then the patient registered under it', async () => {
    const phone = spokenPhone();
    const empty = await lookup(phone.typed);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ phone: phone.stored, patients: [] });

    const created = await register({
      phone: phone.typed,
      fullName: 'সালমা বেগম (ডেমো)',
      ageYears: 41,
      sex: 'female',
    });
    expect(created.status).toBe(200);
    expect(created.body.data.phone).toBe(phone.stored);

    // Typed the other way the same number is said.
    const found = await lookup(phone.stored.replace('+88', ''));
    expect(found.body.data.patients).toEqual([
      {
        patientId: created.body.data.patientId,
        fullName: 'সালমা বেগম (ডেমো)',
        ageYears: 41,
        sex: 'female',
        relationship: 'self',
        isPrimary: true,
        owner: 'guest',
      },
    ]);
  });

  it('keeps one record for the same person, and a second for a child on the same phone', async () => {
    const phone = spokenPhone();
    const first = await register({
      phone: phone.typed,
      fullName: 'রহিম (ডেমো)',
      ageYears: 50,
      sex: 'male',
    });
    const again = await register({
      phone: phone.typed,
      fullName: 'রহিম (ডেমো)',
      ageYears: 50,
      sex: 'male',
    });
    const child = await register({
      phone: phone.typed,
      fullName: 'তানিয়া (ডেমো)',
      ageYears: 6,
      sex: 'female',
    });

    expect(again.body.data.patientId).toBe(first.body.data.patientId);
    expect(child.body.data.patientId).not.toBe(first.body.data.patientId);
    expect((await lookup(phone.typed)).body.data.patients).toHaveLength(2);
  });

  it('audits every patient a lookup showed (DB-P7)', async () => {
    const phone = spokenPhone();
    const created = await register({
      phone: phone.typed,
      fullName: 'করিম (ডেমো)',
      ageYears: 33,
      sex: 'male',
    });
    await lookup(phone.typed);

    const audit = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_log
       WHERE patient_id = ${created.body.data.patientId as string} AND action = 'RECORD_VIEW'
         AND actor_staff_id = ${fixture.receptionistId}
         AND meta->>'purpose' = 'registration_lookup'
    `.execute(db);
    expect(audit.rows[0]?.n).toBe(1);
  });
});

describe('a registered patient walks in (FR-REC-14)', () => {
  it('is given the next serial, once, however often the counter sends it', async () => {
    await request(app)
      .post(`${BASE}/sessions/${fixture.sessionId}/arrived`)
      .set('Authorization', bearer(await staff()))
      .set('Idempotency-Key', randomUUID())
      .send({});

    const phone = spokenPhone();
    const created = await register({
      phone: phone.typed,
      fullName: 'নাসরিন (ডেমো)',
      ageYears: 28,
      sex: 'female',
    });
    const body = {
      clientEventId: randomUUID(),
      clientTs: new Date().toISOString(),
      patientId: created.body.data.patientId as string,
      position: 'end',
    };
    const send = async (): Promise<request.Response> =>
      await request(app)
        .post(`${BASE}/sessions/${fixture.sessionId}/walkin`)
        .set('Authorization', bearer(await staff()))
        .set('Idempotency-Key', randomUUID())
        .send(body);

    const first = await send();
    expect(first.status).toBe(200);
    const serials = (first.body.data.state.entries as { serial: number }[]).map(
      (entry) => entry.serial,
    );
    expect(Math.max(...serials)).toBe(4);

    // The counter's connection dropped after the server answered; it sends again.
    const replay = await send();
    expect(replay.status).toBe(200);
    const bookings = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM bookings WHERE session_id = ${fixture.sessionId} AND deleted_at IS NULL
    `.execute(db);
    expect(bookings.rows[0]?.n).toBe(4);
  });
});
