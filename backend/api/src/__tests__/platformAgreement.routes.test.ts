/**
 * A hospital's agreement state and what it has used, on the platform's screen
 * (`PRD.md` `FR-SUP-04`, the state half; `S-B-12`; migration 0051; plan G1).
 *
 * Entitlements without commerce: the state is one of four words and a note,
 * the usage is three counts. What must hold beside that: only a platform
 * administrator reads or sets either; setting it is on the record; it
 * switches nothing, so a hospital whose agreement has ended is as public as
 * it was until somebody suspends it; and no patient is in any answer
 * (`FR-ONB-08`).
 *
 * Runs against the seeded demo database (CLAUDE.md §6), on a seeded hospital,
 * whose agreement is put back afterwards.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import * as demoRepo from '../repositories/demo.repo.js';

import { asOwner } from './support/ownerDb.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/** A seeded hospital with chambers, serials and messages behind it. */
const CODE = 'KARNAPHULI';
/** The one the seed leaves overdue, with a note. */
const OVERDUE_CODE = 'BURIGANGA';

let app: Express;
let platform: string;
let platformStaffId: string;
let hospitalId: string;
let before: { state: string; note: string | null; at: Date | null; by: string | null };

async function hospitalByCode(code: string): Promise<string> {
  const row = await asOwner(
    async (owner) =>
      await sql<{ id: string }>`
        SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
      `.execute(owner),
  );
  const id = row.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed has no hospital coded ${code}.`);
  return id;
}

async function setAgreement(
  body: object,
  token: string | null = platform,
  id: string = hospitalId,
): Promise<request.Response> {
  const pending = request(app)
    .put(`${BASE}/platform/hospitals/${id}/agreement`)
    .set('Idempotency-Key', randomUUID());
  return await (token === null ? pending : pending.set('Authorization', bearer(token))).send(body);
}

async function read(id: string = hospitalId): Promise<request.Response> {
  return await request(app)
    .get(`${BASE}/platform/hospitals/${id}`)
    .set('Authorization', bearer(platform));
}

beforeAll(async () => {
  app = createApp();

  const account = await demoRepo.nationalStaffFor('platform_admin');
  if (account === null) throw new Error('The seed has no platform administrator.');
  platformStaffId = account.id;
  platform = await signToken({
    kind: 'access',
    claims: { sub: account.id, kind: 'staff', roles: ['platform_admin'] },
  });

  hospitalId = await hospitalByCode(CODE);
  const row = await asOwner(
    async (owner) =>
      await sql<{ state: string; note: string | null; at: Date | null; by: string | null }>`
        SELECT agreement_state::text AS state, agreement_note AS note,
               agreement_changed_at AS at, agreement_changed_by AS by
          FROM hospitals WHERE id = ${hospitalId}::uuid
      `.execute(owner),
  );
  const found = row.rows[0];
  if (found === undefined) throw new Error('no such hospital');
  before = found;
});

afterAll(async () => {
  if (hospitalId === undefined || before === undefined) return;
  await asOwner(async (owner) => {
    await sql`
      UPDATE hospitals
         SET agreement_state = ${before.state}::agreement_state, agreement_note = ${before.note},
             agreement_changed_at = ${before.at}, agreement_changed_by = ${before.by}::uuid
       WHERE id = ${hospitalId}::uuid
    `.execute(owner);
  });
});

describe('whose it is to set (FR-ROLE-01, FR-SUP-04)', () => {
  it('needs a token, and an idempotency key', async () => {
    expect((await setAgreement({ state: 'active' }, null)).status).toBe(401);
    const keyless = await request(app)
      .put(`${BASE}/platform/hospitals/${hospitalId}/agreement`)
      .set('Authorization', bearer(platform))
      .send({ state: 'active' });
    expect(keyless.status).toBe(400);
  });

  it('refuses the hospital’s own administrator, its staff, a government viewer and a patient', async () => {
    for (const token of [
      await staffToken(['hospital_admin'], hospitalId),
      await staffToken(['receptionist', 'doctor'], hospitalId),
      await nationalToken(['gov_viewer']),
      await patientToken(),
    ]) {
      expect((await setAgreement({ state: 'ended' }, token)).status).toBe(403);
    }
  });

  it('answers 404 for a hospital that is not there', async () => {
    expect((await setAgreement({ state: 'active' }, platform, randomUUID())).status).toBe(404);
  });
});

describe('what may be written (FR-SUP-04: a state and a note, nothing commercial)', () => {
  it('one of the four states and no other', async () => {
    expect((await setAgreement({ state: 'paid' })).status).toBe(400);
    expect((await setAgreement({})).status).toBe(400);
  });

  it('has no field for a plan or an amount', async () => {
    expect((await setAgreement({ state: 'active', plan: 'full' })).status).toBe(400);
    expect((await setAgreement({ state: 'active', amount: 5000 })).status).toBe(400);
  });

  it('a note of a sentence, not a letter and not a page', async () => {
    expect((await setAgreement({ state: 'overdue', note: 'x' })).status).toBe(400);
    expect((await setAgreement({ state: 'overdue', note: 'ক'.repeat(501) })).status).toBe(400);
  });
});

describe('setting it (FR-SUP-04, FR-ONB-07)', () => {
  it('answers with the workspace as it now is, and says who set it when', async () => {
    const response = await setAgreement({
      state: 'overdue',
      note: 'নবায়নের কাগজ আসেনি (ডেমো)',
    });
    expect(response.status).toBe(200);
    expect(response.body.data.agreement).toMatchObject({
      state: 'overdue',
      note: 'নবায়নের কাগজ আসেনি (ডেমো)',
    });
    expect(Date.parse(response.body.data.agreement.changedAt as string)).toBeGreaterThan(
      Date.now() - 60_000,
    );

    const row = await asOwner(
      async (owner) =>
        await sql<{ by: string | null }>`
          SELECT agreement_changed_by AS by FROM hospitals WHERE id = ${hospitalId}::uuid
        `.execute(owner),
    );
    expect(row.rows[0]?.by).toBe(platformStaffId);
  });

  it('is in the list as well as on the opened workspace', async () => {
    const list = await request(app)
      .get(`${BASE}/platform/hospitals`)
      .set('Authorization', bearer(platform));
    const mine = (list.body.data.workspaces as { id: string; agreement: { state: string } }[]).find(
      (workspace) => workspace.id === hospitalId,
    );
    expect(mine?.agreement.state).toBe('overdue');
  });

  it('a state set without a note clears the last one: a note belongs to its state', async () => {
    const response = await setAgreement({ state: 'active' });
    expect(response.status).toBe(200);
    expect(response.body.data.agreement).toMatchObject({ state: 'active', note: null });
  });

  it('is on the record, naming the administrator, the workspace and the state', async () => {
    const rows = await sql<{ change: string; actor: string | null }>`
      SELECT meta ->> 'change' AS change, actor_staff_id AS actor FROM audit_log
       WHERE hospital_id = ${hospitalId}::uuid AND action = 'SETTINGS_CHANGE'
         AND meta ->> 'change' LIKE 'agreement_%'
       ORDER BY created_at, id
    `.execute(db);
    const changes = rows.rows.map((row) => row.change);
    expect(changes).toContain('agreement_overdue');
    expect(changes.at(-1)).toBe('agreement_active');
    expect(rows.rows.every((row) => row.actor === platformStaffId)).toBe(true);
  });

  it('switches nothing: a hospital whose agreement has ended is as public as it was', async () => {
    const live = async (): Promise<boolean> =>
      (await request(app).get(`${BASE}/hospitals/${hospitalId}`)).status === 200;
    expect(await live()).toBe(true);

    const response = await setAgreement({ state: 'ended', note: 'চুক্তি নবায়ন হয়নি (ডেমো)' });
    expect(response.status).toBe(200);
    // Still live, still listed, with every module it had: taking a hospital
    // out of the network is suspending it, which is a separate act.
    expect(response.body.data.lifecycle).toBe('active');
    expect(response.body.data.isLive).toBe(true);
    expect(await live()).toBe(true);

    expect((await setAgreement({ state: 'active' })).status).toBe(200);
  });
});

describe('what it has used (FR-SUP-04: usage counters; FR-ONB-08)', () => {
  it('is three counts and when they were counted, on the opened workspace only', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    const usage = response.body.data.usage as Record<string, unknown>;
    expect(Object.keys(usage).sort()).toEqual([
      'asOf',
      'chambersHeld30d',
      'messagesSentThisMonth',
      'serialsTaken30d',
    ]);
    // The seed gives this hospital three weeks of chambers and serials.
    expect(usage['serialsTaken30d']).toBeGreaterThan(0);
    expect(usage['chambersHeld30d']).toBeGreaterThan(0);
    expect(usage['messagesSentThisMonth']).toBeGreaterThanOrEqual(0);
    expect(Date.parse(usage['asOf'] as string)).toBeGreaterThan(Date.now() - 60_000);

    const list = await request(app)
      .get(`${BASE}/platform/hospitals`)
      .set('Authorization', bearer(platform));
    for (const workspace of list.body.data.workspaces as Record<string, unknown>[]) {
      expect(workspace['usage']).toBeUndefined();
    }
  });

  it('counts at least what the hospital’s own serials and chambers came to a moment before', async () => {
    const truth = await asOwner(
      async (owner) =>
        await sql<{ serials: number; chambers: number }>`
          SELECT
            (SELECT count(*)::int FROM bookings b JOIN sessions s ON s.id = b.session_id
              WHERE s.hospital_id = ${hospitalId}::uuid AND b.deleted_at IS NULL
                AND b.created_at >= now() - interval '29 days') AS serials,
            (SELECT count(*)::int FROM sessions s
              WHERE s.hospital_id = ${hospitalId}::uuid
                AND s.actual_start >= now() - interval '29 days') AS chambers
        `.execute(owner),
    );
    const usage = (await read()).body.data.usage as Record<string, number>;
    // Other suites book while this one runs, so the count may only have
    // grown; a day's margin on the window keeps a row from ageing out between
    // the two reads.
    expect(usage['serialsTaken30d']).toBeGreaterThanOrEqual(truth.rows[0]?.serials ?? 0);
    expect(usage['chambersHeld30d']).toBeGreaterThanOrEqual(truth.rows[0]?.chambers ?? 0);
  });

  it('carries no patient: counts of activity, never a row of it', async () => {
    const text = JSON.stringify((await read()).body);
    const people = await asOwner(
      async (owner) =>
        await sql<{ id: string }>`
          SELECT DISTINCT b.patient_id AS id
            FROM bookings b
            JOIN sessions s ON s.id = b.session_id
           WHERE s.hospital_id = ${hospitalId}::uuid AND b.patient_id IS NOT NULL
           LIMIT 25
        `.execute(owner),
    );
    expect(people.rows.length).toBeGreaterThan(0);
    for (const person of people.rows) expect(text).not.toContain(person.id);
  });
});

describe('the demonstration (FR-DEM-*)', () => {
  it('shows the states somebody has to act on: a clinic overdue with a note, the rest set', async () => {
    const overdue = await read(await hospitalByCode(OVERDUE_CODE));
    expect(overdue.body.data.agreement.state).toBe('overdue');
    expect(overdue.body.data.agreement.note).toContain('(ডেমো)');

    const list = await request(app)
      .get(`${BASE}/platform/hospitals`)
      .set('Authorization', bearer(platform));
    const states = new Set(
      (list.body.data.workspaces as { agreement: { state: string } }[]).map(
        (workspace) => workspace.agreement.state,
      ),
    );
    expect(states.has('active')).toBe(true);
    expect(states.has('trial')).toBe(true);
  });
});
