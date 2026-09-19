/**
 * The offline sync protocol, end to end (BACKEND.md §5).
 *
 * Step 8's definition of done is "offline actions queue and sync on
 * reconnect", and this is the server half of proving it. Every `SY-*` rule
 * gets a test, because each of them is a promise to a receptionist who has
 * been working on a dead network for twenty minutes and is about to find out
 * whether the last twenty minutes counted.
 *
 * Runs against the seeded demo database (CLAUDE.md §6), each test on a session
 * of its own — `queue_events` is append-only and cannot be cleaned up.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { time } from '@platform/domain';
import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import * as queueService from '../services/queue.service.js';
import { MAX_OFFLINE_HOURS, requiresFullResync } from '../services/sync.service.js';

import {
  createQueueFixture,
  eventTypesOf,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';
import { guestToken, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

/**
 * A staff token bound to a real seeded staff member.
 *
 * `queue_events.actor_staff_id` is a foreign key, so an event can only be
 * attributed to somebody who exists (`FR-QUE-04`). A token minted for an
 * invented id is refused by the database — correctly.
 */
async function staff(
  roles: readonly StaffRole[] = ['receptionist'],
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.receptionistId,
): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub, kind: 'staff', hospitalId, roles } });
}

/** A receptionist at the fixture's own hospital. */
async function receptionist(): Promise<string> {
  return await staff();
}

/** A batch entry with a fresh key, since `clientEventId` must be unique. */
function entry(
  type: string,
  payload: Record<string, unknown>,
  clientTs: string | null,
  key?: string,
): Record<string, unknown> {
  return {
    clientEventId: key ?? crypto.randomUUID(),
    type,
    payload,
    clientTs,
  };
}

/** Minutes before now, as an ISO instant the console would have stamped. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** A receptionist at a different facility, for the scope matrix. */
async function elsewhereToken(): Promise<string> {
  const hospitalId = await otherHospitalId(fixture.hospitalId);
  return await staff(['receptionist'], hospitalId, await staffIdFor(hospitalId, 'receptionist'));
}

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(5);
});

describe('the auth matrix', () => {
  it('refuses an unauthenticated push', async () => {
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .send({ sessionId: fixture.sessionId, events: [entry('DOCTOR_ARRIVED', {}, null)] });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('refuses a patient token', async () => {
    // Sync is a console protocol. A patient's app reads the session channel
    // and has no offline queue to replay, so there is no reason for a patient
    // token to reach it — and a narrower door is a better one.
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await patientToken()}`)
      .send({ sessionId: fixture.sessionId, events: [entry('DOCTOR_ARRIVED', {}, null)] });

    expect(response.status).toBe(403);
  });

  it('refuses a guest tracking link', async () => {
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await guestToken()}`)
      .send({ sessionId: fixture.sessionId, events: [entry('DOCTOR_ARRIVED', {}, null)] });

    expect(response.status).toBe(403);
  });

  it('refuses staff from another hospital (FR-ROLE-01)', async () => {
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await elsewhereToken()}`)
      .send({ sessionId: fixture.sessionId, events: [entry('DOCTOR_ARRIVED', {}, null)] });

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('wrong_hospital');
  });

  it('admits a doctor as well as a receptionist', async () => {
    // A doctor's console queues offline exactly as reception's does. Refusing
    // its replay would strand them with a shift of unsent work.
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set(
        'Authorization',
        `Bearer ${await staff(['doctor'], fixture.hospitalId, await staffIdFor(fixture.hospitalId, 'doctor'))}`,
      )
      .send({
        sessionId: fixture.sessionId,
        events: [
          entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(5), minutesLate: 5 }, minutesAgo(5)),
        ],
      });

    expect(response.status).toBe(200);
  });

  it('refuses the same push on a session that does not exist', async () => {
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await receptionist()}`)
      .send({
        sessionId: '99999999-9999-7999-8999-999999999999',
        events: [entry('DOCTOR_ARRIVED', {}, null)],
      });

    expect(response.status).toBe(404);
  });
});

describe('SY-01: the server decides order, the client only orders its own batch', () => {
  it('applies a batch in client-timestamp order regardless of array order', async () => {
    // The console recorded "doctor arrived", then called serial 1. Sent in the
    // wrong order — a retry that reassembled the queue badly — the result must
    // still be the sequence the receptionist actually acted in.
    const arrived = entry(
      'DOCTOR_ARRIVED',
      { arrivedAt: minutesAgo(20), minutesLate: 3 },
      minutesAgo(20),
    );
    const called = entry(
      'PATIENT_CALLED',
      { bookingId: fixture.bookingIds[0], serial: 1 },
      minutesAgo(18),
    );

    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await receptionist()}`)
      // Deliberately reversed.
      .send({ sessionId: fixture.sessionId, events: [called, arrived] });

    expect(response.status).toBe(200);
    expect(response.body.data.conflicts).toEqual([]);

    // Had they applied in array order, PATIENT_CALLED would have been refused:
    // you cannot call a patient before the doctor has arrived.
    const types = await eventTypesOf(fixture.sessionId);
    expect(types).toEqual(['DOCTOR_ARRIVED', 'PATIENT_CALLED']);
  });

  it('gives the server sequence back for each accepted entry', async () => {
    const first = entry(
      'DOCTOR_ARRIVED',
      { arrivedAt: minutesAgo(10), minutesLate: 0 },
      minutesAgo(10),
    );

    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await receptionist()}`)
      .send({ sessionId: fixture.sessionId, events: [first] });

    const accepted = response.body.data.accepted;
    expect(accepted).toHaveLength(1);
    expect(accepted[0].clientEventId).toBe(first['clientEventId']);
    expect(accepted[0].seq).toBeGreaterThan(0);
  });
});

describe('SY-02: a replayed batch is safe', () => {
  it('applies a repeated batch exactly once', async () => {
    const batch = {
      sessionId: fixture.sessionId,
      events: [
        entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(15), minutesLate: 2 }, minutesAgo(15)),
        entry('PATIENT_CALLED', { bookingId: fixture.bookingIds[0], serial: 1 }, minutesAgo(14)),
      ],
    };

    const token = await receptionist();
    const first = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send(batch);

    // The console never saw the response — dropped connection — and sends again.
    const second = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send(batch);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // Reported as accepted both times, with the same sequence numbers: from
    // the console's point of view the actions succeeded, which they did.
    expect(second.body.data.conflicts).toEqual([]);
    expect(second.body.data.accepted).toEqual(first.body.data.accepted);

    // And the log grew once.
    const types = await eventTypesOf(fixture.sessionId);
    expect(types).toEqual(['DOCTOR_ARRIVED', 'PATIENT_CALLED']);
  });

  it('refuses a batch that names one key twice', async () => {
    // Not a replay — a console that has lost track of its own queue. Applying
    // one and reporting both as accepted would say everything is fine while an
    // action has vanished.
    const key = crypto.randomUUID();
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await receptionist()}`)
      .send({
        sessionId: fixture.sessionId,
        events: [
          entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(9), minutesLate: 0 }, minutesAgo(9), key),
          entry('SESSION_PAUSED', { reason: null }, minutesAgo(8), key),
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('SY-03: a conflict rolls back one row, not the batch', () => {
  it('keeps the valid entries and reports only the one that lost', async () => {
    const token = await receptionist();

    // Another counter got there first: the doctor is already marked arrived
    // and serial 1 already called and finished.
    const actor = {
      kind: 'staff' as const,
      staffUserId: fixture.receptionistId as never,
      role: 'receptionist' as const,
    };
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: minutesAgo(30), minutesLate: 0 },
      actor,
    });

    // This console was offline and queued its own "doctor arrived" plus a
    // pause. The arrival loses; the pause is still perfectly valid.
    const stale = entry(
      'DOCTOR_ARRIVED',
      { arrivedAt: minutesAgo(25), minutesLate: 0 },
      minutesAgo(25),
    );
    const pause = entry('SESSION_PAUSED', { reason: 'নামাজের বিরতি' }, minutesAgo(20));

    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: fixture.sessionId, events: [stale, pause] });

    expect(response.status).toBe(200);

    // Four of five actions are usually still good. Failing the whole batch
    // would throw away work and leave her retyping it.
    expect(response.body.data.conflicts).toHaveLength(1);
    expect(response.body.data.conflicts[0].clientEventId).toBe(stale['clientEventId']);
    expect(response.body.data.conflicts[0].reason).toBeTruthy();

    expect(response.body.data.accepted).toHaveLength(1);
    expect(response.body.data.accepted[0].clientEventId).toBe(pause['clientEventId']);

    const types = await eventTypesOf(fixture.sessionId);
    expect(types).toEqual(['DOCTOR_ARRIVED', 'SESSION_PAUSED']);
  });

  it('returns the authoritative state so the loser can reconcile (SY-05)', async () => {
    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${await receptionist()}`)
      .send({
        sessionId: fixture.sessionId,
        events: [
          entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(5), minutesLate: 1 }, minutesAgo(5)),
        ],
      });

    const data = response.body.data;

    // The whole SY-05 shape, so a console never has to guess what it got.
    expect(data).toHaveProperty('accepted');
    expect(data).toHaveProperty('conflicts');
    expect(data).toHaveProperty('state');
    expect(data).toHaveProperty('etas');
    expect(data.state.status).toBe('running');
    expect(data.state.entries).toHaveLength(5);
  });
});

describe('SY-04: bookings made while offline are never dropped', () => {
  it('surfaces a booking created during the outage in the pulled state', async () => {
    const token = await receptionist();

    const before = await request(app)
      .get(`${BASE}/sync/session/${fixture.sessionId}?sinceSeq=1&lastSyncedAt=${minutesAgo(5)}`)
      .set('Authorization', `Bearer ${token}`);
    const countBefore = before.body.data.state.entries.length;

    // Somebody booked online while this console had no network.
    await queueService.createWalkinBooking({
      sessionId: fixture.sessionId,
      patientId: fixture.sparePatientId,
      feePoisha: fixture.feePoisha,
      staffUserId: fixture.receptionistId,
    });

    const after = await request(app)
      .get(`${BASE}/sync/session/${fixture.sessionId}?sinceSeq=1&lastSyncedAt=${minutesAgo(5)}`)
      .set('Authorization', `Bearer ${token}`);

    // It arrives as a new row in the queue rather than needing an event of its
    // own: the state is derived from the roster plus the log, so a booking
    // cannot fail to appear (FR-QUE-52).
    expect(after.body.data.state.entries).toHaveLength(countBefore + 1);
  });
});

describe('SY-06: a device too far behind starts over', () => {
  it('forces a re-pull past the offline window', () => {
    const now = new Date().toISOString();
    const longAgo = new Date(Date.now() - (MAX_OFFLINE_HOURS + 1) * 3_600_000).toISOString();
    const recently = new Date(Date.now() - 60_000).toISOString();

    expect(requiresFullResync(10, longAgo, now)).toBe(true);
    expect(requiresFullResync(10, recently, now)).toBe(false);
  });

  it('treats a device that has never synced as needing everything', () => {
    const now = new Date().toISOString();
    expect(requiresFullResync(0, now, now)).toBe(true);
    expect(requiresFullResync(10, null, now)).toBe(true);
  });

  it('sends no events when it forces a re-pull, only the state', async () => {
    const token = await receptionist();

    await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionId: fixture.sessionId,
        events: [
          entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(3), minutesLate: 0 }, minutesAgo(3)),
        ],
      });

    const longAgo = new Date(Date.now() - (MAX_OFFLINE_HOURS + 2) * 3_600_000).toISOString();
    const response = await request(app)
      .get(`${BASE}/sync/session/${fixture.sessionId}?sinceSeq=1&lastSyncedAt=${longAgo}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.fullResync).toBe(true);
    // Sending a day of log to a device that must discard it is the opposite of
    // what the rule is for.
    expect(response.body.data.events).toEqual([]);
    expect(response.body.data.state).toBeTruthy();
  });
});

describe('the missed-events pull', () => {
  it('returns only what came after the sequence the device reported', async () => {
    const token = await receptionist();

    const first = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionId: fixture.sessionId,
        events: [
          entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(12), minutesLate: 0 }, minutesAgo(12)),
        ],
      });

    const afterFirst = first.body.data.accepted[0].seq;

    await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionId: fixture.sessionId,
        events: [entry('SESSION_PAUSED', { reason: null }, minutesAgo(10))],
      });

    const response = await request(app)
      .get(
        `${BASE}/sync/session/${fixture.sessionId}?sinceSeq=${String(afterFirst)}&lastSyncedAt=${minutesAgo(11)}`,
      )
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.fullResync).toBe(false);
    const events = response.body.data.events as { type: string }[];
    expect(events.map((event) => event.type)).toEqual(['SESSION_PAUSED']);
  });

  it('carries a server timestamp for the freshness line (FR-OFF-03)', async () => {
    const response = await request(app)
      .get(`${BASE}/sync/session/${fixture.sessionId}?sinceSeq=1&lastSyncedAt=${minutesAgo(2)}`)
      .set('Authorization', `Bearer ${await receptionist()}`);

    expect(response.body.data.serverTs).toBeTruthy();
    expect(time.toEpochMs(response.body.data.serverTs)).toBeGreaterThan(0);
  });
});

describe('an implausible measurement', () => {
  it('clamps a consultation the console measured overnight, rather than failing', async () => {
    // A receptionist who forgets to mark somebody done before going home
    // leaves that row in the chamber. The next tap measures fourteen hours,
    // which `bookings_consult_seconds_plausible` refuses outright — and the
    // whole batch used to die with it.
    const token = await receptionist();
    const [one] = fixture.bookingIds;

    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionId: fixture.sessionId,
        events: [
          entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(60), minutesLate: 0 }, minutesAgo(60)),
          entry('PATIENT_CALLED', { bookingId: one, serial: 1 }, minutesAgo(59)),
          entry('PATIENT_DONE', { bookingId: one, consultSeconds: 50_400 }, minutesAgo(1)),
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.conflicts).toEqual([]);

    // The action survives — it really happened — and only the duration is
    // brought inside what a consultation can plausibly be.
    const state = response.body.data.state as { rate: { samples: number[] } };
    expect(state.rate.samples).toEqual([3600]);
  });
});

describe('a whole offline shift', () => {
  it('replays five queued actions in order and leaves a coherent queue', async () => {
    // The scenario CLAUDE.md §6 names for e2e/offline-console.spec.ts, proven
    // here at the protocol level first: go offline, act five times, reconnect.
    const token = await receptionist();
    const [one, two] = fixture.bookingIds;

    const batch = [
      entry('DOCTOR_ARRIVED', { arrivedAt: minutesAgo(50), minutesLate: 5 }, minutesAgo(50)),
      entry('PATIENT_CALLED', { bookingId: one, serial: 1 }, minutesAgo(48)),
      entry('PATIENT_DONE', { bookingId: one, consultSeconds: 600 }, minutesAgo(38)),
      entry('PATIENT_CALLED', { bookingId: two, serial: 2 }, minutesAgo(37)),
      entry('PATIENT_DONE', { bookingId: two, consultSeconds: 540 }, minutesAgo(28)),
    ];

    const response = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: fixture.sessionId, events: batch });

    expect(response.status).toBe(200);
    expect(response.body.data.conflicts).toEqual([]);
    expect(response.body.data.accepted).toHaveLength(5);

    const types = await eventTypesOf(fixture.sessionId);
    expect(types).toEqual([
      'DOCTOR_ARRIVED',
      'PATIENT_CALLED',
      'PATIENT_DONE',
      'PATIENT_CALLED',
      'PATIENT_DONE',
    ]);

    // Two seen, three still waiting — and the rate is now measured from the
    // two real consultations rather than the doctor's configured default,
    // which is what makes the ETA on every waiting phone worth showing.
    const state = response.body.data.state as {
      entries: { status: string }[];
      rate: { samples: number[] };
    };
    expect(state.entries.filter((entry) => entry.status === 'done')).toHaveLength(2);
    expect(state.rate.samples).toEqual([600, 540]);
  });
});
