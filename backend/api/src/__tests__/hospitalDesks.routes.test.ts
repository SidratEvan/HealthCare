/**
 * Reception desks (plan R4; `PRD.md` `FR-REC-32`; `BACKEND.md` §7).
 *
 * An administrator names desks and assigns the hospital's own doctors; any
 * member of the hospital's staff reads them, for the picker; another
 * hospital's doctor is refused; a removal is kept as removed; every change is
 * audited. Desks order the console and restrict nothing, so nothing here
 * refuses a receptionist a chamber.
 *
 * Runs against the seeded demo database (CLAUDE.md §6).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { createQueueFixture, staffIdFor, type QueueFixture } from './support/queueFixture.js';
import { bearer } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let admin: string;
let adminId: string;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(1);
  adminId = await staffIdFor(fixture.hospitalId, 'hospital_admin');
  admin = await signToken({
    kind: 'access',
    claims: {
      sub: adminId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['hospital_admin'],
    },
  });
});

async function receptionist(): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: {
      sub: fixture.receptionistId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['receptionist'],
    },
  });
}

async function send(
  method: 'post' | 'patch' | 'delete',
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<request.Response> {
  const call = request(app)
    [method](`${BASE}${path}`)
    .set('authorization', bearer(token))
    .set('idempotency-key', randomUUID());
  return body === undefined ? await call : await call.send(body);
}

const deskName = (): string => `Counter ${randomUUID().slice(0, 6)} (Demo)`;

describe('reception desks (FR-REC-32)', () => {
  it('are made, read by the hospital’s staff, changed, removed, and every change audited', async () => {
    const nameEn = deskName();
    const made = await send('post', '/hospital/desks', admin, {
      nameBn: 'কাউন্টার (ডেমো)',
      nameEn,
      doctorIds: [fixture.doctorId],
    });
    expect(made.status).toBe(200);
    const deskId = made.body.data.deskId as string;

    // Read by a receptionist, for the picker.
    const read = await request(app)
      .get(`${BASE}/hospital/desks`)
      .set('authorization', bearer(await receptionist()));
    expect(read.status).toBe(200);
    const desk = (read.body.data.desks as { id: string; doctorIds: string[] }[]).find(
      (entry) => entry.id === deskId,
    );
    expect(desk?.doctorIds).toEqual([fixture.doctorId]);

    // The doctors are replaced, not added to.
    expect(
      (await send('patch', `/hospital/desks/${deskId}`, admin, { doctorIds: [] })).status,
    ).toBe(200);
    const after = await request(app)
      .get(`${BASE}/hospital/desks`)
      .set('authorization', bearer(admin));
    expect(
      (after.body.data.desks as { id: string; doctorIds: string[] }[]).find((d) => d.id === deskId)
        ?.doctorIds,
    ).toEqual([]);

    expect((await send('delete', `/hospital/desks/${deskId}`, admin)).status).toBe(200);
    const gone = await request(app)
      .get(`${BASE}/hospital/desks`)
      .set('authorization', bearer(admin));
    expect((gone.body.data.desks as { id: string }[]).map((d) => d.id)).not.toContain(deskId);
    // Kept as removed.
    const row = await sql<{ deleted_at: Date | null }>`
      SELECT deleted_at FROM reception_desks WHERE id = ${deskId}::uuid
    `.execute(db);
    expect(row.rows[0]?.deleted_at).not.toBeNull();

    const audit = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_log
       WHERE subject_table = 'reception_desks' AND subject_id = ${deskId}::uuid
         AND actor_staff_id = ${adminId}::uuid
    `.execute(db);
    expect(audit.rows[0]?.n).toBe(3);
  });

  it('refuses another hospital’s doctor, a name already used, and an unknown desk', async () => {
    const stranger = await sql<{ doctor_id: string }>`
      SELECT dh.doctor_id FROM doctor_hospitals dh
       WHERE NOT EXISTS (SELECT 1 FROM doctor_hospitals mine
                          WHERE mine.doctor_id = dh.doctor_id
                            AND mine.hospital_id = ${fixture.hospitalId}::uuid)
       LIMIT 1
    `.execute(db);
    const strangerId = stranger.rows[0]?.doctor_id;
    if (strangerId === undefined) throw new Error('the seed holds doctors at other hospitals');
    const refused = await send('post', '/hospital/desks', admin, {
      nameBn: 'কাউন্টার (ডেমো)',
      nameEn: deskName(),
      doctorIds: [strangerId],
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('doctor_not_here');

    const nameEn = deskName();
    expect(
      (await send('post', '/hospital/desks', admin, { nameBn: 'ক (ডেমো)', nameEn })).status,
    ).toBe(200);
    const twice = await send('post', '/hospital/desks', admin, { nameBn: 'খ (ডেমো)', nameEn });
    expect(twice.body.error.code).toBe('SETTINGS_DUPLICATE');

    expect((await send('delete', `/hospital/desks/${randomUUID()}`, admin)).status).toBe(404);
  });

  it('is changed by the administrator only', async () => {
    const made = await send('post', '/hospital/desks', await receptionist(), {
      nameBn: 'কাউন্টার (ডেমো)',
      nameEn: deskName(),
    });
    expect(made.status).toBe(403);
    expect((await request(app).get(`${BASE}/hospital/desks`)).status).toBe(401);
  });
});

describe('a receptionist at a desk manages its doctors only, on the server (FR-REC-32, question 20)', () => {
  /** A receptionist of the test's own, so no other test's receptionist is bound to a desk. */
  async function newReceptionist(): Promise<{ id: string; token: string }> {
    const made = await send('post', '/hospital/staff', admin, {
      fullName: 'ডেস্ক রিসেপশনিস্ট (ডেমো)',
      email: `desk-${randomUUID().slice(0, 8)}@desk.demo.invalid`,
      roles: ['receptionist'],
    });
    expect(made.status).toBe(200);
    const id = made.body.data.staffId as string;
    const token = await signToken({
      kind: 'access',
      claims: { sub: id, kind: 'staff', hospitalId: fixture.hospitalId, roles: ['receptionist'] },
    });
    return { id, token };
  }

  /** A session at this hospital that another doctor sits. */
  async function otherDoctorsSession(): Promise<string> {
    const found = await sql<{ id: string }>`
      SELECT id FROM sessions
       WHERE hospital_id = ${fixture.hospitalId}::uuid AND doctor_id <> ${fixture.doctorId}::uuid
         AND deleted_at IS NULL
       ORDER BY session_date DESC LIMIT 1
    `.execute(db);
    const id = found.rows[0]?.id;
    if (id === undefined) throw new Error('the seed gives a hospital more than one doctor');
    return id;
  }

  const queueOf = async (sessionId: string, token: string): Promise<number> =>
    (
      await request(app)
        .get(`${BASE}/sessions/${sessionId}/queue`)
        .set('authorization', bearer(token))
    ).status;

  it('refuses another desk’s chamber, allows its own, and lists only its own', async () => {
    const desk = await newReceptionist();
    const other = await otherDoctorsSession();

    // Before any desk: the common workspace, every chamber.
    expect(await queueOf(other, desk.token)).toBe(200);

    const made = await send('post', '/hospital/desks', admin, {
      nameBn: 'ডেস্ক (ডেমো)',
      nameEn: deskName(),
      doctorIds: [fixture.doctorId],
      staffIds: [desk.id],
    });
    expect(made.status).toBe(200);
    const deskId = made.body.data.deskId as string;

    expect(await queueOf(fixture.sessionId, desk.token)).toBe(200);
    const refused = await request(app)
      .get(`${BASE}/sessions/${other}/queue`)
      .set('authorization', bearer(desk.token));
    expect(refused.status).toBe(403);
    expect(refused.body.error.details.reason).toBe('outside_your_desk');

    // A write is refused the same way, and so is an offline pull.
    const write = await request(app)
      .post(`${BASE}/sessions/${other}/next`)
      .set('authorization', bearer(desk.token))
      .set('idempotency-key', randomUUID())
      .send({ clientEventId: randomUUID(), clientTs: new Date().toISOString() });
    expect(write.status).toBe(403);
    const pulled = await request(app)
      .get(`${BASE}/sync/session/${other}`)
      .set('authorization', bearer(desk.token));
    expect(pulled.status).toBe(403);

    // The picker's own list holds only the desk's chambers.
    const chambers = await request(app)
      .get(`${BASE}/staff/chambers`)
      .set('authorization', bearer(desk.token));
    expect(chambers.status).toBe(200);
    for (const chamber of chambers.body.data.chambers as { doctorId: string }[]) {
      expect(chamber.doctorId).toBe(fixture.doctorId);
    }

    // Taken off the desk: the common workspace again.
    await send('patch', `/hospital/desks/${deskId}`, admin, { staffIds: [] });
    expect(await queueOf(other, desk.token)).toBe(200);
  });

  it('never limits the administrator, nor a receptionist at no desk', async () => {
    const atNoDesk = await newReceptionist();
    const other = await otherDoctorsSession();
    expect(await queueOf(other, atNoDesk.token)).toBe(200);
    expect(await queueOf(other, admin)).not.toBe(403);
  });

  it('puts only this hospital’s receptionists at a desk', async () => {
    const refused = await send('post', '/hospital/desks', admin, {
      nameBn: 'ডেস্ক (ডেমো)',
      nameEn: deskName(),
      staffIds: [adminId],
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('not_a_receptionist_here');
  });
});
