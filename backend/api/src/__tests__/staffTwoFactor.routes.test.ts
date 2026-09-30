/**
 * The staff second factor (pilot step 28, FR-SEC-10, FR-SEC-06,
 * BACKEND.md §7.1): `POST /staff/2fa`, `/staff/2fa/setup`, `/staff/2fa/enable`,
 * and the administrator's reset on `S-B-11`.
 *
 * The step's test of done: **an administrator cannot sign in without the
 * second factor.** A password alone opens only the setup, and once it is on, a
 * password alone opens nothing at all.
 *
 * Against the seeded demo database, with an account made per test so no test
 * leaves a seeded account with a second factor another test would trip on.
 * Codes are computed from the secret the API hands back, exactly as the
 * person's phone would compute them.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken, verifyToken } from '../config/jwt.js';
import { hashPassword } from '../config/password.js';
import { codeAt, stepAt } from '../config/totp.js';
import { resetTwoFactorFromServer } from '../services/staffAuth.service.js';

import type { Express } from 'express';

const BASE = '/api/v1';
const PASSWORD = 'correct-horse-battery';

let app: Express;
let shapla: string;
let padma: string;

async function hospitalId(code: string): Promise<string> {
  const result = await sql<{ id: string }>`SELECT id FROM hospitals WHERE code = ${code}`.execute(
    db,
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`No seeded facility with code ${code} (FR-DEM-01).`);
  return id;
}

interface Account {
  readonly id: string;
  readonly email: string;
  readonly hospitalId: string;
}

async function makeStaff(
  roles: readonly string[],
  options: { readonly hospitalId?: string; readonly mustChange?: boolean } = {},
): Promise<Account> {
  const hospital = options.hospitalId ?? shapla;
  const email = `tfa-${randomUUID().slice(0, 8)}@shapla.demo.invalid`;
  const inserted = await sql<{ id: string }>`
    INSERT INTO staff_users (hospital_id, email, full_name, password_hash, must_change_password)
    VALUES (${hospital}, ${email}, 'পরীক্ষা (ডেমো)', ${await hashPassword(PASSWORD)},
            ${options.mustChange ?? false})
    RETURNING id
  `.execute(db);
  const id = inserted.rows[0]?.id ?? '';
  for (const role of roles) {
    await sql`
      INSERT INTO staff_roles (staff_user_id, hospital_id, role)
      VALUES (${id}, ${hospital}, ${role}::staff_role)
    `.execute(db);
  }
  return { id, email, hospitalId: hospital };
}

async function login(email: string, password = PASSWORD): Promise<request.Response> {
  return await request(app).post(`${BASE}/staff/login`).send({ email, password });
}

function get(path: string, token: string): request.Test {
  return request(app).get(`${BASE}${path}`).set('Authorization', `Bearer ${token}`);
}

function post(path: string, token: string, body: Record<string, unknown> = {}): request.Test {
  return request(app).post(`${BASE}${path}`).set('Authorization', `Bearer ${token}`).send(body);
}

/**
 * The earliest code the server will still take: inside a step either side of
 * now and after the last step it accepted. So a test that signs in three times
 * inside one half-minute still has a code for each.
 */
async function nextCode(account: Account, secret: string): Promise<string> {
  const row = await sql<{ step: string | null }>`
    SELECT totp_last_step::text AS step FROM staff_users WHERE id = ${account.id}
  `.execute(db);
  const last = row.rows[0]?.step;
  const current = stepAt(Date.now());
  const floor = last === null || last === undefined ? current - 1 : Number(last) + 1;
  const step = Math.max(current - 1, floor);
  if (step > current + 1) throw new Error('no code left in this window');
  return codeAt(secret, step);
}

/** Signs in on the password, sets the second factor up, and returns what it made. */
async function enrol(account: Account): Promise<{
  readonly secret: string;
  readonly recoveryCodes: readonly string[];
  readonly session: { access: string; refresh: string };
}> {
  const first = (await login(account.email)).body.data;
  const setup = await post('/staff/2fa/setup', first.access);
  expect(setup.status).toBe(200);
  const secret = setup.body.data.secret as string;
  const enabled = await post('/staff/2fa/enable', first.access, {
    code: codeAt(secret, stepAt(Date.now()) - 1),
  });
  expect(enabled.status).toBe(200);
  return {
    secret,
    recoveryCodes: enabled.body.data.recoveryCodes,
    session: enabled.body.data.session,
  };
}

async function auditChanges(staffId: string): Promise<string[]> {
  const result = await sql<{ change: string }>`
    SELECT meta->>'change' AS change FROM audit_log
     WHERE subject_table = 'staff_users' AND subject_id = ${staffId}
     ORDER BY created_at
  `.execute(db);
  return result.rows.map((row) => row.change);
}

beforeAll(async () => {
  shapla = await hospitalId('SHAPLA');
  padma = await hospitalId('PADMA');
});

beforeEach(() => {
  app = createApp();
});

describe('an administrator cannot sign in without the second factor (FR-SEC-10)', () => {
  it('on a password alone, reaches the setup and nothing else', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const response = await login(admin.email);

    expect(response.status).toBe(200);
    const session = response.body.data;
    expect(session.requires2fa).toBe(false);
    expect(session.twoFactor).toEqual({ enabled: false, required: true, recoveryCodesLeft: 0 });

    const verified = await verifyToken(session.access, 'access');
    expect(verified.ok && verified.claims.tfa).toBe('setup');

    // The facility's dashboard, its settings, its chambers: all refused.
    for (const path of ['/staff/chambers', '/hospital/setup', '/admin/dashboard']) {
      const blocked = await get(path, session.access);
      expect(blocked.status, path).toBe(403);
      expect(blocked.body.error.code, path).toBe('AUTH_2FA_SETUP_REQUIRED');
    }
    // Who is signed in, and the way out, still answer.
    expect((await get('/staff/me', session.access)).status).toBe(200);
  });

  it('sets it up with a code from the app, and every earlier session ends', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const first = (await login(admin.email)).body.data;

    const setup = await post('/staff/2fa/setup', first.access);
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\/.+secret=/);

    // Stored sealed, never as the secret the app was given.
    const stored = await sql<{ totp_secret: string | null; totp_enabled_at: Date | null }>`
      SELECT totp_secret, totp_enabled_at FROM staff_users WHERE id = ${admin.id}
    `.execute(db);
    expect(stored.rows[0]?.totp_secret).toMatch(/^v1\./);
    expect(stored.rows[0]?.totp_secret).not.toContain(secret);
    expect(stored.rows[0]?.totp_enabled_at).toBeNull();

    const wrong = await post('/staff/2fa/enable', first.access, { code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('AUTH_2FA_INVALID');

    const enabled = await post('/staff/2fa/enable', first.access, {
      code: codeAt(secret, stepAt(Date.now())),
    });
    expect(enabled.status).toBe(200);
    const codes = enabled.body.data.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    const session = enabled.body.data.session;
    expect(session.twoFactor).toEqual({ enabled: true, required: true, recoveryCodesLeft: 10 });

    const verified = await verifyToken(session.access, 'access');
    expect(verified.ok && verified.claims.tfa).toBeUndefined();
    expect((await get('/hospital/setup', session.access)).status).toBe(200);

    // The session from before it was on is over.
    const old = await request(app).post(`${BASE}/staff/refresh`).send({ refresh: first.refresh });
    expect(old.status).toBe(401);

    expect(await auditChanges(admin.id)).toContain('two_factor_enabled');
  });

  it('once on, a right password alone gets a challenge and no session', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const { secret } = await enrol(admin);

    const response = await login(admin.email);
    expect(response.status).toBe(200);
    expect(response.body.data.requires2fa).toBe(true);
    expect(response.body.data.access).toBeUndefined();
    expect(response.body.data.refresh).toBeUndefined();
    const challenge = response.body.data.challenge as string;

    // The challenge is not a bearer token.
    const asBearer = await get('/staff/me', challenge);
    expect(asBearer.status).toBe(401);
    expect(asBearer.body.error.code).toBe('AUTH_TOKEN_INVALID');

    const signedIn = await request(app)
      .post(`${BASE}/staff/2fa`)
      .send({ challenge, code: await nextCode(admin, secret) });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.roles).toContain('hospital_admin');
    expect((await get('/hospital/setup', signedIn.body.data.access)).status).toBe(200);
  });

  it('takes each code once: one read over a shoulder is already spent', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const { secret } = await enrol(admin);
    const code = await nextCode(admin, secret);

    const first = (await login(admin.email)).body.data.challenge;
    const ok = await request(app).post(`${BASE}/staff/2fa`).send({ challenge: first, code });
    expect(ok.status).toBe(200);

    const second = (await login(admin.email)).body.data.challenge;
    const replay = await request(app).post(`${BASE}/staff/2fa`).send({ challenge: second, code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_2FA_INVALID');
  });

  it('locks after five wrong codes, and a right password does not buy more guesses', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const { secret } = await enrol(admin);

    const guess = async (challenge: string): Promise<request.Response> =>
      await request(app).post(`${BASE}/staff/2fa`).send({ challenge, code: '000000' });

    let challenge = (await login(admin.email)).body.data.challenge as string;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await guess(challenge)).body.error.code).toBe('AUTH_2FA_INVALID');
    }
    // The password again: the count carries on from four.
    challenge = (await login(admin.email)).body.data.challenge as string;
    const fifth = await guess(challenge);
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('AUTH_LOCKED');

    // Locked: the right code waits too, and so does the password.
    const right = await request(app)
      .post(`${BASE}/staff/2fa`)
      .send({ challenge, code: await nextCode(admin, secret) });
    expect(right.status).toBe(423);
    expect((await login(admin.email)).status).toBe(423);
  });

  it('accepts a recovery code once, and says how many are left', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const { recoveryCodes } = await enrol(admin);
    const code = recoveryCodes[0] ?? '';

    const challenge = (await login(admin.email)).body.data.challenge;
    // Typed off paper: capitals, spaces for the hyphens.
    const typed = code.toUpperCase().replace(/-/g, ' ');
    const used = await request(app).post(`${BASE}/staff/2fa`).send({ challenge, code: typed });
    expect(used.status).toBe(200);
    expect(used.body.data.twoFactor.recoveryCodesLeft).toBe(9);

    const again = (await login(admin.email)).body.data.challenge;
    const reused = await request(app).post(`${BASE}/staff/2fa`).send({ challenge: again, code });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('AUTH_2FA_INVALID');
  });

  it('refuses a challenge that is made up, or signed as something else', async () => {
    const admin = await makeStaff(['hospital_admin']);
    await enrol(admin);
    const access = await signToken({
      kind: 'access',
      claims: { sub: admin.id, kind: 'staff', hospitalId: shapla, roles: ['hospital_admin'] },
    });
    for (const challenge of ['x'.repeat(40), access]) {
      const response = await request(app)
        .post(`${BASE}/staff/2fa`)
        .send({ challenge, code: '123456' });
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_TOKEN_INVALID');
    }
  });

  it('asks for the password change first, and the setup after it', async () => {
    const admin = await makeStaff(['hospital_admin'], { mustChange: true });
    const first = (await login(admin.email)).body.data;
    const claims = await verifyToken(first.access, 'access');
    expect(claims.ok && claims.claims.mcp).toBe(true);
    expect(claims.ok && claims.claims.tfa).toBeUndefined();
    expect((await post('/staff/2fa/setup', first.access)).body.error.code).toBe(
      'AUTH_PASSWORD_CHANGE_REQUIRED',
    );

    const changed = await post('/staff/password', first.access, {
      current: PASSWORD,
      next: 'my-own-long-password',
    });
    expect(changed.status).toBe(200);
    const after = await verifyToken(changed.body.data.access, 'access');
    expect(after.ok && after.claims.tfa).toBe('setup');
    expect((await post('/staff/2fa/setup', changed.body.data.access)).status).toBe(200);
  });

  it('shows one secret however often the setup is asked for, until it is on', async () => {
    // A screen that mounted twice, a reload, a second tab: two setups racing
    // once gave two secrets, and the code typed from the one shown was checked
    // against the other.
    const admin = await makeStaff(['hospital_admin']);
    const session = (await login(admin.email)).body.data;
    const [first, second] = await Promise.all([
      post('/staff/2fa/setup', session.access),
      post('/staff/2fa/setup', session.access),
    ]);
    expect(first.status).toBe(200);
    expect(second.body.data.secret).toBe(first.body.data.secret);
    const third = await post('/staff/2fa/setup', session.access);
    expect(third.body.data.secret).toBe(first.body.data.secret);

    const secret = first.body.data.secret as string;
    const enabled = await post('/staff/2fa/enable', session.access, {
      code: codeAt(secret, stepAt(Date.now())),
    });
    expect(enabled.status).toBe(200);
  });

  it('will not set up a second secret over one that is on', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const { session } = await enrol(admin);
    const again = await post('/staff/2fa/setup', session.access);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('AUTH_2FA_ALREADY_ON');
  });
});

describe('anybody else may turn it on for themself', () => {
  it('a receptionist is not asked, and once they turn it on, is asked every time', async () => {
    const reception = await makeStaff(['receptionist']);
    const plain = (await login(reception.email)).body.data;
    expect(plain.requires2fa).toBe(false);
    expect(plain.twoFactor).toEqual({ enabled: false, required: false, recoveryCodesLeft: 0 });
    expect((await get('/staff/chambers', plain.access)).status).toBe(200);

    await enrol(reception);
    expect((await login(reception.email)).body.data.requires2fa).toBe(true);
  });
});

describe('a lost phone', () => {
  async function adminToken(account: Account): Promise<string> {
    return await signToken({
      kind: 'access',
      claims: {
        sub: account.id,
        kind: 'staff',
        hospitalId: account.hospitalId,
        roles: ['hospital_admin'],
      },
    });
  }

  it('is reset by an administrator on S-B-11, audited, and every session ends', async () => {
    const admin = await makeStaff(['hospital_admin']);
    const colleague = await makeStaff(['hospital_admin']);
    const { session } = await enrol(colleague);

    const reset = await request(app)
      .post(`${BASE}/hospital/staff/${colleague.id}/reset-2fa`)
      .set('Authorization', `Bearer ${await adminToken(admin)}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(reset.status).toBe(200);

    const refreshed = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: session.refresh });
    expect(refreshed.status).toBe(401);

    // An administrator again: straight back to the setup, not to a challenge.
    const next = (await login(colleague.email)).body.data;
    expect(next.requires2fa).toBe(false);
    expect(next.twoFactor.enabled).toBe(false);
    const claims = await verifyToken(next.access, 'access');
    expect(claims.ok && claims.claims.tfa).toBe('setup');

    const setup = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', `Bearer ${await adminToken(admin)}`);
    const row = (setup.body.data.staff as { id: string; twoFactorEnabled: boolean }[]).find(
      (member) => member.id === colleague.id,
    );
    expect(row?.twoFactorEnabled).toBe(false);

    const audit = await sql<{ actor: string | null }>`
      SELECT actor_staff_id AS actor FROM audit_log
       WHERE subject_id = ${colleague.id} AND meta->>'change' = 'two_factor_reset'
    `.execute(db);
    expect(audit.rows.map((r) => r.actor)).toEqual([admin.id]);
  });

  it("is not one's own to reset, and not another facility's", async () => {
    const admin = await makeStaff(['hospital_admin']);
    const elsewhere = await makeStaff(['receptionist'], { hospitalId: padma });
    const token = await adminToken(admin);

    const own = await request(app)
      .post(`${BASE}/hospital/staff/${admin.id}/reset-2fa`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(own.status).toBe(422);
    expect(own.body.error.details.reason).toBe('own_two_factor');

    const other = await request(app)
      .post(`${BASE}/hospital/staff/${elsewhere.id}/reset-2fa`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(other.status).toBe(404);
  });

  it('is refused to anyone but an administrator', async () => {
    const reception = await makeStaff(['receptionist']);
    const token = await signToken({
      kind: 'access',
      claims: { sub: reception.id, kind: 'staff', hospitalId: shapla, roles: ['receptionist'] },
    });
    const response = await request(app)
      .post(`${BASE}/hospital/staff/${reception.id}/reset-2fa`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(response.status).toBe(403);
    const none = await request(app)
      .post(`${BASE}/hospital/staff/${reception.id}/reset-2fa`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(none.status).toBe(401);
  });

  it('with nobody left to reset it, `pnpm staff:reset-2fa` does, audited with no actor', async () => {
    const admin = await makeStaff(['hospital_admin']);
    await enrol(admin);
    expect((await login(admin.email)).body.data.requires2fa).toBe(true);

    const reset = await resetTwoFactorFromServer({ email: admin.email, hospitalCode: null });
    expect(reset?.hospitalCode).toBe('SHAPLA');
    expect((await login(admin.email)).body.data.requires2fa).toBe(false);

    const audit = await sql<{ actor: string | null }>`
      SELECT actor_staff_id AS actor FROM audit_log
       WHERE subject_id = ${admin.id} AND meta->>'change' = 'two_factor_reset_from_server'
    `.execute(db);
    expect(audit.rows.map((r) => r.actor)).toEqual([null]);
    expect(await resetTwoFactorFromServer({ email: 'nobody@x.invalid', hospitalCode: null })).toBe(
      null,
    );
  });
});

describe('the auth matrix for /staff/2fa (FR-ROLE-01)', () => {
  it('refuses setup and enable without a token', async () => {
    expect((await request(app).post(`${BASE}/staff/2fa/setup`).send({})).status).toBe(401);
    expect(
      (await request(app).post(`${BASE}/staff/2fa/enable`).send({ code: '123456' })).status,
    ).toBe(401);
  });

  it('refuses a body with fields it does not know, or a code of the wrong shape', async () => {
    const response = await request(app)
      .post(`${BASE}/staff/2fa`)
      .send({ challenge: 'x'.repeat(40), code: '123456', remember: true });
    expect(response.status).toBe(400);

    const admin = await makeStaff(['hospital_admin']);
    const session = (await login(admin.email)).body.data;
    expect((await post('/staff/2fa/enable', session.access, { code: '12ab56' })).status).toBe(400);
  });
});
