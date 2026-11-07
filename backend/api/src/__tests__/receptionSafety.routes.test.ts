/** Reception integration safety (FR-QUE-51, FR-REC-14, FR-SEC-06/10).
 * Exercise persisted rows and real sockets, not visual permission hiding.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import * as events from '../repositories/queueEvent.repo.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';

let fixture: QueueFixture;
let token: string;
const app = createApp();
beforeEach(async () => {
  resetEmitter();
  fixture = await createQueueFixture(0);
  token = await signToken({
    kind: 'access',
    claims: {
      sub: fixture.receptionistId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['receptionist'],
    },
  });
});
afterEach(() => vi.restoreAllMocks());

async function bookings(): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*)::text AS n FROM bookings
    WHERE session_id=${fixture.sessionId}::uuid`.execute(db);
  return Number(result.rows[0]!.n);
}
function walkin(key = randomUUID(), patientId = fixture.sparePatientId) {
  return request(app)
    .post(`/api/v1/sessions/${fixture.sessionId}/walkin`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      patientId,
      position: 'end',
      index: null,
      reason: null,
      clientEventId: key,
      clientTs: new Date().toISOString(),
    });
}
describe('walk-in booking and event form one guarded operation', () => {
  it('a replay returns its original serial after another walk-in was issued', async () => {
    const key = randomUUID();
    const first = await walkin(key);
    const other = await sql<{
      id: string;
    }>`SELECT id FROM patients WHERE id<>${fixture.sparePatientId}::uuid AND deleted_at IS NULL LIMIT 1`.execute(
      db,
    );
    expect((await walkin(randomUUID(), other.rows[0]!.id)).status).toBe(200);
    const repeated = await walkin(key);
    expect(repeated.status).toBe(200);
    expect((repeated.body as { data: { walkin: { serial: number } } }).data.walkin.serial).toBe(
      (first.body as { data: { walkin: { serial: number } } }).data.walkin.serial,
    );
    expect(await bookings()).toBe(2);
  });
  it('the opt-in finished list stays in the hospital and the default picker omits ended chambers', async () => {
    const ended = await request(app)
      .post(`/api/v1/sessions/${fixture.sessionId}/end`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(ended.status).toBe(200);
    const normal = await request(app)
      .get('/api/v1/staff/chambers')
      .set('Authorization', `Bearer ${token}`);
    const archive = await request(app)
      .get('/api/v1/staff/chambers?includeEnded=1')
      .set('Authorization', `Bearer ${token}`);
    const entries = (response: request.Response) =>
      (response.body as { data: { chambers: { id: string; hospitalId: string }[] } }).data.chambers;
    expect(entries(normal).some((entry) => entry.id === fixture.sessionId)).toBe(false);
    expect(entries(archive).some((entry) => entry.id === fixture.sessionId)).toBe(true);
    expect(entries(archive).every((entry) => entry.hospitalId === fixture.hospitalId)).toBe(true);
  });
  it('an ended chamber creates no booking', async () => {
    const ended = await request(app)
      .post(`/api/v1/sessions/${fixture.sessionId}/end`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(ended.status).toBe(200);
    const before = await bookings();
    expect((await walkin()).status).toBe(422);
    expect(await bookings()).toBe(before);
  });
  it('concurrent identical event keys issue one booking and both callers receive the result', async () => {
    const key = randomUUID();
    const responses = await Promise.all([walkin(key), walkin(key)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await bookings()).toBe(1);
    const logged = await sql<{ n: string }>`SELECT count(*)::text AS n FROM queue_events
      WHERE session_id=${fixture.sessionId}::uuid AND type='WALKIN_ADDED'`.execute(db);
    expect(Number(logged.rows[0]!.n)).toBe(1);
  });
  it('an event write failure rolls back the booking too', async () => {
    vi.spyOn(events, 'append').mockRejectedValueOnce(new Error('synthetic event failure'));
    expect((await walkin()).status).toBe(500);
    expect(await bookings()).toBe(0);
  });
});
