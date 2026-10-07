/**
 * A hospital applies by itself (`PRD.md` `FR-ONB-09`, `FR-ONB-10`; plan D1;
 * migration 0049).
 *
 * `POST /hospital-applications` is public and makes a workspace. What this
 * file holds to: it makes one that is **setting up** and nothing else, so
 * that creating an account never publishes a hospital; nothing sent with the
 * form can make it more than that; the person who applied can sign in and
 * nobody else was given anything; the platform sees it as an application;
 * and the form cannot be used to fill the database.
 *
 * Everything written here is demonstration data and is removed afterwards
 * (`FR-SEC-08`).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { signToken } from '../config/jwt.js';
import { env } from '../env.js';
import { counter } from '../middleware/rateLimit.js';
import * as demoRepo from '../repositories/demo.repo.js';

import { asOwner } from './support/ownerDb.js';
import { bearer } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/** Every workspace this file makes is named for a river no seeded hospital has. */
const MARK = 'Dhaleshwari';

const PASSWORD = 'a-password-of-their-own';

let app: Express;
let platform: string;
let serial = 0;

function form(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  serial += 1;
  return {
    nameBn: 'ধলেশ্বরী জেনারেল হাসপাতাল (ডেমো)',
    nameEn: `${MARK} General Hospital (Demo)`,
    kind: 'hospital',
    division: 'Dhaka',
    district: 'Munshiganj',
    phone: '+8802912345678',
    registrationNo: `DEMO-REG-${String(serial)}`,
    adminName: 'Demo Applicant',
    adminEmail: `applicant${String(serial)}@dhaleshwari.example`,
    adminMobile: '+8801712345678',
    password: PASSWORD,
    ...overrides,
  };
}

async function apply(
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
): Promise<request.Response> {
  const pending = request(app).post(`${BASE}/hospital-applications`);
  return await (key === null ? pending : pending.set('Idempotency-Key', key)).send(body);
}

interface Row {
  readonly id: string;
  readonly code: string;
  readonly lifecycle: string;
  readonly is_live: boolean;
  readonly self_registered: boolean;
  readonly phone: string | null;
  readonly registration_no: string | null;
}

async function workspaces(): Promise<Row[]> {
  return await asOwner(async (owner) => {
    const result = await sql<Row>`
      SELECT id, code, lifecycle::text AS lifecycle, is_live, self_registered, phone,
             registration_no
        FROM hospitals WHERE name_en LIKE ${`${MARK}%`} ORDER BY created_at
    `.execute(owner);
    return result.rows;
  });
}

async function removeAll(): Promise<void> {
  await asOwner(async (owner) => {
    const made = await sql<{ id: string }>`
      SELECT id FROM hospitals WHERE name_en LIKE ${`${MARK}%`}
    `.execute(owner);
    for (const { id } of made.rows) {
      await sql`DELETE FROM audit_log WHERE hospital_id = ${id}`.execute(owner);
      await sql`DELETE FROM sessions_auth WHERE subject_id IN
        (SELECT id FROM staff_users WHERE hospital_id = ${id})`.execute(owner);
      await sql`DELETE FROM staff_roles WHERE hospital_id = ${id}`.execute(owner);
      await sql`DELETE FROM staff_users WHERE hospital_id = ${id}`.execute(owner);
      await sql`DELETE FROM hospital_settings WHERE hospital_id = ${id}`.execute(owner);
      await sql`DELETE FROM hospitals WHERE id = ${id}`.execute(owner);
    }
  });
}

const mutable = env as { ORG_APPLICATIONS_OPEN_MAX: number };
const originalMax = mutable.ORG_APPLICATIONS_OPEN_MAX;

beforeAll(async () => {
  app = createApp();
  const account = await demoRepo.nationalStaffFor('platform_admin');
  if (account === null) throw new Error('The seed has no platform administrator.');
  platform = await signToken({
    kind: 'access',
    claims: { sub: account.id, kind: 'staff', roles: ['platform_admin'] },
  });
  await removeAll();
});

// One address sends every request here; each test starts with the hour's
// allowance whole, and with nothing of another test's waiting.
afterEach(async () => {
  counter.reset();
  mutable.ORG_APPLICATIONS_OPEN_MAX = originalMax;
  await removeAll();
});

afterAll(async () => {
  await removeAll();
});

describe('POST /hospital-applications: what may be sent', () => {
  it('is public, and needs a key like every write', async () => {
    const refused = await apply(form(), null);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await workspaces()).toEqual([]);

    expect((await apply(form())).status).toBe(201);
  });

  it('every field the form has, and nothing that is not the applicant’s to say', async () => {
    // A refused form counts towards the address's hour like any other, which
    // is right and is not what this test is about.
    const refused = async (body: Record<string, unknown>): Promise<number> => {
      counter.reset();
      return (await apply(body)).status;
    };
    for (const field of ['nameBn', 'nameEn', 'kind', 'phone', 'registrationNo', 'adminEmail']) {
      const body = form();
      delete body[field];
      expect(await refused(body), field).toBe(400);
    }
    // A code, a live switch, a state, a role: none can be sent with it.
    for (const extra of [
      { code: 'DHALESHWARI' },
      { isLive: true },
      { lifecycle: 'active' },
      { role: 'platform_admin' },
      { selfRegistered: false },
    ]) {
      expect(await refused(form(extra)), JSON.stringify(extra)).toBe(400);
    }
    expect(await refused(form({ adminMobile: '01712345678' }))).toBe(400);
    expect(await refused(form({ kind: 'pharmacy' }))).toBe(400);
    expect(await refused(form({ password: 'short' }))).toBe(400);
    expect(await workspaces()).toEqual([]);
  });
});

describe('what an application makes (FR-ONB-09)', () => {
  it('a workspace that is setting up, marked as applied for, and one administrator', async () => {
    const body = form();
    const response = await apply(body);
    expect(response.status).toBe(201);
    // The code and the email to sign in with, and nothing else: no token.
    expect(response.body.data).toEqual({ code: 'DHALESHWARI', adminEmail: body['adminEmail'] });

    const [made, ...others] = await workspaces();
    expect(others).toEqual([]);
    expect(made).toMatchObject({
      code: 'DHALESHWARI',
      lifecycle: 'setup',
      is_live: false,
      self_registered: true,
      phone: body['phone'],
      registration_no: body['registrationNo'],
    });

    await asOwner(async (owner) => {
      const staff = await sql<{
        email: string;
        phone: string | null;
        password_hash: string;
        must_change_password: boolean;
        totp_enabled_at: Date | null;
        roles: string[];
      }>`
        SELECT u.email, u.phone, u.password_hash, u.must_change_password, u.totp_enabled_at,
               array(SELECT r.role::text FROM staff_roles r
                      WHERE r.staff_user_id = u.id AND r.deleted_at IS NULL) AS roles
          FROM staff_users u WHERE u.hospital_id = ${made?.id ?? ''}
      `.execute(owner);
      expect(staff.rows).toHaveLength(1);
      expect(staff.rows[0]).toMatchObject({
        email: body['adminEmail'],
        phone: body['adminMobile'],
        // Their own password: nothing to change at first sign-in.
        must_change_password: false,
        totp_enabled_at: null,
        roles: ['hospital_admin'],
      });
      // Kept as a hash, and the password itself is nowhere in the row.
      expect(staff.rows[0]?.password_hash.startsWith('scrypt$')).toBe(true);
      expect(staff.rows[0]?.password_hash).not.toContain(PASSWORD);

      const settings = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM hospital_settings WHERE hospital_id = ${made?.id ?? ''}
      `.execute(owner);
      expect(settings.rows[0]?.n).toBe('1');

      // Who applied, and that it was an application (`FR-ONB-07`).
      const audit = await sql<{ change: string }>`
        SELECT meta ->> 'change' AS change FROM audit_log WHERE hospital_id = ${made?.id ?? ''}
      `.execute(owner);
      expect(audit.rows.map((row) => row.change)).toEqual(['workspace_applied']);
    });
  });

  it('nothing public: not listed, not found by name, and its code opens nothing', async () => {
    const response = await apply(form());
    const [made] = await workspaces();
    const code = response.body.data.code as string;

    const listed = await request(app).get(`${BASE}/hospitals?limit=100`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(made?.id ?? 'x');
    const searched = await request(app).get(`${BASE}/search?q=${MARK}`).expect(200);
    // The answer repeats what was asked; what it found is nothing.
    expect(searched.body.data.hospitals).toEqual([]);
    expect(searched.body.data.doctors).toEqual([]);
    expect((await request(app).get(`${BASE}/hospitals/${made?.id ?? ''}`)).status).toBe(404);
    expect((await request(app).get(`${BASE}/config?scope=${code}`)).status).toBe(404);
    expect((await request(app).get(`${BASE}/hospitals?scope=${code}`)).status).toBe(404);
    const emergency = await request(app).get(`${BASE}/emergency/search`).expect(200);
    expect(JSON.stringify(emergency.body)).not.toContain(made?.id ?? 'x');
  });

  it('the applicant signs in with their own password, and sets up two-step before anything opens', async () => {
    const body = form();
    const applied = await apply(body);
    const code = applied.body.data.code as string;

    const wrong = await request(app)
      .post(`${BASE}/staff/login`)
      .send({ email: body['adminEmail'], password: 'not-their-password', hospitalCode: code });
    expect(wrong.status).toBe(401);

    const login = await request(app)
      .post(`${BASE}/staff/login`)
      .send({ email: body['adminEmail'], password: PASSWORD, hospitalCode: code })
      .expect(200);
    expect(login.body.data.mustChangePassword).toBe(false);
    expect(login.body.data.roles).toEqual(['hospital_admin']);
    expect(login.body.data.hospital.code).toBe(code);
    // An administrator: the second factor is owed and not yet set up.
    expect(login.body.data.twoFactor).toMatchObject({ required: true, enabled: false });

    const setup = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', bearer(login.body.data.access as string));
    expect(setup.status).toBe(403);
    expect(setup.body.error.code).toBe('AUTH_2FA_SETUP_REQUIRED');
  });

  it('is seen by the platform among those waiting, as an application, with whom to ring', async () => {
    const body = form();
    await apply(body);
    const [made] = await workspaces();

    const list = await request(app)
      .get(`${BASE}/platform/hospitals`)
      .set('Authorization', bearer(platform))
      .expect(200);
    const row = (
      list.body.data.workspaces as { id: string; selfRegistered: boolean; lifecycle: string }[]
    ).find((entry) => entry.id === made?.id);
    expect(row).toMatchObject({ selfRegistered: true, lifecycle: 'setup' });
    // A workspace the platform made itself is not one.
    expect(
      (list.body.data.workspaces as { selfRegistered: boolean }[]).filter(
        (entry) => entry.selfRegistered,
      ),
    ).toHaveLength(1);
    // The list is still organisations and counts: an application brings no
    // phone into it (`FR-ONB-08`). Whom to ring is on the opened workspace.
    expect(JSON.stringify(list.body).toLowerCase()).not.toContain('phone');

    const detail = await request(app)
      .get(`${BASE}/platform/hospitals/${made?.id ?? ''}`)
      .set('Authorization', bearer(platform))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      selfRegistered: true,
      phone: body['phone'],
      registrationNo: body['registrationNo'],
      isLive: false,
      administrators: [
        { fullName: body['adminName'], email: body['adminEmail'], phone: body['adminMobile'] },
      ],
    });
    // A facility's switchboard and a member of staff; nobody who came for care.
    const opened = JSON.stringify(detail.body).toLowerCase();
    for (const forbidden of ['patient', 'booking', 'visit', 'diagnosis']) {
      expect(opened, forbidden).not.toContain(forbidden);
    }
    // It is not ready, and the platform cannot approve what is not.
    const approved = await request(app)
      .post(`${BASE}/platform/hospitals/${made?.id ?? ''}/approve`)
      .set('Authorization', bearer(platform))
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(approved.status).toBeGreaterThanOrEqual(400);
    expect((await workspaces())[0]).toMatchObject({ lifecycle: 'setup', is_live: false });
  });
});

describe('the same form again', () => {
  it('with the same key: the workspace the first one made, and no second', async () => {
    const body = form();
    const key = randomUUID();
    const first = await apply(body, key);
    const again = await apply(body, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.data).toEqual(first.body.data);
    expect(await workspaces()).toHaveLength(1);
  });

  it('sent twice at once with one key makes one', async () => {
    const body = form();
    const key = randomUUID();
    const [a, b] = await Promise.all([apply(body, key), apply(body, key)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data).toEqual(b.body.data);
    expect(await workspaces()).toHaveLength(1);
  });

  it('a second hospital of the same name is given a code of its own', async () => {
    const first = await apply(form());
    const second = await apply(form());
    expect(first.body.data.code).toBe('DHALESHWARI');
    expect(second.body.data.code).toBe('DHALESHWARI-2');
    expect((await workspaces()).map((row) => row.code)).toEqual(['DHALESHWARI', 'DHALESHWARI-2']);
  });
});

describe('the platform declines one (FR-ONB-10)', () => {
  async function close(hospitalId: string, note?: string): Promise<request.Response> {
    return await request(app)
      .post(`${BASE}/platform/hospitals/${hospitalId}/close`)
      .set('Authorization', bearer(platform))
      .set('Idempotency-Key', randomUUID())
      .send(note === undefined ? {} : { note });
  }

  it('by closing it with a reason, and it no longer counts as waiting', async () => {
    mutable.ORG_APPLICATIONS_OPEN_MAX = 1;
    expect((await apply(form())).status).toBe(201);
    const [made] = await workspaces();
    const id = made?.id ?? '';
    // One is waiting, which is all this deployment holds: the form is shut.
    expect((await apply(form())).status).toBe(429);

    // The platform is offered exactly that, and owes the reason.
    const detail = await request(app)
      .get(`${BASE}/platform/hospitals/${id}`)
      .set('Authorization', bearer(platform))
      .expect(200);
    expect(detail.body.data.actions).toEqual(['close']);
    expect((await close(id)).status).toBe(400);
    expect((await workspaces())[0]).toMatchObject({ lifecycle: 'setup' });

    const closed = await close(id, 'আবেদনটি কোনো আসল প্রতিষ্ঠানের নয় (ডেমো)।');
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ lifecycle: 'closed', isLive: false, actions: [] });
    expect((await workspaces())[0]).toMatchObject({ lifecycle: 'closed', is_live: false });

    await asOwner(async (owner) => {
      const audit = await sql<{ change: string }>`
        SELECT meta ->> 'change' AS change FROM audit_log
         WHERE hospital_id = ${id} ORDER BY created_at
      `.execute(owner);
      expect(audit.rows.map((row) => row.change)).toEqual(['workspace_applied', 'workspace_close']);
    });

    // The form is open again. The declined one keeps its code: a code is
    // never handed to a second hospital.
    const next = await apply(form());
    expect(next.status).toBe(201);
    expect(next.body.data.code).toBe('DHALESHWARI-2');
  });

  it('and a hospital cannot do it to itself or to another', async () => {
    const body = form();
    const applied = await apply(body);
    const [made] = await workspaces();
    const login = await request(app)
      .post(`${BASE}/staff/login`)
      .send({
        email: body['adminEmail'],
        password: PASSWORD,
        hospitalCode: applied.body.data.code as string,
      })
      .expect(200);

    const refused = await request(app)
      .post(`${BASE}/platform/hospitals/${made?.id ?? ''}/close`)
      .set('Authorization', bearer(login.body.data.access as string))
      .set('Idempotency-Key', randomUUID())
      .send({ note: 'not theirs to close' });
    expect(refused.status).toBe(403);
    expect((await workspaces())[0]).toMatchObject({ lifecycle: 'setup' });
  });
});

describe('it cannot be used to fill the database', () => {
  it('an address is allowed a handful an hour', async () => {
    for (let n = 0; n < 5; n += 1) {
      expect((await apply(form())).status, `application ${String(n + 1)}`).toBe(201);
    }
    const sixth = await apply(form());
    expect(sixth.status).toBe(429);
    expect(await workspaces()).toHaveLength(5);
  });

  it('and the deployment holds only so many unanswered at once', async () => {
    mutable.ORG_APPLICATIONS_OPEN_MAX = 2;
    expect((await apply(form())).status).toBe(201);
    expect((await apply(form())).status).toBe(201);

    const refused = await apply(form());
    expect(refused.status).toBe(429);
    expect(refused.body.error.details).toMatchObject({ reason: 'applications_paused' });
    expect(await workspaces()).toHaveLength(2);

    // A form already answered is still answered: the cap stops new ones.
    const body = form();
    const key = randomUUID();
    mutable.ORG_APPLICATIONS_OPEN_MAX = 3;
    expect((await apply(body, key)).status).toBe(201);
    mutable.ORG_APPLICATIONS_OPEN_MAX = 1;
    expect((await apply(body, key)).status).toBe(201);
    expect(await workspaces()).toHaveLength(3);
  });
});
