/** Encounter/revision and sign-race regressions (FR-DOC-08, FR-DOC-10, FR-QUE-53). */
import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import * as clinicalRepo from '../repositories/clinical.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';
import { withTransaction } from '../repositories/transaction.js';
import * as queue from '../services/queue.service.js';

import {
  createQueueFixture,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';

let fixture: QueueFixture;
let token: string;
const app = createApp();
const BASE = '/api/v1';
const reception = () => ({
  kind: 'staff' as const,
  staffUserId: fixture.receptionistId as never,
  role: 'receptionist' as const,
});
beforeEach(async () => {
  resetEmitter();
  fixture = await createQueueFixture(4);
  token = await signToken({
    kind: 'access',
    claims: {
      sub: fixture.doctorStaffId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['doctor'],
    },
  });
  await queue.appendEvent({
    sessionId: fixture.sessionId,
    type: 'DOCTOR_ARRIVED',
    payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
    actor: reception(),
    clientEventId: crypto.randomUUID(),
  });
  await next();
});
async function next() {
  return await queue.callNext({
    sessionId: fixture.sessionId,
    actor: reception(),
    clientEventId: crypto.randomUUID(),
  });
}
async function post(body: Record<string, unknown>) {
  const key =
    typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : crypto.randomUUID();
  return await request(app)
    .post(`${BASE}/visits`)
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', String(key))
    .send({
      bookingId: fixture.bookingIds[0],
      diagnosisText: 'Synthetic safety note',
      expectedRevision: null,
      ...body,
      idempotencyKey: key,
    });
}
describe('Doctor consultation safety', () => {
  async function read(bookingId = String(fixture.bookingIds[0]), credential = token) {
    return await request(app)
      .get(`${BASE}/visits/booking/${bookingId}`)
      .set('authorization', `Bearer ${credential}`);
  }

  it('refuses a stale unsigned sign when reception wins before the clinical transaction lock', async () => {
    const original = sessionRepo.lockForUpdate;
    vi.spyOn(sessionRepo, 'lockForUpdate').mockImplementationOnce(async (trx, sessionId) => {
      await next();
      return await original(trx, sessionId);
    });
    const answer = await post({ sign: true });
    expect(answer.status).toBe(422);
    expect(answer.body.error.details.guard).toBe('PATIENT_NOT_IN_CHAMBER');
    expect(await clinicalRepo.findVisitByBooking(String(fixture.bookingIds[0]))).toBeNull();
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[1],
      )?.status,
    ).toBe('in_chamber');
  });

  it('does not finish B when reception advances after A is signed but before its queue step', async () => {
    const original = queue.callNext;
    vi.spyOn(queue, 'callNext').mockImplementationOnce(async (input) => {
      await original({
        sessionId: fixture.sessionId,
        actor: reception(),
        clientEventId: crypto.randomUUID(),
      });
      return await original(input);
    });
    const answer = await post({ sign: true });
    expect(answer.status).toBe(201);
    expect(answer.body.data.signed).toBe(true);
    const state = await queue.getState(fixture.sessionId);
    expect(state.entries.find((e) => e.bookingId === fixture.bookingIds[1])?.status).toBe(
      'in_chamber',
    );
    expect(answer.body.data.queueOutcome).toBe('changed');
    expect(
      (await clinicalRepo.findVisitForBooking(String(fixture.bookingIds[0])))?.signedAt,
    ).not.toBeNull();
    expect(await clinicalRepo.findVisitByBooking(String(fixture.bookingIds[1]))).toBeNull();
  });
  it('returns confirmed signed receipts on repeated and simultaneous signing without finishing B', async () => {
    const key = crypto.randomUUID();
    const answers = await Promise.all([
      post({ sign: true, idempotencyKey: key }),
      post({ sign: true, idempotencyKey: key }),
    ]);
    const lostReplyRetry = await post({ sign: true, idempotencyKey: key });
    expect([...answers, lostReplyRetry].map((a) => a.status)).toEqual([201, 201, 201]);
    expect([...answers, lostReplyRetry].every((a) => a.body.data.signed === true)).toBe(true);
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[1],
      )?.status,
    ).toBe('in_chamber');
  });

  it('recognises a lost successful sign even with a new key after another device advanced again', async () => {
    const first = await post({ sign: true });
    expect(first.status).toBe(201);
    await next();
    const retry = await post({ sign: true, diagnosisText: 'Must not replace signed content' });
    expect(retry.status).toBe(201);
    expect(retry.body.data.signed).toBe(true);
    expect(retry.body.data.contentMatches).toBe(false);
    expect(retry.body.data.queue.duplicate).toBe(true);
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[2],
      )?.status,
    ).toBe('in_chamber');
    expect(
      (await clinicalRepo.findVisitForBooking(String(fixture.bookingIds[0])))?.diagnosisText,
    ).toBe('Synthetic safety note');
  });

  it('conflicting device signatures finalize only one persisted note and flag the differing local content', async () => {
    const answers = await Promise.all([
      post({ sign: true, diagnosisText: 'Device A sign' }),
      post({ sign: true, diagnosisText: 'Device B sign' }),
    ]);
    expect(answers.map((a) => a.status)).toEqual([201, 201]);
    expect(answers.map((a) => a.body.data.contentMatches as boolean).sort()).toEqual([false, true]);
    const record = await clinicalRepo.findVisitForBooking(String(fixture.bookingIds[0]));
    expect(['Device A sign', 'Device B sign']).toContain(record?.diagnosisText);
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[1],
      )?.status,
    ).toBe('in_chamber');
    expect(await clinicalRepo.findVisitByBooking(String(fixture.bookingIds[1]))).toBeNull();
  });

  it('reports a committed signature separately from a failed queue step and recovers safely', async () => {
    vi.spyOn(queue, 'callNext').mockRejectedValueOnce(new Error('Synthetic queue outage'));
    const signed = await post({ sign: true });
    expect(signed.status).toBe(201);
    expect(signed.body.data).toMatchObject({
      signed: true,
      queue: null,
      queueOutcome: 'retry_needed',
    });
    expect(
      (await clinicalRepo.findVisitForBooking(String(fixture.bookingIds[0])))?.signedAt,
    ).not.toBeNull();
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[0],
      )?.status,
    ).toBe('in_chamber');
    const recovery = await post({ sign: true });
    expect(recovery.status).toBe(201);
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[1],
      )?.status,
    ).toBe('in_chamber');
  });

  it('saves the old patient draft after reception Next without changing either patient identity or queue', async () => {
    await next();
    const answer = await post({
      sign: false,
      patientId: fixture.patientIds[0],
      sessionId: fixture.sessionId,
      medicines: [{ name: 'Synthetic medicine', schedule: '1+0+1', durationDays: 3 }],
    });
    expect(answer.status).toBe(201);
    const restored = await read();
    expect(restored.body.data).toMatchObject({
      bookingId: fixture.bookingIds[0],
      patientId: fixture.patientIds[0],
      sessionId: fixture.sessionId,
    });
    expect(restored.body.data.visit).toMatchObject({
      diagnosisText: 'Synthetic safety note',
      signedAt: null,
      medicines: [{ name: 'Synthetic medicine' }],
    });
    expect(restored.body.data.visit.revision).toBe(answer.body.data.revision);
    expect(await clinicalRepo.findVisitByBooking(String(fixture.bookingIds[1]))).toBeNull();
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[1],
      )?.status,
    ).toBe('in_chamber');
  });

  it('serialises conflicting draft writes from two devices and preserves the winning persisted fields', async () => {
    const first = await post({ sign: false });
    const revision: string = first.body.data.revision;
    const answers = await Promise.all([
      post({
        expectedRevision: revision,
        diagnosisText: 'Device A',
        medicines: [{ name: 'Medicine A' }],
      }),
      post({
        expectedRevision: revision,
        diagnosisText: 'Device B',
        medicines: [{ name: 'Medicine B' }],
      }),
    ]);
    expect(answers.map((a) => a.status).sort()).toEqual([201, 422]);
    const loser = answers.find((a) => a.status === 422);
    expect(loser?.body.error.details.guard).toBe('VISIT_REVISION_CONFLICT');
    const saved = (await read()).body.data.visit as {
      diagnosisText: string;
      medicines: { name: string }[];
    };
    expect(saved.medicines[0]?.name).toBe(
      saved.diagnosisText === 'Device A' ? 'Medicine A' : 'Medicine B',
    );
    const staleSign = await post({
      sign: true,
      expectedRevision: revision,
      diagnosisText: 'Stale sign',
    });
    expect(staleSign.status).toBe(422);
    expect((await read()).body.data.visit.signedAt).toBeNull();
    expect(
      (await queue.getState(fixture.sessionId)).entries.find(
        (e) => e.bookingId === fixture.bookingIds[0],
      )?.status,
    ).toBe('in_chamber');
  });

  it('reconciles a lost draft response only for identical persisted content and refuses unversioned overwrite', async () => {
    const body = { sign: false, medicines: [{ name: 'Synthetic medicine', schedule: '1+0+1' }] };
    const first = await post(body);
    const retry = await post(body);
    expect(retry.status).toBe(201);
    expect(retry.body.data.revision).toBe(first.body.data.revision);
    const rejected = await post({ diagnosisText: 'Newer unseen overwrite' });
    expect(rejected.status).toBe(422);
    expect((await read()).body.data.visit.diagnosisText).toBe('Synthetic safety note');
  });

  it('detects changed content even when two persisted writes have the same timestamp', async () => {
    const booking = await clinicalRepo.findChamberBooking(String(fixture.bookingIds[0]));
    if (booking === null) throw new Error('Missing synthetic booking');
    const versions = await withTransaction(async (trx) => {
      await sessionRepo.lockForUpdate(trx, fixture.sessionId);
      const body = {
        bookingId: booking.bookingId,
        patientId: booking.patientId,
        hospitalId: booking.hospitalId,
        doctorId: booking.doctorId,
        diagnosisText: 'Synthetic first version',
        adviceTextBn: null,
        followUpDate: null,
        symptomSignal: null,
        sign: false,
        staffUserId: fixture.doctorStaffId,
      };
      await clinicalRepo.upsertVisit(trx, body);
      const first = await clinicalRepo.readDraft(booking.bookingId, trx);
      await clinicalRepo.upsertVisit(trx, {
        ...body,
        diagnosisText: 'Synthetic same-timestamp change',
      });
      const second = await clinicalRepo.readDraft(booking.bookingId, trx);
      if (first === null || second === null) throw new Error('Missing synthetic versions');
      return { first: first.revision, second: second.revision };
    });
    expect(versions.first.slice(0, versions.first.lastIndexOf(':'))).toBe(
      versions.second.slice(0, versions.second.lastIndexOf(':')),
    );
    expect(versions.first).not.toBe(versions.second);
    const stale = await post({
      expectedRevision: versions.first,
      diagnosisText: 'Unseen overwrite',
    });
    expect(stale.status).toBe(422);
    expect((await read()).body.data.visit.diagnosisText).toBe('Synthetic same-timestamp change');
  });

  it.each(['patientId', 'sessionId'])(
    'refuses a mismatched %s before writing clinical data',
    async (field) => {
      const answer = await post({ [field]: crypto.randomUUID(), sign: true });
      expect(answer.status).toBe(403);
      expect(answer.body.error.details.reason).toBe('consultation_identity');
      expect(await clinicalRepo.findVisitByBooking(String(fixture.bookingIds[0]))).toBeNull();
      expect(
        (await queue.getState(fixture.sessionId)).entries.find(
          (e) => e.bookingId === fixture.bookingIds[0],
        )?.status,
      ).toBe('in_chamber');
    },
  );

  it('protects draft reads with authentication, doctor role, own-hospital scope and audit', async () => {
    await post({ sign: false });
    expect(
      (await request(app).get(`${BASE}/visits/booking/${String(fixture.bookingIds[0])}`)).status,
    ).toBe(401);
    const receptionist = await signToken({
      kind: 'access',
      claims: {
        sub: fixture.receptionistId,
        kind: 'staff',
        hospitalId: fixture.hospitalId,
        roles: ['receptionist'],
      },
    });
    expect((await read(String(fixture.bookingIds[0]), receptionist)).status).toBe(403);
    const hospitalId = await otherHospitalId(fixture.hospitalId);
    const elsewhere = await signToken({
      kind: 'access',
      claims: {
        sub: await staffIdFor(hospitalId, 'doctor'),
        kind: 'staff',
        hospitalId,
        roles: ['doctor'],
      },
    });
    expect((await read(String(fixture.bookingIds[0]), elsewhere)).status).toBe(404);
    const auditBefore =
      (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM audit_log WHERE subject_table='visits' AND subject_id IS NOT NULL AND patient_id=${String(fixture.patientIds[0])}::uuid`.execute(
          db,
        )
      ).rows[0]?.n ?? 0;
    expect((await read()).status).toBe(200);
    const auditAfter =
      (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM audit_log WHERE subject_table='visits' AND subject_id IS NOT NULL AND patient_id=${String(fixture.patientIds[0])}::uuid`.execute(
          db,
        )
      ).rows[0]?.n ?? 0;
    expect(auditAfter).toBe(auditBefore + 1);
    const wallet = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${token}`);
    expect(
      (wallet.body.data.visits as { bookingId: string }[]).some(
        (v) => v.bookingId === fixture.bookingIds[0],
      ),
    ).toBe(false);
  });
});
