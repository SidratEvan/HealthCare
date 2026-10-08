/**
 * Payment first, after no-shows (plan F3; `PRD.md` `FR-GST-14`, `FR-PAY-02`).
 *
 * A number with three no-shows at a hospital within its window, where the
 * hospital has turned the rule on, books its next guest serial paid online
 * first: the counter is refused with the reason, and an online booking is
 * held and released if not paid (`FR-PAY-08`). Off by default; counted at
 * this hospital only; and the window is the hospital's.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';

import { createQueueFixture, otherHospitalId, type QueueFixture } from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let phone: string;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(2);
  phone = `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
});

afterEach(async () => {
  await sql`
    UPDATE hospital_settings SET noshow_prepay = false, noshow_window_days = 90
     WHERE hospital_id = ${fixture.hospitalId}::uuid
  `.execute(db);
});

/** The guest identity behind the number, made as a first booking would. */
async function identity(): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO guest_identities (phone, display_name) VALUES (${phone}, 'নাসিমা (ডেমো)')
    RETURNING id
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('no identity');
  return id;
}

/** Records no-shows for the number in a session, as the counter would have marked them. */
async function noShows(guestId: string, sessionId: string, count: number): Promise<void> {
  // Patients with nothing in this session: one live booking each is the rule.
  const free = await sql<{ id: string }>`
    SELECT id FROM patients p
     WHERE p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.patient_id = p.id AND b.session_id = ${sessionId}::uuid)
     ORDER BY random() LIMIT ${count}
  `.execute(db);
  for (let index = 0; index < count; index += 1) {
    const patient = free.rows[index]?.id;
    await sql`
      INSERT INTO bookings
        (session_id, patient_id, serial_number, source, fee_poisha, intake,
         booked_by_guest_id, status)
      VALUES (${sessionId}::uuid, ${patient}::uuid, ${900 + index + Math.floor(Math.random() * 90)},
              'guest_link', 50000, '{"demo":true}'::jsonb, ${guestId}::uuid, 'no_show')
    `.execute(db);
  }
}

async function ruleOn(windowDays = 90): Promise<void> {
  await sql`
    INSERT INTO hospital_settings (hospital_id) VALUES (${fixture.hospitalId}::uuid)
    ON CONFLICT (hospital_id) DO NOTHING
  `.execute(db);
  await sql`
    UPDATE hospital_settings SET noshow_prepay = true, noshow_window_days = ${windowDays}
     WHERE hospital_id = ${fixture.hospitalId}::uuid
  `.execute(db);
}

async function book(method: 'at_hospital' | 'bkash'): Promise<request.Response> {
  const key = randomUUID();
  return await request(app)
    .post(`${BASE}/bookings`)
    .set('Idempotency-Key', key)
    .send({
      sessionId: fixture.sessionId,
      method,
      guest: { name: 'নাসিমা (ডেমো)', phone, ageYears: 38, sex: 'female' },
    });
}

/** A past session at a hospital, for no-shows outside a window or elsewhere. */
async function pastSession(hospitalId: string, olderThanDays: number): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM sessions
     WHERE hospital_id = ${hospitalId}::uuid
       AND session_date < (now() AT TIME ZONE 'Asia/Dhaka')::date - ${olderThanDays}::int
     ORDER BY session_date DESC LIMIT 1
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('the seed should hold past sessions (FR-DEM-02)');
  return id;
}

describe('three no-shows ask for payment first (FR-GST-14)', () => {
  it('is off until the hospital turns it on', async () => {
    await noShows(await identity(), fixture.sessionId, 3);
    const booked = await book('at_hospital');
    expect(booked.status).toBe(201);
  });

  it('refuses the counter, says why, and writes nothing', async () => {
    await noShows(await identity(), fixture.sessionId, 3);
    await ruleOn();
    const before = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM bookings WHERE session_id = ${fixture.sessionId}::uuid
    `.execute(db);

    const refused = await book('at_hospital');
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('PREPAYMENT_REQUIRED');
    expect(refused.body.error.details.reason).toBe('no_shows');

    const after = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM bookings WHERE session_id = ${fixture.sessionId}::uuid
    `.execute(db);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('takes an online booking, marked as one that must be paid first', async () => {
    await noShows(await identity(), fixture.sessionId, 3);
    await ruleOn();

    const booked = await book('bkash');
    expect(booked.status).toBe(201);
    expect(booked.body.data.payment.afterHold).toBe('released');
    const row = await sql<{ prepayment_required: boolean }>`
      SELECT prepayment_required FROM bookings WHERE id = ${booked.body.data.bookingId}::uuid
    `.execute(db);
    expect(row.rows[0]?.prepayment_required).toBe(true);
  });

  it('asks nothing of a number with two', async () => {
    await noShows(await identity(), fixture.sessionId, 2);
    await ruleOn();
    expect((await book('at_hospital')).status).toBe(201);
  });

  it('counts this hospital’s no-shows only (FR-NET-02)', async () => {
    const guest = await identity();
    await noShows(guest, await pastSession(await otherHospitalId(fixture.hospitalId), 1), 3);
    await ruleOn();
    expect((await book('at_hospital')).status).toBe(201);
  });

  it('counts within the hospital’s window only', async () => {
    await noShows(await identity(), await pastSession(fixture.hospitalId, 10), 3);
    await ruleOn(7);
    expect((await book('at_hospital')).status).toBe(201);
  });
});
