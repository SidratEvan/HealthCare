/**
 * The emergency endpoints (BACKEND.md §7.5, `FR-PAT-40..47`, `FR-EMG-01..05`).
 *
 * What is proven here and nowhere else:
 *
 *   - **Nobody is asked for anything in an emergency.** Search and "I'm on my
 *     way" work with no token and no phone (`GR-08`, `FR-GST-03`).
 *   - **The order is the product's rule.** From Farmgate, a burn case is sent
 *     to the fresh Padma before the nearer, stale Jamuna (`FR-PAT-43`,
 *     `FR-PAT-45`, `PRD.md` §24 step 7).
 *   - **Who may act on a case** (`FR-ROLE-01`): the ER coordinator at that
 *     hospital, and nobody else.
 *   - **A case cannot say something untrue.** Triage before arrival, a
 *     decline after acceptance, an admission nobody handed over — each is
 *     refused; a replay is answered, not repeated.
 *   - **A number is read on purpose.** The board and the broadcasts carry no
 *     phone; reading one writes `audit_log` (`DB-P7`).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { counter } from '../middleware/rateLimit.js';
import { resetEmitter, type RecordingEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';

import { createBedFixture, deskPatient } from './support/bedFixture.js';
import {
  auditedReadsOf,
  caseRow,
  erFixture,
  messagesFor,
  oldestBurnCardStamp,
  seededHospitalId,
  FARMGATE,
  type ErFixture,
} from './support/emergencyFixture.js';
import { bearer, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let emitted: RecordingEmitter;
let shapla: ErFixture;

beforeEach(async () => {
  app = createApp();
  emitted = resetEmitter();
  // The alert route is rate-limited per address, and every test here is one
  // address.
  counter.reset();
  shapla = await erFixture('Shapla General');
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SearchResult {
  hospitalId: string;
  nameEn: string;
  distanceKm: number | null;
  travelMinutes: number | null;
  hasCapability: boolean | null;
  erLoad: number;
  freeBeds: number | null;
  bedKind: string | null;
  freshness: { asOf: string | null; ageMinutes: number | null; stale: boolean };
}

async function searchFrom(query: Record<string, string | number>): Promise<{
  origin: string;
  requiredCapability: string | null;
  results: SearchResult[];
}> {
  const response = await request(app).get(`${BASE}/emergency/search`).query(query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data as {
    origin: string;
    requiredCapability: string | null;
    results: SearchResult[];
  };
}

let phoneCounter = 0;
/** A number no seeded identity holds; never sent anywhere (`SMS_PROVIDER=log`). */
function callerPhone(): string {
  phoneCounter += 1;
  return `+88019${String(process.pid % 1000).padStart(3, '0')}${String(phoneCounter).padStart(5, '0')}`;
}

async function sendAlert(
  body: Record<string, unknown>,
  key: string = randomUUID(),
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/emergency/inbound`)
    .set('Idempotency-Key', key)
    .send({ hospitalId: shapla.hospitalId, problem: 'accident', ...body });
}

/** An alert at Shapla with a number left, returning its id and the family's token. */
async function alertWithPhone(): Promise<{ caseId: string; token: string }> {
  const response = await sendAlert({ phone: callerPhone(), ageYears: 40, sex: 'male' });
  expect(response.status).toBe(201);
  return {
    caseId: response.body.data.case.id as string,
    token: response.body.data.token as string,
  };
}

async function acknowledge(caseId: string, token = shapla.erToken): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/emergency/cases/${caseId}/acknowledge`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({ clientEventId: randomUUID(), clientTs: new Date().toISOString() });
}

async function patch(
  caseId: string,
  body: Record<string, unknown>,
  token = shapla.erToken,
): Promise<request.Response> {
  return await request(app)
    .patch(`${BASE}/emergency/cases/${caseId}`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({ clientEventId: randomUUID(), clientTs: new Date().toISOString(), ...body });
}

async function walkIn(
  body: Record<string, unknown> = {},
  clientEventId: string = randomUUID(),
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/emergency/cases`)
    .set('Authorization', bearer(shapla.erToken))
    .set('Idempotency-Key', randomUUID())
    .send({ clientEventId, clientTs: new Date().toISOString(), problem: 'accident', ...body });
}

async function loadAt(hospitalId: string): Promise<number> {
  const result = await sql<{ er_active: number }>`
    SELECT er_active FROM v_public_hospital_capacity WHERE hospital_id = ${hospitalId}::uuid
  `.execute(db);
  return result.rows[0]?.er_active ?? -1;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('GET /emergency/search — public, ranked (FR-PAT-43, FR-PAT-44, FR-PAT-45)', () => {
  it('needs no token, and lists only facilities with an ER to ring', async () => {
    const found = await searchFrom({ ...FARMGATE, problem: 'burn' });
    const names = found.results.map((result) => result.nameEn);

    expect(names.some((name) => name.startsWith('Meghna'))).toBe(false);
    expect(names.some((name) => name.startsWith('Buriganga'))).toBe(false);
    // Chattogram is two hundred kilometres away: outside the radius.
    expect(names.some((name) => name.startsWith('Karnaphuli'))).toBe(false);
    expect(found.requiredCapability).toBe('burn_unit');
    expect(found.origin).toBe('position');
  });

  it('sends a burn case to the fresh Padma before the nearer, stale Jamuna (PRD.md §24 step 7)', async () => {
    const padmaId = await seededHospitalId('Padma Specialised');
    // Padma's figures are fresh for ten minutes after a reset; this suite may
    // have been running longer than that. So the clock is set just after the
    // oldest of Padma's own stamps — Date only, nothing else is faked — and
    // the order is decided against the data rather than the suite's age.
    vi.useFakeTimers({ toFake: ['Date'], now: (await oldestBurnCardStamp(padmaId)) + 2 * 60_000 });

    const found = await searchFrom({ ...FARMGATE, problem: 'burn' });
    const [first, second, third] = found.results;

    expect(first?.nameEn).toMatch(/^Padma/);
    expect(first).toMatchObject({ hasCapability: true, bedKind: 'burn' });
    expect(first?.freshness.stale).toBe(false);

    expect(second?.nameEn).toMatch(/^Jamuna/);
    expect(second?.freshness.stale).toBe(true);
    // Nearer, and still second: freshness ranks above travel time.
    expect(second?.distanceKm ?? 0).toBeLessThan(first?.distanceKm ?? 0);

    // Shapla has no burn unit: listed, and last, with its answer said.
    expect(third?.nameEn).toMatch(/^Shapla/);
    expect(third).toMatchObject({ hasCapability: false, freeBeds: null });
  });

  it('gives every result a travel estimate, a load and a freshness (FR-PAT-44)', async () => {
    const found = await searchFrom({ ...FARMGATE, problem: 'cardiac' });
    for (const result of found.results) {
      expect(result.distanceKm).toBeGreaterThan(0);
      expect(result.travelMinutes).toBeGreaterThan(0);
      expect(result.erLoad).toBeGreaterThanOrEqual(0);
      expect(result.freshness).toHaveProperty('stale');
    }
  });

  it('asks for no capability before a problem is chosen — the critical screen (FR-PAT-41)', async () => {
    const found = await searchFrom({ ...FARMGATE });
    expect(found.requiredCapability).toBeNull();
    expect(found.results.every((result) => result.hasCapability === null)).toBe(true);
    // Nearest first when nothing else separates them (and Shapla is nearest).
    expect(found.results[0]?.nameEn).toMatch(/^Shapla/);
  });

  it('still answers without a position, ranked on everything but distance', async () => {
    const found = await searchFrom({ problem: 'stroke' });
    expect(found.origin).toBe('none');
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results.every((result) => result.travelMinutes === null)).toBe(true);
  });

  it('searches from a hospital and leaves it out — the refer-out suggestion (FR-EMG-02)', async () => {
    const found = await searchFrom({ from: shapla.hospitalId, problem: 'burn' });
    expect(found.origin).toBe('hospital');
    expect(found.results.some((result) => result.hospitalId === shapla.hospitalId)).toBe(false);
  });

  it('refuses half a position', async () => {
    const response = await request(app)
      .get(`${BASE}/emergency/search`)
      .query({ lat: FARMGATE.lat });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// "I'm on my way"
// ---------------------------------------------------------------------------

describe("POST /emergency/inbound — I'm on my way (FR-PAT-46, FR-EMG-01)", () => {
  it('needs nothing at all of the family, and rings the ER', async () => {
    const before = await loadAt(shapla.hospitalId);
    const response = await sendAlert({});

    expect(response.status).toBe(201);
    expect(response.body.data.case.state).toBe('inbound');
    expect(response.body.data.trackUrl).toContain('/emergency/onway?t=');
    expect(await loadAt(shapla.hospitalId)).toBe(before + 1);

    const rung = emitted.forRoom(ROOMS.emergency(shapla.hospitalId));
    expect(rung.map((entry) => entry.event)).toContain('emergency.inbound');
  });

  it('carries the ETA, age and sex to the ER, and never the number over the room', async () => {
    const phone = callerPhone();
    const response = await sendAlert({ ...FARMGATE, phone, ageYears: 7, sex: 'female' });
    const caseId = response.body.data.case.id as string;

    const row = await caseRow(caseId);
    expect(row.inbound_eta_minutes).toBeGreaterThan(0);
    expect(row.contact_phone).toBe(phone);

    const rung = emitted.forRoom(ROOMS.emergency(shapla.hospitalId));
    const payload = JSON.stringify(rung.map((entry) => entry.envelope));
    expect(payload).toContain('"ageYears":7');
    expect(payload).toContain('"hasPhone":true');
    expect(payload).not.toContain(phone);
  });

  it('creates the case once however often the alert is retried', async () => {
    const key = randomUUID();
    const first = await sendAlert({}, key);
    const again = await sendAlert({}, key);

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(again.body.data.case.id).toBe(first.body.data.case.id);
  });

  it('refuses a facility with no ER console to ring', async () => {
    const meghna = await seededHospitalId('Meghna Diagnostic');
    const response = await sendAlert({ hospitalId: meghna });
    expect(response.status).toBe(400);
    expect(response.body.error.details.reason).toBe('no_emergency_department');
  });

  it('requires an idempotency key, and limits how often one address can ring', async () => {
    const keyless = await request(app)
      .post(`${BASE}/emergency/inbound`)
      .send({ hospitalId: shapla.hospitalId, problem: 'other' });
    expect(keyless.status).toBe(400);

    counter.reset();
    for (let sent = 0; sent < 10; sent += 1) {
      expect((await sendAlert({})).status).toBe(201);
    }
    const eleventh = await sendAlert({});
    expect(eleventh.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// The family's status page
// ---------------------------------------------------------------------------

describe('the family’s status page (S-A-10c)', () => {
  it('opens on the signed token and nothing else', async () => {
    const { caseId, token } = await alertWithPhone();
    const response = await request(app).get(`${BASE}/emergency/track/${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: caseId, state: 'inbound' });
    expect(response.body.data.hospital.nameEn).toMatch(/^Shapla/);
    // The status page names the hospital, not the family.
    expect(JSON.stringify(response.body.data)).not.toContain('+88019');

    const forged = await signToken({
      kind: 'bed_request',
      claims: { sub: caseId, kind: 'guest', bedRequestId: caseId },
    });
    expect((await request(app).get(`${BASE}/emergency/track/${forged}`)).status).toBe(401);
  });

  it('shows "hospital ready" once the ER prepares, and texts the number left', async () => {
    const { caseId, token } = await alertWithPhone();
    expect((await acknowledge(caseId)).status).toBe(200);

    const status = await request(app).get(`${BASE}/emergency/track/${token}`);
    expect(status.body.data.state).toBe('acknowledged');
    expect(status.body.data.acknowledgedAt).not.toBeNull();

    const messages = await messagesFor(caseId);
    expect(messages.map((message) => message.template_key)).toEqual(['emergency.acknowledged']);
    expect(messages[0]?.state).toBe('sent');
  });

  it('lets the family call it off, and tells the ER (BTN-A10C-CANCEL)', async () => {
    const { caseId, token } = await alertWithPhone();
    const before = await loadAt(shapla.hospitalId);

    const cancelled = await request(app).post(`${BASE}/emergency/track/${token}/cancel`).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.state).toBe('cancelled');
    expect(await loadAt(shapla.hospitalId)).toBe(before - 1);

    const updates = emitted.forRoom(ROOMS.emergency(shapla.hospitalId));
    expect(updates.some((entry) => entry.event === 'emergency.updated')).toBe(true);

    // A second tap is the same answer, not an error.
    expect((await request(app).post(`${BASE}/emergency/track/${token}/cancel`)).status).toBe(200);
    expect((await caseRow(caseId)).state).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// Who may act (FR-ROLE-01)
// ---------------------------------------------------------------------------

describe('the ER console — who may read and act (FR-ROLE-01)', () => {
  it('opens the board for the ER and the administrator, and for nobody else', async () => {
    const board = (token: string): Promise<request.Response> =>
      request(app)
        .get(`${BASE}/hospitals/${shapla.hospitalId}/emergency`)
        .set('Authorization', bearer(token));

    expect((await board(shapla.erToken)).status).toBe(200);
    expect((await board(shapla.adminToken)).status).toBe(200);
    expect((await board(shapla.wardToken)).status).toBe(403);
    expect((await board(shapla.receptionistToken)).status).toBe(403);
    expect((await board(await patientToken())).status).toBe(403);
    expect(
      (await request(app).get(`${BASE}/hospitals/${shapla.hospitalId}/emergency`)).status,
    ).toBe(401);

    const padma = await erFixture('Padma Specialised');
    expect((await board(padma.erToken)).status).toBe(403);
  });

  it('names nobody on the board', async () => {
    await alertWithPhone();
    const response = await request(app)
      .get(`${BASE}/hospitals/${shapla.hospitalId}/emergency`)
      .set('Authorization', bearer(shapla.erToken));

    const body = JSON.stringify(response.body.data);
    expect(body).not.toMatch(/\+8801/);
    expect(response.body.data.cases.length).toBeGreaterThan(0);
    expect(response.body.data.load).toBe(await loadAt(shapla.hospitalId));
  });

  it("refuses another hospital's ER, and every other role, on a case", async () => {
    const { caseId } = await alertWithPhone();
    const padma = await erFixture('Padma Specialised');

    expect((await acknowledge(caseId, padma.erToken)).status).toBe(403);
    expect((await acknowledge(caseId, shapla.wardToken)).status).toBe(403);
    expect((await patch(caseId, { action: 'accept' }, shapla.receptionistToken)).status).toBe(403);
    expect((await caseRow(caseId)).state).toBe('inbound');
  });
});

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

describe('what a case may do (FR-EMG-01..04)', () => {
  it('prepares, accepts with a token, triages and discharges', async () => {
    const { caseId } = await alertWithPhone();

    const accepted = await patch(caseId, { action: 'accept' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.case.state).toBe('arrived');
    expect(accepted.body.data.case.tokenLabel).toMatch(/^ER-\d+$/);

    const triaged = await patch(caseId, { action: 'triage', triage: 'red' });
    expect(triaged.body.data.case.triage).toBe('red');

    const before = await loadAt(shapla.hospitalId);
    const discharged = await patch(caseId, { action: 'discharge' });
    expect(discharged.body.data.case.state).toBe('discharged');
    expect(await loadAt(shapla.hospitalId)).toBe(before - 1);
    expect((await caseRow(caseId)).closed_at).not.toBeNull();
  });

  it('never gives two open cases the same token', async () => {
    const tokens = await Promise.all(
      [1, 2, 3].map(async () => {
        const response = await walkIn();
        return response.body.data.case.tokenLabel as string;
      }),
    );
    expect(new Set(tokens).size).toBe(3);

    const result = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM (
        SELECT token_label FROM emergency_cases
         WHERE hospital_id = ${shapla.hospitalId}::uuid AND closed_at IS NULL
           AND token_label IS NOT NULL
         GROUP BY token_label HAVING count(*) > 1) repeated
    `.execute(db);
    expect(result.rows[0]?.n).toBe('0');
  });

  it('declines only with a reason, tells the family, and cannot then accept (FR-EMG-02)', async () => {
    const { caseId, token } = await alertWithPhone();

    expect((await patch(caseId, { action: 'decline', reason: '' })).status).toBe(400);

    const declined = await patch(caseId, { action: 'decline', reason: 'বার্ন ইউনিট নেই' });
    expect(declined.status).toBe(200);
    expect(declined.body.data.case).toMatchObject({
      state: 'declined',
      declineReason: 'বার্ন ইউনিট নেই',
    });

    const status = await request(app).get(`${BASE}/emergency/track/${token}`);
    expect(status.body.data).toMatchObject({
      state: 'declined',
      declineReason: 'বার্ন ইউনিট নেই',
    });
    expect((await messagesFor(caseId)).map((message) => message.template_key)).toContain(
      'emergency.declined',
    );

    const late = await patch(caseId, { action: 'accept' });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('EMERGENCY_TRANSITION_INVALID');
  });

  it('triages nobody who has not arrived', async () => {
    const { caseId } = await alertWithPhone();
    const response = await patch(caseId, { action: 'triage', triage: 'red' });
    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('WRONG_STATE');
  });

  it('answers a replayed action as a replay, and texts nobody twice (FR-OFF-01)', async () => {
    const { caseId } = await alertWithPhone();
    expect((await acknowledge(caseId)).body.data.duplicate).toBe(false);

    const replay = await acknowledge(caseId);
    expect(replay.status).toBe(200);
    expect(replay.body.data.duplicate).toBe(true);
    expect(await messagesFor(caseId)).toHaveLength(1);
  });

  it('registers a walk-in once, however often an offline console sends it', async () => {
    const clientEventId = randomUUID();
    const first = await walkIn(
      { problem: 'breathing', triage: 'yellow', ageYears: 70 },
      clientEventId,
    );
    const again = await walkIn(
      { problem: 'breathing', triage: 'yellow', ageYears: 70 },
      clientEventId,
    );

    expect(first.status).toBe(201);
    expect(first.body.data.case).toMatchObject({ state: 'arrived', triage: 'yellow' });
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(again.body.data.case.id).toBe(first.body.data.case.id);
  });
});

// ---------------------------------------------------------------------------
// The number, read on purpose (DB-P7)
// ---------------------------------------------------------------------------

describe('GET /emergency/cases/:id/contact — the number, audited (DB-P7)', () => {
  it('returns the number and writes the read down', async () => {
    const { caseId } = await alertWithPhone();
    expect(await auditedReadsOf(caseId)).toBe(0);

    const response = await request(app)
      .get(`${BASE}/emergency/cases/${caseId}/contact`)
      .set('Authorization', bearer(shapla.erToken));

    expect(response.status).toBe(200);
    expect(response.body.data.phone).toMatch(/^\+88019/);
    expect(await auditedReadsOf(caseId)).toBe(1);
  });

  it('writes nothing when there is no number to read', async () => {
    const response = await sendAlert({});
    const caseId = response.body.data.case.id as string;

    const contact = await request(app)
      .get(`${BASE}/emergency/cases/${caseId}/contact`)
      .set('Authorization', bearer(shapla.erToken));
    expect(contact.body.data.phone).toBeNull();
    expect(await auditedReadsOf(caseId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The ward (BTN-B07-ADMIT, FR-BED-07)
// ---------------------------------------------------------------------------

describe('handing a case to the ward (BTN-B07-ADMIT, FR-BED-07)', () => {
  it('puts it on the pending list, and the ward places it in a bed', async () => {
    const beds = await createBedFixture(2, 'general');
    const arrived = await walkIn({ problem: 'cardiac', triage: 'red', ageYears: 61, sex: 'male' });
    const caseId = arrived.body.data.case.id as string;

    const handed = await patch(caseId, { action: 'handoff', bedKind: 'general' });
    expect(handed.status).toBe(200);
    expect(handed.body.data.case.admitBedKind).toBe('general');
    expect(emitted.forRoom(ROOMS.beds(shapla.hospitalId)).map((entry) => entry.event)).toContain(
      'emergency.handoff',
    );

    const pending = await request(app)
      .get(`${BASE}/hospitals/${shapla.hospitalId}/bed-requests`)
      .set('Authorization', bearer(beds.wardToken));
    const handoff = (pending.body.data.handoffs as { caseId: string; bedKind: string }[]).find(
      (entry) => entry.caseId === caseId,
    );
    expect(handoff?.bedKind).toBe('general');

    const bedId = beds.bedIds[0] ?? '';
    const admitted = await request(app)
      .post(`${BASE}/beds/${bedId}/admit`)
      .set('Authorization', bearer(beds.wardToken))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: randomUUID(),
        clientTs: new Date().toISOString(),
        emergencyCaseId: caseId,
        patient: deskPatient('আবুল কালাম (ডেমো)'),
      });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(200);

    const row = await caseRow(caseId);
    expect(row.state).toBe('admitted');
    expect(row.patient_id).not.toBeNull();

    const stay = await sql<{ source: string; emergency_case_id: string | null }>`
      SELECT source, emergency_case_id FROM admissions WHERE bed_id = ${bedId}::uuid
    `.execute(db);
    expect(stay.rows[0]).toEqual({ source: 'er', emergency_case_id: caseId });

    // It leaves the ER's list as a case, and the ward's as a handoff.
    const after = await request(app)
      .get(`${BASE}/hospitals/${shapla.hospitalId}/bed-requests`)
      .set('Authorization', bearer(beds.wardToken));
    expect(
      (after.body.data.handoffs as { caseId: string }[]).some((entry) => entry.caseId === caseId),
    ).toBe(false);
  });

  it('refuses to admit a case the ER never handed over', async () => {
    const beds = await createBedFixture(1, 'general');
    const arrived = await walkIn({ problem: 'other' });
    const caseId = arrived.body.data.case.id as string;

    const response = await request(app)
      .post(`${BASE}/beds/${beds.bedIds[0] ?? ''}/admit`)
      .set('Authorization', bearer(beds.wardToken))
      .set('Idempotency-Key', randomUUID())
      .send({ clientEventId: randomUUID(), emergencyCaseId: caseId, patient: deskPatient() });

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('NOT_HANDED_OFF');
  });

  it('refuses a kind of bed the hospital does not have', async () => {
    const arrived = await walkIn({ problem: 'burn' });
    const response = await patch(arrived.body.data.case.id as string, {
      action: 'handoff',
      bedKind: 'burn',
    });
    expect(response.status).toBe(400);
    expect(response.body.error.details.reason).toBe('not_at_this_hospital');
  });
});

// ---------------------------------------------------------------------------
// Capabilities (FR-EMG-05)
// ---------------------------------------------------------------------------

describe('PUT /hospitals/:id/capabilities — published to the network (FR-EMG-05)', () => {
  async function put(
    hospitalId: string,
    capabilities: { kind: string; available: boolean }[],
    token: string,
  ): Promise<request.Response> {
    return await request(app)
      .put(`${BASE}/hospitals/${hospitalId}/capabilities`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send({ clientEventId: randomUUID(), capabilities });
  }

  it('reaches the next search at once, and renews the freshness when re-sent', async () => {
    const padma = await erFixture('Padma Specialised');
    try {
      const off = await put(
        padma.hospitalId,
        [{ kind: 'burn_unit', available: false }],
        padma.erToken,
      );
      expect(off.status).toBe(200);

      const found = await searchFrom({ ...FARMGATE, problem: 'burn' });
      expect(found.results.find((result) => result.hospitalId === padma.hospitalId)).toMatchObject({
        hasCapability: false,
      });

      const row = await sql<{ updated_by: string | null }>`
        SELECT updated_by FROM capabilities
         WHERE hospital_id = ${padma.hospitalId}::uuid AND kind = 'burn_unit'
      `.execute(db);
      expect(row.rows[0]?.updated_by).toBe(padma.erStaffId);
      expect(
        emitted.forRoom(ROOMS.emergency(padma.hospitalId)).map((entry) => entry.event),
      ).toContain('capabilities.updated');
    } finally {
      // The rest of the suite, and the pitch, need Padma's burn unit.
      await put(padma.hospitalId, [{ kind: 'burn_unit', available: true }], padma.erToken);
    }
  });

  it('refuses a capability the hospital never declared', async () => {
    const response = await put(
      shapla.hospitalId,
      [{ kind: 'burn_unit', available: true }],
      shapla.erToken,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.details.reason).toBe('not_declared_here');
  });

  it('lets the administrator set them, and nobody else', async () => {
    const same = [{ kind: 'dialysis', available: true }];
    expect((await put(shapla.hospitalId, same, shapla.adminToken)).status).toBe(200);
    expect((await put(shapla.hospitalId, same, shapla.wardToken)).status).toBe(403);
    expect((await put(shapla.hospitalId, same, shapla.receptionistToken)).status).toBe(403);

    const padma = await erFixture('Padma Specialised');
    expect((await put(shapla.hospitalId, same, padma.erToken)).status).toBe(403);
  });
});
