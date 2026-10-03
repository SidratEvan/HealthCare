/**
 * A queue write must need only one database connection (`FR-QUE-53`, `NFR-02`).
 *
 * Every write to a chamber takes the session's row lock inside a transaction,
 * on one connection. While it held that lock, the notification step went back
 * to the *pool* for three more reads. If every other connection was held — by
 * other counters' taps on the same chamber, each waiting for that very lock —
 * the holder waited for a connection that could only be freed by itself: five
 * seconds of nothing (`connectionTimeoutMillis`), then a failed tap, with the
 * queue already broadcast as though it had moved.
 *
 * It showed itself once, as `queueConflict.test.ts` failing after 5.3 s in a
 * full run: five taps at once on a pool of five. That test depends on timing.
 * These do not: they take every connection but one before the request is
 * made, so a path that needs two at once fails every time.
 *
 * Runs against the seeded demo database (CLAUDE.md §6), each test on a session
 * of its own.
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { pool } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { env } from '../env.js';
import { resetEmitter } from '../realtime/emit.js';

import { createQueueFixture, eventTypesOf, type QueueFixture } from './support/queueFixture.js';

import type { Express } from 'express';
import type { PoolClient } from 'pg';

const BASE = '/api/v1';

/**
 * Well under the five seconds a starved connection waits, and well over what
 * a tap takes on a slow machine.
 */
const PROMPT_MS = 3_500;

let app: Express;
let fixture: QueueFixture;
let held: PoolClient[] = [];

async function staff(roles: readonly StaffRole[] = ['receptionist']): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: fixture.receptionistId, kind: 'staff', hospitalId: fixture.hospitalId, roles },
  });
}

async function post(path: string, body: Record<string, unknown>, token?: string) {
  const call = request(app).post(`${BASE}${path}`).set('Idempotency-Key', crypto.randomUUID());
  if (token !== undefined) void call.set('Authorization', `Bearer ${token}`);
  return await call.send(body);
}

/** Takes every connection the pool has but one, as busy counters would. */
async function leaveOneConnection(): Promise<void> {
  for (let i = 0; i < env.DATABASE_POOL_MAX - 1; i += 1) held.push(await pool.connect());
}

/** How long a request took, and what came back. */
async function timed<T>(run: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = Date.now();
  const result = await run();
  return { result, ms: Date.now() - started };
}

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(5);
  await post(`/sessions/${fixture.sessionId}/arrived`, {}, await staff());
});

afterEach(() => {
  for (const client of held) client.release();
  held = [];
});

describe('with one database connection to spare', () => {
  it('calls the next patient, at once', async () => {
    const token = await staff();
    await leaveOneConnection();

    const { result, ms } = await timed(() =>
      post(`/sessions/${fixture.sessionId}/next`, {}, token),
    );

    expect(result.status).toBe(200);
    expect(ms, `the tap took ${String(ms)} ms`).toBeLessThan(PROMPT_MS);
    expect(await eventTypesOf(fixture.sessionId)).toEqual(['DOCTOR_ARRIVED', 'PATIENT_CALLED']);
  });

  it('declares a delay to everybody waiting, at once', async () => {
    const token = await staff();
    await leaveOneConnection();

    const { result, ms } = await timed(() =>
      post(
        `/sessions/${fixture.sessionId}/delay`,
        { minutes: 15, reason: null, declaredBy: 'reception' },
        token,
      ),
    );

    expect(result.status).toBe(200);
    expect(ms, `the delay took ${String(ms)} ms`).toBeLessThan(PROMPT_MS);
  });

  it('replays a counter’s batch, at once', async () => {
    const token = await staff();
    await leaveOneConnection();

    const { result, ms } = await timed(() =>
      post(
        '/sync/events',
        {
          sessionId: fixture.sessionId,
          events: [
            {
              clientEventId: crypto.randomUUID(),
              type: 'PATIENT_CALLED',
              payload: { bookingId: fixture.bookingIds[0], serial: 1 },
              clientTs: new Date().toISOString(),
            },
          ],
        },
        token,
      ),
    );

    expect(result.status).toBe(200);
    expect(result.body.data.accepted).toHaveLength(1);
    expect(ms, `the batch took ${String(ms)} ms`).toBeLessThan(PROMPT_MS);
  });

  // The rest of what a counter does to a chamber, each in turn.
  it.each([
    [
      'checks a patient in',
      (f: QueueFixture) => `/bookings/${f.bookingIds[0] ?? ''}/check-in`,
      { quotedWaitMinutes: 10 },
    ],
    [
      'marks a patient late',
      (f: QueueFixture) => `/bookings/${f.bookingIds[1] ?? ''}/late`,
      { expectedMinutes: 20 },
    ],
    ['adds a walk-in', (f: QueueFixture) => `/sessions/${f.sessionId}/walkin`, { position: 'end' }],
    ['pauses the chamber', (f: QueueFixture) => `/sessions/${f.sessionId}/pause`, { reason: null }],
    ['ends the chamber', (f: QueueFixture) => `/sessions/${f.sessionId}/end`, { reason: null }],
  ] as const)('%s, at once', async (_name, path, body) => {
    const token = await staff();
    await leaveOneConnection();

    const { result, ms } = await timed(() =>
      post(
        path(fixture),
        'position' in body ? { ...body, patientId: fixture.sparePatientId } : body,
        token,
      ),
    );

    expect(result.status).toBe(200);
    expect(ms, `it took ${String(ms)} ms`).toBeLessThan(PROMPT_MS);
  });

  it('takes a booking and queues its confirmation, at once', async () => {
    await leaveOneConnection();

    const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
    const { result, ms } = await timed(() =>
      post('/bookings', {
        sessionId: fixture.sessionId,
        method: 'at_hospital',
        guest: { name: 'রহিমা খাতুন (ডেমো)', phone: `+88019${tail}`, ageYears: 34, sex: 'female' },
      }),
    );

    expect(result.status).toBe(201);
    // The confirmation's failure is swallowed so a booking never reports
    // failure for an SMS (`booking.service`) — which is why a starved pool
    // showed up only as five lost seconds and a patient with no message.
    expect(ms, `the booking took ${String(ms)} ms`).toBeLessThan(PROMPT_MS);
  });
});
