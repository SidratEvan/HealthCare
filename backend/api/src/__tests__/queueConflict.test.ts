/**
 * Two counters, one queue (`FR-QUE-53`).
 *
 * This is the test step 6's definition of done names, and it is the reason
 * `appendEvent` takes `SELECT … FOR UPDATE` on the session row before it reads
 * anything (BACKEND.md §4.1 step 5).
 *
 * Without the lock the failure is not an error — it is worse than an error.
 * Both counters read the same state, both conclude that serial 1 is next, both
 * append a `PATIENT_CALLED`, and the log now says one patient was called twice
 * while the patient behind them was skipped. Nothing throws. The queue is
 * simply, quietly wrong, and the log that exists to settle the argument
 * contains the argument.
 *
 * So the assertion is not "no request failed". It is that after two
 * simultaneous taps, exactly one patient is in the chamber and the serials
 * advanced by exactly one each time.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import * as queueService from '../services/queue.service.js';

import {
  cachedStateOf,
  createQueueFixture,
  eventTypesOf,
  type QueueFixture,
} from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let counter = 0;

/** A token for a real seeded receptionist — the actor FK demands one. */
async function staffToken(hospitalId: string, sub: string): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub, kind: 'staff', hospitalId, roles: ['receptionist'] },
  });
}

/** One counter tapping `next`. Its own idempotency key, like a real device. */
async function tapNext(
  token: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  counter += 1;
  return await request(app)
    .post(`${BASE}/sessions/${fixture.sessionId}/next`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', `conflict-${String(counter)}-${String(Date.now())}`)
    .send(body);
}

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(6);

  const token = await staffToken(fixture.hospitalId, fixture.receptionistId);
  await request(app)
    .post(`${BASE}/sessions/${fixture.sessionId}/arrived`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', `arrive-${String(Date.now())}`)
    .send({});
});

describe('two counters calling next at the same moment (FR-QUE-53)', () => {
  it('calls two different patients, in order, never the same one twice', async () => {
    const token = await staffToken(fixture.hospitalId, fixture.receptionistId);

    // Fired together, with no await between them: both requests are in flight
    // before either has taken the lock.
    const [first, second] = await Promise.all([tapNext(token), tapNext(token)]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const types = await eventTypesOf(fixture.sessionId);
    const called = types.filter((type) => type === 'PATIENT_CALLED');
    const done = types.filter((type) => type === 'PATIENT_DONE');

    // The first tap called serial 1. The second finished serial 1 and called
    // serial 2 — which is only possible if it read the state *after* the first
    // had committed.
    expect(called).toHaveLength(2);
    expect(done).toHaveLength(1);

    const state = await queueService.getState(fixture.sessionId);
    const inChamber = state.entries.filter((entry) => entry.status === 'in_chamber');
    expect(inChamber).toHaveLength(1);
    expect(inChamber[0]?.serial).toBe(2);
  });

  it('never leaves two patients in the chamber, however many taps land at once', async () => {
    const token = await staffToken(fixture.hospitalId, fixture.receptionistId);

    // Five counters, all tapping at the same instant.
    const responses = await Promise.all([
      tapNext(token),
      tapNext(token),
      tapNext(token),
      tapNext(token),
      tapNext(token),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const state = await queueService.getState(fixture.sessionId);
    // FR-QUE-53: at most one patient is "now serving" at any time.
    expect(state.entries.filter((entry) => entry.status === 'in_chamber')).toHaveLength(1);

    // Each tap moved the queue exactly one place: five calls, four completions.
    const types = await eventTypesOf(fixture.sessionId);
    expect(types.filter((type) => type === 'PATIENT_CALLED')).toHaveLength(5);
    expect(types.filter((type) => type === 'PATIENT_DONE')).toHaveLength(4);

    // And the cache agrees with the log it was derived from.
    const cached = await cachedStateOf(fixture.sessionId);
    expect(cached?.now_serving_serial).toBe(5);
    expect(cached?.done_count).toBe(4);
  });

  it('refuses a second next that names a patient no longer in the chamber (F-03)', async () => {
    const token = await staffToken(fixture.hospitalId, fixture.receptionistId);
    await tapNext(token);
    const before = await queueService.getState(fixture.sessionId);
    const serving = before.entries.find((entry) => entry.status === 'in_chamber');
    expect(serving?.serial).toBe(1);
    const expected = { expectedBookingId: serving?.bookingId };

    // Two counters, both looking at serial 1, both tap at once.
    const [first, second] = await Promise.all([tapNext(token, expected), tapNext(token, expected)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 422]);
    const refused = first.status === 422 ? first : second;
    expect(refused.body.error.code).toBe('QUEUE_GUARD_FAILED');
    expect(refused.body.error.details.guard).toBe('CONSULTATION_CHANGED');

    // Serial 1 was finished once and serial 2 called; serial 2 was not
    // finished by the counter that never saw it.
    const state = await queueService.getState(fixture.sessionId);
    const statusOf = (serial: number) =>
      state.entries.find((entry) => entry.serial === serial)?.status;
    expect(statusOf(1)).toBe('done');
    expect(statusOf(2)).toBe('in_chamber');
    expect(statusOf(3)).not.toBe('in_chamber');
  });

  it('refuses an expected patient that is not a booking id', async () => {
    const token = await staffToken(fixture.hospitalId, fixture.receptionistId);
    const response = await tapNext(token, { expectedBookingId: 'serial-1' });
    expect(response.status).toBe(400);
  });

  it('keeps the cache in step with the log after concurrent writes (DB-P1)', async () => {
    const token = await staffToken(fixture.hospitalId, fixture.receptionistId);
    await Promise.all([tapNext(token), tapNext(token), tapNext(token)]);

    const cached = await cachedStateOf(fixture.sessionId);
    const state = await queueService.getState(fixture.sessionId);

    // `rebuilt_from_seq` behind `lastSeq` would mean the cache had not
    // consumed the whole log — a reader trusting it would show a stale queue.
    expect(Number(cached?.rebuilt_from_seq ?? 0)).toBe(state.lastSeq);
  });
});
