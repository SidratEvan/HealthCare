/**
 * The referral endpoints (BACKEND.md §7.5, `FR-EMG-07..09`).
 *
 * What is proven here and nowhere else:
 *
 *   - **Who may act** (`FR-ROLE-01`): an ER coordinator, at a hospital the
 *     referral names, taking a step that is their side's.
 *   - **The timeline is recorded** (`FR-EMG-08`): sent, seen, accepted,
 *     arrived — each stamped once, each broadcast to both ERs.
 *   - **The handover** (the owner's ruling, 2026-09-22): the sending ER keeps
 *     the case until the receiving ER records the arrival, and that one act
 *     moves the person from one triage list to the other.
 *   - **A held case stays put**: no handoff, discharge or ward admission while
 *     another ER is answering.
 *   - **A replay is answered, not repeated**; a race ends in one outcome.
 *   - **Nothing names anybody**: a family's number left with the case never
 *     travels with the referral.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { resetEmitter, type RecordingEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';

import { createBedFixture, deskPatient } from './support/bedFixture.js';
import {
  caseRow,
  erFixture,
  seededHospitalId,
  type ErFixture,
} from './support/emergencyFixture.js';
import { bearer, guestToken, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let emitted: RecordingEmitter;
let jamuna: ErFixture;
let shapla: ErFixture;
let padma: ErFixture;

beforeEach(async () => {
  app = createApp();
  emitted = resetEmitter();
  jamuna = await erFixture('Jamuna Medical');
  shapla = await erFixture('Shapla General');
  padma = await erFixture('Padma Specialised');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Referral {
  id: string;
  state: string;
  from: { hospitalId: string };
  to: { hospitalId: string };
  emergencyCaseId: string;
  fromTokenLabel: string | null;
  arrivedCaseId: string | null;
  arrivedTokenLabel: string | null;
  requiredCapability: string | null;
  requiredBedKind: string | null;
  summary: {
    problem: string;
    triage: string | null;
    ageYears: number | null;
    sex: string | null;
    note: string | null;
  };
  seenAt: string | null;
  respondedAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
  declineReason: string | null;
}

let phoneCounter = 0;
function familyPhone(): string {
  phoneCounter += 1;
  return `+88018${String(process.pid % 1000).padStart(3, '0')}${String(phoneCounter).padStart(5, '0')}`;
}

/** Somebody in `er`'s ER with a token — the only kind of case that is referred. */
async function inEr(er: ErFixture, body: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${BASE}/emergency/cases`)
    .set('Authorization', bearer(er.erToken))
    .set('Idempotency-Key', randomUUID())
    .send({
      clientEventId: randomUUID(),
      clientTs: new Date().toISOString(),
      problem: 'cardiac',
      triage: 'red',
      ageYears: 58,
      sex: 'male',
      ...body,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.case.id as string;
}

async function sendReferral(
  caseId: string,
  to: ErFixture,
  body: Record<string, unknown> = {},
  options: { token?: string; key?: string } = {},
): Promise<request.Response> {
  const key = options.key ?? randomUUID();
  return await request(app)
    .post(`${BASE}/referrals`)
    .set('Authorization', bearer(options.token ?? jamuna.erToken))
    .set('Idempotency-Key', key)
    .send({
      clientEventId: key,
      clientTs: new Date().toISOString(),
      emergencyCaseId: caseId,
      toHospitalId: to.hospitalId,
      requiredCapability: 'cardiac',
      ...body,
    });
}

async function step(
  referralId: string,
  action: 'seen' | 'accept' | 'decline' | 'cancel' | 'arrive',
  token: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/referrals/${referralId}/${action}`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({ clientEventId: randomUUID(), clientTs: new Date().toISOString(), ...body });
}

/** A referral from Jamuna to Shapla, sent. */
async function referred(body: Record<string, unknown> = {}): Promise<{
  caseId: string;
  referral: Referral;
}> {
  const caseId = await inEr(jamuna);
  const response = await sendReferral(caseId, shapla, body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { caseId, referral: response.body.data.referral as Referral };
}

/** A referral from Jamuna to Shapla, accepted. */
async function accepted(): Promise<{ caseId: string; referral: Referral }> {
  const sent = await referred();
  const response = await step(sent.referral.id, 'accept', shapla.erToken);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { caseId: sent.caseId, referral: response.body.data.referral as Referral };
}

async function loadAt(hospitalId: string): Promise<number> {
  const result = await sql<{ er_active: number }>`
    SELECT er_active FROM v_public_hospital_capacity WHERE hospital_id = ${hospitalId}::uuid
  `.execute(db);
  return result.rows[0]?.er_active ?? -1;
}

function eventsIn(hospitalId: string): string[] {
  return emitted.forRoom(ROOMS.emergency(hospitalId)).map((entry) => entry.event);
}

// ---------------------------------------------------------------------------
// Who may send
// ---------------------------------------------------------------------------

describe('POST /referrals — who may send (FR-ROLE-01)', () => {
  it('refuses anybody who is not an ER coordinator', async () => {
    const caseId = await inEr(jamuna);

    const anonymous = await request(app)
      .post(`${BASE}/referrals`)
      .set('Idempotency-Key', randomUUID())
      .send({
        emergencyCaseId: caseId,
        toHospitalId: shapla.hospitalId,
        requiredCapability: 'cardiac',
      });
    expect(anonymous.status).toBe(401);

    for (const token of [
      await patientToken(),
      await guestToken(),
      jamuna.wardToken,
      jamuna.receptionistToken,
      jamuna.adminToken,
    ]) {
      const response = await sendReferral(caseId, shapla, {}, { token });
      expect(response.status, JSON.stringify(response.body)).toBe(403);
    }
  });

  it('refuses another hospital’s case', async () => {
    const caseId = await inEr(jamuna);
    const response = await sendReferral(caseId, padma, {}, { token: shapla.erToken });
    expect(response.status).toBe(403);
  });

  it('needs an idempotency key, and something to ask for', async () => {
    const caseId = await inEr(jamuna);
    const keyless = await request(app)
      .post(`${BASE}/referrals`)
      .set('Authorization', bearer(jamuna.erToken))
      .send({
        emergencyCaseId: caseId,
        toHospitalId: shapla.hospitalId,
        requiredCapability: 'cardiac',
      });
    expect(keyless.status).toBe(400);
    expect(keyless.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const nothing = await sendReferral(caseId, shapla, {
      requiredCapability: null,
      requiredBedKind: null,
    });
    expect(nothing.status).toBe(400);
    expect(nothing.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('sends only to another facility with an ER to answer', async () => {
    const caseId = await inEr(jamuna);

    const self = await sendReferral(caseId, jamuna);
    expect(self.status).toBe(400);
    expect(self.body.error.details.reason).toBe('same_hospital');

    const meghna = await seededHospitalId('Meghna Diagnostic');
    const noEr = await sendReferral(caseId, { ...shapla, hospitalId: meghna });
    expect(noEr.status).toBe(400);
    expect(noEr.body.error.details.reason).toBe('no_emergency_department');
  });
});

// ---------------------------------------------------------------------------
// Sending (FR-EMG-08)
// ---------------------------------------------------------------------------

describe('POST /referrals — the summary, and who is told (FR-EMG-08)', () => {
  it('sends what the case says, a note, and nothing that names anybody', async () => {
    const phone = familyPhone();
    const caseId = await inEr(jamuna, {
      problem: 'burn',
      triage: 'yellow',
      ageYears: 9,
      sex: 'female',
      phone,
    });

    const response = await sendReferral(caseId, padma, {
      requiredCapability: 'burn_unit',
      requiredBedKind: 'burn',
      note: '  অ্যাম্বুলেন্স প্রস্তুত  ',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const referral = response.body.data.referral as Referral;

    expect(referral).toMatchObject({
      state: 'sent',
      emergencyCaseId: caseId,
      requiredCapability: 'burn_unit',
      requiredBedKind: 'burn',
      seenAt: null,
      summary: {
        problem: 'burn',
        triage: 'yellow',
        ageYears: 9,
        sex: 'female',
        note: 'অ্যাম্বুলেন্স প্রস্তুত',
      },
    });
    expect(referral.fromTokenLabel).toMatch(/^ER-\d+$/);

    // The receiving ER rings; the sending ER's other screens hear it too.
    expect(eventsIn(padma.hospitalId)).toContain('referral.incoming');
    expect(eventsIn(jamuna.hospitalId)).toContain('referral.updated');
    const payload = JSON.stringify(emitted.all().map((entry) => entry.envelope));
    expect(payload).not.toContain(phone);
    expect(JSON.stringify(response.body)).not.toContain(phone);
  });

  it('asks for a bed alone — "our ICU is full" names no capability', async () => {
    const caseId = await inEr(jamuna, { problem: 'breathing' });
    const response = await sendReferral(caseId, padma, {
      requiredCapability: null,
      requiredBedKind: 'icu',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data.referral).toMatchObject({
      requiredCapability: null,
      requiredBedKind: 'icu',
    });
  });

  it('answers a replayed send with the referral it made, once (FR-OFF-01)', async () => {
    const caseId = await inEr(jamuna);
    const key = randomUUID();
    const first = await sendReferral(caseId, shapla, {}, { key });
    emitted.clear();
    const replay = await sendReferral(caseId, shapla, {}, { key });

    expect(replay.status).toBe(200);
    expect(replay.body.data.duplicate).toBe(true);
    expect(replay.body.data.referral.id).toBe(first.body.data.referral.id);
    expect(emitted.all()).toHaveLength(0);
  });

  it('asks one hospital at a time', async () => {
    const { caseId } = await referred();
    const second = await sendReferral(caseId, padma);
    expect(second.status).toBe(422);
    expect(second.body.error.details.guard).toBe('REFERRAL_OPEN');
  });

  it('refers only somebody who is here — a car on the road is a decline (owner’s ruling)', async () => {
    const alert = await request(app)
      .post(`${BASE}/emergency/inbound`)
      .set('Idempotency-Key', randomUUID())
      .send({ hospitalId: jamuna.hospitalId, problem: 'burn' });
    expect(alert.status).toBe(201);

    const response = await sendReferral(alert.body.data.case.id as string, padma);
    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('WRONG_STATE');
  });
});

// ---------------------------------------------------------------------------
// The receiving ER (FR-EMG-09)
// ---------------------------------------------------------------------------

describe('the receiving ER’s steps (LIST-B07-IN, FR-EMG-09)', () => {
  it('stamps seen once, and tells the sender', async () => {
    const { referral } = await referred();
    emitted.clear();

    const seen = await step(referral.id, 'seen', shapla.erToken);
    expect(seen.status).toBe(200);
    expect(seen.body.data.referral.state).toBe('seen');
    const firstSeen = seen.body.data.referral.seenAt as string;
    expect(eventsIn(jamuna.hospitalId)).toContain('referral.updated');
    expect(eventsIn(shapla.hospitalId)).toContain('referral.updated');

    const again = await step(referral.id, 'seen', shapla.erToken);
    expect(again.body.data).toMatchObject({ duplicate: true });
    expect(again.body.data.referral.seenAt).toBe(firstSeen);
  });

  it('keeps each side to its own steps, and every other hospital out', async () => {
    const { referral } = await referred();

    for (const action of ['seen', 'accept', 'arrive'] as const) {
      const bySender = await step(referral.id, action, jamuna.erToken);
      expect(bySender.status, action).toBe(403);
    }
    const receiverWithdraws = await step(referral.id, 'cancel', shapla.erToken);
    expect(receiverWithdraws.status).toBe(403);

    const stranger = await step(referral.id, 'accept', padma.erToken);
    expect(stranger.status).toBe(403);

    const ward = await step(referral.id, 'accept', shapla.wardToken);
    expect(ward.status).toBe(403);

    const patient = await step(referral.id, 'accept', await patientToken());
    expect(patient.status).toBe(403);

    const anonymous = await request(app)
      .post(`${BASE}/referrals/${referral.id}/accept`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(anonymous.status).toBe(401);
  });

  it('accepts, stamping seen with the answer when nobody looked first', async () => {
    const { referral } = await referred();
    const response = await step(referral.id, 'accept', shapla.erToken);

    expect(response.status).toBe(200);
    const after = response.body.data.referral as Referral;
    expect(after.state).toBe('accepted');
    expect(after.seenAt).not.toBeNull();
    expect(after.respondedAt).not.toBeNull();
    expect(after.closedAt).toBeNull();
  });

  it('declines only with a reason, and the case stays with the sender to try elsewhere', async () => {
    const { caseId, referral } = await referred();

    const blank = await step(referral.id, 'decline', shapla.erToken, { reason: '   ' });
    expect(blank.status).toBe(400);

    const declined = await step(referral.id, 'decline', shapla.erToken, {
      reason: 'কার্ডিয়াক টিম এখন অস্ত্রোপচারে',
    });
    expect(declined.status).toBe(200);
    expect(declined.body.data.referral).toMatchObject({
      state: 'declined',
      declineReason: 'কার্ডিয়াক টিম এখন অস্ত্রোপচারে',
    });
    expect(declined.body.data.referral.closedAt).not.toBeNull();

    expect((await caseRow(caseId)).state).toBe('arrived');
    const next = await sendReferral(caseId, padma);
    expect(next.status).toBe(201);
  });

  it('refuses an arrival nobody accepted', async () => {
    const { referral } = await referred();
    const response = await step(referral.id, 'arrive', shapla.erToken);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('REFERRAL_TRANSITION_INVALID');
  });
});

// ---------------------------------------------------------------------------
// The handover (the owner's ruling, 2026-09-22)
// ---------------------------------------------------------------------------

describe('POST /referrals/:id/arrive — the handover', () => {
  it('moves the person from one triage list to the other in one act', async () => {
    const { caseId, referral } = await accepted();
    const jamunaBefore = await loadAt(jamuna.hospitalId);
    const shaplaBefore = await loadAt(shapla.hospitalId);
    emitted.clear();

    const response = await step(referral.id, 'arrive', shapla.erToken);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const after = response.body.data.referral as Referral;

    expect(after.state).toBe('arrived');
    expect(after.arrivedTokenLabel).toMatch(/^ER-\d+$/);

    // The receiving ER has the person, with a token and the summary's facts.
    const received = await caseRow(after.arrivedCaseId ?? '');
    expect(received).toMatchObject({ state: 'arrived', triage: 'red', contact_phone: null });
    expect(received.token_label).toBe(after.arrivedTokenLabel);

    // The sending ER's case closed as referred.
    const sent = await caseRow(caseId);
    expect(sent.state).toBe('referred');
    expect(sent.closed_at).not.toBeNull();

    expect(await loadAt(jamuna.hospitalId)).toBe(jamunaBefore - 1);
    expect(await loadAt(shapla.hospitalId)).toBe(shaplaBefore + 1);

    // Both consoles hear their case move and the referral close.
    expect(eventsIn(jamuna.hospitalId)).toEqual(
      expect.arrayContaining(['emergency.updated', 'referral.updated']),
    );
    expect(eventsIn(shapla.hospitalId)).toEqual(
      expect.arrayContaining(['emergency.updated', 'referral.updated']),
    );
  });

  it('keeps the family’s number with the ER that was given it', async () => {
    const phone = familyPhone();
    const caseId = await inEr(jamuna, { phone });
    const sent = await sendReferral(caseId, shapla);
    const id = sent.body.data.referral.id as string;
    await step(id, 'accept', shapla.erToken);
    const arrived = await step(id, 'arrive', shapla.erToken);

    const received = await caseRow(arrived.body.data.referral.arrivedCaseId as string);
    expect(received.contact_phone).toBeNull();
    expect((await caseRow(caseId)).contact_phone).toBe(phone);
  });

  it('answers a replayed arrival without opening a second case', async () => {
    const { referral } = await accepted();
    const first = await step(referral.id, 'arrive', shapla.erToken);
    const replay = await step(referral.id, 'arrive', shapla.erToken);

    expect(replay.status).toBe(200);
    expect(replay.body.data.duplicate).toBe(true);
    expect(replay.body.data.referral.arrivedCaseId).toBe(first.body.data.referral.arrivedCaseId);
  });

  it('ends a race between the arrival and a withdrawal in one outcome', async () => {
    const { referral } = await accepted();
    const [arrive, cancel] = await Promise.all([
      step(referral.id, 'arrive', shapla.erToken),
      step(referral.id, 'cancel', jamuna.erToken),
    ]);

    const statuses = [arrive.status, cancel.status].sort();
    expect(statuses).toEqual([200, 422]);

    const final = await sql<{ state: string }>`
      SELECT state::text AS state FROM referrals WHERE id = ${referral.id}::uuid
    `.execute(db);
    expect(final.rows[0]?.state).toBe(arrive.status === 200 ? 'arrived' : 'cancelled');
  });
});

// ---------------------------------------------------------------------------
// The sending ER
// ---------------------------------------------------------------------------

describe('the sending ER while it waits', () => {
  it('holds the case: no handoff and no discharge until the referral is withdrawn', async () => {
    const { caseId, referral } = await accepted();

    for (const body of [{ action: 'discharge' }, { action: 'handoff', bedKind: 'general' }]) {
      const response = await request(app)
        .patch(`${BASE}/emergency/cases/${caseId}`)
        .set('Authorization', bearer(jamuna.erToken))
        .set('Idempotency-Key', randomUUID())
        .send({ clientEventId: randomUUID(), ...body });
      expect(response.status, body.action).toBe(422);
      expect(response.body.error.details.guard).toBe('REFERRAL_OPEN');
    }

    const withdrawn = await step(referral.id, 'cancel', jamuna.erToken);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.referral.state).toBe('cancelled');

    const discharged = await request(app)
      .patch(`${BASE}/emergency/cases/${caseId}`)
      .set('Authorization', bearer(jamuna.erToken))
      .set('Idempotency-Key', randomUUID())
      .send({ clientEventId: randomUUID(), action: 'discharge' });
    expect(discharged.status).toBe(200);
  });

  it('keeps the ward from admitting a case another ER is answering (FR-BED-07)', async () => {
    const beds = await createBedFixture(1, 'general');
    const caseId = await inEr(shapla);
    const handed = await request(app)
      .patch(`${BASE}/emergency/cases/${caseId}`)
      .set('Authorization', bearer(shapla.erToken))
      .set('Idempotency-Key', randomUUID())
      .send({ clientEventId: randomUUID(), action: 'handoff', bedKind: 'general' });
    expect(handed.status).toBe(200);

    const sent = await sendReferral(caseId, padma, {}, { token: shapla.erToken });
    expect(sent.status).toBe(201);

    const admit = await request(app)
      .post(`${BASE}/beds/${beds.bedIds[0] ?? ''}/admit`)
      .set('Authorization', bearer(beds.wardToken))
      .set('Idempotency-Key', randomUUID())
      .send({ clientEventId: randomUUID(), emergencyCaseId: caseId, patient: deskPatient() });
    expect(admit.status).toBe(422);
    expect(admit.body.error.details.guard).toBe('REFERRAL_OPEN');
  });

  it('cannot withdraw a referral that has arrived', async () => {
    const { referral } = await accepted();
    await step(referral.id, 'arrive', shapla.erToken);
    const late = await step(referral.id, 'cancel', jamuna.erToken);
    expect(late.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// What the consoles read
// ---------------------------------------------------------------------------

describe('GET /hospitals/:id/emergency — referrals on the board', () => {
  it('shows each ER its own end of a referral', async () => {
    const { referral } = await referred();

    const receiving = await request(app)
      .get(`${BASE}/hospitals/${shapla.hospitalId}/emergency`)
      .set('Authorization', bearer(shapla.erToken));
    const sending = await request(app)
      .get(`${BASE}/hospitals/${jamuna.hospitalId}/emergency`)
      .set('Authorization', bearer(jamuna.erToken));
    const elsewhere = await request(app)
      .get(`${BASE}/hospitals/${padma.hospitalId}/emergency`)
      .set('Authorization', bearer(padma.erToken));

    const ids = (response: request.Response): string[] =>
      (response.body.data.referrals as Referral[]).map((entry) => entry.id);
    expect(ids(receiving)).toContain(referral.id);
    expect(ids(sending)).toContain(referral.id);
    expect(ids(elsewhere)).not.toContain(referral.id);
  });
});

describe('GET /emergency/search — the refer-out search (FR-EMG-07)', () => {
  it('ranks on a need the coordinator names — a bed no problem maps to', async () => {
    const response = await request(app)
      .get(`${BASE}/emergency/search`)
      .query({ from: jamuna.hospitalId, problem: 'breathing', bedKind: 'icu' });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      requiredCapability: null,
      bedKind: 'icu',
      origin: 'hospital',
    });
    const results = response.body.data.results as { hospitalId: string; bedKind: string | null }[];
    expect(results.every((result) => result.bedKind === 'icu')).toBe(true);
    expect(results.some((result) => result.hospitalId === jamuna.hospitalId)).toBe(false);
  });

  it('keeps a named need to the refer-out search', async () => {
    const response = await request(app)
      .get(`${BASE}/emergency/search`)
      .query({ lat: 23.758, lng: 90.39, bedKind: 'icu' });
    expect(response.status).toBe(400);
  });
});
