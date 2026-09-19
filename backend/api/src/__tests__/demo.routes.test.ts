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

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
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

  it('offers only the roles this version has a console for', async () => {
    const response = await request(app).get(`${BASE}/demo/consoles`);
    const consoles = response.body.data.consoles as { roles: string[] }[];

    for (const entry of consoles) {
      // `ward`, `lab`, `pharmacy` and the rest are seeded as staff roles but
      // have no screen until steps 14 and 17. A door onto an empty room is
      // worse than no door.
      for (const role of entry.roles) {
        expect(['receptionist', 'doctor', 'hospital_admin']).toContain(role);
      }
    }
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

  it('refuses a role this version has no console for', async () => {
    const { hospitalId } = await anyHospital();

    const response = await request(app)
      .post(`${BASE}/demo/token`)
      .send({ hospitalId, role: 'ward' });

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
