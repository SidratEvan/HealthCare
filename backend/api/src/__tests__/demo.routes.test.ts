/**
 * Demo sign-in (CLAUDE.md §4.1).
 *
 * This is the one route in the API that hands out a staff credential to an
 * anonymous caller, so it gets tested as what it is: a door that must only
 * exist on a demonstration deployment, and must only open onto rooms that are
 * already furnished.
 *
 * The strongest guarantee is not in this file at all — `env.ts` refuses to boot
 * with `DEMO_MODE=true` under `NODE_ENV=production`, so a deployment serving
 * real patients cannot reach this code even by misconfiguration. What is
 * asserted here is the second lock: the service refuses when the flag is off,
 * and the token it mints names a real, seeded staff account.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { verifyToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;

beforeEach(() => {
  app = createApp();
  resetEmitter();
});

describe('GET /demo/consoles', () => {
  it('lists live facilities with something running today', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);

    expect(response.status).toBe(200);
    expect(response.body.data.consoles.length).toBeGreaterThan(0);
  });

  it('puts a chamber that is already mid-queue first (FR-DEM-06)', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as {
      sessions: { status: string }[];
    }[];

    // The pitch opens on a running session. Making somebody hunt for it is the
    // difference between a demo that lands and one that explains itself.
    const first = consoles[0];
    expect(first?.sessions[0]?.status).toBe('running');
  });

  it('still offers a chamber that opened before midnight (FR-DEM-06)', async () => {
    // The demo's pitch session is built by walking a mid-queue log backwards
    // from the present, so a reset in the small hours files it under
    // *yesterday's* Dhaka date while the clock says today. Filtering the picker
    // on today's date alone therefore hid the one session the whole demo exists
    // to show — and only ever between midnight and about 01:20 Dhaka, which is
    // the worst kind of bug to find by hand.
    //
    // It is not only a demo problem: a chamber that opened at half past eleven
    // and is still going at one in the morning belongs to the console somebody
    // is standing at.
    const sessionId = await runningSinceYesterday();

    try {
      const response = await request(app).get(`${BASE}/demo/consoles`);
      const offered = (response.body.data.consoles as { sessions: { id: string }[] }[])
        .flatMap((entry) => entry.sessions)
        .map((session) => session.id);

      expect(offered).toContain(sessionId);
    } finally {
      // Put the shared view back. This row is a running chamber with no
      // bookings, and leaving it behind would make it the first session the
      // picker offers — which is what the sibling assertions about the pitch
      // session read. A test that changes what the next one sees is the
      // ordering dependency `queueFixture` exists to avoid (CLAUDE.md §6).
      await releaseSession(sessionId);
    }
  });

  it('offers only the roles this version has a console for', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as { roles: string[] }[];

    for (const entry of consoles) {
      // A door onto an empty room is worse than no door. `ward` joined at
      // step 14 with the bed board, `emergency` at step 15 with the ER
      // console, `lab` and `pharmacy` with their screens at step 17, and
      // `hospital_admin` opens `S-B-10` from step 19.
      for (const role of entry.roles) {
        expect([
          'receptionist',
          'doctor',
          'ward',
          'emergency',
          'lab',
          'pharmacy',
          'hospital_admin',
        ]).toContain(role);
      }
    }
  });

  it('offers the lab and the pharmacy where they are staffed (S-B-08, S-B-09)', async () => {
    // Missing from the picker from step 17 until step 19 — the consoles were
    // built and nothing offered them (`demo.service` OFFERED).
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as { roles: string[] }[];

    expect(consoles.some((entry) => entry.roles.includes('lab'))).toBe(true);
    expect(consoles.some((entry) => entry.roles.includes('pharmacy'))).toBe(true);
    expect(consoles.every((entry) => entry.roles.includes('hospital_admin'))).toBe(true);
  });

  it('offers the ER console wherever an emergency coordinator works (S-B-07)', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as { roles: string[] }[];

    // The four facilities with a full roster (`database/seeds/data/people.ts`).
    expect(
      consoles.filter((entry) => entry.roles.includes('emergency')).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('offers the ward board wherever a ward is staffed (S-B-06)', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as { roles: string[] }[];

    // Four of the six seeded facilities run a ward; the diagnostic centre and
    // the clinic do not (`database/seeds/data/people.ts`).
    expect(consoles.filter((entry) => entry.roles.includes('ward')).length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it('names no patient', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const serialised = JSON.stringify(response.body);

    // This endpoint is reachable without any credential. What it returns is
    // what a hospital already puts on a board in its own lobby.
    expect(serialised).not.toContain('patient_id');
    expect(serialised).not.toContain('phone');
  });

  it('carries the waiting count each chamber has', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as {
      sessions: { waiting: number; total: number }[];
    }[];

    const session = consoles[0]?.sessions[0];
    expect(typeof session?.waiting).toBe('number');
    expect(session?.total).toBeGreaterThan(0);
  });
});

describe('POST /demo/token', () => {
  async function anyHospital(): Promise<{ hospitalId: string; sessionId: string }> {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as {
      hospitalId: string;
      sessions: { id: string }[];
    }[];

    const first = consoles[0];
    if (first === undefined) throw new Error('no seeded console');
    return { hospitalId: first.hospitalId, sessionId: first.sessions[0]?.id ?? '' };
  }

  it('mints a staff token scoped to the hospital and role asked for', async () => {
    const { hospitalId } = await anyHospital();

    const response = await request(app)
      .post(`${BASE}/demo/token`)
      .send({ hospitalId, role: 'receptionist' });

    expect(response.status).toBe(200);

    const verified = await verifyToken(response.body.data.token as string, 'access');
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    expect(verified.claims.kind).toBe('staff');
    expect(verified.claims.hospitalId).toBe(hospitalId);
    expect(verified.claims.roles).toEqual(['receptionist']);
  });

  it('names a real seeded staff account, not an invented id (FR-QUE-04)', async () => {
    const { hospitalId } = await anyHospital();

    const response = await request(app)
      .post(`${BASE}/demo/token`)
      .send({ hospitalId, role: 'receptionist' });

    // `queue_events.actor_staff_id` is a foreign key. A token for an id that
    // does not exist produces a console whose every action the database
    // refuses — so the demo would look broken in exactly the moment it matters.
    expect(response.body.data.staffName).toBeTruthy();

    const verified = await verifyToken(response.body.data.token as string, 'access');
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.sub).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('mints a token for every role the picker offers, the ER included (S-B-07)', async () => {
    // The picker's list and this route's schema are two lists of one thing.
    // Step 15 added the ER to the first and, until this test, not the second:
    // the picker offered "জরুরি বিভাগ খুলুন" and the route refused it.
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as { hospitalId: string; roles: string[] }[];

    for (const entry of consoles) {
      for (const role of entry.roles) {
        const minted = await request(app)
          .post(`${BASE}/demo/token`)
          .send({ hospitalId: entry.hospitalId, role });
        expect(minted.status, `${role} at ${entry.hospitalId}`).toBe(200);
      }
    }
    expect(consoles.some((entry) => entry.roles.includes('emergency'))).toBe(true);
  });

  it('refuses a role this version has no console for', async () => {
    const { hospitalId } = await anyHospital();

    const response = await request(app)
      .post(`${BASE}/demo/token`)
      .send({ hospitalId, role: 'platform_admin' });

    expect(response.status).toBe(400);
  });

  it('refuses a hospital with no staff account', async () => {
    const response = await request(app)
      .post(`${BASE}/demo/token`)
      .send({ hospitalId: '99999999-9999-7999-8999-999999999999', role: 'receptionist' });

    expect(response.status).toBe(404);
  });

  it('refuses a body that is not a hospital and a role', async () => {
    const response = await request(app).post(`${BASE}/demo/token`).send({});
    expect(response.status).toBe(400);
  });
});

describe('the door is shut when DEMO_MODE is off', () => {
  it('refuses to list consoles', async () => {
    const env = await import('../env.js');
    vi.spyOn(env, 'env', 'get').mockReturnValue({ ...env.env, DEMO_MODE: false });

    const response = await request(createApp()).get(`${BASE}/demo/consoles`);

    // Deliberately not a 404: a caller finding this route on a real deployment
    // should learn that it exists and is switched off, rather than go looking
    // for a variant of the path that might not be.
    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('demo_mode_off');

    vi.restoreAllMocks();
  });

  it('refuses to mint a token', async () => {
    const env = await import('../env.js');
    vi.spyOn(env, 'env', 'get').mockReturnValue({ ...env.env, DEMO_MODE: false });

    const response = await request(createApp())
      .post(`${BASE}/demo/token`)
      .send({ hospitalId: '99999999-9999-7999-8999-999999999999', role: 'receptionist' });

    expect(response.status).toBe(403);

    vi.restoreAllMocks();
  });
});

/**
 * A chamber that opened late yesterday evening and has not closed yet.
 *
 * Built on a real seeded chamber like every other session in this suite
 * (CLAUDE.md §6): what matters about this row is its date and its status, so
 * everything else about it should be a doctor who actually exists.
 *
 * `sessions_running_has_started` means a running session has an `actual_start`
 * — a console cannot claim a doctor is in the chamber if none ever arrived —
 * so this sets one rather than working around the constraint.
 */
async function runningSinceYesterday(): Promise<string> {
  const chamber = await sql<{
    hospital_id: string;
    doctor_id: string;
    department_id: string;
    fee_poisha: number;
  }>`
    SELECT dh.hospital_id, dh.doctor_id, dh.department_id, dh.fee_poisha
      FROM doctor_hospitals dh
      JOIN doctors d ON d.id = dh.doctor_id
      JOIN hospitals h ON h.id = dh.hospital_id
     WHERE dh.deleted_at IS NULL AND dh.is_active
       AND h.is_live AND h.deleted_at IS NULL
     ORDER BY d.bmdc_number
     LIMIT 1
  `.execute(db);

  const row = chamber.rows[0];
  if (row === undefined) {
    throw new Error('No seeded chamber found. Has the global setup seeded the database?');
  }

  const session = await sql<{ id: string }>`
    INSERT INTO sessions
      (hospital_id, doctor_id, department_id, room, session_date,
       planned_start, planned_end, actual_start, status, capacity, fee_poisha)
    VALUES (
      ${row.hospital_id}, ${row.doctor_id}, ${row.department_id}, 'LATE',
      (now() AT TIME ZONE 'Asia/Dhaka')::date - 1,
      now() - interval '90 minutes', now() + interval '90 minutes',
      now() - interval '80 minutes', 'running', 20, ${row.fee_poisha}
    )
    RETURNING id
  `.execute(db);

  const id = session.rows[0]?.id;
  if (id === undefined) throw new Error('session insert returned no id.');

  return id;
}

/**
 * Takes the late chamber back out of view.
 *
 * A soft delete rather than a `DELETE`: `deleted_at` is what every read in this
 * repository already filters on, so this removes the row the same way the
 * product would and needs no exception from the append-only rules.
 */
async function releaseSession(sessionId: string): Promise<void> {
  await sql`UPDATE sessions SET deleted_at = now() WHERE id = ${sessionId}::uuid`.execute(db);
}
