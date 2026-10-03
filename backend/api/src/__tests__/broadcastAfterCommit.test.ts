/**
 * A screen is told about a queue write only once it is in the database
 * (`FR-QUE-05`, `NFR-01`, PRD.md §3.2).
 *
 * `queue.updated` used to be emitted from inside the write's transaction,
 * before it committed. Two things followed.
 *
 * A screen that subscribed in that moment — a phone opening its tracking link
 * as reception tapped *next* — joined the room just too late to hear the
 * broadcast and read its catch-up state just too early to see the write: it
 * showed the previous patient, stamped as fresh, until the next tap. That is
 * the product's one promise broken without a word.
 *
 * And if anything after the emit failed, the transaction rolled back with
 * every screen already told about a queue that never existed.
 *
 * Runs against the seeded demo database (CLAUDE.md §6), each test on a session
 * of its own.
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { signToken } from '../config/jwt.js';
import { setEmitter, type RealtimeEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';
import * as notificationRepo from '../repositories/notification.repo.js';

import { createQueueFixture, eventTypesOf, type QueueFixture } from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

/**
 * An emitter that, the instant it is asked to tell a session's room anything,
 * asks the database what that session's log holds — on a connection of its
 * own, which can only see what has been committed. That is exactly what a
 * screen subscribing at that instant would read as its catch-up.
 */
class WitnessEmitter implements RealtimeEmitter {
  readonly told: { event: string; committedLog: Promise<string[]> }[] = [];

  constructor(private readonly sessionId: string) {}

  emit(room: string, event: string): void {
    if (room !== ROOMS.session(this.sessionId)) return;
    this.told.push({ event, committedLog: eventTypesOf(this.sessionId) });
  }
}

async function token(): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: {
      sub: fixture.receptionistId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['receptionist'],
    },
  });
}

async function post(path: string, body: Record<string, unknown> = {}) {
  return await request(app)
    .post(`${BASE}${path}`)
    .set('Authorization', `Bearer ${await token()}`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send(body);
}

let witness: WitnessEmitter;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(4);
  witness = new WitnessEmitter(fixture.sessionId);
  setEmitter(witness);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('telling the room', () => {
  it('happens after the write is committed, for every way a counter writes', async () => {
    const calls: [string, Record<string, unknown>][] = [
      [`/sessions/${fixture.sessionId}/arrived`, {}],
      [`/sessions/${fixture.sessionId}/next`, {}],
      [
        `/sessions/${fixture.sessionId}/delay`,
        { minutes: 15, reason: null, declaredBy: 'reception' },
      ],
      [
        '/sync/events',
        {
          sessionId: fixture.sessionId,
          events: [
            {
              clientEventId: crypto.randomUUID(),
              type: 'SESSION_PAUSED',
              payload: { reason: null },
              clientTs: new Date().toISOString(),
            },
          ],
        },
      ],
    ];

    for (const [path, body] of calls) {
      const before = witness.told.length;
      const response = await post(path, body);
      expect(response.status, path).toBe(200);

      const updates = witness.told.slice(before).filter((entry) => entry.event === 'queue.updated');
      expect(updates.length, `${path} told nobody`).toBeGreaterThan(0);

      // What a screen subscribing at the moment of the broadcast would have
      // read is the queue *with* this write in it, not the one before.
      const logWhenTold = await updates[0]?.committedLog;
      const logNow = await eventTypesOf(fixture.sessionId);
      expect(logWhenTold, `${path} was broadcast before it was committed`).toEqual(logNow);
    }
  });

  it('does not happen at all for a write that fails after it was computed', async () => {
    expect((await post(`/sessions/${fixture.sessionId}/arrived`)).status).toBe(200);
    const before = witness.told.length;
    const logBefore = await eventTypesOf(fixture.sessionId);

    // The last step of the transaction fails: the messages cannot be written.
    vi.spyOn(notificationRepo, 'queueAll').mockRejectedValueOnce(new Error('disk full'));

    const response = await post(`/sessions/${fixture.sessionId}/next`);

    expect(response.status).toBe(500);
    // Nothing was written…
    expect(await eventTypesOf(fixture.sessionId)).toEqual(logBefore);
    // …so nobody may have been told that serial 1 was called.
    expect(witness.told.slice(before)).toEqual([]);
  });
});
