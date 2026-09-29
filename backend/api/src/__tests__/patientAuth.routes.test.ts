/**
 * A patient signs in with a phone and a one-time code, and claims what that
 * number holds (pilot step 25, `S-A-03`, `S-A-04`, `S-A-20`, `FR-PAT-01`,
 * `FR-PAT-04`, `FR-GST-09`, `FR-IMP-10`, `FR-SEC-05`).
 *
 * The suite runs with `DEMO_MODE=true`, so a code comes back in the response;
 * the SMS itself is captured by a recording adapter, which is how the test
 * knows the code was sent marked sensitive and never printed.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetSmsAdapter, setSmsAdapter, type SmsMessage } from '../adapters/sms.js';
import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { bearer, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';
let app: Express;
const sent: SmsMessage[] = [];

/** A number nobody else in the run uses, as the patient types it. */
function freshPhone(): { typed: string; stored: string } {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return { typed: `017${tail}`, stored: `+88017${tail}` };
}

async function askCode(phone: string, agent = 'test-device'): Promise<request.Response> {
  return await request(app).post(`${BASE}/auth/otp`).set('user-agent', agent).send({ phone });
}

async function signIn(phone: string, agent = 'test-device'): Promise<request.Response> {
  const asked = await askCode(phone, agent);
  return await request(app)
    .post(`${BASE}/auth/verify`)
    .set('user-agent', agent)
    .send({ phone, code: asked.body.data.demoCode as string });
}

beforeAll(() => {
  app = createApp();
  setSmsAdapter({
    name: 'recording',
    send: async (message) => {
      sent.push(message);
      return await Promise.resolve({ ok: true, providerRef: 'rec', costPoisha: 0 });
    },
  });
});

afterAll(() => {
  resetSmsAdapter();
});

describe('the code (FR-PAT-01, FR-SEC-05)', () => {
  it('is sent by SMS marked sensitive, and answered in the demo only', async () => {
    const phone = freshPhone();
    const response = await askCode(phone.typed);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ ttlSeconds: 300, resendAfterSeconds: 60 });
    const code = response.body.data.demoCode as string;
    expect(code).toMatch(/^\d{6}$/);
    const message = sent.at(-1);
    expect(message).toMatchObject({ to: phone.stored, sensitive: true, templateKey: 'auth.otp' });
    expect(message?.body.startsWith(code)).toBe(true);
    // Only a keyed hash is stored.
    const stored = await sql<{ code_hash: string }>`
      SELECT code_hash FROM otp_challenges WHERE phone = ${phone.stored} ORDER BY created_at DESC LIMIT 1
    `.execute(db);
    expect(stored.rows[0]?.code_hash).not.toContain(code);
  });

  it('signs a new number in and makes its account', async () => {
    const phone = freshPhone();
    const response = await signIn(phone.typed);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      isNew: true,
      user: { phone: phone.stored },
      claimable: 0,
    });
    expect(typeof response.body.data.access).toBe('string');
    const again = await signIn(phone.typed);
    expect(again.body.data.isNew).toBe(false);
  });

  it('refuses a wrong code, says how many tries are left, and locks after five', async () => {
    const phone = freshPhone();
    await askCode(phone.typed);
    let last: request.Response | null = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      last = await request(app)
        .post(`${BASE}/auth/verify`)
        .send({ phone: phone.typed, code: '000000' });
      if (attempt < 5)
        expect(last.body.error).toMatchObject({
          code: 'AUTH_OTP_INVALID',
          details: { attemptsLeft: 5 - attempt },
        });
    }
    expect(last?.status).toBe(423);
    expect(last?.body.error.code).toBe('AUTH_LOCKED');
    // Locked: no new code either, for fifteen minutes.
    expect((await askCode(phone.typed)).status).toBe(423);
  });

  it('sends a number at most five codes an hour', async () => {
    const phone = freshPhone();
    for (let sentCount = 0; sentCount < 5; sentCount += 1) {
      expect((await askCode(phone.typed)).status).toBe(200);
    }
    const sixth = await askCode(phone.typed);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('AUTH_OTP_RATE_LIMIT');
  });

  it('lets only the latest code work', async () => {
    const phone = freshPhone();
    const first = (await askCode(phone.typed)).body.data.demoCode as string;
    const second = (await askCode(phone.typed)).body.data.demoCode as string;
    if (first !== second) {
      const old = await request(app)
        .post(`${BASE}/auth/verify`)
        .send({ phone: phone.typed, code: first });
      expect(old.status).toBe(401);
    }
    const current = await request(app)
      .post(`${BASE}/auth/verify`)
      .send({ phone: phone.typed, code: second });
    expect(current.status).toBe(200);
  });
});

describe('the session (rotation and device binding)', () => {
  it('rotates on refresh, ends everything when a token is used twice, and refuses another device', async () => {
    const phone = freshPhone();
    const signedIn = await signIn(phone.typed, 'phone-A');
    const first = signedIn.body.data.refresh as string;

    const rotated = await request(app)
      .post(`${BASE}/auth/refresh`)
      .set('user-agent', 'phone-A')
      .send({ refresh: first });
    expect(rotated.status).toBe(200);
    const second = rotated.body.data.refresh as string;

    // The first token again: two parties hold it, so every session ends.
    const reused = await request(app)
      .post(`${BASE}/auth/refresh`)
      .set('user-agent', 'phone-A')
      .send({ refresh: first });
    expect(reused.body.error.details.reason).toBe('reused');
    const afterReuse = await request(app)
      .post(`${BASE}/auth/refresh`)
      .set('user-agent', 'phone-A')
      .send({ refresh: second });
    expect(afterReuse.status).toBe(401);

    // Carried to another device (FR-SEC-05).
    const fresh = (await signIn(phone.typed, 'phone-A')).body.data.refresh as string;
    const elsewhere = await request(app)
      .post(`${BASE}/auth/refresh`)
      .set('user-agent', 'phone-B')
      .send({ refresh: fresh });
    expect(elsewhere.body.error.details.reason).toBe('device');
  });
});

describe('claiming what the number holds (FR-GST-09, FR-IMP-10, FR-PAT-04)', () => {
  let phone: { typed: string; stored: string };
  let hospitalId: string;

  beforeAll(async () => {
    phone = freshPhone();
    // Held for this number as a guest: a counter registration makes exactly this.
    hospitalId =
      (
        await sql<{
          id: string;
        }>`SELECT id FROM hospitals WHERE deleted_at IS NULL ORDER BY name_en LIMIT 1`.execute(db)
      ).rows[0]?.id ?? '';
    const staffId = (
      await sql<{ id: string }>`
        SELECT su.id FROM staff_users su JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.role = 'receptionist'
         WHERE su.hospital_id = ${hospitalId} LIMIT 1
      `.execute(db)
    ).rows[0]?.id;
    const counter = await signToken({
      kind: 'access',
      claims: { sub: staffId ?? '', kind: 'staff', hospitalId, roles: ['receptionist'] },
    });
    const registered = await request(app)
      .post(`${BASE}/registration/patients`)
      .set('Authorization', bearer(counter))
      .set('Idempotency-Key', randomUUID())
      .send({ phone: phone.typed, fullName: 'দাবিদার রোগী (ডেমো)', ageYears: 52, sex: 'female' });
    expect(registered.status).toBe(200);
    // And one a hospital imported with the same number.
    await sql`
      INSERT INTO patients (owner_hospital_id, full_name, age_years, sex, phone, relationship, is_primary)
      VALUES (${hospitalId}, 'আমদানি দাবি (ডেমো)', 60, 'male', ${phone.stored}, 'self', false)
    `.execute(db);
  });

  it('lists both at sign-in, takes them over in one step, and the records follow', async () => {
    const signedIn = await signIn(phone.typed);
    expect(signedIn.body.data.claimable).toBe(2);
    const access = signedIn.body.data.access as string;

    const preview = await request(app)
      .post(`${BASE}/guest/claim`)
      .set('Authorization', bearer(access))
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(
      (preview.body.data.claimable as { fullName: string }[]).map((entry) => entry.fullName).sort(),
    ).toEqual(['আমদানি দাবি (ডেমো)', 'দাবিদার রোগী (ডেমো)']);

    const claimed = await request(app)
      .post(`${BASE}/guest/claim`)
      .set('Authorization', bearer(access))
      .set('Idempotency-Key', randomUUID())
      .send({ confirm: true });
    expect(claimed.body.data.claimed).toBe(2);

    const profiles = await request(app)
      .get(`${BASE}/me/profiles`)
      .set('Authorization', bearer(access));
    expect(profiles.body.data.profiles).toHaveLength(2);
    // Now the account's own: its records are readable with its token.
    const patientId = (profiles.body.data.profiles as { patientId: string }[])[0]?.patientId ?? '';
    const records = await request(app)
      .get(`${BASE}/patients/${patientId}/records`)
      .set('Authorization', bearer(access));
    expect(records.status).toBe(200);
    // Nothing left to claim.
    expect((await signIn(phone.typed)).body.data.claimable).toBe(0);
  });

  it('is an account holder’s alone: a staff token cannot claim', async () => {
    const staff = await staffToken(['receptionist'], hospitalId);
    const response = await request(app)
      .post(`${BASE}/guest/claim`)
      .set('Authorization', bearer(staff))
      .set('Idempotency-Key', randomUUID())
      .send({ confirm: true });
    expect(response.status).toBe(403);
  });
});
