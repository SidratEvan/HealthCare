/**
 * Offering a freed chair to the standby list (`FR-QUE-30`, `FR-REC-30`).
 *
 * What is proven here and nowhere else:
 *
 *   - **A chair is only offered when it is genuinely empty.** A patient who is
 *     merely late still holds their place (`FR-QUE-21`), and the commonest way
 *     this feature could hurt somebody is by giving away the seat of a person
 *     stuck in traffic outside.
 *   - **One chair, one offer.** Two outstanding offers against one slot is two
 *     people told to come in and one of them turned away at the counter.
 *   - **Two counters cannot offer the same chair to the same person.** Five
 *     simultaneous offers take five different people off the list, or fail —
 *     never the same person twice.
 *   - **An expired offer cannot be accepted**, even though nothing sweeps the
 *     table on a timer.
 *   - **The recovered value is recorded**, because `FR-ADM-03`'s figure is
 *     built from it and a recovery nobody wrote down is a recovery the
 *     dashboard cannot report.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import {
  createQueueFixture,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';
import { bearer, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let reception: string;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(4);
  reception = await staff(['receptionist']);
});

/**
 * A staff token whose subject is a real `staff_users` row.
 *
 * `queue_events.actor_staff_id` is a foreign key, so an event can only ever be
 * attributed to somebody who exists (`FR-QUE-04`). A token minted for an
 * invented id is refused by the database — correctly — which is why the
 * subject comes from the seeded roster rather than from a constant.
 */
async function staff(
  roles: readonly StaffRole[],
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.receptionistId,
): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub, kind: 'staff', hospitalId, roles },
  });
}

/** Puts a seeded patient on this session's standby list. */
async function addStandby(patientId: string, position: number): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO standby_list (session_id, patient_id, contact_phone, position)
    VALUES (${fixture.sessionId}, ${patientId}, '+8801712345678', ${position})
    RETURNING id
  `.execute(db);

  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('standby insert returned no id');
  return id;
}

/** Opens the chamber and cancels serial 2, so a chair is free. */
async function freeAChair(): Promise<string> {
  const freed = fixture.bookingIds[1];
  if (freed === undefined) throw new Error('the fixture should hold four bookings');

  await request(app)
    .post(`${BASE}/sessions/${fixture.sessionId}/arrived`)
    .set('Authorization', bearer(reception))
    .set('Idempotency-Key', randomUUID())
    .send({})
    .expect(200);

  await request(app)
    .post(`${BASE}/bookings/${freed}/cancel`)
    .set('Authorization', bearer(reception))
    .set('Idempotency-Key', randomUUID())
    .send({ reason: 'patient cancelled' })
    .expect(200);

  return freed;
}

async function offer(bookingId: string): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/bookings/${bookingId}/offer-slot`)
    .set('Authorization', bearer(reception))
    .set('Idempotency-Key', randomUUID())
    .send({});
}

/**
 * Moves the clock past the acceptance window.
 *
 * Not an UPDATE on `slot_offers`. The deadline the guard reads comes from the
 * `SLOT_OFFERED` event's payload, because the log is the source of truth and
 * `trg_queue_events_no_mutate` makes sure it stays that way — so editing the
 * row would change the projection and leave the guard reading the original
 * deadline, which is exactly the disagreement the log exists to prevent.
 *
 * Only `Date` is faked. `setTimeout` is left real, so the database driver's
 * own timers keep working.
 */
function passTime(minutes: number): void {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now + minutes * 60_000));
}

afterEach(() => {
  vi.useRealTimers();
});

async function pendingOfferId(): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM slot_offers
     WHERE session_id = ${fixture.sessionId} AND accepted_at IS NULL
     ORDER BY offered_at DESC LIMIT 1
  `.execute(db);

  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('no offer was written');
  return id;
}

describe('who may offer a chair (FR-ROLE-01)', () => {
  it('is reception, and not a patient', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);

    await request(app)
      .post(`${BASE}/bookings/${freed}/offer-slot`)
      .set('Authorization', bearer(await patientToken()))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const freed = await freeAChair();

    await request(app)
      .post(`${BASE}/bookings/${freed}/offer-slot`)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(401);
  });

  it('refuses a receptionist from another hospital', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);

    const elsewhere = await otherHospitalId(fixture.hospitalId);

    await request(app)
      .post(`${BASE}/bookings/${freed}/offer-slot`)
      .set(
        'Authorization',
        bearer(
          await staff(['receptionist'], elsewhere, await staffIdFor(elsewhere, 'receptionist')),
        ),
      )
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
  });

  it('demands an idempotency key', async () => {
    const freed = await freeAChair();

    await request(app)
      .post(`${BASE}/bookings/${freed}/offer-slot`)
      .set('Authorization', bearer(reception))
      .send({})
      .expect(400);
  });
});

describe('which chairs may be offered', () => {
  it('offers a cancelled chair to the person at the top of the list', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);

    const response = await offer(freed);
    expect(response.status).toBe(200);

    const rows = await sql<{ offered_to_patient_id: string; expires_at: Date }>`
      SELECT offered_to_patient_id, expires_at FROM slot_offers
       WHERE session_id = ${fixture.sessionId}
    `.execute(db);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.offered_to_patient_id).toBe(fixture.sparePatientId);
    expect(rows.rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses to give away the chair of somebody merely running late', async () => {
    // `FR-QUE-21` keeps a late patient's place. This is the failure that would
    // actually cost a person their turn, so it is checked against the API and
    // not only against the domain guard.
    await addStandby(fixture.sparePatientId, 1);
    const late = fixture.bookingIds[2];
    if (late === undefined) throw new Error('the fixture should hold four bookings');

    await request(app)
      .post(`${BASE}/sessions/${fixture.sessionId}/arrived`)
      .set('Authorization', bearer(reception))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);

    await request(app)
      .post(`${BASE}/bookings/${late}/late`)
      .set('Authorization', bearer(reception))
      .set('Idempotency-Key', randomUUID())
      .send({ expectedMinutes: 20 })
      .expect(200);

    const response = await offer(late);

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('SLOT_NOT_FREE');
  });

  it('refuses a chair somebody is still waiting in', async () => {
    await addStandby(fixture.sparePatientId, 1);
    const waiting = fixture.bookingIds[3];
    if (waiting === undefined) throw new Error('the fixture should hold four bookings');

    const response = await offer(waiting);

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('SLOT_NOT_FREE');
  });

  it('says so plainly when nobody is on the standby list', async () => {
    // The ordinary state of most chambers, and not an error worth a stack
    // trace. The console shows a free chair with nobody to give it to.
    const freed = await freeAChair();

    const response = await offer(freed);

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('NO_STANDBY');
  });

  it('refuses a second outstanding offer against one chair', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    await addStandby(fixture.patientIds[0] ?? '', 2);

    await offer(freed);
    const second = await offer(freed);

    expect(second.status).toBe(422);
    expect(second.body.error.details.guard).toBe('OFFER_OUTSTANDING');
  });
});

describe('two counters at once', () => {
  it('never offers two chairs to the same person', async () => {
    // Two receptionists settling two rows in the same instant. Without
    // `FOR UPDATE SKIP LOCKED` both read position 1 and both offer that
    // patient a chair, which covers one seat twice and never asks the next
    // person on the list at all.
    await freeAChair();

    const second = fixture.bookingIds[2];
    if (second === undefined) throw new Error('the fixture should hold four bookings');
    await request(app)
      .post(`${BASE}/bookings/${second}/cancel`)
      .set('Authorization', bearer(reception))
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'patient cancelled' })
      .expect(200);

    await addStandby(fixture.sparePatientId, 1);
    await addStandby(fixture.patientIds[0] ?? '', 2);

    const freed = fixture.bookingIds[1];
    if (freed === undefined) throw new Error('the fixture should hold four bookings');

    await Promise.all([offer(freed), offer(second)]);

    const rows = await sql<{ offered_to_patient_id: string }>`
      SELECT offered_to_patient_id FROM slot_offers WHERE session_id = ${fixture.sessionId}
    `.execute(db);

    const offeredTo = rows.rows.map((row) => row.offered_to_patient_id);
    expect(new Set(offeredTo).size).toBe(offeredTo.length);
  });
});

describe('accepting a chair', () => {
  it('seats the patient, records the recovered value and clears the list', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    await offer(freed);
    const offerId = await pendingOfferId();

    const response = await request(app)
      .post(`${BASE}/offers/${offerId}/accept`)
      .set('Authorization', bearer(reception))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);

    expect(response.body.data.state.entries).toHaveLength(5);

    // `FR-ADM-03`'s figure is built from this column. A chair recovered and
    // not written down is a recovery the dashboard cannot report.
    const settled = await sql<{ recovered_value_poisha: number; accepted_at: Date | null }>`
      SELECT recovered_value_poisha, accepted_at FROM slot_offers WHERE id = ${offerId}
    `.execute(db);

    expect(settled.rows[0]?.accepted_at).not.toBeNull();
    expect(settled.rows[0]?.recovered_value_poisha).toBe(fixture.feePoisha);

    // Off the list: somebody holding a chair is not still waiting for one.
    const remaining = await sql<{ count: string }>`
      SELECT count(*)::text FROM standby_list
       WHERE session_id = ${fixture.sessionId} AND removed_at IS NULL
    `.execute(db);
    expect(remaining.rows[0]?.count).toBe('0');
  });

  it('reissues the cancelled serial rather than appending to the end', async () => {
    // The chair that opened was serial 2 and the chamber has not reached it,
    // so the standby patient takes exactly the slot that came free.
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    await offer(freed);

    await request(app)
      .post(`${BASE}/offers/${await pendingOfferId()}/accept`)
      .set('Authorization', bearer(reception))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);

    const seated = await sql<{ serial_number: number }>`
      SELECT serial_number FROM bookings
       WHERE session_id = ${fixture.sessionId} AND patient_id = ${fixture.sparePatientId}
         AND status <> 'cancelled'
    `.execute(db);

    expect(seated.rows[0]?.serial_number).toBe(2);
  });

  it('refuses an offer whose window has closed', async () => {
    // Nothing sweeps the table on a timer, so the row still reads as pending.
    // The refusal is on the clock, not on the absence of a SLOT_EXPIRED event.
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    await offer(freed);
    const offerId = await pendingOfferId();

    passTime(11);

    const response = await request(app)
      .post(`${BASE}/offers/${offerId}/accept`)
      .set('Authorization', bearer(reception))
      .set('Idempotency-Key', randomUUID())
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('OFFER_EXPIRED');
  });

  it('gives one chair to one person when two accepts race', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    await offer(freed);
    const offerId = await pendingOfferId();

    const responses = await Promise.all(
      Array.from(
        { length: 3 },
        async () =>
          await request(app)
            .post(`${BASE}/offers/${offerId}/accept`)
            .set('Authorization', bearer(reception))
            .set('Idempotency-Key', randomUUID())
            .send({}),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);

    const seated = await sql<{ count: string }>`
      SELECT count(*)::text FROM bookings
       WHERE session_id = ${fixture.sessionId} AND patient_id = ${fixture.sparePatientId}
         AND status <> 'cancelled'
    `.execute(db);
    expect(seated.rows[0]?.count).toBe('1');
  });

  it('refuses an offer that does not exist', async () => {
    await request(app)
      .post(`${BASE}/offers/${randomUUID()}/accept`)
      .set('Authorization', bearer(reception))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(404);
  });
});

describe('the standby panel (GET /sessions/:id/standby)', () => {
  it('lists who is waiting and what has been offered, without a phone number', async () => {
    // Reception does not need the number to give a chair away — the SMS does
    // that — and an endpoint that returns one is an endpoint that will end up
    // in a log (`CLAUDE.md` §7).
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    await offer(freed);

    const response = await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/standby`)
      .set('Authorization', bearer(reception))
      .expect(200);

    expect(response.body.data.waiting).toHaveLength(1);
    expect(response.body.data.offers).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain('+8801712345678');
  });

  it('records a lapsed offer as it answers, so the chair can be offered again', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    await offer(freed);

    passTime(11);

    await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/standby`)
      .set('Authorization', bearer(reception))
      .expect(200);

    const events = await sql<{ count: string }>`
      SELECT count(*)::text FROM queue_events
       WHERE session_id = ${fixture.sessionId} AND type = 'SLOT_EXPIRED'
    `.execute(db);
    expect(events.rows[0]?.count).toBe('1');

    // And the chair is free to offer again, which is what "unaccepted offers
    // pass to the next patient" means in practice.
    await addStandby(fixture.patientIds[0] ?? '', 2);
    const again = await offer(freed);
    expect(again.status).toBe(200);
  });

  it('passes a lapsed chair to the next person, not back to the one who did not answer', async () => {
    // `FR-QUE-30`: "unaccepted offers pass to the next patient". Ordering on
    // position alone handed the re-offer straight back to position 1.
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);
    const next = fixture.patientIds[0] ?? '';
    await addStandby(next, 2);
    await offer(freed);

    passTime(11);

    await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/standby`)
      .set('Authorization', bearer(reception))
      .expect(200);

    expect((await offer(freed)).status).toBe(200);

    const latest = await sql<{ offered_to_patient_id: string }>`
      SELECT offered_to_patient_id FROM slot_offers
       WHERE session_id = ${fixture.sessionId}
       ORDER BY offered_at DESC LIMIT 1
    `.execute(db);
    expect(latest.rows[0]?.offered_to_patient_id).toBe(next);
  });

  it('is readable by an administrator, who is shown the figure built from it', async () => {
    const response = await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/standby`)
      .set(
        'Authorization',
        bearer(
          await staff(
            ['hospital_admin'],
            fixture.hospitalId,
            await staffIdFor(fixture.hospitalId, 'hospital_admin'),
          ),
        ),
      )
      .expect(200);

    expect(response.body.ok).toBe(true);
  });

  it('is not readable by a patient', async () => {
    await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/standby`)
      .set('Authorization', bearer(await patientToken()))
      .expect(403);
  });
});

describe('the standby patient is told', () => {
  it('writes an SMS to the number on the standby row (FR-QUE-30, FR-NOT-03)', async () => {
    const freed = await freeAChair();
    await addStandby(fixture.sparePatientId, 1);

    // The API suite runs against one shared, deliberately un-cleaned database
    // (see `docs/STATUS.md`), and the seeds reuse patients across sessions. So
    // the query is scoped to the instant this offer was made rather than to
    // the patient, who has had other messages in other tests.
    const since = new Date();
    await offer(freed);

    const messages = await sql<{ phone: string | null; state: string; template_key: string }>`
      SELECT phone, state::text, template_key FROM notifications
       WHERE template_key = 'queue.slot_offered'
         AND recipient_patient_id = ${fixture.sparePatientId}
         AND created_at >= ${since}
    `.execute(db);

    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0]?.phone).toBe('+8801712345678');
    expect(messages.rows[0]?.state).toBe('sent');
  });
});
