/**
 * The queue endpoints (BACKEND.md §7.4).
 *
 * The step's definition of done is "every event type appends, reduces,
 * broadcasts" — so that is what this file checks, and it checks all three for
 * each, not just that the request returned 200. A route that appended without
 * reducing would leave a queue that is right in the log and wrong on every
 * screen; one that reduced without broadcasting would leave every waiting
 * patient's phone stale until they pulled to refresh, which is the one thing
 * this product exists not to do.
 *
 * Tests run against the seeded demo database (CLAUDE.md §6), each on a session
 * of its own — `queue_events` is append-only, so a test cannot clean up after
 * itself and must not share a session with another.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { time } from '@platform/domain';
import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter, type RecordingEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';
import * as queueService from '../services/queue.service.js';

import {
  bookingStatusOf,
  cachedStateOf,
  createQueueFixture,
  eventTypesOf,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let emitted: RecordingEmitter;
let key = 0;

/** A fresh idempotency key per call; replay is tested deliberately, not by accident. */
function idem(): string {
  key += 1;
  return `test-key-${String(key)}-${String(Date.now())}`;
}

/**
 * A staff token scoped to the fixture's hospital.
 *
 * The subject is a **real** seeded staff member. `queue_events.actor_staff_id`
 * is a foreign key, so an invented id is refused by the database — which is
 * the behaviour that makes `FR-QUE-04` hold: an unattributable queue action
 * cannot be recorded at all.
 */
async function staff(
  roles: readonly StaffRole[] = ['receptionist'],
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.receptionistId,
): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub, kind: 'staff', hospitalId, roles },
  });
}

/** `POST` with a staff token and an idempotency key, the way a console calls. */
async function post(
  path: string,
  body: Record<string, unknown> = {},
  token?: string,
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}${path}`)
    .set('Authorization', `Bearer ${token ?? (await staff())}`)
    .set('Idempotency-Key', idem())
    .send(body);
}

/** Drives the session to `running` so the queue guards will let anything happen. */
async function startSession(): Promise<void> {
  const response = await post(`/sessions/${fixture.sessionId}/arrived`);
  expect(response.status).toBe(200);
}

/**
 * Starts the session as though the doctor arrived an hour ago.
 *
 * The no-show grace period runs from the moment a patient's turn arrives,
 * which for the first patient is the doctor's arrival (`FR-QUE-20`). The route
 * stamps that instant itself and cannot be told otherwise — correctly, since a
 * console that could backdate an arrival could also backdate a no-show. So a
 * test that needs the grace to have expired drives the service directly for
 * this one setup step.
 */
async function startSessionAnHourAgo(): Promise<void> {
  const arrivedAt = time.addMinutes(time.fromDate(new Date()), -60);
  await queueService.appendEvent({
    sessionId: fixture.sessionId,
    type: 'DOCTOR_ARRIVED',
    payload: { arrivedAt, minutesLate: 0 },
    actor: {
      kind: 'staff',
      staffUserId: fixture.receptionistId as never,
      role: 'receptionist',
    },
  });
}

beforeEach(async () => {
  app = createApp();
  emitted = resetEmitter();
  fixture = await createQueueFixture(4);
});

describe('GET /sessions/:id/queue', () => {
  it('returns the queue, the ETAs and a freshness stamp', async () => {
    const response = await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/queue`)
      .set('Authorization', `Bearer ${await staff()}`);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.state.entries).toHaveLength(4);
    expect(response.body.data.bookings).toHaveLength(4);
    // FR-OFF-03: a live figure never travels without its age.
    expect(typeof response.body.data.freshAt).toBe('string');
  });

  it('refuses a receptionist from another hospital (FR-ROLE-01)', async () => {
    const elsewhere = await otherHospitalId(fixture.hospitalId);
    const token = await staff(
      ['receptionist'],
      elsewhere,
      await staffIdFor(elsewhere, 'receptionist'),
    );
    const response = await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/queue`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN_SCOPE');
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(app).get(`${BASE}/sessions/${fixture.sessionId}/queue`);
    expect(response.status).toBe(401);
  });
});

describe('every event type appends, reduces and broadcasts', () => {
  it('DOCTOR_ARRIVED starts the session and stamps lateness', async () => {
    const response = await post(`/sessions/${fixture.sessionId}/arrived`);

    expect(response.status).toBe(200);
    expect(await eventTypesOf(fixture.sessionId)).toEqual(['DOCTOR_ARRIVED']);
    // Reduced: the session is running, which the schema only permits with an
    // actual start (`sessions_running_has_started`).
    expect(response.body.data.state.status).toBe('running');
    expect(response.body.data.state.doctorArrivedAt).not.toBeNull();
    // Broadcast.
    expect(emitted.forRoom(ROOMS.session(fixture.sessionId))).toHaveLength(1);
  });

  it('DELAY_DECLARED accumulates and emits its own event', async () => {
    await startSession();
    const response = await post(`/sessions/${fixture.sessionId}/delay`, {
      minutes: 30,
      reason: 'ডাক্তার অস্ত্রোপচারে আছেন',
      declaredBy: 'reception',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.state.delayMinutes).toBe(30);

    const events = emitted.forRoom(ROOMS.session(fixture.sessionId));
    expect(events.map((entry) => entry.event)).toContain('session.delayed');
  });

  it('SESSION_PAUSED and SESSION_RESUMED round-trip', async () => {
    await startSession();
    const paused = await post(`/sessions/${fixture.sessionId}/pause`, { reason: 'নামাজের বিরতি' });
    expect(paused.body.data.state.status).toBe('paused');

    const resumed = await post(`/sessions/${fixture.sessionId}/resume`);
    expect(resumed.body.data.state.status).toBe('running');

    expect(await eventTypesOf(fixture.sessionId)).toEqual([
      'DOCTOR_ARRIVED',
      'SESSION_PAUSED',
      'SESSION_RESUMED',
    ]);
  });

  it('PATIENT_CALLED puts serial 1 in the chamber and targets that patient', async () => {
    await startSession();
    const response = await post(`/sessions/${fixture.sessionId}/next`);

    expect(response.status).toBe(200);
    expect(response.body.data.state.entries[0].status).toBe('in_chamber');
    expect(await bookingStatusOf(fixture.bookingIds[0] ?? '')).toBe('in_chamber');

    const cached = await cachedStateOf(fixture.sessionId);
    expect(cached?.now_serving_serial).toBe(1);

    // `patient.called` is addressed to one person, not the waiting room.
    const targeted = emitted.forRoom(ROOMS.patient(fixture.patientIds[0] ?? ''));
    expect(targeted.map((entry) => entry.event)).toContain('patient.called');
  });

  it('PATIENT_DONE finishes the consultation and measures it', async () => {
    await startSession();
    await post(`/sessions/${fixture.sessionId}/next`);
    const response = await post(`/bookings/${fixture.bookingIds[0] ?? ''}/done`);

    expect(response.status).toBe(200);
    expect(await bookingStatusOf(fixture.bookingIds[0] ?? '')).toBe('done');

    const cached = await cachedStateOf(fixture.sessionId);
    expect(cached?.done_count).toBe(1);
  });

  it('next finishes the current patient and calls the following one', async () => {
    await startSession();
    await post(`/sessions/${fixture.sessionId}/next`);
    const response = await post(`/sessions/${fixture.sessionId}/next`);

    expect(response.status).toBe(200);
    expect(await eventTypesOf(fixture.sessionId)).toEqual([
      'DOCTOR_ARRIVED',
      'PATIENT_CALLED',
      'PATIENT_DONE',
      'PATIENT_CALLED',
    ]);

    const cached = await cachedStateOf(fixture.sessionId);
    expect(cached?.now_serving_serial).toBe(2);
    expect(cached?.done_count).toBe(1);
  });

  it('PATIENT_LATE marks the patient and moves them back (FR-QUE-21)', async () => {
    await startSession();
    const response = await post(`/bookings/${fixture.bookingIds[1] ?? ''}/late`, {
      expectedMinutes: 20,
    });

    expect(response.status).toBe(200);
    expect(await bookingStatusOf(fixture.bookingIds[1] ?? '')).toBe('late');
    expect((await cachedStateOf(fixture.sessionId))?.late_count).toBe(1);
  });

  it('PATIENT_NO_SHOW records the absence once the grace period has run', async () => {
    await startSessionAnHourAgo();
    const front = fixture.bookingIds[0] ?? '';
    const response = await post(`/bookings/${front}/no-show`);

    expect(response.status).toBe(200);
    expect(await bookingStatusOf(front)).toBe('no_show');
    expect((await cachedStateOf(fixture.sessionId))?.no_show_count).toBe(1);
  });

  it('refuses a no-show while the grace period is still running (FR-QUE-20)', async () => {
    await startSession();
    const response = await post(`/bookings/${fixture.bookingIds[0] ?? ''}/no-show`);

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('NO_SHOW_BEFORE_GRACE');
  });

  it('refuses a no-show for a patient whose turn has not come', async () => {
    await startSessionAnHourAgo();
    // Serial 3 is two places back. A patient holding a later serial is not
    // absent at five o'clock — the grace period has no meaning until the queue
    // has actually reached them.
    const response = await post(`/bookings/${fixture.bookingIds[2] ?? ''}/no-show`);

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('NOT_A_NO_SHOW');
  });

  it('PATIENT_REINSERTED brings a late patient back into the line', async () => {
    await startSession();
    await post(`/bookings/${fixture.bookingIds[1] ?? ''}/late`, { expectedMinutes: 20 });
    const response = await post(`/bookings/${fixture.bookingIds[1] ?? ''}/reinstate`);

    expect(response.status).toBe(200);
    expect(await eventTypesOf(fixture.sessionId)).toContain('PATIENT_REINSERTED');
    expect((await cachedStateOf(fixture.sessionId))?.late_count).toBe(0);
  });

  it('WALKIN_ADDED creates the booking and puts it in the queue', async () => {
    await startSession();
    const response = await post(`/sessions/${fixture.sessionId}/walkin`, {
      patientId: fixture.sparePatientId,
      position: 'end',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.state.entries).toHaveLength(5);
    expect(await eventTypesOf(fixture.sessionId)).toContain('WALKIN_ADDED');
  });

  it('refuses a walk-in inserted mid-queue with no reason (FR-REC-14)', async () => {
    await startSession();
    const response = await post(`/sessions/${fixture.sessionId}/walkin`, {
      patientId: fixture.sparePatientId,
      position: 'index',
      index: 0,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('PRIORITY_REORDERED requires a reason and records it (FR-REC-15)', async () => {
    await startSession();

    const refused = await post(`/sessions/${fixture.sessionId}/reorder`, {
      bookingId: fixture.bookingIds[2],
      toIndex: 0,
    });
    expect(refused.status).toBe(400);

    const accepted = await post(`/sessions/${fixture.sessionId}/reorder`, {
      bookingId: fixture.bookingIds[2],
      toIndex: 0,
      reason: 'বয়স্ক রোগী',
    });
    expect(accepted.status).toBe(200);
    expect(await eventTypesOf(fixture.sessionId)).toContain('PRIORITY_REORDERED');
  });

  it('SESSION_ENDED closes the chamber and says so', async () => {
    await startSession();
    const response = await post(`/sessions/${fixture.sessionId}/end`, { reason: null });

    expect(response.status).toBe(200);
    expect(response.body.data.state.status).toBe('ended');

    const events = emitted.forRoom(ROOMS.session(fixture.sessionId));
    expect(events.map((entry) => entry.event)).toContain('session.ended');
  });

  it('ACTION_UNDONE nets out the event it compensates (GR-02)', async () => {
    await startSession();
    const called = await post(`/sessions/${fixture.sessionId}/next`);
    const seq = called.body.data.seq as number;
    expect(seq).toBeGreaterThan(0);

    const eventId = await eventIdAtSeq(fixture.sessionId, seq);
    const response = await post(`/events/${eventId}/undo`);

    expect(response.status).toBe(200);
    // The call never happened as far as the state is concerned…
    expect(response.body.data.state.entries[0].status).toBe('booked');
    // …but both events are still in the log. History is never deleted.
    expect(await eventTypesOf(fixture.sessionId)).toEqual([
      'DOCTOR_ARRIVED',
      'PATIENT_CALLED',
      'ACTION_UNDONE',
    ]);
  });
});

describe('guards refuse what the rules forbid', () => {
  it('refuses a second DOCTOR_ARRIVED', async () => {
    await startSession();
    const response = await post(`/sessions/${fixture.sessionId}/arrived`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('QUEUE_GUARD_FAILED');
  });

  it('refuses calling next while someone is still in the chamber', async () => {
    await startSession();
    await post(`/sessions/${fixture.sessionId}/next`);
    // A direct call, rather than `next`, is the console action that would skip
    // a patient without marking them done.
    const response = await post(`/bookings/${fixture.bookingIds[2] ?? ''}/done`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('QUEUE_GUARD_FAILED');
  });

  it('refuses any further event once the session has ended', async () => {
    await startSession();
    await post(`/sessions/${fixture.sessionId}/end`, { reason: null });
    const response = await post(`/sessions/${fixture.sessionId}/next`);

    expect(response.status).toBe(422);
  });

  it('refuses a delay longer than the documented maximum', async () => {
    await startSession();
    const response = await post(`/sessions/${fixture.sessionId}/delay`, {
      minutes: 10_000,
      reason: null,
      declaredBy: 'reception',
    });

    expect(response.status).toBe(400);
  });
});

describe('the auth matrix for the queue (FR-ROLE-01, FR-ROLE-02)', () => {
  it('lets a doctor call next but not mark a no-show', async () => {
    await startSession();
    const doctor = await staff(['doctor'], fixture.hospitalId, fixture.doctorStaffId);

    const next = await post(`/sessions/${fixture.sessionId}/next`, {}, doctor);
    expect(next.status).toBe(200);

    const noShow = await post(`/bookings/${fixture.bookingIds[2] ?? ''}/no-show`, {}, doctor);
    expect(noShow.status).toBe(403);
  });

  it('refuses a lab or pharmacy role outright', async () => {
    for (const role of ['lab', 'pharmacy', 'ward'] as const) {
      const response = await post(
        `/sessions/${fixture.sessionId}/arrived`,
        {},
        await staff([role], fixture.hospitalId, await staffIdFor(fixture.hospitalId, role)),
      );
      expect(response.status).toBe(403);
    }
  });

  it('refuses a receptionist from another hospital', async () => {
    const elsewhere = await otherHospitalId(fixture.hospitalId);
    const response = await post(
      `/sessions/${fixture.sessionId}/arrived`,
      {},
      await staff(['receptionist'], elsewhere, await staffIdFor(elsewhere, 'receptionist')),
    );

    expect(response.status).toBe(403);
  });

  it('demands an idempotency key on every write (FR-QUE-51)', async () => {
    const response = await request(app)
      .post(`${BASE}/sessions/${fixture.sessionId}/arrived`)
      .set('Authorization', `Bearer ${await staff()}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('replay is safe (SY-02)', () => {
  it('returns the stored result rather than advancing the queue twice', async () => {
    await startSession();
    const clientEventId = crypto.randomUUID();

    const first = await post(`/sessions/${fixture.sessionId}/next`, { clientEventId });
    expect(first.status).toBe(200);
    expect(first.body.data.duplicate).toBe(false);

    const replayed = await post(`/sessions/${fixture.sessionId}/next`, { clientEventId });
    expect(replayed.status).toBe(200);
    expect(replayed.body.data.duplicate).toBe(true);

    // One call, not two: the queue did not move on the replay.
    const types = await eventTypesOf(fixture.sessionId);
    expect(types.filter((type) => type === 'PATIENT_CALLED')).toHaveLength(1);
    expect((await cachedStateOf(fixture.sessionId))?.now_serving_serial).toBe(1);
  });
});

/** The id of the event at a given sequence number, for the undo test. */
async function eventIdAtSeq(sessionId: string, seq: number): Promise<string> {
  const { db } = await import('../config/db.js');
  const { sql } = await import('kysely');
  const result = await sql<{ id: string }>`
    SELECT id FROM queue_events WHERE session_id = ${sessionId} AND seq = ${String(seq)}::bigint
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`no event at seq ${String(seq)}`);
  return id;
}
