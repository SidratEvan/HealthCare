/** Conditional desk writes preserve colleagues' access (FR-REC-32, FR-ADM-11, DB-P1).
 * Real routes and limited API role, with the established synthetic fixture. */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { createQueueFixture, staffIdFor, type QueueFixture } from './support/queueFixture.js';
import { bearer, nationalToken, staffToken } from './support/tokens.js';

const app = createApp();
const ROOT = '/api/v1/hospital/desks';
interface Desk {
  id: string;
  nameBn: string;
  nameEn: string;
  doctorIds: string[];
  staffIds: string[];
}
let fixture: QueueFixture;
let token: string;
let desk: Desk;
beforeEach(async () => {
  fixture = await createQueueFixture(1);
  const id = await staffIdFor(fixture.hospitalId, 'hospital_admin');
  token = await signToken({
    kind: 'access',
    claims: {
      sub: id,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['hospital_admin'],
    },
  });
  const body = {
    nameBn: 'নিরাপদ ডেস্ক (ডেমো)',
    nameEn: `Safety ${randomUUID()} (Demo)`,
    doctorIds: [fixture.doctorId],
    staffIds: [fixture.receptionistId],
  };
  const made = await request(app)
    .post(ROOT)
    .set('authorization', bearer(token))
    .set('idempotency-key', randomUUID())
    .send(body);
  expect(made.status).toBe(200);
  desk = { id: (made.body.data as { deskId: string }).deskId, ...body };
});
function expected() {
  const { id: _id, ...before } = desk;
  return before;
}
function patch(body: object, auth = token, id = desk.id) {
  return request(app)
    .patch(`${ROOT}/${id}`)
    .set('authorization', bearer(auth))
    .set('idempotency-key', randomUUID())
    .send(body);
}
async function current() {
  const read = await request(app).get(ROOT).set('authorization', bearer(token));
  expect(read.status).toBe(200);
  return (read.body.data as { desks: Desk[] }).desks.find((row) => row.id === desk.id);
}
describe('conditional desk replacement', () => {
  it('accepts the matching before-image and refuses a stale membership without another audit', async () => {
    const before = expected();
    expect((await patch({ staffIds: [], expected: before })).status).toBe(200);
    const refused = await patch({ doctorIds: [], expected: before });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.reason).toBe('desk_changed');
    expect(await current()).toMatchObject({ staffIds: [], doctorIds: [fixture.doctorId] });
    const audit = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_log
      WHERE subject_table='reception_desks' AND subject_id=${desk.id}::uuid`.execute(db);
    expect(audit.rows[0]?.n).toBe(2); // create and accepted update only
  });
  it('serializes two competing replacements: exactly one succeeds and neither silently merges', async () => {
    const before = expected();
    const outcomes = await Promise.all([
      patch({ staffIds: [], expected: before }),
      patch({ doctorIds: [], expected: before }),
    ]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 422]);
    const row = await current();
    expect(row).toBeDefined();
    expect((row?.staffIds.length === 0) !== (row?.doctorIds.length === 0)).toBe(true);
  });
  it('refuses a renamed or removed desk and requires a real changed field', async () => {
    const before = expected();
    expect((await patch({ nameEn: `Renamed ${randomUUID()} (Demo)` })).status).toBe(200);
    expect((await patch({ staffIds: [], expected: before })).body.error.details.reason).toBe(
      'desk_changed',
    );
    expect((await patch({ expected: before })).status).toBe(400);
    expect(
      (
        await request(app)
          .delete(`${ROOT}/${desk.id}`)
          .set('authorization', bearer(token))
          .set('idempotency-key', randomUUID())
      ).status,
    ).toBe(200);
    expect((await patch({ staffIds: [], expected: before })).status).toBe(404);
  });
  it('keeps legacy PATCH compatibility while conditional callers compare unordered memberships', async () => {
    const before = expected();
    expect(
      (
        await patch({
          nameBn: desk.nameBn,
          expected: { ...before, staffIds: [...before.staffIds].reverse() },
        })
      ).status,
    ).toBe(200);
    expect((await patch({ staffIds: [] })).status).toBe(200);
  });
  it('refuses cross-hospital desks and foreign staff even with a matching before-image', async () => {
    const stranger = await sql<{
      id: string;
      hospital_id: string;
    }>`SELECT s.id,s.hospital_id FROM staff_users s
      JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.hospital_id<>${fixture.hospitalId}::uuid
      AND r.role='receptionist' LIMIT 1`.execute(db);
    const other = stranger.rows[0];
    if (other === undefined) throw new Error('Seeded foreign receptionist missing');
    expect((await patch({ staffIds: [other.id], expected: expected() })).status).toBe(422);
    expect(
      (
        await patch(
          { staffIds: [], expected: expected() },
          await staffToken(['hospital_admin'], other.hospital_id),
        )
      ).status,
    ).toBe(404);
    expect(await current()).toMatchObject({ staffIds: [fixture.receptionistId] });
  });
  it('does not grant platform administrators, other facility roles or anonymous callers management access', async () => {
    const body = { staffIds: [], expected: expected() };
    for (const role of [
      'receptionist',
      'doctor',
      'ward',
      'emergency',
      'lab',
      'pharmacy',
    ] as const) {
      expect((await patch(body, await staffToken([role], fixture.hospitalId))).status).toBe(403);
    }
    expect((await patch(body, await nationalToken(['platform_admin']))).status).toBe(403);
    expect(
      (
        await request(app)
          .patch(`${ROOT}/${desk.id}`)
          .set('idempotency-key', randomUUID())
          .send(body)
      ).status,
    ).toBe(401);
  });
});
