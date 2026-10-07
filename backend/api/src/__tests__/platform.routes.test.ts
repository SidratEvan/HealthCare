/**
 * Onboarding from the platform's side (`S-B-12`, `PRD.md` §14c `FR-ONB-*`).
 *
 * One hospital taken from nothing to live and back out again, by the two
 * people the flow needs: its own administrator, who sets it up and asks, and a
 * platform administrator, who verifies its doctors and answers. Along the way,
 * the things that must not be possible: a hospital publishing itself, a
 * hospital's staff reaching the platform's routes, anything public showing a
 * workspace that is not active, and a patient appearing in what the platform
 * sees.
 *
 * Runs against the seeded demo database (CLAUDE.md §6): the platform
 * administrator is the seeded national account, because every act writes an
 * audit row that names a real person.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { createPlatformAdministrator } from '../services/staffAuth.service.js';

import { asOwner } from './support/ownerDb.js';
import { seededPlatformAdminId } from './support/queueFixture.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let platform: string;
let platformStaffId: string;

/** The workspace this file creates, and its administrator's token. */
let hospitalId: string;
let adminToken: string;
const code = `P${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

function send(method: 'get' | 'post' | 'patch', path: string, token: string, body: object = {}) {
  const call = request(app)[method](`${BASE}${path}`).set('Authorization', bearer(token));
  return method === 'get' ? call : call.set('Idempotency-Key', randomUUID()).send(body);
}

async function lifecycleOf(id: string): Promise<{ lifecycle: string; is_live: boolean }> {
  const result = await sql<{ lifecycle: string; is_live: boolean }>`
    SELECT lifecycle::text AS lifecycle, is_live FROM hospitals WHERE id = ${id}
  `.execute(db);
  const row = result.rows[0];
  if (row === undefined) throw new Error('no such hospital');
  return row;
}

/** Whether a hospital shows on each public surface that lists hospitals. */
async function publicSightings(id: string): Promise<Record<string, boolean>> {
  const list = await request(app).get(`${BASE}/hospitals?limit=100`);
  const search = await request(app).get(`${BASE}/search?limit=50`);
  const detail = await request(app).get(`${BASE}/hospitals/${id}`);
  const scope = await request(app).get(`${BASE}/config?scope=${code}`);
  const doctors = await request(app).get(`${BASE}/doctors?hospitalId=${id}`);

  return {
    '/hospitals': (list.body.data.hospitals as { id: string }[]).some((h) => h.id === id),
    '/search': (search.body.data.hospitals as { id: string }[]).some((h) => h.id === id),
    '/hospitals/:id': detail.status === 200,
    '/config?scope': scope.status === 200,
    '/doctors': (doctors.body.data.doctors as { chambers: { hospitalId: string }[] }[]).some(
      (doctor) => doctor.chambers.some((chamber) => chamber.hospitalId === id),
    ),
  };
}

const NOWHERE = {
  '/hospitals': false,
  '/search': false,
  '/hospitals/:id': false,
  '/config?scope': false,
  '/doctors': false,
};

beforeAll(async () => {
  app = createApp();

  const account = { id: await seededPlatformAdminId() };
  platformStaffId = account.id;
  platform = await signToken({
    kind: 'access',
    claims: { sub: account.id, kind: 'staff', roles: ['platform_admin'] },
  });
});

afterAll(async () => {
  if (hospitalId === undefined) return;
  // As the owner: the API's role may not delete an audit row (`ownerDb.ts`).
  await asOwner(async (owner) => {
    await sql`
      DELETE FROM session_templates WHERE doctor_hospital_id IN
        (SELECT id FROM doctor_hospitals WHERE hospital_id = ${hospitalId})
    `.execute(owner);
    const doctors = await sql<{ doctor_id: string }>`
      SELECT DISTINCT doctor_id FROM doctor_hospitals WHERE hospital_id = ${hospitalId}
    `.execute(owner);
    await sql`DELETE FROM sessions WHERE hospital_id = ${hospitalId}`.execute(owner);
    await sql`DELETE FROM doctor_hospitals WHERE hospital_id = ${hospitalId}`.execute(owner);
    await sql`
      DELETE FROM doctors WHERE id = ANY(${doctors.rows.map((row) => row.doctor_id)}::uuid[])
    `.execute(owner);
    await sql`DELETE FROM departments WHERE hospital_id = ${hospitalId}`.execute(owner);
    await sql`DELETE FROM audit_log WHERE hospital_id = ${hospitalId}`.execute(owner);
    await sql`UPDATE hospitals SET reviewed_by = NULL WHERE id = ${hospitalId}`.execute(owner);
    await sql`DELETE FROM sessions_auth WHERE subject_id IN
      (SELECT id FROM staff_users WHERE hospital_id = ${hospitalId})`.execute(owner);
    await sql`DELETE FROM staff_roles WHERE hospital_id = ${hospitalId}`.execute(owner);
    await sql`DELETE FROM staff_users WHERE hospital_id = ${hospitalId}`.execute(owner);
    await sql`DELETE FROM hospital_settings WHERE hospital_id = ${hospitalId}`.execute(owner);
    await sql`DELETE FROM hospitals WHERE id = ${hospitalId}`.execute(owner);
  });
});

describe('who reaches the platform’s routes (FR-ROLE-01, FR-ONB-08)', () => {
  const routes: readonly ['get' | 'post', string][] = [
    ['get', '/platform/hospitals'],
    ['get', `/platform/hospitals/${randomUUID()}`],
    ['post', '/platform/hospitals'],
    ['post', `/platform/hospitals/${randomUUID()}/approve`],
    ['post', `/platform/hospitals/${randomUUID()}/send-back`],
    ['post', `/platform/hospitals/${randomUUID()}/suspend`],
    ['post', `/platform/hospitals/${randomUUID()}/reinstate`],
    ['post', `/platform/hospitals/${randomUUID()}/close`],
    ['post', `/platform/hospitals/${randomUUID()}/doctors/${randomUUID()}/verify`],
  ];

  it.each(routes)('%s %s needs a token', async (method, path) => {
    const call = request(app)[method](`${BASE}${path}`);
    const response = await (method === 'get'
      ? call
      : call.set('Idempotency-Key', randomUUID()).send({}));
    expect(response.status).toBe(401);
  });

  it.each(routes)(
    '%s %s refuses a hospital’s administrator, a government viewer and a patient',
    async (method, path) => {
      const tokens = [
        await staffToken(['hospital_admin']),
        await staffToken(['receptionist', 'doctor']),
        await nationalToken(['gov_viewer']),
        await patientToken(),
      ];
      for (const token of tokens) {
        const response = await send(method, path, token);
        expect(response.status).toBe(403);
      }
    },
  );
});

describe('a hospital, from nothing to live (FR-ONB-01 to FR-ONB-05)', () => {
  it('is created by the platform with its first administrator, and is nowhere public', async () => {
    const response = await send('post', '/platform/hospitals', platform, {
      code: code.toLowerCase(),
      nameBn: 'অনবোর্ডিং পরীক্ষা হাসপাতাল (ডেমো)',
      nameEn: 'Onboarding Test Hospital (Demo)',
      kind: 'hospital',
      division: 'Dhaka',
      district: 'Dhaka',
      registrationNo: 'DGHS-DEMO-0001',
      adminName: 'প্রশাসক (ডেমো)',
      adminEmail: `admin-${randomUUID().slice(0, 8)}@onboarding.demo.invalid`,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe(code);
    // Shown once, to be handed over; changed at first sign-in.
    expect(response.body.data.temporaryPassword.length).toBeGreaterThanOrEqual(10);
    hospitalId = response.body.data.hospitalId as string;

    expect(await lifecycleOf(hospitalId)).toEqual({ lifecycle: 'setup', is_live: false });
    expect(await publicSightings(hospitalId)).toEqual(NOWHERE);

    const admin = await sql<{ id: string }>`
      SELECT su.id FROM staff_users su
        JOIN staff_roles sr ON sr.staff_user_id = su.id
       WHERE su.hospital_id = ${hospitalId} AND sr.role = 'hospital_admin'
    `.execute(db);
    adminToken = await signToken({
      kind: 'access',
      claims: {
        sub: admin.rows[0]?.id ?? '',
        kind: 'staff',
        hospitalId,
        roles: ['hospital_admin'],
      },
    });
  });

  it('refuses a code another workspace has', async () => {
    const response = await send('post', '/platform/hospitals', platform, {
      code,
      nameBn: 'আরেকটি (ডেমো)',
      nameEn: 'Another (Demo)',
      kind: 'clinic',
      division: 'Dhaka',
      district: 'Dhaka',
      adminName: 'প্রশাসক (ডেমো)',
      adminEmail: `admin-${randomUUID().slice(0, 8)}@onboarding.demo.invalid`,
    });
    expect(response.status).toBe(409);
    expect(response.body.error.details).toMatchObject({ field: 'code' });
  });

  it('shows the administrator a checklist of what is missing (FR-ONB-03)', async () => {
    const response = await send('get', '/hospital/setup', adminToken);

    expect(response.status).toBe(200);
    expect(response.body.data.hospital).toMatchObject({ lifecycle: 'setup', isLive: false });
    expect(response.body.data.counts).toEqual({
      departments: 0,
      doctors: 0,
      verifiedDoctors: 0,
      schedules: 0,
      beds: 0,
      staff: 1,
      // Plan D2: named, and not waited for. No address or phone, no place on
      // the map, and an emergency desk that has declared nothing yet.
      contact: 0,
      location: 0,
      capabilities: 0,
    });
  });

  it('will not take a request for review while required items are missing', async () => {
    const response = await send('post', '/hospital/request-review', adminToken);

    expect(response.status).toBe(422);
    expect(response.body.error.details).toMatchObject({
      reason: 'not_ready',
      missing: ['departments', 'doctors', 'schedules'],
    });
    expect((await lifecycleOf(hospitalId)).lifecycle).toBe('setup');
  });

  it('has no way for a hospital to publish itself', async () => {
    // The route that used to do it is gone, and the platform's are closed to it.
    expect((await send('post', '/hospital/go-live', adminToken)).status).toBe(404);
    expect(
      (await send('post', `/platform/hospitals/${hospitalId}/approve`, adminToken)).status,
    ).toBe(403);
    expect(await lifecycleOf(hospitalId)).toEqual({ lifecycle: 'setup', is_live: false });
  });

  it('is set up by its administrator: a department, a doctor, a schedule', async () => {
    const department = await send('post', '/hospital/departments', adminToken, {
      code: 'CARD',
      nameBn: 'কার্ডিওলজি',
      nameEn: 'Cardiology',
    });
    expect(department.status).toBe(200);

    const doctor = await send('post', '/hospital/doctors', adminToken, {
      nameBn: 'ডা. অনবোর্ডিং (ডেমো)',
      nameEn: 'Dr Onboarding (Demo)',
      bmdcNumber: `A-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      specialties: ['cardiology'],
      departmentId: department.body.data.departmentId,
      room: '101',
      feePoisha: 80_000,
    });
    expect(doctor.status).toBe(200);

    const template = await send('post', '/hospital/templates', adminToken, {
      doctorHospitalId: doctor.body.data.doctorHospitalId,
      weekday: 1,
      startTime: '17:00',
      endTime: '20:00',
      capacity: 20,
    });
    expect(template.status).toBe(200);
  });

  it('then asks for review, and is still nowhere public (FR-ONB-04)', async () => {
    const response = await send('post', '/hospital/request-review', adminToken);
    expect(response.status).toBe(200);

    expect(await lifecycleOf(hospitalId)).toEqual({
      lifecycle: 'ready_for_review',
      is_live: false,
    });
    expect(await publicSightings(hospitalId)).toEqual(NOWHERE);

    // Asking twice is refused: it is already asked.
    const again = await send('post', '/hospital/request-review', adminToken);
    expect(again.status).toBe(422);
    expect(again.body.error.details.reason).toBe('wrong_state');
  });

  it('appears first in the platform’s list, with counts and no patient (FR-ONB-08)', async () => {
    const response = await send('get', '/platform/hospitals', platform);
    const workspaces = response.body.data.workspaces as {
      id: string;
      lifecycle: string;
      actions: string[];
    }[];

    expect(workspaces[0]?.lifecycle).toBe('ready_for_review');
    const mine = workspaces.find((workspace) => workspace.id === hospitalId);
    expect(mine).toMatchObject({
      lifecycle: 'ready_for_review',
      counts: { departments: 1, doctors: 1, verifiedDoctors: 0, schedules: 1 },
    });
    // Approve it, send it back, or decline it altogether (`FR-ONB-10`).
    expect([...(mine?.actions ?? [])].sort()).toEqual(['approve', 'close', 'send_back']);

    // What is absent is the boundary: organisations and counts, never people
    // who came for care.
    const raw = JSON.stringify(response.body).toLowerCase();
    for (const forbidden of ['patient', 'booking', 'visit', 'phone', 'diagnosis']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('cannot be approved while no doctor is verified', async () => {
    const response = await send('post', `/platform/hospitals/${hospitalId}/approve`, platform);

    expect(response.status).toBe(422);
    expect(response.body.error.details).toMatchObject({
      reason: 'not_ready',
      missing: ['verified_doctors'],
    });
    expect(await lifecycleOf(hospitalId)).toEqual({
      lifecycle: 'ready_for_review',
      is_live: false,
    });
  });

  it('is sent back only with a reason, which its administrator then reads', async () => {
    const silent = await send('post', `/platform/hospitals/${hospitalId}/send-back`, platform);
    expect(silent.status).toBe(400);

    const note = 'লাইসেন্স নম্বরটি মিলছে না, আবার দেখে দিন।';
    const sent = await send('post', `/platform/hospitals/${hospitalId}/send-back`, platform, {
      note,
    });
    expect(sent.status).toBe(200);
    expect(sent.body.data.lifecycle).toBe('setup');

    const seen = await send('get', '/hospital/setup', adminToken);
    expect(seen.body.data.hospital).toMatchObject({ lifecycle: 'setup', reviewNote: note });

    // And asks again.
    expect((await send('post', '/hospital/request-review', adminToken)).status).toBe(200);
  });

  it('has its doctor verified by the platform, from the review (FR-ONB-05)', async () => {
    const detail = await send('get', `/platform/hospitals/${hospitalId}`, platform);
    const doctor = (
      detail.body.data.doctors as { doctorId: string; verifiedAt: string | null }[]
    )[0];
    expect(doctor?.verifiedAt).toBeNull();
    expect(detail.body.data.missingForApproval).toEqual(['verified_doctors']);

    const verified = await send(
      'post',
      `/platform/hospitals/${hospitalId}/doctors/${doctor?.doctorId ?? ''}/verify`,
      platform,
    );
    expect(verified.status).toBe(200);
    expect(verified.body.data.missingForApproval).toEqual([]);
    expect(verified.body.data.counts.verifiedDoctors).toBe(1);

    // A doctor who does not sit at this hospital is not this review's to verify.
    const stranger = await send(
      'post',
      `/platform/hospitals/${hospitalId}/doctors/${randomUUID()}/verify`,
      platform,
    );
    expect(stranger.status).toBe(404);
  });

  it('is approved, and is then everywhere public at once', async () => {
    const response = await send('post', `/platform/hospitals/${hospitalId}/approve`, platform);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      lifecycle: 'active',
      isLive: true,
      reviewNote: null,
    });
    expect(await publicSightings(hospitalId)).toEqual({
      '/hospitals': true,
      '/search': true,
      '/hospitals/:id': true,
      '/config?scope': true,
      '/doctors': true,
    });

    // Approving twice is refused: there is nothing waiting.
    const again = await send('post', `/platform/hospitals/${hospitalId}/approve`, platform);
    expect(again.status).toBe(422);
    expect(again.body.error.details.reason).toBe('wrong_state');
  });
});

describe('suspending, reinstating and closing (FR-ONB-06)', () => {
  it('suspends with a reason, and the hospital is out of every public surface', async () => {
    expect((await send('post', `/platform/hospitals/${hospitalId}/suspend`, platform)).status).toBe(
      400,
    );

    const response = await send('post', `/platform/hospitals/${hospitalId}/suspend`, platform, {
      note: 'চুক্তি নবায়ন বাকি আছে।',
    });
    expect(response.status).toBe(200);
    expect(await lifecycleOf(hospitalId)).toEqual({ lifecycle: 'suspended', is_live: false });
    expect(await publicSightings(hospitalId)).toEqual(NOWHERE);
  });

  it('takes no booking from the public, even at a chamber somebody already had open', async () => {
    // Discovery no longer lists it; a chamber's id outlives the listing.
    const chamber = await sql<{ id: string }>`
      SELECT id FROM sessions WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL LIMIT 1
    `.execute(db);
    const sessionId = chamber.rows[0]?.id;
    expect(sessionId).toBeDefined();

    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', randomUUID())
      .send({
        sessionId,
        method: 'at_hospital',
        guest: {
          name: 'রহিমা খাতুন (ডেমো)',
          phone: `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
          ageYears: 34,
          sex: 'female',
        },
      });

    expect(response.status).toBe(422);
    expect(response.body.error.details).toMatchObject({ guard: 'HOSPITAL_NOT_LIVE' });
    const booked = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM bookings WHERE session_id = ${sessionId ?? ''}
    `.execute(db);
    expect(booked.rows[0]?.n).toBe('0');
  });

  it('leaves its staff able to sign in and see why', async () => {
    const seen = await send('get', '/hospital/setup', adminToken);
    expect(seen.status).toBe(200);
    expect(seen.body.data.hospital).toMatchObject({
      lifecycle: 'suspended',
      reviewNote: 'চুক্তি নবায়ন বাকি আছে।',
    });
    // It cannot ask its way back in: reinstating is the platform's.
    expect((await send('post', '/hospital/request-review', adminToken)).status).toBe(422);
  });

  it('reinstates it, public again, and then closes it for good', async () => {
    const back = await send('post', `/platform/hospitals/${hospitalId}/reinstate`, platform);
    expect(back.status).toBe(200);
    expect(await lifecycleOf(hospitalId)).toEqual({ lifecycle: 'active', is_live: true });

    const closed = await send('post', `/platform/hospitals/${hospitalId}/close`, platform, {
      note: 'হাসপাতালের অনুরোধে বন্ধ।',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.data.actions).toEqual([]);
    expect(await lifecycleOf(hospitalId)).toEqual({ lifecycle: 'closed', is_live: false });
    expect(await publicSightings(hospitalId)).toEqual(NOWHERE);
  });
});

describe('every act is on the record (FR-ONB-07)', () => {
  it('names the platform administrator, the workspace and what was done, in order', async () => {
    const rows = await sql<{ change: string; actor: string | null }>`
      SELECT meta ->> 'change' AS change, actor_staff_id::text AS actor
        FROM audit_log
       WHERE hospital_id = ${hospitalId} AND action = 'SETTINGS_CHANGE'
         AND (meta ->> 'change' LIKE 'workspace_%'
              OR meta ->> 'change' IN ('review_requested', 'doctor_verified'))
       ORDER BY created_at, id
    `.execute(db);

    expect(rows.rows.map((row) => row.change)).toEqual([
      'workspace_created',
      'review_requested',
      'workspace_send_back',
      'review_requested',
      'doctor_verified',
      'workspace_approve',
      'workspace_suspend',
      'workspace_reinstate',
      'workspace_close',
    ]);

    const byPlatform = rows.rows.filter((row) => row.change !== 'review_requested');
    expect(byPlatform.every((row) => row.actor === platformStaffId)).toBe(true);
  });
});

describe('a deployment’s first platform administrator (pnpm staff:create --platform)', () => {
  const email = `ops-${randomUUID().slice(0, 8)}@platform.demo.invalid`;
  let staffId: string | undefined;

  afterAll(async () => {
    if (staffId === undefined) return;
    await asOwner(async (owner) => {
      await sql`DELETE FROM audit_log WHERE actor_staff_id = ${staffId ?? ''}`.execute(owner);
      await sql`DELETE FROM sessions_auth WHERE subject_id = ${staffId ?? ''}`.execute(owner);
      await sql`DELETE FROM staff_roles WHERE staff_user_id = ${staffId ?? ''}`.execute(owner);
      await sql`DELETE FROM staff_users WHERE id = ${staffId ?? ''}`.execute(owner);
    });
  });

  it('belongs to no facility, signs in, and must change the password it was given', async () => {
    const created = await createPlatformAdministrator({ email, fullName: 'প্ল্যাটফর্ম (ডেমো)' });
    staffId = created.staffId;

    const response = await request(app)
      .post(`${BASE}/staff/login`)
      .send({ email, password: created.temporaryPassword });

    expect(response.status).toBe(200);
    expect(response.body.data.roles).toEqual(['platform_admin']);
    expect(response.body.data.hospital).toBeNull();
    expect(response.body.data.mustChangePassword).toBe(true);
  });

  it('is refused a second account at the same address', async () => {
    await expect(createPlatformAdministrator({ email, fullName: 'আরেকজন (ডেমো)' })).rejects.toThrow(
      /already has a platform account/,
    );
  });
});

describe('the demonstration’s door to S-B-12 (DEMO_MODE)', () => {
  it('mints a platform administrator’s token, which opens the platform and no hospital', async () => {
    const minted = await request(app).post(`${BASE}/demo/token`).send({ role: 'platform_admin' });
    expect(minted.status).toBe(200);
    const token = minted.body.data.token as string;

    expect((await send('get', '/platform/hospitals', token)).status).toBe(200);
    // Not a hospital's staff: a hospital's own routes refuse it.
    expect((await send('get', '/hospital/setup', token)).status).toBe(403);
    // And not the government's: aggregates are another role's.
    expect((await send('get', '/gov/capacity', token)).status).toBe(403);
  });
});

describe('the rule the database holds (0037)', () => {
  it('refuses a live hospital whose workspace is not active, whatever wrote it', async () => {
    await expect(
      asOwner(async (owner) => {
        await sql`
          UPDATE hospitals SET is_live = true, onboarded_at = now()
           WHERE id = ${hospitalId}
        `.execute(owner);
      }),
    ).rejects.toMatchObject({ constraint: 'hospitals_live_requires_workspace_active' });
  });
});
