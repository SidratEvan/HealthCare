/**
 * The queue follows the facility's own rules (pilot step 22, `FR-QUE-20`,
 * `FR-QUE-21`).
 *
 * Until `S-B-11` could change them, every guard ran on the documented
 * defaults, and the late route wrote `reinsertAfter: 3` whatever the
 * facility said. Now an administrator can set both, so the server reads the
 * facility's row for every event — and a console that sends a different `k`
 * is corrected, because the rule is the facility's, not the counter's.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let key = 0;

async function post(path: string, body: Record<string, unknown> = {}): Promise<request.Response> {
  key += 1;
  const token = await signToken({
    kind: 'access',
    claims: {
      sub: fixture.receptionistId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['receptionist'],
    },
  });
  return await request(app)
    .post(`${BASE}${path}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', `rules-${String(key)}-${String(Date.now())}`)
    .send(body);
}

async function setRules(values: {
  lateReinsertAfter?: number;
  noShowGraceMinutes?: number;
}): Promise<void> {
  await sql`
    UPDATE hospital_settings SET
      late_reinsert_after = coalesce(${values.lateReinsertAfter ?? null}::int, late_reinsert_after),
      no_show_grace_minutes = coalesce(${values.noShowGraceMinutes ?? null}::int, no_show_grace_minutes)
     WHERE hospital_id = ${fixture.hospitalId}
  `.execute(db);
}

async function lastPayload(type: string): Promise<Record<string, unknown>> {
  const result = await sql<{ payload: Record<string, unknown> }>`
    SELECT payload FROM queue_events WHERE session_id = ${fixture.sessionId} AND type = ${type}
     ORDER BY seq DESC LIMIT 1
  `.execute(db);
  return result.rows[0]?.payload ?? {};
}

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(6);
});

afterEach(async () => {
  // Back to the documented defaults the seeds leave (FR-QUE-20, FR-QUE-21).
  await setRules({ lateReinsertAfter: 3, noShowGraceMinutes: 15 });
});

describe("the facility's queue rules (FR-QUE-20, FR-QUE-21)", () => {
  it('re-inserts a late patient after the facility’s k, not the default', async () => {
    await setRules({ lateReinsertAfter: 1 });
    expect((await post(`/sessions/${fixture.sessionId}/arrived`)).status).toBe(200);

    const response = await post(`/bookings/${fixture.bookingIds[0] ?? ''}/late`, {
      expectedMinutes: 20,
    });
    expect(response.status).toBe(200);
    expect((await lastPayload('PATIENT_LATE'))['reinsertAfter']).toBe(1);
  });

  it('corrects a k a console sent, because the rule is the facility’s', async () => {
    await setRules({ lateReinsertAfter: 4 });
    expect((await post(`/sessions/${fixture.sessionId}/arrived`)).status).toBe(200);

    const response = await post('/sync/events', {
      sessionId: fixture.sessionId,
      events: [
        {
          clientEventId: crypto.randomUUID(),
          clientTs: new Date().toISOString(),
          type: 'PATIENT_LATE',
          payload: { bookingId: fixture.bookingIds[1], expectedMinutes: 20, reinsertAfter: 3 },
        },
      ],
    });
    expect(response.status).toBe(200);
    expect((await lastPayload('PATIENT_LATE'))['reinsertAfter']).toBe(4);
  });

  it('holds a no-show until the facility’s grace has run', async () => {
    // Two hours of grace: a patient called now cannot be a no-show yet,
    // though the default fifteen minutes would not have allowed it either —
    // so the proof is the minutes the guard reports.
    await setRules({ noShowGraceMinutes: 120 });
    expect((await post(`/sessions/${fixture.sessionId}/arrived`)).status).toBe(200);
    expect((await post(`/sessions/${fixture.sessionId}/next`)).status).toBe(200);

    const response = await post(`/bookings/${fixture.bookingIds[0] ?? ''}/no-show`);
    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('of 120');
  });
});
