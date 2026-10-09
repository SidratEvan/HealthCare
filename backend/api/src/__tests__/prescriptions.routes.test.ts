/**
 * Prescribing (plan R2; `PRD.md` `FR-DOC-04`, `FR-DOC-05`; `BACKEND.md` §7.6).
 *
 * The medicines go with the visit: saved with a draft, signed with it, final
 * once signed, read wherever the visit is read and nowhere else. The
 * formulary is a doctor's to search, by the start of a name.
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
import * as clinicalRepo from '../repositories/clinical.repo.js';
import * as queueService from '../services/queue.service.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(3);
});

async function staff(roles: readonly StaffRole[] = ['doctor']): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: {
      sub: roles.includes('doctor') ? fixture.doctorStaffId : fixture.receptionistId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles,
    },
  });
}

async function callFirstPatient(): Promise<void> {
  const actor = {
    kind: 'staff',
    staffUserId: fixture.receptionistId as never,
    role: 'receptionist',
  } as const;
  await queueService.appendEvent({
    sessionId: fixture.sessionId,
    type: 'DOCTOR_ARRIVED',
    payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
    actor,
    clientEventId: crypto.randomUUID(),
  });
  await queueService.callNext({
    sessionId: fixture.sessionId,
    actor,
    clientEventId: crypto.randomUUID(),
  });
}

async function postVisit(body: Record<string, unknown>): Promise<request.Response> {
  const key = crypto.randomUUID();
  return await request(app)
    .post(`${BASE}/visits`)
    .set('authorization', `Bearer ${await staff()}`)
    .set('idempotency-key', key)
    .send({ bookingId: fixture.bookingIds[0], ...body, idempotencyKey: key });
}

async function storedRows(): Promise<{ name_text: string; schedule: string | null }[]> {
  const result = await sql<{ name_text: string; schedule: string | null }>`
    SELECT i.name_text, i.schedule
      FROM prescription_items i
      JOIN prescriptions p ON p.id = i.prescription_id
      JOIN visits v ON v.id = p.visit_id
     WHERE v.booking_id = ${fixture.bookingIds[0]}::uuid
     ORDER BY i.created_at, i.id
  `.execute(db);
  return result.rows;
}

const PARACETAMOL = {
  name: 'Paracetamol (Napa)',
  strength: '500 mg',
  schedule: '১ + ১ + ১',
  durationDays: 3,
  instructionBn: 'খাবারের পরে',
};

describe('POST /visits with medicines (FR-DOC-04)', () => {
  it('signs the medicines with the visit, in the order written, schedule in its one form', async () => {
    await callFirstPatient();

    const signed = await postVisit({
      diagnosisText: 'শ্বাসনালীর সংক্রমণ',
      medicines: [PARACETAMOL, { name: 'Cetirizine', schedule: '0+0+1' }],
      sign: true,
    });
    expect(signed.status).toBe(201);

    const records = await request(app)
      .get(`${BASE}/patients/${String(fixture.patientIds[0])}/records`)
      .set('authorization', `Bearer ${await staff()}`);
    expect(records.status).toBe(200);
    const visit = (
      records.body.data.visits as {
        bookingId: string;
        doctorBmdc: string;
        medicines: unknown[];
      }[]
    ).find((entry) => entry.bookingId === fixture.bookingIds[0]);
    expect(visit?.doctorBmdc).toEqual(expect.any(String));
    expect(visit?.medicines).toEqual([
      {
        medicineId: null,
        name: 'Paracetamol (Napa)',
        strength: '500 mg',
        schedule: '1+1+1',
        durationDays: 3,
        instructionBn: 'খাবারের পরে',
      },
      {
        medicineId: null,
        name: 'Cetirizine',
        strength: null,
        schedule: '0+0+1',
        durationDays: null,
        instructionBn: null,
      },
    ]);
  });

  it('replaces a draft’s rows on the next save, clears them with an empty list, keeps them when absent', async () => {
    await callFirstPatient();

    expect((await postVisit({ medicines: [PARACETAMOL], sign: false })).status).toBe(201);
    expect(await storedRows()).toEqual([{ name_text: 'Paracetamol (Napa)', schedule: '1+1+1' }]);

    expect(
      (await postVisit({ medicines: [{ name: 'Omeprazole (Losectil)' }], sign: false })).status,
    ).toBe(201);
    expect(await storedRows()).toEqual([{ name_text: 'Omeprazole (Losectil)', schedule: null }]);

    // Absent: a save that does not speak about medicines leaves them alone.
    expect((await postVisit({ diagnosisText: 'গ্যাস্ট্রাইটিস', sign: false })).status).toBe(201);
    expect(await storedRows()).toHaveLength(1);

    expect((await postVisit({ medicines: [], sign: false })).status).toBe(201);
    expect(await storedRows()).toEqual([]);
  });

  it('keeps a signed prescription as it was signed', async () => {
    await callFirstPatient();
    expect(
      (await postVisit({ diagnosisText: 'জ্বর', medicines: [PARACETAMOL], sign: true })).status,
    ).toBe(201);

    const edit = await postVisit({ medicines: [{ name: 'Ibuprofen' }], sign: false });
    expect(edit.status).toBe(422);
    expect(edit.body.error.details.guard).toBe('VISIT_ALREADY_SIGNED');
    expect(await storedRows()).toEqual([{ name_text: 'Paracetamol (Napa)', schedule: '1+1+1' }]);
  });

  it('refuses a schedule that is not the notation, and a row with no name', async () => {
    await callFirstPatient();
    expect((await postVisit({ medicines: [{ name: 'X', schedule: 'twice' }] })).status).toBe(400);
    expect((await postVisit({ medicines: [{ name: '  ' }] })).status).toBe(400);
    expect((await postVisit({ medicines: [{ name: 'X', durationDays: 400 }] })).status).toBe(400);
    expect(
      (await postVisit({ medicines: Array.from({ length: 21 }, () => ({ name: 'X' })) })).status,
    ).toBe(400);
  });

  it('is a doctor’s to write: a receptionist is refused', async () => {
    await callFirstPatient();
    const key = crypto.randomUUID();
    const refused = await request(app)
      .post(`${BASE}/visits`)
      .set('authorization', `Bearer ${await staff(['receptionist'])}`)
      .set('idempotency-key', key)
      .send({
        bookingId: fixture.bookingIds[0],
        medicines: [PARACETAMOL],
        sign: false,
        idempotencyKey: key,
      });
    expect(refused.status).toBe(403);
    expect(await storedRows()).toEqual([]);
  });

  it('reaches the patient through their tracking link with the record (FR-GST-08)', async () => {
    await callFirstPatient();
    await postVisit({ diagnosisText: 'জ্বর', medicines: [PARACETAMOL], sign: true });

    // What `guest.service` hands the link's holder as `record`, unchanged.
    const record = await clinicalRepo.findVisitForBooking(String(fixture.bookingIds[0]));
    expect(record?.medicines).toHaveLength(1);
    expect(record?.medicines[0]?.name).toBe('Paracetamol (Napa)');
  });
});

describe('GET /formulary (FR-DOC-05)', () => {
  it('finds by the start of a generic or a brand name', async () => {
    const byGeneric = await request(app)
      .get(`${BASE}/formulary?q=para`)
      .set('authorization', `Bearer ${await staff()}`);
    expect(byGeneric.status).toBe(200);
    expect(
      (byGeneric.body.data.medicines as { genericName: string }[]).map((m) => m.genericName),
    ).toContain('Paracetamol');

    const byBrand = await request(app)
      .get(`${BASE}/formulary?q=NAP`)
      .set('authorization', `Bearer ${await staff()}`);
    expect(
      (byBrand.body.data.medicines as { brandName: string | null }[]).map((m) => m.brandName),
    ).toContain('Napa');
  });

  it('treats a wildcard as the character it is', async () => {
    const response = await request(app)
      .get(`${BASE}/formulary?q=%25%25`)
      .set('authorization', `Bearer ${await staff()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.medicines).toEqual([]);
  });

  it('is the prescribing screen’s: no token 401, a receptionist 403, one letter 400', async () => {
    expect((await request(app).get(`${BASE}/formulary?q=para`)).status).toBe(401);
    expect(
      (
        await request(app)
          .get(`${BASE}/formulary?q=para`)
          .set('authorization', `Bearer ${await staff(['receptionist'])}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`${BASE}/formulary?q=p`)
          .set('authorization', `Bearer ${await staff()}`)
      ).status,
    ).toBe(400);
  });
});
