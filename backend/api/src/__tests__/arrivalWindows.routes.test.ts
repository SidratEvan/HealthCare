/**
 * A preferred hour to arrive (plan R1; `PRD.md` `FR-PAT-28`).
 *
 * Offered only where the hospital has turned it on; only one of the chamber's
 * own windows; kept on the booking; and never read by the queue.
 *
 * Runs against the seeded demo database (CLAUDE.md §6).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let plannedStart: Date;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(1);
  const session = await sql<{ planned_start: Date }>`
    SELECT planned_start FROM sessions WHERE id = ${fixture.sessionId}::uuid
  `.execute(db);
  const start = session.rows[0]?.planned_start;
  if (start === undefined) throw new Error('the fixture holds a session');
  plannedStart = start;
});

afterEach(async () => {
  await setting(false);
});

async function setting(on: boolean): Promise<void> {
  await sql`
    INSERT INTO hospital_settings (hospital_id) VALUES (${fixture.hospitalId}::uuid)
    ON CONFLICT (hospital_id) DO NOTHING
  `.execute(db);
  await sql`
    UPDATE hospital_settings SET arrival_windows = ${on}
     WHERE hospital_id = ${fixture.hospitalId}::uuid
  `.execute(db);
}

async function book(arrivalWindowStart: string): Promise<request.Response> {
  const key = randomUUID();
  return await request(app)
    .post(`${BASE}/bookings`)
    .set('Idempotency-Key', key)
    .send({
      sessionId: fixture.sessionId,
      method: 'at_hospital',
      guest: {
        name: 'রুমানা (ডেমো)',
        phone: `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
        ageYears: 33,
        sex: 'female',
      },
      arrivalWindowStart,
    });
}

const hourAfterStart = (): string => new Date(plannedStart.getTime() + 60 * 60_000).toISOString();

describe('a preferred arrival hour (FR-PAT-28)', () => {
  it('is refused, and nothing written, where the hospital does not offer it', async () => {
    const refused = await book(hourAfterStart());
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('ARRIVAL_WINDOW_NOT_OFFERED');
  });

  it('is kept on the booking where the hospital offers it, and said on the session list', async () => {
    await setting(true);

    const sessions = await request(app).get(`${BASE}/sessions?hospitalId=${fixture.hospitalId}`);
    const card = (
      sessions.body.data.sessions as { id: string; offersArrivalWindow: boolean }[]
    ).find((session) => session.id === fixture.sessionId);
    expect(card?.offersArrivalWindow).toBe(true);

    const booked = await book(hourAfterStart());
    expect(booked.status).toBe(201);
    const row = await sql<{ arrival_window_start: Date | null }>`
      SELECT arrival_window_start FROM bookings WHERE id = ${booked.body.data.bookingId}::uuid
    `.execute(db);
    expect(row.rows[0]?.arrival_window_start?.toISOString()).toBe(hourAfterStart());
  });

  it('takes only one of the chamber’s own windows', async () => {
    await setting(true);
    const halfPast = new Date(plannedStart.getTime() + 30 * 60_000).toISOString();
    expect((await book(halfPast)).status).toBe(422);
    const dayBefore = new Date(plannedStart.getTime() - 24 * 60 * 60_000).toISOString();
    expect((await book(dayBefore)).status).toBe(422);
  });

  it('is never read by the queue: the serial is the next one, whatever the hour', async () => {
    await setting(true);
    const last = await book(new Date(plannedStart.getTime()).toISOString());
    expect(last.status).toBe(201);
    // One booking already in the fixture, so this is serial two, in its order.
    expect(last.body.data.serial).toBe(2);
  });
});
