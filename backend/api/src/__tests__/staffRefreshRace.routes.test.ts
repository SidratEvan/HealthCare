/**
 * A staff sign-in survives its own token renewal (`FR-SEC-06`; pilot-readiness
 * audit of 12 October 2026, finding F-17).
 *
 * Renewal revokes the old refresh row and writes the new one. While it did
 * that in two steps, the sign-in held no live session for a moment, and the
 * still-valid access token was refused as revoked by any request arriving in
 * that moment. The console asks who it is on the same focus event that renews
 * the token, so the two met: the console read the refusal as "renew again",
 * renewed with the token just rotated, and the server took that for a stolen
 * token and ended every session of the account — tearing down the Doctor
 * workspace and an unsaved note with it.
 *
 * These tests hold a renewal open between its two steps and ask the questions
 * a console asks in that moment.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { hashPassword } from '../config/password.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';

import type { Express } from 'express';

const BASE = '/api/v1';
const PASSWORD = 'correct-horse-battery';

let app: Express;
let hospitalId: string;

beforeAll(async () => {
  app = createApp();
  const result = await sql<{ id: string }>`SELECT id FROM hospitals WHERE code = 'SHAPLA'`.execute(
    db,
  );
  hospitalId = result.rows[0]?.id ?? '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function signedIn(): Promise<{ access: string; refresh: string }> {
  const email = `race-${randomUUID().slice(0, 8)}@shapla.demo.invalid`;
  const inserted = await sql<{ id: string }>`
    INSERT INTO staff_users (hospital_id, email, full_name, password_hash, must_change_password, is_active)
    VALUES (${hospitalId}, ${email}, 'ডাক্তার পরীক্ষা (ডেমো)', ${await hashPassword(PASSWORD)}, false, true)
    RETURNING id
  `.execute(db);
  await sql`
    INSERT INTO staff_roles (staff_user_id, hospital_id, role)
    VALUES (${inserted.rows[0]?.id ?? ''}, ${hospitalId}, 'doctor'::staff_role)
  `.execute(db);
  const login = await request(app).post(`${BASE}/staff/login`).send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return { access: login.body.data.access as string, refresh: login.body.data.refresh as string };
}

/** Holds the next renewal between revoking its old row and writing its new one. */
function holdRenewal(): { reached: Promise<void>; release: () => void } {
  let release!: () => void;
  let reached!: () => void;
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = staffAuthRepo.rolesOf;
  vi.spyOn(staffAuthRepo, 'rolesOf').mockImplementationOnce(async (...args) => {
    reached();
    await gate;
    return await original(...args);
  });
  return { reached: reachedPromise, release };
}

describe('a staff sign-in survives its own renewal (F-17, FR-SEC-06)', () => {
  it('the access token in hand is honoured while its renewal is in flight', async () => {
    const session = await signedIn();
    const held = holdRenewal();

    const renewal = request(app).post(`${BASE}/staff/refresh`).send({ refresh: session.refresh });
    const renewed = renewal.then((response) => response);
    await held.reached;

    // The console's own question, on the same focus event.
    const me = await request(app)
      .get(`${BASE}/staff/me`)
      .set('Authorization', `Bearer ${session.access}`);

    held.release();
    expect((await renewed).status).toBe(200);
    expect(me.status).toBe(200);
  });

  it('a second renewal with the same token, while the first is in flight, ends nothing', async () => {
    const session = await signedIn();
    const held = holdRenewal();

    const first = request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: session.refresh })
      .then((response) => response);
    await held.reached;
    const second = request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: session.refresh })
      .then((response) => response);
    // Let the second reach the server before the first finishes.
    await new Promise((resolve) => setTimeout(resolve, 200));
    held.release();

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    // The loser is refused as a race, not punished as a theft.
    expect(b.status).toBe(401);
    expect(b.body.error.details.reason).not.toBe('reused');

    // And the winner's new session stands.
    const me = await request(app)
      .get(`${BASE}/staff/me`)
      .set('Authorization', `Bearer ${a.body.data.access as string}`);
    expect(me.status).toBe(200);
    const renewedAgain = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: a.body.data.refresh as string });
    expect(renewedAgain.status).toBe(200);
  });
});
