/**
 * `POST /bookings/:id/check-in` — the patient is at the counter, and was told
 * roughly how long they will wait (`FR-REC-18`, `FR-PAT-38`).
 *
 * The owner's ruling of 2026-09-23 on STATUS decision 61: without a check-in
 * nothing recorded a patient arriving, so `FR-ADM-01`'s average wait had no
 * source. These tests pin the three things the ruling depends on — the arrival
 * is the server's clock, the quote reaches the patient in the broadcast state,
 * and both land on the booking row the dashboard aggregates.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter, type RecordingEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';

import {
  createQueueFixture,
  eventTypesOf,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';
import { patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let emitted: RecordingEmitter;
let key = 0;

function idem(): string {
  key += 1;
  return `check-in-${String(key)}-${String(Date.now())}`;
}

async function staff(
  roles: readonly StaffRole[] = ['receptionist'],
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.receptionistId,
): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub, kind: 'staff', hospitalId, roles } });
}

async function checkIn(
  bookingId: string,
  body: Record<string, unknown> = { quotedWaitMinutes: 25 },
  token?: string,
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/bookings/${bookingId}/check-in`)
    .set('Authorization', `Bearer ${token ?? (await staff())}`)
    .set('Idempotency-Key', idem())
    .send(body);
}

async function bookingRow(
  bookingId: string,
): Promise<{ arrived_at: Date | null; quoted_wait_minutes: number | null; status: string }> {
  const result = await sql<{
    arrived_at: Date | null;
    quoted_wait_minutes: number | null;
    status: string;
  }>`
    SELECT arrived_at, quoted_wait_minutes, status::text AS status
      FROM bookings WHERE id = ${bookingId}
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) throw new Error('booking not found');
  return row;
}

beforeEach(async () => {
  app = createApp();
  emitted = resetEmitter();
  fixture = await createQueueFixture(4);
});

describe('checking a patient in (FR-REC-18)', () => {
  it('appends PATIENT_ARRIVED and projects the arrival and the quote onto the booking', async () => {
    const booking = fixture.bookingIds[2] ?? '';
    const before = Date.now();

    const response = await checkIn(booking, { quotedWaitMinutes: 35 });

    expect(response.status).toBe(200);
    expect(await eventTypesOf(fixture.sessionId)).toContain('PATIENT_ARRIVED');

    const row = await bookingRow(booking);
    expect(row.quoted_wait_minutes).toBe(35);
    expect(row.status).toBe('waiting');
    // The server's clock, not a figure the console sent.
    expect(row.arrived_at?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('carries the quote to the patient in the broadcast state (FR-PAT-38)', async () => {
    const booking = fixture.bookingIds[1] ?? '';
    await checkIn(booking, { quotedWaitMinutes: 20 });

    const updates = emitted.forRoom(ROOMS.session(fixture.sessionId));
    expect(updates.length).toBeGreaterThan(0);

    const payload = JSON.stringify(updates.at(-1)?.envelope);
    expect(payload).toContain('"quotedWaitMinutes":20');
  });

  it('refuses a second check-in, which would move the measured arrival', async () => {
    const booking = fixture.bookingIds[0] ?? '';
    await checkIn(booking);

    const again = await checkIn(booking, { quotedWaitMinutes: 5 });

    expect(again.status).toBe(422);
    expect(again.body.error.details.guard).toBe('ALREADY_ARRIVED');
    expect((await bookingRow(booking)).quoted_wait_minutes).toBe(25);
  });

  it('refuses a quote that is missing, negative, fractional or past eight hours', async () => {
    const booking = fixture.bookingIds[0] ?? '';

    for (const body of [
      {},
      { quotedWaitMinutes: -1 },
      { quotedWaitMinutes: 12.5 },
      { quotedWaitMinutes: 481 },
    ]) {
      expect((await checkIn(booking, body)).status).toBe(400);
    }
    expect((await bookingRow(booking)).arrived_at).toBeNull();
  });

  it('is a replay, not a second event, when the console re-sends it (SY-02)', async () => {
    // A console that lost the response re-sends the same `clientEventId`,
    // which is the event's own idempotency key.
    const booking = fixture.bookingIds[3] ?? '';
    const clientEventId = crypto.randomUUID();

    const first = await checkIn(booking, { quotedWaitMinutes: 15, clientEventId });
    const second = await checkIn(booking, { quotedWaitMinutes: 15, clientEventId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    const arrivals = (await eventTypesOf(fixture.sessionId)).filter(
      (type) => type === 'PATIENT_ARRIVED',
    );
    expect(arrivals).toHaveLength(1);
  });
});

describe('who may check a patient in (FR-ROLE-01)', () => {
  it('is reception: not the doctor, and not the patient', async () => {
    const booking = fixture.bookingIds[1] ?? '';

    const doctor = await staff(['doctor'], fixture.hospitalId, fixture.doctorStaffId);
    expect((await checkIn(booking, undefined, doctor)).status).toBe(403);
    expect((await checkIn(booking, undefined, await patientToken())).status).toBe(403);
  });

  it('refuses a receptionist from another hospital', async () => {
    const elsewhere = await otherHospitalId(fixture.hospitalId);
    const token = await staff(
      ['receptionist'],
      elsewhere,
      await staffIdFor(elsewhere, 'receptionist'),
    );

    expect((await checkIn(fixture.bookingIds[1] ?? '', undefined, token)).status).toBe(403);
  });

  it('refuses an unauthenticated caller, and demands an idempotency key', async () => {
    const booking = fixture.bookingIds[1] ?? '';

    const anonymous = await request(app)
      .post(`${BASE}/bookings/${booking}/check-in`)
      .set('Idempotency-Key', idem())
      .send({ quotedWaitMinutes: 10 });
    expect(anonymous.status).toBe(401);

    const keyless = await request(app)
      .post(`${BASE}/bookings/${booking}/check-in`)
      .set('Authorization', `Bearer ${await staff()}`)
      .send({ quotedWaitMinutes: 10 });
    expect(keyless.status).toBe(400);
    expect(keyless.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
