/**
 * `S-B-11` hospital settings (pilot step 22, `FR-SUP-01`, `FR-ADM-11`,
 * `FR-SUP-02`, BACKEND.md §7.7 `/hospital/*`).
 *
 * The step's promise is that a hospital with no seed data can be set up from
 * the screen and its chambers appear for the next seven days. So the facility
 * here is made the way a real one is — `createFirstAdministrator`, the
 * `pnpm staff:create` path — and has nothing else until these requests give
 * it departments, doctors, schedules, wards and staff. Its names carry the
 * demo label like every other row in a demo database (`FR-DEM-07`), and it is
 * removed afterwards so the seeded six stay the only facilities other files
 * count.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { time } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { hashPassword } from '../config/password.js';
import { verifyDoctor } from '../services/hospitalSettings.service.js';
import { materialise } from '../services/sessionMaterialise.service.js';
import { createFirstAdministrator } from '../services/staffAuth.service.js';

import { asOwner } from './support/ownerDb.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
const made: string[] = [];

interface Facility {
  readonly hospitalId: string;
  readonly adminId: string;
  readonly token: string;
}

function code(): string {
  return `T${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** A new, empty facility and its first administrator, as `pnpm staff:create` makes them. */
async function newFacility(): Promise<Facility> {
  const result = await createFirstAdministrator({
    hospitalCode: code(),
    hospital: {
      nameBn: 'পরীক্ষা হাসপাতাল (ডেমো)',
      nameEn: 'Settings Test Hospital (Demo)',
      kind: 'hospital',
      division: 'Dhaka',
      district: 'Dhaka',
    },
    email: `admin-${randomUUID().slice(0, 8)}@settings.demo.invalid`,
    fullName: 'প্রশাসক (ডেমো)',
  });
  made.push(result.hospitalId);
  const token = await signToken({
    kind: 'access',
    claims: {
      sub: result.staffId,
      kind: 'staff',
      hospitalId: result.hospitalId,
      roles: ['hospital_admin'],
    },
  });
  return { hospitalId: result.hospitalId, adminId: result.staffId, token };
}

function send(
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string,
  token: string,
  body: object = {},
): request.Test {
  return request(app)
    [method](`${BASE}${path}`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

async function removeFacilities(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const list = [...ids];
  // As the owner: the API's role may not delete an audit row (`ownerDb.ts`).
  await asOwner(async (owner) => {
    await sql`DELETE FROM sessions WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    await sql`DELETE FROM beds WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    await sql`DELETE FROM wards WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    await sql`
      DELETE FROM session_templates WHERE doctor_hospital_id IN
        (SELECT id FROM doctor_hospitals WHERE hospital_id = ANY(${list}::uuid[]))
    `.execute(owner);
    const doctors = await sql<{ doctor_id: string }>`
      SELECT DISTINCT doctor_id FROM doctor_hospitals WHERE hospital_id = ANY(${list}::uuid[])
    `.execute(owner);
    await sql`DELETE FROM doctor_hospitals WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    // Only the doctors these tests created: a seeded doctor linked here sits elsewhere too.
    await sql`
      DELETE FROM doctors d
       WHERE d.id = ANY(${doctors.rows.map((row) => row.doctor_id)}::uuid[])
         AND NOT EXISTS (SELECT 1 FROM doctor_hospitals dh WHERE dh.doctor_id = d.id)
    `.execute(owner);
    await sql`DELETE FROM departments WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    await sql`DELETE FROM audit_log WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    await sql`
      DELETE FROM sessions_auth WHERE subject_id IN
        (SELECT id FROM staff_users WHERE hospital_id = ANY(${list}::uuid[]))
    `.execute(owner);
    await sql`DELETE FROM staff_roles WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    await sql`UPDATE hospitals SET created_by = NULL WHERE id = ANY(${list}::uuid[])`.execute(
      owner,
    );
    await sql`DELETE FROM staff_users WHERE hospital_id = ANY(${list}::uuid[])`.execute(owner);
    await sql`DELETE FROM hospitals WHERE id = ANY(${list}::uuid[])`.execute(owner);
  });
}

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await removeFacilities(made);
});

describe('who may open S-B-11 (FR-ROLE-01)', () => {
  let facility: Facility;

  beforeAll(async () => {
    facility = await newFacility();
  });

  it('needs a signed-in account', async () => {
    const response = await request(app).get(`${BASE}/hospital/setup`);
    expect(response.status).toBe(401);
  });

  it('is the hospital administrator’s alone', async () => {
    for (const token of [
      await staffToken(
        ['receptionist', 'doctor', 'ward', 'emergency', 'lab', 'pharmacy'],
        facility.hospitalId,
      ),
      await nationalToken(),
      await patientToken(),
    ]) {
      const response = await request(app)
        .get(`${BASE}/hospital/setup`)
        .set('Authorization', bearer(token));
      expect(response.status).toBe(403);
    }
  });

  it('answers with the administrator’s own facility, empty until it is set up', async () => {
    const response = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', bearer(facility.token));

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.hospital.id).toBe(facility.hospitalId);
    expect(data.hospital.isLive).toBe(false);
    expect(data.departments).toEqual([]);
    expect(data.doctors).toEqual([]);
    // The defaults the requirements name (FR-QUE-20, FR-QUE-21, FR-OFF-04).
    expect(data.rules).toEqual({
      noShowGracePatients: 2,
      noShowGraceMinutes: 15,
      lateReinsertAfter: 3,
      staleThresholdMinutes: 10,
      smsBudgetMonthly: null,
      paymentHoldMinutes: 15,
    });
    expect(data.staff).toHaveLength(1);
    expect(data.staff[0].roles).toEqual(['hospital_admin']);
  });

  it('refuses a write without an idempotency key', async () => {
    const response = await request(app)
      .post(`${BASE}/hospital/departments`)
      .set('Authorization', bearer(facility.token))
      .send({ nameBn: 'মেডিসিন (ডেমো)', nameEn: 'Medicine (Demo)', code: 'MED' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('cannot reach another facility’s rows, which it cannot even name', async () => {
    const other = await newFacility();
    const department = await send('post', '/hospital/departments', other.token, {
      nameBn: 'শিশু (ডেমো)',
      nameEn: 'Paediatrics (Demo)',
      code: 'PAED',
    });
    expect(department.status).toBe(200);

    const response = await send(
      'patch',
      `/hospital/departments/${department.body.data.departmentId as string}`,
      facility.token,
      { nameEn: 'Taken over (Demo)' },
    );
    expect(response.status).toBe(404);
  });
});

describe('a facility with no seed data, set up from the screen (FR-SUP-01)', () => {
  let facility: Facility;
  let departmentId: string;
  let doctorHospitalId: string;
  let templateId: string;
  const today = time.toDhakaDate(time.fromDate(new Date()));
  const weekday = time.dhakaWeekday(time.fromDate(new Date()));

  beforeAll(async () => {
    facility = await newFacility();
  });

  it('keeps its profile and queue rules, and audits each change', async () => {
    expect(
      (
        await send('patch', '/hospital/profile', facility.token, {
          phone: '+8802912345678',
          coordinates: { lat: 23.75, lng: 90.39 },
          addressEn: 'Road 1, Dhanmondi (Demo)',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send('patch', '/hospital/rules', facility.token, {
          lateReinsertAfter: 4,
          smsBudgetMonthly: 5000,
        })
      ).status,
    ).toBe(200);

    const setup = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', bearer(facility.token));
    expect(setup.body.data.hospital.lat).toBeCloseTo(23.75);
    expect(setup.body.data.rules.lateReinsertAfter).toBe(4);
    // FR-NOT-06: the cap the notification worker reads.
    expect(setup.body.data.rules.smsBudgetMonthly).toBe(5000);

    const audit = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_log
       WHERE hospital_id = ${facility.hospitalId} AND action = 'SETTINGS_CHANGE'
         AND actor_staff_id = ${facility.adminId}
    `.execute(db);
    expect(audit.rows[0]?.n).toBe(2);
  });

  it('adds a department, and refuses its code twice', async () => {
    const response = await send('post', '/hospital/departments', facility.token, {
      nameBn: 'হৃদরোগ (ডেমো)',
      nameEn: 'Cardiology (Demo)',
      code: 'card',
    });
    expect(response.status).toBe(200);
    departmentId = response.body.data.departmentId as string;

    const again = await send('post', '/hospital/departments', facility.token, {
      nameBn: 'হৃদরোগ (ডেমো)',
      nameEn: 'Cardiology (Demo)',
      code: 'CARD',
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: 'SETTINGS_DUPLICATE',
      details: { field: 'code' },
    });
  });

  it('will not ask for review with nothing a patient could book (FR-ONB-03)', async () => {
    const response = await send('post', '/hospital/request-review', facility.token);
    expect(response.status).toBe(422);
    expect(response.body.error.details).toMatchObject({
      reason: 'not_ready',
      missing: ['doctors', 'schedules'],
    });
  });

  it('adds a doctor, unverified until the platform checks the register (FR-SUP-02)', async () => {
    const bmdc = `A-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const response = await send('post', '/hospital/doctors', facility.token, {
      nameBn: 'ডা. পরীক্ষা (ডেমো)',
      nameEn: 'Dr Test (Demo)',
      bmdcNumber: bmdc,
      specialties: ['cardiology'],
      departmentId,
      feePoisha: 80_000,
      room: '204',
    });
    expect(response.status).toBe(200);
    expect(response.body.data.linkedExisting).toBe(false);
    doctorHospitalId = response.body.data.doctorHospitalId as string;

    // Unverified: the facility may still correct the name.
    expect(
      (
        await send('patch', `/hospital/doctors/${doctorHospitalId}`, facility.token, {
          nameEn: 'Dr Tested (Demo)',
        })
      ).status,
    ).toBe(200);

    expect(await verifyDoctor(bmdc)).toBe('Dr Tested (Demo)');
    const locked = await send('patch', `/hospital/doctors/${doctorHospitalId}`, facility.token, {
      nameEn: 'Someone else (Demo)',
    });
    expect(locked.status).toBe(422);
    expect(locked.body.error.details.reason).toBe('doctor_verified');
  });

  it('links a doctor it already knows rather than making a second record', async () => {
    const seeded = await sql<{ bmdc_number: string }>`
      SELECT d.bmdc_number FROM doctors d
       WHERE d.deleted_at IS NULL AND d.bmdc_verified_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM doctor_hospitals dh
                          WHERE dh.doctor_id = d.id AND dh.hospital_id = ${facility.hospitalId})
       ORDER BY d.bmdc_number
       LIMIT 1
    `.execute(db);
    const bmdc = seeded.rows[0]?.bmdc_number;
    if (bmdc === undefined) throw new Error('the seeds made no verified doctor (FR-DEM-02)');

    const response = await send('post', '/hospital/doctors', facility.token, {
      nameBn: 'যেকোনো (ডেমো)',
      nameEn: 'Anything (Demo)',
      bmdcNumber: bmdc,
      departmentId,
      feePoisha: 50_000,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.linkedExisting).toBe(true);

    const twice = await send('post', '/hospital/doctors', facility.token, {
      nameBn: 'যেকোনো (ডেমো)',
      nameEn: 'Anything (Demo)',
      bmdcNumber: bmdc,
      departmentId,
      feePoisha: 50_000,
    });
    expect(twice.status).toBe(409);
  });

  it('turns a weekly schedule into this week’s and next week’s chambers at once', async () => {
    const response = await send('post', '/hospital/templates', facility.token, {
      doctorHospitalId,
      weekday,
      startTime: '17:00',
      endTime: '21:00',
      capacity: 30,
    });
    expect(response.status).toBe(200);
    templateId = response.body.data.templateId as string;
    // Today plus seven days holds today's weekday twice.
    expect(response.body.data.sessionsCreated).toBe(2);

    const sessions = await sql<{
      session_date: string;
      fee_poisha: number;
      room: string | null;
      capacity: number;
    }>`
      SELECT to_char(session_date, 'YYYY-MM-DD') AS session_date, fee_poisha, room, capacity
        FROM sessions WHERE template_id = ${templateId} AND deleted_at IS NULL ORDER BY session_date
    `.execute(db);
    expect(sessions.rows.map((row) => row.session_date)).toEqual([
      today,
      time.toDhakaDate(time.addMinutes(time.fromDate(new Date()), 7 * 24 * 60)),
    ]);
    expect(
      sessions.rows.every(
        (row) => row.fee_poisha === 80_000 && row.room === '204' && row.capacity === 30,
      ),
    ).toBe(true);
  });

  it('writes each chamber once, however often the job runs', async () => {
    // The first run may have work to do that is nobody's here. For about the
    // first hour of a Dhaka day the seeds date the pitch session yesterday —
    // it is dated by when its doctor arrived (`seed_07_demo_live`) — and
    // today's chamber for that schedule is then the job's to write. This
    // line asserted that the first run writes nothing, and failed every
    // night in that hour (seen at 00:13 Dhaka on 6 October). What the job
    // must never do is write a chamber twice.
    await materialise();
    expect(await materialise()).toBe(0);
    expect(await materialise({ onlyTemplate: templateId })).toBe(0);
    const count = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM sessions WHERE template_id = ${templateId} AND deleted_at IS NULL
    `.execute(db);
    expect(count.rows[0]?.n).toBe(2);
  });

  it('writes a chamber that is missing the first time it runs, and not again', async () => {
    // What the job is for, and what it did at 00:13 Dhaka on 6 October: a
    // schedule whose chamber for today does not exist. Everything else is
    // written first, so the count below is this chamber and nothing the hour
    // happens to have left undone.
    await materialise();
    await asOwner(async (owner) => {
      await sql`
        DELETE FROM sessions WHERE template_id = ${templateId} AND session_date = ${today}::date
      `.execute(owner);
    });

    expect(await materialise()).toBe(1);

    const sessions = await sql<{ session_date: string }>`
      SELECT to_char(session_date, 'YYYY-MM-DD') AS session_date
        FROM sessions WHERE template_id = ${templateId} AND deleted_at IS NULL ORDER BY session_date
    `.execute(db);
    expect(sessions.rows.map((row) => row.session_date)).toEqual([
      today,
      time.toDhakaDate(time.addMinutes(time.fromDate(new Date()), 7 * 24 * 60)),
    ]);

    expect(await materialise()).toBe(0);
  });

  it('writes the next day’s chamber beside one still running, and changes neither (FR-QUE-06)', async () => {
    // The same doctor sits tomorrow too: a second schedule, for tomorrow's
    // weekday. Its chambers are written at once, tomorrow's among them.
    const now = time.fromDate(new Date());
    const tomorrow = time.toDhakaDate(time.addMinutes(now, 24 * 60));
    const added = await send('post', '/hospital/templates', facility.token, {
      doctorHospitalId,
      weekday: time.dhakaWeekday(time.addMinutes(now, 24 * 60)),
      startTime: '17:00',
      endTime: '21:00',
      capacity: 30,
    });
    expect(added.status).toBe(200);
    const nextDay = added.body.data.templateId as string;

    // Today's chamber runs late: it is still running when the day turns.
    await asOwner(async (owner) => {
      await sql`
        UPDATE sessions SET status = 'running', actual_start = now()
         WHERE template_id = ${templateId} AND session_date = ${today}::date
      `.execute(owner);
    });

    const chambers = async (): Promise<
      { id: string; template: string; day: string; status: string }[]
    > =>
      (
        await sql<{ id: string; template: string; day: string; status: string }>`
          SELECT id, template_id AS template, to_char(session_date, 'YYYY-MM-DD') AS day,
                 status::text AS status
            FROM sessions
           WHERE template_id IN (${templateId}, ${nextDay}) AND deleted_at IS NULL
             AND session_date IN (${today}::date, ${tomorrow}::date)
           ORDER BY session_date
        `.execute(db)
      ).rows;
    const before = await chambers();

    // Two chambers, one doctor, two days: the one still running is today's,
    // and tomorrow's is its own row. Neither replaced the other.
    expect(before.map((row) => [row.template, row.day, row.status])).toEqual([
      [templateId, today, 'running'],
      [nextDay, tomorrow, 'scheduled'],
    ]);

    // The job runs as it does after midnight, from the next day on, for both
    // schedules. It writes what that day newly reaches and touches neither of
    // these: nothing is moved to the next day, and nothing is written twice.
    await materialise({ from: tomorrow, onlyTemplate: templateId });
    await materialise({ from: tomorrow, onlyTemplate: nextDay });
    expect(await chambers()).toEqual(before);
    expect(await materialise({ from: tomorrow, onlyTemplate: templateId })).toBe(0);
    expect(await materialise({ from: tomorrow, onlyTemplate: nextDay })).toBe(0);

    // Left as the tests after this one expect to find it.
    await asOwner(async (owner) => {
      await sql`
        UPDATE sessions SET status = 'scheduled', actual_start = NULL
         WHERE template_id = ${templateId} AND session_date = ${today}::date
      `.execute(owner);
      await sql`DELETE FROM sessions WHERE template_id = ${nextDay}`.execute(owner);
      await sql`DELETE FROM session_templates WHERE id = ${nextDay}`.execute(owner);
    });
  });

  it('refuses a schedule that overlaps the doctor’s own', async () => {
    const response = await send('post', '/hospital/templates', facility.token, {
      doctorHospitalId,
      weekday,
      startTime: '20:00',
      endTime: '22:00',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.details.field).toBe('schedule');
  });

  it('carries a fee change to chambers still scheduled, not to bookings (DB-P5)', async () => {
    expect(
      (
        await send('patch', `/hospital/doctors/${doctorHospitalId}`, facility.token, {
          feePoisha: 90_000,
        })
      ).status,
    ).toBe(200);
    const fees = await sql<{ fee_poisha: number }>`
      SELECT fee_poisha FROM sessions WHERE template_id = ${templateId} AND deleted_at IS NULL
    `.execute(db);
    expect(fees.rows.map((row) => row.fee_poisha)).toEqual([90_000, 90_000]);
  });

  it('asks for review once there is something to book, and publishes nothing itself (FR-ONB-04)', async () => {
    // Going live is the platform's answer to this request; the whole path is
    // `platform.routes.test.ts`.
    const response = await send('post', '/hospital/request-review', facility.token);
    expect(response.status).toBe(200);
    const row = await sql<{ lifecycle: string; is_live: boolean }>`
      SELECT lifecycle::text AS lifecycle, is_live FROM hospitals WHERE id = ${facility.hospitalId}
    `.execute(db);
    expect(row.rows[0]).toEqual({ lifecycle: 'ready_for_review', is_live: false });
  });

  it('removes a schedule’s future chambers that nobody booked', async () => {
    const response = await send('delete', `/hospital/templates/${templateId}`, facility.token);
    expect(response.status).toBe(200);
    expect(response.body.data.bookedChambersKept).toBe(0);
    const left = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM sessions WHERE template_id = ${templateId} AND deleted_at IS NULL
    `.execute(db);
    expect(left.rows[0]?.n).toBe(0);

    // And the job does not write them back: not asked for this schedule
    // alone, and not on a run of its own. Counted by this schedule's
    // chambers, because what a whole run writes depends on the hour (above).
    expect(await materialise({ onlyTemplate: templateId })).toBe(0);
    await materialise();
    const after = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM sessions WHERE template_id = ${templateId} AND deleted_at IS NULL
    `.execute(db);
    expect(after.rows[0]?.n).toBe(0);
  });
});

describe('wards and beds from settings (FR-SUP-01)', () => {
  let facility: Facility;

  beforeAll(async () => {
    facility = await newFacility();
  });

  it('adds beds out of service until the ward confirms them, never falsely free', async () => {
    const ward = await send('post', '/hospital/wards', facility.token, {
      nameBn: 'সাধারণ ওয়ার্ড (ডেমো)',
      nameEn: 'General Ward (Demo)',
      floor: 3,
      kind: 'general',
    });
    expect(ward.status).toBe(200);
    const wardId = ward.body.data.wardId as string;

    const beds = await send('post', '/hospital/beds', facility.token, {
      wardId,
      labels: ['301', '302', '303'],
      kind: 'general',
      nightlyPoisha: 150_000,
    });
    expect(beds.status).toBe(200);
    expect(beds.body.data.bedIds).toHaveLength(3);

    const states = await sql<{ state: string; oos_reason: string }>`
      SELECT state::text AS state, oos_reason FROM beds WHERE ward_id = ${wardId}
    `.execute(db);
    expect(
      states.rows.every(
        (row) => row.state === 'out_of_service' && row.oos_reason === 'setup:unconfirmed',
      ),
    ).toBe(true);

    const again = await send('post', '/hospital/beds', facility.token, {
      wardId,
      labels: ['303', '304'],
      kind: 'general',
      nightlyPoisha: 150_000,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ field: 'label', labels: ['303'] });
  });
});

describe('staff accounts (FR-ADM-11, FR-SEC-06)', () => {
  let facility: Facility;

  beforeAll(async () => {
    facility = await newFacility();
  });

  it('creates an account with a temporary password that must be changed at first sign-in', async () => {
    const email = `reception-${randomUUID().slice(0, 8)}@settings.demo.invalid`;
    const created = await send('post', '/hospital/staff', facility.token, {
      fullName: 'অভ্যর্থনা (ডেমো)',
      email,
      staffCode: 'r-01',
      roles: ['receptionist'],
    });
    expect(created.status).toBe(200);
    const password = created.body.data.temporaryPassword as string;
    expect(password.length).toBeGreaterThanOrEqual(12);

    const hospital = await sql<{
      code: string;
    }>`SELECT code FROM hospitals WHERE id = ${facility.hospitalId}`.execute(db);
    const login = await request(app)
      .post(`${BASE}/staff/login`)
      .send({ email, password, hospitalCode: hospital.rows[0]?.code });
    expect(login.status).toBe(200);
    expect(login.body.data.mustChangePassword).toBe(true);

    const duplicate = await send('post', '/hospital/staff', facility.token, {
      fullName: 'আবার (ডেমো)',
      email: email.toUpperCase(),
      roles: ['ward'],
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details.field).toBe('email');
  });

  it('never hands out a role that belongs to no facility', async () => {
    const response = await send('post', '/hospital/staff', facility.token, {
      fullName: 'কেউ (ডেমো)',
      email: `x-${randomUUID().slice(0, 8)}@settings.demo.invalid`,
      roles: ['platform_admin'],
    });
    expect(response.status).toBe(400);
  });

  it('will not let an administrator lock themself out', async () => {
    const deactivate = await send('patch', `/hospital/staff/${facility.adminId}`, facility.token, {
      isActive: false,
    });
    expect(deactivate.status).toBe(422);
    expect(deactivate.body.error.details.reason).toBe('own_access');

    const demote = await send('patch', `/hospital/staff/${facility.adminId}`, facility.token, {
      roles: ['receptionist'],
    });
    expect(demote.status).toBe(422);

    const reset = await send(
      'post',
      `/hospital/staff/${facility.adminId}/reset-password`,
      facility.token,
    );
    expect(reset.status).toBe(422);
    expect(reset.body.error.details.reason).toBe('own_password');
  });

  it('deactivates an account and ends its sessions; a reset issues a new temporary password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    const inserted = await sql<{ id: string }>`
      INSERT INTO staff_users (hospital_id, email, full_name, password_hash)
      VALUES (${facility.hospitalId}, ${`ward-${randomUUID().slice(0, 8)}@settings.demo.invalid`}, 'ওয়ার্ড (ডেমো)', ${hash})
      RETURNING id
    `.execute(db);
    const staffId = inserted.rows[0]?.id ?? '';

    const reset = await send('post', `/hospital/staff/${staffId}/reset-password`, facility.token);
    expect(reset.status).toBe(200);
    const row = await sql<{ must_change_password: boolean }>`
      SELECT must_change_password FROM staff_users WHERE id = ${staffId}
    `.execute(db);
    expect(row.rows[0]?.must_change_password).toBe(true);

    expect(
      (
        await send('patch', `/hospital/staff/${staffId}`, facility.token, {
          isActive: false,
          roles: ['ward'],
        })
      ).status,
    ).toBe(200);
    const after = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', bearer(facility.token));
    const account = (
      after.body.data.staff as { id: string; isActive: boolean; roles: string[] }[]
    ).find((entry) => entry.id === staffId);
    expect(account).toMatchObject({ isActive: false, roles: ['ward'] });
  });
});

describe('what the facility offers in an emergency (FR-EMG-05)', () => {
  let facility: Facility;

  beforeAll(async () => {
    facility = await newFacility();
  });

  it('declares kinds unavailable until the ER says otherwise, and withdraws one', async () => {
    const declared = await send('put', '/hospital/capabilities', facility.token, {
      kinds: ['burn_unit', 'cardiac'],
    });
    expect(declared.status).toBe(200);

    const setup = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', bearer(facility.token));
    expect(
      (setup.body.data.capabilities as { kind: string; isAvailable: boolean }[]).map((entry) => [
        entry.kind,
        entry.isAvailable,
      ]),
    ).toEqual([
      ['burn_unit', false],
      ['cardiac', false],
    ]);

    // The ER's half now accepts the declared kind.
    const confirmed = await request(app)
      .put(`${BASE}/hospitals/${facility.hospitalId}/capabilities`)
      .set('Authorization', bearer(facility.token))
      .set('Idempotency-Key', randomUUID())
      .send({ capabilities: [{ kind: 'cardiac', available: true }] });
    expect(confirmed.status).toBe(200);

    expect(
      (await send('put', '/hospital/capabilities', facility.token, { kinds: ['cardiac'] })).status,
    ).toBe(200);
    const rows = await sql<{ kind: string; is_available: boolean }>`
      SELECT kind::text AS kind, is_available FROM capabilities WHERE hospital_id = ${facility.hospitalId}
    `.execute(db);
    // Still offered keeps its state; withdrawn is gone.
    expect(rows.rows).toEqual([{ kind: 'cardiac', is_available: true }]);
  });
});

// ---------------------------------------------------------------------------
// Plan D2: the checklist names the rest, and a mistake can be put right
// ---------------------------------------------------------------------------

interface SetupData {
  readonly hospital: {
    readonly division: string;
    readonly district: string;
    readonly registrationNo: string | null;
    readonly phone: string | null;
  };
  readonly counts: {
    readonly contact: number;
    readonly location: number;
    readonly capabilities: number | null;
  };
  readonly departments: readonly { id: string; code: string; nameEn: string }[];
  readonly wards: readonly {
    id: string;
    nameEn: string;
    floor: number;
    beds: readonly { id: string; label: string; unconfirmed: boolean; nightlyPoisha: number }[];
  }[];
}

async function setupOf(token: string): Promise<SetupData> {
  const response = await request(app)
    .get(`${BASE}/hospital/setup`)
    .set('Authorization', bearer(token));
  expect(response.status).toBe(200);
  return response.body.data as SetupData;
}

async function auditChanges(hospitalId: string): Promise<string[]> {
  const rows = await sql<{ change: string }>`
    SELECT meta ->> 'change' AS change FROM audit_log
     WHERE hospital_id = ${hospitalId} AND action = 'SETTINGS_CHANGE' ORDER BY created_at
  `.execute(db);
  return rows.rows.map((row) => row.change);
}

describe('the checklist names what a patient needs to reach the place (FR-ONB-03, plan D2)', () => {
  let facility: Facility;

  beforeAll(async () => {
    facility = await newFacility();
  });

  it('says no to each until it is there, and then yes', async () => {
    const empty = await setupOf(facility.token);
    // An emergency desk is on unless switched off, so there is a count: none yet.
    expect(empty.counts).toMatchObject({ contact: 0, location: 0, capabilities: 0 });

    // A phone alone is not enough to find the place.
    await send('patch', '/hospital/profile', facility.token, { phone: '+8802912345678' });
    expect((await setupOf(facility.token)).counts.contact).toBe(0);

    await send('patch', '/hospital/profile', facility.token, {
      addressBn: 'সড়ক ১, ধানমন্ডি (ডেমো)',
      coordinates: { lat: 23.75, lng: 90.39 },
    });
    await send('put', '/hospital/capabilities', facility.token, { kinds: ['cardiac', 'dialysis'] });

    expect((await setupOf(facility.token)).counts).toMatchObject({
      contact: 1,
      location: 1,
      capabilities: 2,
    });
  });

  it('names them without making review wait for them', async () => {
    const bare = await newFacility();
    const response = await send('post', '/hospital/request-review', bare.token);
    expect(response.status).toBe(422);
    // What review waits for is what `FR-ONB-03` lists, and nothing added here.
    expect(response.body.error.details.missing).toEqual(['departments', 'doctors', 'schedules']);
  });

  it('has no line for emergency services where there is no emergency desk (FR-BRD-11)', async () => {
    await asOwner(async (owner) => {
      await sql`
        UPDATE hospital_settings SET modules_off = '{emergency}'
         WHERE hospital_id = ${facility.hospitalId}
      `.execute(owner);
    });
    expect((await setupOf(facility.token)).counts.capabilities).toBeNull();
  });
});

describe('what it was registered as is its own to correct while setting up (plan D2)', () => {
  let facility: Facility;

  beforeAll(async () => {
    facility = await newFacility();
  });

  async function lifecycle(to: string): Promise<void> {
    await asOwner(async (owner) => {
      await sql`
        UPDATE hospitals SET lifecycle = ${to}::org_lifecycle WHERE id = ${facility.hospitalId}
      `.execute(owner);
    });
  }

  it('division, district and registration number, each audited', async () => {
    const saved = await send('patch', '/hospital/profile', facility.token, {
      division: 'Chattogram',
      district: 'Cumilla',
      registrationNo: 'DEMO-REG-0042',
    });
    expect(saved.status).toBe(200);
    expect((await setupOf(facility.token)).hospital).toMatchObject({
      division: 'Chattogram',
      district: 'Cumilla',
      registrationNo: 'DEMO-REG-0042',
    });

    // Null takes the number away; a district cannot be emptied.
    await send('patch', '/hospital/profile', facility.token, { registrationNo: null });
    expect((await setupOf(facility.token)).hospital.registrationNo).toBeNull();
    expect(
      (await send('patch', '/hospital/profile', facility.token, { district: '' })).status,
    ).toBe(400);
    expect(await auditChanges(facility.hospitalId)).toEqual(['profile', 'profile']);
  });

  it('and not once review has been asked for; everything else still saves', async () => {
    await lifecycle('ready_for_review');
    for (const body of [
      { district: 'Feni' },
      { division: 'Dhaka' },
      { registrationNo: 'DEMO-REG-0099' },
      // One identity field among ordinary ones refuses the whole save.
      { phone: '+8802912345678', district: 'Feni' },
    ]) {
      const refused = await send('patch', '/hospital/profile', facility.token, body);
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(refused.body.error.details.reason).toBe('identity_after_review');
    }
    const still = await setupOf(facility.token);
    expect(still.hospital).toMatchObject({ division: 'Chattogram', district: 'Cumilla' });
    expect(still.hospital.phone).toBeNull();

    expect(
      (await send('patch', '/hospital/profile', facility.token, { phone: '+8802912345678' }))
        .status,
    ).toBe(200);
  });

  it('a workspace sent back is setting up again, and can correct them', async () => {
    await lifecycle('setup');
    expect(
      (await send('patch', '/hospital/profile', facility.token, { district: 'Feni' })).status,
    ).toBe(200);
    expect((await setupOf(facility.token)).hospital.district).toBe('Feni');
  });
});

describe('what was added by mistake can be taken away, while nothing stands on it (plan D2)', () => {
  let facility: Facility;
  let other: Facility;

  beforeAll(async () => {
    facility = await newFacility();
    other = await newFacility();
  });

  async function department(token: string, code: string): Promise<string> {
    const response = await send('post', '/hospital/departments', token, {
      nameBn: 'বিভাগ (ডেমো)',
      nameEn: `Department ${code} (Demo)`,
      code,
    });
    expect(response.status).toBe(200);
    return response.body.data.departmentId as string;
  }

  async function ward(token: string, nameEn: string): Promise<string> {
    const response = await send('post', '/hospital/wards', token, {
      nameBn: 'ওয়ার্ড (ডেমো)',
      nameEn,
      floor: 2,
      kind: 'general',
    });
    expect(response.status).toBe(200);
    return response.body.data.wardId as string;
  }

  it('only the hospital’s administrator may', async () => {
    const id = await department(facility.token, 'GATE');
    const others = [
      await staffToken(
        ['receptionist', 'doctor', 'ward', 'emergency', 'lab', 'pharmacy'],
        facility.hospitalId,
      ),
      await nationalToken(),
      await patientToken(),
    ];
    for (const token of others) {
      for (const [method, path] of [
        ['delete', `/hospital/departments/${id}`],
        ['patch', `/hospital/wards/${randomUUID()}`],
        ['delete', `/hospital/wards/${randomUUID()}`],
        ['delete', `/hospital/beds/${randomUUID()}`],
      ] as const) {
        expect((await send(method, path, token, { floor: 1 })).status, `${method} ${path}`).toBe(
          403,
        );
      }
    }
    expect((await request(app).delete(`${BASE}/hospital/departments/${id}`)).status).toBe(401);
    expect((await setupOf(facility.token)).departments.map((entry) => entry.id)).toContain(id);
  });

  it('a department nobody sits in goes, and its code is free again', async () => {
    const id = await department(facility.token, 'CRAD');
    const removed = await send('delete', `/hospital/departments/${id}`, facility.token);
    expect(removed.status).toBe(200);
    expect((await setupOf(facility.token)).departments.map((entry) => entry.code)).not.toContain(
      'CRAD',
    );
    // Gone is gone: a second removal finds nothing.
    expect((await send('delete', `/hospital/departments/${id}`, facility.token)).status).toBe(404);
    // The code that was mistyped can be given to the department that was meant.
    await department(facility.token, 'CRAD');
    expect(await auditChanges(facility.hospitalId)).toContain('department_removed');
  });

  it('a department a doctor is listed under stays, and says why', async () => {
    const id = await department(facility.token, 'CARD');
    const doctor = await send('post', '/hospital/doctors', facility.token, {
      nameBn: 'ডা. পরীক্ষা (ডেমো)',
      nameEn: 'Dr Listed (Demo)',
      bmdcNumber: `A-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      departmentId: id,
      feePoisha: 80_000,
    });
    expect(doctor.status).toBe(200);

    const refused = await send('delete', `/hospital/departments/${id}`, facility.token);
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('department_has_doctors');
    expect((await setupOf(facility.token)).departments.map((entry) => entry.id)).toContain(id);

    // Deactivated, the doctor is still listed under it.
    await send(
      'patch',
      `/hospital/doctors/${doctor.body.data.doctorHospitalId as string}`,
      facility.token,
      { isActive: false },
    );
    expect((await send('delete', `/hospital/departments/${id}`, facility.token)).status).toBe(422);
  });

  it('a ward is renamed and moved to another floor, and not onto another ward’s name', async () => {
    const first = await ward(facility.token, 'Ward One (Demo)');
    await ward(facility.token, 'Ward Two (Demo)');

    const changed = await send('patch', `/hospital/wards/${first}`, facility.token, {
      nameBn: 'পুরুষ ওয়ার্ড (ডেমো)',
      nameEn: 'Male Ward (Demo)',
      floor: 5,
    });
    expect(changed.status).toBe(200);
    expect((await setupOf(facility.token)).wards.find((entry) => entry.id === first)).toMatchObject(
      { nameEn: 'Male Ward (Demo)', floor: 5 },
    );

    const clash = await send('patch', `/hospital/wards/${first}`, facility.token, {
      nameEn: 'Ward Two (Demo)',
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details).toMatchObject({ field: 'nameEn' });
    // Its own name again is no clash.
    expect(
      (
        await send('patch', `/hospital/wards/${first}`, facility.token, {
          nameEn: 'Male Ward (Demo)',
        })
      ).status,
    ).toBe(200);
    expect((await send('patch', `/hospital/wards/${first}`, facility.token, {})).status).toBe(400);
    expect(
      (await send('patch', `/hospital/wards/${first}`, facility.token, { kind: 'icu' })).status,
    ).toBe(400);
  });

  it('a bed the ward never brought into service goes; one it has does not', async () => {
    const wardId = await ward(facility.token, 'Bed Ward (Demo)');
    const added = await send('post', '/hospital/beds', facility.token, {
      wardId,
      labels: ['401', '402', '403', '404'],
      kind: 'general',
      nightlyPoisha: 150_000,
    });
    const [b401, b402, b403, b404] = added.body.data.bedIds as string[];

    // 404 was typed by mistake.
    expect((await send('delete', `/hospital/beds/${b404 ?? ''}`, facility.token)).status).toBe(200);
    const beds = (await setupOf(facility.token)).wards.find((entry) => entry.id === wardId)?.beds;
    expect(beds?.map((bed) => bed.label)).toEqual(['401', '402', '403']);
    expect(beds?.every((bed) => bed.unconfirmed)).toBe(true);
    // Its label is free for the bed that was meant.
    expect(
      (
        await send('post', '/hospital/beds', facility.token, {
          wardId,
          labels: ['404'],
          kind: 'general',
          nightlyPoisha: 150_000,
        })
      ).status,
    ).toBe(200);

    // The ward brings 401 into service; 402 is out of service for a reason of
    // the ward's own. Neither is a line typed by mistake any more.
    await asOwner(async (owner) => {
      await sql`UPDATE beds SET state = 'free', oos_reason = NULL WHERE id = ${b401 ?? ''}`.execute(
        owner,
      );
      await sql`UPDATE beds SET oos_reason = 'Oxygen line under repair (Demo)' WHERE id = ${b402 ?? ''}`.execute(
        owner,
      );
    });
    for (const id of [b401, b402]) {
      const refused = await send('delete', `/hospital/beds/${id ?? ''}`, facility.token);
      expect(refused.status).toBe(422);
      expect(refused.body.error.details.reason).toBe('bed_in_use');
    }
    const after = (await setupOf(facility.token)).wards.find((entry) => entry.id === wardId)?.beds;
    expect(after?.find((bed) => bed.id === b401)?.unconfirmed).toBe(false);
    expect(after?.find((bed) => bed.id === b402)?.unconfirmed).toBe(false);
    expect(after?.find((bed) => bed.id === b403)?.unconfirmed).toBe(true);
    expect(await auditChanges(facility.hospitalId)).toContain('bed_removed');
  });

  it('a ward goes only once it holds no bed', async () => {
    const wardId = await ward(facility.token, 'Short Ward (Demo)');
    const added = await send('post', '/hospital/beds', facility.token, {
      wardId,
      labels: ['S-1'],
      kind: 'general',
      nightlyPoisha: 100_000,
    });
    const refused = await send('delete', `/hospital/wards/${wardId}`, facility.token);
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('ward_has_beds');

    const [bedId] = added.body.data.bedIds as string[];
    expect((await send('delete', `/hospital/beds/${bedId ?? ''}`, facility.token)).status).toBe(
      200,
    );
    expect((await send('delete', `/hospital/wards/${wardId}`, facility.token)).status).toBe(200);
    expect((await setupOf(facility.token)).wards.map((entry) => entry.id)).not.toContain(wardId);
    // Its name is free again.
    await ward(facility.token, 'Short Ward (Demo)');
  });

  it('another hospital’s department, ward or bed is not there to be changed', async () => {
    const theirDepartment = await department(other.token, 'THEIRS');
    const theirWard = await ward(other.token, 'Their Ward (Demo)');
    const theirBeds = await send('post', '/hospital/beds', other.token, {
      wardId: theirWard,
      labels: ['T-1'],
      kind: 'general',
      nightlyPoisha: 100_000,
    });
    const [theirBed] = theirBeds.body.data.bedIds as string[];

    for (const [method, path, body] of [
      ['delete', `/hospital/departments/${theirDepartment}`, {}],
      ['patch', `/hospital/wards/${theirWard}`, { floor: 9 }],
      ['delete', `/hospital/wards/${theirWard}`, {}],
      ['delete', `/hospital/beds/${theirBed ?? ''}`, {}],
    ] as const) {
      expect((await send(method, path, facility.token, body)).status, `${method} ${path}`).toBe(
        404,
      );
    }
    const theirs = await setupOf(other.token);
    expect(theirs.departments.map((entry) => entry.id)).toContain(theirDepartment);
    expect(theirs.wards.find((entry) => entry.id === theirWard)).toMatchObject({
      floor: 2,
      beds: [{ id: theirBed }],
    });
  });
});
