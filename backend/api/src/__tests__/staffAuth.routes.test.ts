/**
 * Staff sign-in (pilot step 21, `S-B-00`, FR-SEC-06, BACKEND.md §7.1).
 *
 * Against the seeded demo database: a seeded account signs in with the
 * documented demo password, which is also the check that the seeds and the API
 * hash passwords the same way. Accounts a test changes — locked, deactivated,
 * given a temporary password — are made per test, so no test leaves a seeded
 * account in a state another depends on.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { verifyToken } from '../config/jwt.js';
import { hashPassword } from '../config/password.js';

import { guestToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/**
 * `DEMO_STAFF_PASSWORD` in `database/seeds/lib/demo.ts`. Written out rather
 * than imported (the API may not import the seeds); the first test fails the
 * day the two disagree.
 */
const DEMO_PASSWORD = 'demo-password-2026';

/** A password the per-test accounts use. */
const PASSWORD = 'correct-horse-battery';

let app: Express;
let shapla: { id: string; code: string };
let padma: { id: string; code: string };
let seededReception: string;

async function hospital(code: string): Promise<{ id: string; code: string }> {
  const result = await sql<{ id: string }>`SELECT id FROM hospitals WHERE code = ${code}`.execute(
    db,
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`No seeded facility with code ${code} (FR-DEM-01).`);
  return { id, code };
}

/** A fresh account for one test. */
async function makeStaff(
  options: {
    readonly hospitalId?: string;
    readonly roles?: readonly string[];
    readonly password?: string;
    readonly mustChange?: boolean;
    readonly active?: boolean;
    readonly email?: string;
  } = {},
): Promise<{ id: string; email: string }> {
  const hospitalId = options.hospitalId ?? shapla.id;
  const email = options.email ?? `t-${randomUUID().slice(0, 8)}@shapla.demo.invalid`;
  const hash = await hashPassword(options.password ?? PASSWORD);
  const inserted = await sql<{ id: string }>`
    INSERT INTO staff_users (hospital_id, email, full_name, password_hash, must_change_password, is_active)
    VALUES (${hospitalId}, ${email}, 'পরীক্ষা (ডেমো)', ${hash}, ${options.mustChange ?? false},
            ${options.active ?? true})
    RETURNING id
  `.execute(db);
  const id = inserted.rows[0]?.id ?? '';
  for (const role of options.roles ?? ['receptionist']) {
    await sql`
      INSERT INTO staff_roles (staff_user_id, hospital_id, role)
      VALUES (${id}, ${hospitalId}, ${role}::staff_role)
    `.execute(db);
  }
  return { id, email };
}

async function login(body: Record<string, unknown>): Promise<request.Response> {
  return await request(app).post(`${BASE}/staff/login`).send(body);
}

beforeAll(async () => {
  shapla = await hospital('SHAPLA');
  padma = await hospital('PADMA');
  const reception = await sql<{ email: string }>`
    SELECT su.email FROM staff_users su
      JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.role = 'receptionist'
     WHERE su.hospital_id = ${shapla.id} AND su.deleted_at IS NULL
     ORDER BY su.email LIMIT 1
  `.execute(db);
  seededReception = reception.rows[0]?.email ?? '';
  if (seededReception === '') throw new Error('No seeded receptionist at Shapla (FR-DEM-01).');
});

beforeEach(() => {
  app = createApp();
});

describe('POST /staff/login', () => {
  it('signs a seeded demo account in with the documented demo password', async () => {
    const response = await login({ email: seededReception, password: DEMO_PASSWORD });

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.roles).toContain('receptionist');
    expect(data.hospital).toMatchObject({ id: shapla.id, code: 'SHAPLA' });
    expect(data.mustChangePassword).toBe(false);
    expect(data.refresh).toMatch(/^[0-9a-f-]{36}\..{20,}$/);

    // The same claims the demo picker's token carries, so every guard since
    // step 3 applies unchanged.
    const verified = await verifyToken(data.access, 'access');
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.kind).toBe('staff');
      expect(verified.claims.hospitalId).toBe(shapla.id);
      expect(verified.claims.roles).toContain('receptionist');
      expect(verified.claims.mcp).toBeUndefined();
    }
  });

  it('matches the email whatever its case', async () => {
    const staff = await makeStaff();
    const response = await login({ email: staff.email.toUpperCase(), password: PASSWORD });
    expect(response.status).toBe(200);
  });

  it('gives an unknown email and a wrong password the same answer', async () => {
    const staff = await makeStaff();
    const wrong = await login({ email: staff.email, password: 'not-the-password' });
    const unknown = await login({ email: 'nobody@shapla.demo.invalid', password: PASSWORD });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(unknown.body.error).toEqual(wrong.body.error);
  });

  it('locks an account after five failures, and the right password waits too', async () => {
    const staff = await makeStaff();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(
        (await login({ email: staff.email, password: `wrong-${String(attempt)}` })).status,
      ).toBe(401);
    }
    const fifth = await login({ email: staff.email, password: 'wrong-5' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('AUTH_LOCKED');
    expect(Date.parse(fifth.body.error.details.until)).toBeGreaterThan(Date.now());

    const right = await login({ email: staff.email, password: PASSWORD });
    expect(right.status).toBe(423);
  });

  it('clears the failure count on a success', async () => {
    const staff = await makeStaff();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await login({ email: staff.email, password: 'wrong' });
    }
    expect((await login({ email: staff.email, password: PASSWORD })).status).toBe(200);
    // Four more failures do not lock it: the count started again.
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await login({ email: staff.email, password: 'wrong' })).status).toBe(401);
    }
  });

  it('refuses a deactivated account as if the password were wrong', async () => {
    const staff = await makeStaff({ active: false });
    const response = await login({ email: staff.email, password: PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('says so when an account has no role to open anything with', async () => {
    const staff = await makeStaff({ roles: [] });
    const response = await login({ email: staff.email, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('no_roles');
  });

  it('asks for the hospital code only when the password opens two facilities', async () => {
    const email = `same-${randomUUID().slice(0, 8)}@demo.invalid`;
    await makeStaff({ email, hospitalId: shapla.id });
    await makeStaff({ email, hospitalId: padma.id, roles: ['ward'] });

    const ambiguous = await login({ email, password: PASSWORD });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error.code).toBe('AUTH_HOSPITAL_REQUIRED');

    const withCode = await login({ email, password: PASSWORD, hospitalCode: 'padma' });
    expect(withCode.status).toBe(200);
    expect(withCode.body.data.hospital.id).toBe(padma.id);
    expect(withCode.body.data.roles).toEqual(['ward']);
  });

  it('needs no code when only one of the accounts has that password', async () => {
    const email = `split-${randomUUID().slice(0, 8)}@demo.invalid`;
    await makeStaff({ email, hospitalId: shapla.id, password: 'shapla-password-1' });
    await makeStaff({ email, hospitalId: padma.id, password: 'padma-password-22' });

    const response = await login({ email, password: 'padma-password-22' });
    expect(response.status).toBe(200);
    expect(response.body.data.hospital.id).toBe(padma.id);
  });

  it('signs a national account in with no facility on the token', async () => {
    const response = await login({ email: 'gov@national.demo.invalid', password: DEMO_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.data.hospital).toBeNull();
    expect(response.body.data.roles).toEqual(['gov_viewer']);

    const chambers = await request(app)
      .get(`${BASE}/staff/chambers`)
      .set('Authorization', `Bearer ${response.body.data.access}`);
    expect(chambers.status).toBe(403);
  });

  it('refuses a body with fields it does not know', async () => {
    const response = await login({ email: 'a@b.c', password: 'x', role: 'hospital_admin' });
    expect(response.status).toBe(400);
  });
});

describe('refresh tokens', () => {
  it('rotate: a refresh works once, and a reused one ends every session', async () => {
    const staff = await makeStaff();
    const first = (await login({ email: staff.email, password: PASSWORD })).body.data;

    const second = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: first.refresh });
    expect(second.status).toBe(200);
    expect(second.body.data.refresh).not.toBe(first.refresh);

    const reused = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: first.refresh });
    expect(reused.status).toBe(401);
    expect(reused.body.error.details.reason).toBe('reused');

    // Two parties held the first token, so the one issued from it is revoked too.
    const afterTheft = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: second.body.data.refresh });
    expect(afterTheft.status).toBe(401);
  });

  it('stop working after logout', async () => {
    const staff = await makeStaff();
    const session = (await login({ email: staff.email, password: PASSWORD })).body.data;

    const out = await request(app).post(`${BASE}/staff/logout`).send({ refresh: session.refresh });
    expect(out.status).toBe(200);

    const refreshed = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: session.refresh });
    expect(refreshed.status).toBe(401);
  });

  it('are refused for an account deactivated since', async () => {
    const staff = await makeStaff();
    const session = (await login({ email: staff.email, password: PASSWORD })).body.data;
    await sql`UPDATE staff_users SET is_active = false WHERE id = ${staff.id}`.execute(db);

    const refreshed = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: session.refresh });
    expect(refreshed.status).toBe(401);
  });

  it('refuse a made-up token', async () => {
    const response = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: `${randomUUID()}.${'x'.repeat(40)}` });
    expect(response.status).toBe(401);
  });
});

describe('a password an administrator set', () => {
  it('opens nothing but the password change until the person sets their own', async () => {
    const staff = await makeStaff({ mustChange: true });
    const session = (await login({ email: staff.email, password: PASSWORD })).body.data;
    expect(session.mustChangePassword).toBe(true);

    const blocked = await request(app)
      .get(`${BASE}/staff/chambers`)
      .set('Authorization', `Bearer ${session.access}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');

    const me = await request(app)
      .get(`${BASE}/staff/me`)
      .set('Authorization', `Bearer ${session.access}`);
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);

    const change = (next: string) =>
      request(app)
        .post(`${BASE}/staff/password`)
        .set('Authorization', `Bearer ${session.access}`)
        .send({ current: PASSWORD, next });

    const short = await change('short');
    expect(short.status).toBe(422);
    expect(short.body.error.details.reason).toBe('too_short');

    const same = await change(PASSWORD);
    expect(same.status).toBe(422);
    expect(same.body.error.details.reason).toBe('unchanged');

    const changed = await change('my-own-long-password');
    expect(changed.status).toBe(200);
    expect(changed.body.data.mustChangePassword).toBe(false);

    const opened = await request(app)
      .get(`${BASE}/staff/chambers`)
      .set('Authorization', `Bearer ${changed.body.data.access}`);
    expect(opened.status).toBe(200);

    // The old refresh token went with the old password.
    const oldRefresh = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: session.refresh });
    expect(oldRefresh.status).toBe(401);

    expect((await login({ email: staff.email, password: 'my-own-long-password' })).status).toBe(
      200,
    );
    expect((await login({ email: staff.email, password: PASSWORD })).status).toBe(401);
  });

  it('asks for the current password, and a wrong one counts as a failure', async () => {
    const staff = await makeStaff();
    const session = (await login({ email: staff.email, password: PASSWORD })).body.data;
    const response = await request(app)
      .post(`${BASE}/staff/password`)
      .set('Authorization', `Bearer ${session.access}`)
      .send({ current: 'not-it', next: 'another-long-password' });
    expect(response.status).toBe(401);

    const failures = await sql<{ n: number }>`
      SELECT failed_login_count AS n FROM staff_users WHERE id = ${staff.id}
    `.execute(db);
    expect(failures.rows[0]?.n).toBe(1);
  });
});

describe('GET /staff/chambers', () => {
  it("lists today's chambers at the caller's own facility and no other", async () => {
    const session = (await login({ email: seededReception, password: DEMO_PASSWORD })).body.data;
    const response = await request(app)
      .get(`${BASE}/staff/chambers`)
      .set('Authorization', `Bearer ${session.access}`);

    expect(response.status).toBe(200);
    const chambers = response.body.data.chambers as { hospitalId: string }[];
    expect(chambers.every((chamber) => chamber.hospitalId === shapla.id)).toBe(true);
  });
});

describe('the auth matrix for /staff (FR-ROLE-01)', () => {
  it('refuses /staff/me and /staff/chambers without a token', async () => {
    expect((await request(app).get(`${BASE}/staff/me`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/staff/chambers`)).status).toBe(401);
  });

  it('refuses a guest', async () => {
    const token = await guestToken();
    const me = await request(app).get(`${BASE}/staff/me`).set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(403);
  });
});

describe('GET /demo/status', () => {
  it('says whether the password-less picker is on', async () => {
    const response = await request(app).get(`${BASE}/demo/status`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ demoMode: true });
  });
});
