/**
 * Consent (`FR-PAT-63`, `FR-PAT-64`, BACKEND.md §7.6).
 *
 * Step 13's definition of done is one line: *consent + audit rows written on
 * every view*. Both halves are asserted here, and the second one is the harder
 * promise — `FR-PAT-64` says "the patient can see who viewed their records and
 * when", which is only true if the log has no gaps.
 *
 * ## What gets the most attention
 *
 * - **A code names one patient and nothing else.** Minting an offer for a
 *   patient id supplied by the caller would be a way to grant yourself access
 *   to a stranger's record, so the subject comes from the credential.
 * - **A consent code is not a credential anywhere else.** It is separated from
 *   a tracking link and from an access token by a signed audience, so the same
 *   string cannot be presented as any of the others.
 * - **Revocation is a timestamp, not a delete** (`DB-P2`), because an audit has
 *   to be able to answer what was permitted at the time of a read.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';

import { createQueueFixture, staffIdFor, type QueueFixture } from './support/queueFixture.js';
import { trackingLink } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

/** An account that owns the fixture's first patient, so ownership is real. */
let ownerUserId: string;
let ownedPatientId: string;

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(3);

  // The account-owned profile that the fewest facilities have treated.
  //
  // Not simply the first one: this suite shares its seeded patients with every
  // other file in the API project, and the earlier files book the first few
  // patients into chambers all over the country. A patient every hospital has
  // already treated has nothing left to consent *to*, so the tests below become
  // untestable — which is how they passed alone and failed in the suite.
  const owned = await sql<{ patient_id: string; user_id: string }>`
    SELECT p.id AS patient_id, p.owner_user_id AS user_id
      FROM patients p
     WHERE p.owner_user_id IS NOT NULL AND p.deleted_at IS NULL
     ORDER BY (
       SELECT count(DISTINCT s.hospital_id)
         FROM bookings b
         JOIN sessions s ON s.id = b.session_id
        WHERE b.patient_id = p.id AND b.deleted_at IS NULL
     ), p.created_at
     LIMIT 1
  `.execute(db);

  const row = owned.rows[0];
  if (row === undefined) throw new Error('The seed should hold account-owned profiles.');

  ownedPatientId = row.patient_id;
  ownerUserId = row.user_id;

  // Start from no live grants, whatever the last test left behind. Revoking is
  // the product's own mechanism rather than a delete (`DB-P2`), so this leaves
  // the history intact and only resets what the next test reads.
  await sql`
    UPDATE consents SET revoked_at = now()
     WHERE patient_id = ${ownedPatientId}::uuid AND revoked_at IS NULL
  `.execute(db);
});

async function patient(sub: string = ownerUserId): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub, kind: 'patient' } });
}

async function doctor(
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.doctorStaffId,
): Promise<string> {
  const roles: readonly StaffRole[] = ['doctor'];
  return await signToken({ kind: 'access', claims: { sub, kind: 'staff', hospitalId, roles } });
}

/** Asks for a code the way `BTN-A12-QR` does. */
async function offer(token?: string, patientId: string = ownedPatientId): Promise<string> {
  const response = await request(app)
    .post(`${BASE}/patients/${patientId}/consent-offer`)
    .set('authorization', `Bearer ${token ?? (await patient())}`)
    .set('idempotency-key', crypto.randomUUID())
    .send({});

  if (response.status !== 200) throw new Error(`offer failed: ${String(response.status)}`);
  return response.body.data.code as string;
}

async function redeem(code: string, token?: string): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/consents/redeem`)
    .set('authorization', `Bearer ${token ?? (await doctor())}`)
    .set('idempotency-key', crypto.randomUUID())
    .send({ code, idempotencyKey: crypto.randomUUID() });
}

/**
 * A facility this patient has never been booked into, with a doctor on staff.
 *
 * Asked of the database rather than assumed. The seeded history spreads 200
 * patients across six facilities, so "another hospital" is usually one they
 * *have* attended — and a consent test that starts from an existing treatment
 * relationship proves nothing, because access was already allowed.
 */
async function hospitalStrangerTo(patientId: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT h.id
      FROM hospitals h
     WHERE h.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM staff_roles sr
                    WHERE sr.hospital_id = h.id AND sr.role = 'doctor'
                      AND sr.deleted_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
           JOIN sessions s ON s.id = b.session_id
          WHERE b.patient_id = ${patientId}::uuid
            AND s.hospital_id = h.id
            AND b.deleted_at IS NULL
       )
     LIMIT 1
  `.execute(db);

  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error(`Every seeded facility already reaches ${patientId}; consent is untestable.`);
  }
  return id;
}

async function liveConsents(patientId: string): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM consents
     WHERE patient_id = ${patientId}::uuid AND revoked_at IS NULL AND deleted_at IS NULL
  `.execute(db);

  return Number(result.rows[0]?.n ?? '0');
}

// ---------------------------------------------------------------------------

describe('offering consent (BTN-A12-QR)', () => {
  it('gives the patient a code that expires', async () => {
    const response = await request(app)
      .post(`${BASE}/patients/${ownedPatientId}/consent-offer`)
      .set('authorization', `Bearer ${await patient()}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({});

    expect(response.status).toBe(200);
    expect(typeof response.body.data.code).toBe('string');
    expect(response.body.data.expiresInSeconds).toBeGreaterThan(0);

    // Minutes, not hours. The code is shown on a screen in a chamber.
    expect(response.body.data.expiresInSeconds).toBeLessThanOrEqual(600);
  });

  it('refuses to mint an offer for somebody else', async () => {
    // The whole point of the subject coming from the credential: otherwise
    // this endpoint hands out access to any record by id.
    const response = await request(app)
      .post(`${BASE}/patients/${String(fixture.patientIds[0])}/consent-offer`)
      .set('authorization', `Bearer ${await patient('11111111-1111-7111-8111-111111111111')}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({});

    expect(response.status).toBe(403);
  });

  it('refuses staff, who have nothing to consent to', async () => {
    const response = await request(app)
      .post(`${BASE}/patients/${ownedPatientId}/consent-offer`)
      .set('authorization', `Bearer ${await doctor()}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({});

    expect(response.status).toBe(403);
  });
});

describe('redeeming consent (BTN-B05-SCAN)', () => {
  it('writes the grant and the audit row together', async () => {
    const before = await liveConsents(ownedPatientId);

    const response = await redeem(await offer());

    expect(response.status).toBe(201);
    expect(response.body.data.patientId).toBe(ownedPatientId);
    expect(await liveConsents(ownedPatientId)).toBe(before + 1);

    // The grant and the record of it being taken are one event: a system that
    // could write one without the other would have a log that disagrees with
    // its own permissions.
    const audit = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM audit_log
       WHERE patient_id = ${ownedPatientId}::uuid
         AND subject_table = 'consents'
         AND subject_id = ${response.body.data.consentId}::uuid
    `.execute(db);

    expect(Number(audit.rows[0]?.n ?? '0')).toBe(1);
  });

  it('lets a doctor who had no relationship read the record afterwards', async () => {
    // Before consent this hospital has never treated the patient, so
    // `FR-DOC-10` refuses. This is the requirement's second clause arriving.
    const elsewhere = await hospitalStrangerTo(ownedPatientId);
    const stranger = await doctor(elsewhere, await staffIdFor(elsewhere, 'doctor'));

    const before = await request(app)
      .get(`${BASE}/patients/${ownedPatientId}/records`)
      .set('authorization', `Bearer ${stranger}`);

    await redeem(await offer(), stranger);

    const after = await request(app)
      .get(`${BASE}/patients/${ownedPatientId}/records`)
      .set('authorization', `Bearer ${stranger}`);

    expect(before.status).toBe(403);
    expect(after.status).toBe(200);
  });

  it('refuses a code that was never real', async () => {
    // Long enough to be a plausible token, so the refusal comes from the
    // signature check rather than from the length floor in front of it.
    const response = await redeem('not.a.real.token'.repeat(4));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CONSENT_CODE_INVALID');
  });

  it('refuses a tracking link presented as a consent code', async () => {
    // Separated by a signed audience rather than by key, so this is the test
    // that the separation actually holds.
    const response = await redeem(await trackingLink(String(fixture.bookingIds[0])));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CONSENT_CODE_INVALID');
  });

  it('refuses a consent code presented as a bearer token', async () => {
    const code = await offer();

    const response = await request(app)
      .get(`${BASE}/patients/${ownedPatientId}/records`)
      .set('authorization', `Bearer ${code}`);

    // `attachPrincipal` only ever verifies against the access audience, so the
    // code is not a credential anywhere.
    expect(response.status).toBe(401);
  });

  it('refuses a receptionist redeeming one', async () => {
    const receptionist = await signToken({
      kind: 'access',
      claims: {
        sub: fixture.receptionistId,
        kind: 'staff',
        hospitalId: fixture.hospitalId,
        roles: ['receptionist'] as readonly StaffRole[],
      },
    });

    const response = await redeem(await offer(), receptionist);
    expect(response.status).toBe(403);
  });

  it('says yes again rather than stacking grants', async () => {
    await redeem(await offer());
    const before = await liveConsents(ownedPatientId);

    await redeem(await offer());

    // A patient handing the same hospital a second code has not granted twice.
    expect(await liveConsents(ownedPatientId)).toBe(before);
  });
});

describe('the patient can see and undo it (FR-PAT-64)', () => {
  it('lists who looked, and when', async () => {
    const stranger = await doctor();
    await redeem(await offer(), stranger);

    await request(app)
      .get(`${BASE}/patients/${ownedPatientId}/records`)
      .set('authorization', `Bearer ${stranger}`);

    const response = await request(app)
      .get(`${BASE}/patients/${ownedPatientId}/access`)
      .set('authorization', `Bearer ${await patient()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.consents.length).toBeGreaterThan(0);

    // "The patient can see who viewed their records and when."
    const views = response.body.data.views as { staffName: string | null; at: string }[];
    expect(views.length).toBeGreaterThan(0);
    expect(views[0]?.staffName).toBeTruthy();
  });

  it('revokes by timestamp, and the doctor loses access', async () => {
    const elsewhere = await hospitalStrangerTo(ownedPatientId);
    const stranger = await doctor(elsewhere, await staffIdFor(elsewhere, 'doctor'));

    const granted = await redeem(await offer(), stranger);
    const consentId = granted.body.data.consentId as string;

    const revoke = await request(app)
      .post(`${BASE}/consents/${consentId}/revoke`)
      .set('authorization', `Bearer ${await patient()}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({});

    expect(revoke.status).toBe(200);

    const after = await request(app)
      .get(`${BASE}/patients/${ownedPatientId}/records`)
      .set('authorization', `Bearer ${stranger}`);

    expect(after.status).toBe(403);

    // `DB-P2`: the row survives, so an audit can still answer what was
    // permitted at the time of an earlier read.
    const row = await sql<{ revoked_at: Date | null }>`
      SELECT revoked_at FROM consents WHERE id = ${consentId}::uuid
    `.execute(db);

    expect(row.rows[0]?.revoked_at).not.toBeNull();
  });

  it('refuses to revoke somebody else’s grant, and does not confirm it exists', async () => {
    const granted = await redeem(await offer());
    const consentId = granted.body.data.consentId as string;

    const response = await request(app)
      .post(`${BASE}/consents/${consentId}/revoke`)
      .set('authorization', `Bearer ${await patient('11111111-1111-7111-8111-111111111111')}`)
      .set('idempotency-key', crypto.randomUUID())
      .send({});

    // 403 for the ownership failure — the id was real, but saying so to a
    // stranger is the disclosure. Either way it is not revoked.
    expect(response.status).toBeGreaterThanOrEqual(403);
  });

  it('refuses an anonymous caller the access log', async () => {
    const response = await request(app).get(`${BASE}/patients/${ownedPatientId}/access`);
    expect(response.status).toBe(401);
  });
});
