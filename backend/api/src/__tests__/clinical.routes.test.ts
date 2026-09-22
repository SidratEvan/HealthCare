/**
 * The clinical record (BACKEND.md §7.6, `FR-DOC-03`, `FR-DOC-08`, `FR-DOC-10`).
 *
 * This file carries more weight than its length suggests, because these are the
 * first endpoints in the API where the answer to "may I read this" is not a
 * role. `FR-DOC-10` is a *relationship* — has this patient been in a chamber
 * here, or did they consent — so the permission cannot be read off the route
 * table, and the matrix that would otherwise have been documented by a
 * `requireRole` line is documented here instead.
 *
 * Three things get asserted harder than the rest:
 *
 *   - **a guest tracking link is not consent to a medical history.** It is a
 *     capability token for one booking's queue position (`FR-GST-05`), and
 *     conflating the two would make an SMS a key to a record.
 *   - **every read that succeeds leaves an `audit_log` row**, and every read
 *     that is refused leaves none (`DB-P7`, `FR-SEC-03`). A trail with gaps is
 *     worse than no trail, because it looks complete.
 *   - **signing advances the queue exactly once** (`FR-DOC-08`). A doctor on a
 *     bad connection tapping twice must not call two patients.
 *
 * Runs against the seeded demo database (CLAUDE.md §6), each test on a session
 * of its own.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import * as queueService from '../services/queue.service.js';

import {
  createQueueFixture,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';
import { guestToken, patientToken, trackingLink } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(4);
});

/**
 * A staff token whose subject is a **real** seeded account.
 *
 * `visits.created_by` is a foreign key, so an invented id is refused by the
 * database — the same property that makes `FR-QUE-04` hold for queue events.
 */
async function staff(
  roles: readonly StaffRole[] = ['doctor'],
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.doctorStaffId,
): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub, kind: 'staff', hospitalId, roles } });
}

/** Drives the queue until the first serial is in the chamber. */
async function callFirstPatient(): Promise<void> {
  await queueService.appendEvent({
    sessionId: fixture.sessionId,
    type: 'DOCTOR_ARRIVED',
    payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
    actor: { kind: 'staff', staffUserId: fixture.receptionistId as never, role: 'receptionist' },
    clientEventId: crypto.randomUUID(),
  });

  await queueService.callNext({
    sessionId: fixture.sessionId,
    actor: { kind: 'staff', staffUserId: fixture.receptionistId as never, role: 'receptionist' },
    clientEventId: crypto.randomUUID(),
  });
}

/**
 * A patient, and a facility that has never treated them.
 *
 * Both are asked of the database together, and that pairing is the point. The
 * seeded history books 200 patients across six facilities, and this suite's own
 * fixtures book more on every test — so a *fixed* patient eventually has been
 * treated everywhere and the question `FR-DOC-10` answers stops existing for
 * them. Picking the patient and the stranger in one query means the pair is
 * always one the rule can actually be tested on.
 *
 * Throws rather than skipping. If no such pair exists the suite is no longer
 * testing the requirement, and saying so is better than passing quietly.
 */
async function patientAndStrangerHospital(): Promise<{
  patientId: string;
  hospitalId: string;
}> {
  const result = await sql<{ patient_id: string; hospital_id: string }>`
    SELECT p.id AS patient_id, h.id AS hospital_id
      FROM patients p
      CROSS JOIN hospitals h
     WHERE p.deleted_at IS NULL
       AND h.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM staff_roles sr
                    WHERE sr.hospital_id = h.id AND sr.role = 'doctor'
                      AND sr.deleted_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
           JOIN sessions s ON s.id = b.session_id
          WHERE b.patient_id = p.id
            AND s.hospital_id = h.id
            AND b.deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM consents c
          WHERE c.patient_id = p.id
            AND c.hospital_id = h.id
            AND c.revoked_at IS NULL
            AND c.deleted_at IS NULL
       )
     ORDER BY p.created_at
     LIMIT 1
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('No patient/facility pair without a relationship; FR-DOC-10 is untestable.');
  }

  return { patientId: row.patient_id, hospitalId: row.hospital_id };
}

async function auditRowsFor(patientId: string): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*)::text AS n
      FROM audit_log
     WHERE patient_id = ${patientId}::uuid AND action = 'RECORD_VIEW'
  `.execute(db);

  return Number(result.rows[0]?.n ?? '0');
}

// ---------------------------------------------------------------------------

describe('who may read a record (FR-DOC-10)', () => {
  it('refuses an anonymous caller', async () => {
    const response = await request(app).get(
      `${BASE}/patients/${String(fixture.patientIds[0])}/records`,
    );

    expect(response.status).toBe(401);
  });

  it('lets a doctor at the hospital treating them read it', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${await staff(['doctor'])}`);

    expect(response.status).toBe(200);
    expect(response.body.data.patient.fullName).toBeTruthy();
    expect(Array.isArray(response.body.data.visits)).toBe(true);
  });

  it('refuses a doctor at a hospital the patient has never attended', async () => {
    const { patientId, hospitalId } = await patientAndStrangerHospital();
    const token = await staff(['doctor'], hospitalId, await staffIdFor(hospitalId, 'doctor'));

    const response = await request(app)
      .get(`${BASE}/patients/${patientId}/records`)
      .set('authorization', `Bearer ${token}`);

    // No treatment relationship and no consent. A consultant at one facility
    // cannot open the record of somebody who has only ever attended another.
    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('no_treatment_relationship_or_consent');
  });

  it('refuses a receptionist, who has no clinical reason to look', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set(
        'authorization',
        `Bearer ${await staff(['receptionist'], fixture.hospitalId, fixture.receptionistId)}`,
      );

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('role_not_permitted');
  });

  it('does not accept a tracking link as a credential here at all', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${await trackingLink(String(fixture.bookingIds[0]))}`);

    // A tracking link is a `guest`-kind token redeemed through its own path
    // (`FR-GST-05`), and `attachPrincipal` only verifies `access` tokens. So it
    // is refused one layer earlier than the record rule — which is the stronger
    // outcome: an SMS is not a key to a medical history, and it does not even
    // reach the code that would decide.
    expect(response.status).toBe(401);
  });

  it('refuses a guest principal, because a booking is not consent to a history', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${await guestToken()}`);

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('guest_link_is_not_consent');
  });

  it('refuses an account holder reading somebody else', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${await patientToken()}`);

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('not_your_record');
  });

  it('404s a patient who does not exist, before deciding anything else', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/11111111-1111-7111-8111-999999999999/records`)
      .set('authorization', `Bearer ${await staff(['doctor'])}`);

    expect(response.status).toBe(404);
  });
});

describe('every read leaves a mark (DB-P7, FR-SEC-03)', () => {
  it('writes an audit row when a doctor reads a record', async () => {
    const patientId = String(fixture.patientIds[0]);
    const before = await auditRowsFor(patientId);

    await request(app)
      .get(`${BASE}/patients/${patientId}/records`)
      .set('authorization', `Bearer ${await staff(['doctor'])}`);

    expect(await auditRowsFor(patientId)).toBe(before + 1);
  });

  it('writes none when the read was refused', async () => {
    const patientId = String(fixture.patientIds[1]);
    const before = await auditRowsFor(patientId);

    await request(app)
      .get(`${BASE}/patients/${patientId}/records`)
      .set('authorization', `Bearer ${await patientToken()}`);

    // A row claiming a read that never happened would make the trail worse than
    // useless, because it would look complete.
    expect(await auditRowsFor(patientId)).toBe(before);
  });
});

describe('the patient panel (S-B-05, FR-DOC-03)', () => {
  it('returns the pre-visit answers for the booking being consulted on', async () => {
    const response = await request(app)
      .get(
        `${BASE}/patients/${String(fixture.patientIds[0])}/records?booking=${String(fixture.bookingIds[0])}`,
      )
      .set('authorization', `Bearer ${await staff(['doctor'])}`);

    expect(response.status).toBe(200);

    // The fixture's booking carries only the demo marker, so the honest answer
    // is "not asked" — which is what the screen must say rather than implying
    // the patient declared no allergies.
    const intake = response.body.data.intake as { asked: boolean; allergiesBn: string[] };
    expect(intake).not.toBeNull();
    expect(intake.asked).toBe(false);
    expect(intake.allergiesBn).toEqual([]);
  });

  it('omits the intake when no booking was named', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${await staff(['doctor'])}`);

    expect(response.body.data.intake).toBeNull();
  });

  it('reads a seeded history that carries follow-up dates', async () => {
    // A regression, and a real one: `follow_up_date` is a `date` column, and the
    // driver may hand it back as a string rather than a `Date`. The conversion
    // assumed a `Date`, so the wallet threw a 500 for any patient whose history
    // included a follow-up — intermittently, because it depended on which
    // patient was read. The seeded history sets one on about half of its 500
    // visits, which is why this test goes looking for such a patient.
    const withFollowUp = await sql<{ patient_id: string; hospital_id: string }>`
      SELECT v.patient_id, v.hospital_id
        FROM visits v
       WHERE v.follow_up_date IS NOT NULL
         AND v.signed_at IS NOT NULL
         AND v.deleted_at IS NULL
       ORDER BY v.created_at
       LIMIT 1
    `.execute(db);

    const row = withFollowUp.rows[0];
    if (row === undefined) throw new Error('The seed should write visits with follow-up dates.');

    const response = await request(app)
      .get(`${BASE}/patients/${row.patient_id}/records`)
      .set(
        'authorization',
        `Bearer ${await staff(['doctor'], row.hospital_id, await staffIdFor(row.hospital_id, 'doctor'))}`,
      );

    expect(response.status).toBe(200);

    const dated = (response.body.data.visits as { followUpDate: string | null }[]).find(
      (visit) => visit.followUpDate !== null,
    );

    // `YYYY-MM-DD`, not an instant: a follow-up is a day on a calendar in
    // Dhaka, and turning it into a timestamp would move it west of UTC.
    expect(dated?.followUpDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('names what this version cannot show rather than omitting it', async () => {
    const response = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${await staff(['doctor'])}`);

    // `FR-DOC-03` asks for previous prescriptions and recent results too.
    // Prescriptions were dropped, reports are step 17; an empty area would read
    // as "this patient has none" (`PRD.md` §3.2).
    expect(response.body.data.absent).toEqual(['prescriptions', 'reports']);
  });

  it('refuses a booking that belongs to a different patient', async () => {
    const response = await request(app)
      .get(
        `${BASE}/patients/${String(fixture.patientIds[0])}/records?booking=${String(fixture.bookingIds[1])}`,
      )
      .set('authorization', `Bearer ${await staff(['doctor'])}`);

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('booking_patient');
  });
});

describe('writing a visit (FR-DOC-08)', () => {
  /** `POST /visits` the way the console calls it. */
  async function postVisit(
    body: Record<string, unknown>,
    token?: string,
  ): Promise<request.Response> {
    const key = (body['idempotencyKey'] as string | undefined) ?? crypto.randomUUID();
    return await request(app)
      .post(`${BASE}/visits`)
      .set('authorization', `Bearer ${token ?? (await staff(['doctor']))}`)
      .set('idempotency-key', key)
      .send({ ...body, idempotencyKey: key });
  }

  it('saves a draft without ending the consultation (BTN-B05-DRAFT)', async () => {
    await callFirstPatient();

    const response = await postVisit({
      bookingId: fixture.bookingIds[0],
      diagnosisText: 'Suspected reflux',
      sign: false,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.signed).toBe(false);
    expect(response.body.data.queue).toBeNull();

    // The patient is still in the chamber: a draft is a note, not a decision.
    const state = await queueService.getState(fixture.sessionId);
    const entry = state.entries.find((e) => e.bookingId === fixture.bookingIds[0]);
    expect(entry?.status).toBe('in_chamber');
  });

  it('signs, writes the record, and calls the next patient (BTN-B05-SIGN)', async () => {
    await callFirstPatient();

    const response = await postVisit({
      bookingId: fixture.bookingIds[0],
      diagnosisText: 'Gastritis',
      adviceTextBn: 'ভাজা খাবার এড়িয়ে চলুন।',
      sign: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.signed).toBe(true);

    // `FR-DOC-08`: equivalent to reception's *done*. The first patient is
    // finished and the second is in the chamber, in one action.
    const state = await queueService.getState(fixture.sessionId);
    expect(state.entries.find((e) => e.bookingId === fixture.bookingIds[0])?.status).toBe('done');
    expect(state.entries.find((e) => e.bookingId === fixture.bookingIds[1])?.status).toBe(
      'in_chamber',
    );
  });

  it('puts the signed record in the wallet, and a draft nowhere', async () => {
    await callFirstPatient();

    await postVisit({ bookingId: fixture.bookingIds[0], diagnosisText: 'Gastritis', sign: false });

    // Scoped to *this* booking. The seeded patients are shared between tests in
    // this file and each already carries signed history, so a count of all
    // visits would measure the suite rather than the behaviour.
    const walletHolds = async (): Promise<boolean> => {
      const response = await request(app)
        .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
        .set('authorization', `Bearer ${await staff(['doctor'])}`);

      const visits = response.body.data.visits as { bookingId: string }[];
      return visits.some((visit) => visit.bookingId === fixture.bookingIds[0]);
    };

    // An unsigned visit is a doctor's unfinished thought. Showing it would
    // present a working note as a conclusion.
    expect(await walletHolds()).toBe(false);

    await postVisit({ bookingId: fixture.bookingIds[0], diagnosisText: 'Gastritis', sign: true });

    expect(await walletHolds()).toBe(true);
  });

  it('calls the next patient once when the same sign is sent twice', async () => {
    await callFirstPatient();

    const key = crypto.randomUUID();
    const body = { bookingId: fixture.bookingIds[0], diagnosisText: 'Gastritis', sign: true };

    await postVisit({ ...body, idempotencyKey: key });
    await postVisit({ ...body, idempotencyKey: key });

    // A doctor on a bad connection taps twice. Two patients called is the
    // failure a waiting room notices immediately (CLAUDE.md §7).
    const state = await queueService.getState(fixture.sessionId);
    const inChamber = state.entries.filter((e) => e.status === 'in_chamber');
    expect(inChamber).toHaveLength(1);
    expect(inChamber[0]?.bookingId).toBe(fixture.bookingIds[1]);
  });

  it('refuses to sign for somebody who is not in the chamber', async () => {
    await callFirstPatient();

    const response = await postVisit({
      bookingId: fixture.bookingIds[2],
      diagnosisText: 'Nothing happened here',
      sign: true,
    });

    // Signing ends a consultation and advances the queue. Doing it for a
    // waiting patient would step over whoever is actually being seen.
    // `QUEUE_GUARD_FAILED` is 422 across this API (`errors/codes.ts`).
    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('PATIENT_NOT_IN_CHAMBER');
  });

  it('refuses a doctor from another hospital', async () => {
    await callFirstPatient();
    const elsewhere = await otherHospitalId(fixture.hospitalId);

    const response = await postVisit(
      { bookingId: fixture.bookingIds[0], diagnosisText: 'x', sign: false },
      await staff(['doctor'], elsewhere, await staffIdFor(elsewhere, 'doctor')),
    );

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('hospital_scope');
  });

  it('refuses a write with no idempotency key', async () => {
    await callFirstPatient();

    const response = await request(app)
      .post(`${BASE}/visits`)
      .set('authorization', `Bearer ${await staff(['doctor'])}`)
      .send({ bookingId: fixture.bookingIds[0], sign: false, idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(400);
  });

  it('will not sign an empty record', async () => {
    await callFirstPatient();

    const response = await postVisit({ bookingId: fixture.bookingIds[0], sign: true });

    // `visits_signed_has_content`. A signed record with nothing in it is a
    // document a patient could be shown that says nothing.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
