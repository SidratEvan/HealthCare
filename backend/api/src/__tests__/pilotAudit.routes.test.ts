/**
 * Independent probes from the pilot-readiness audit of 12 October 2026
 * (`docs/audit/pilot-readiness-2026-10-12/FINDINGS.md`).
 *
 * Written from the outside in: each block states something a real pilot
 * depends on and asks the API, through its own routes, whether it holds. They
 * are not a restatement of the route files' own matrices, which they do not
 * read. Seeded demo data and the localhost API test database only
 * (`FR-SEC-08`).
 *
 *   - What a patient is handed back after acting on their own serial names no
 *     other patient (`FR-NET-02`, `FR-SEC-11`, plan I2c) — finding F-01.
 *   - A replay key names one action in one chamber (`FR-QUE-51`) — F-02.
 *   - Capacity holds when many people book the last places at once
 *     (`FR-PAT-20`).
 *   - No route answers malformed input with a 5xx (`GR-03`): a crash is not a
 *     refusal, and an unhandled error is where unvalidated input reaches SQL.
 */

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Agent, createServer } from 'node:http';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FACILITY_ROLES, type StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { counter } from '../middleware/rateLimit.js';
import { resetEmitter } from '../realtime/emit.js';
import { buildApiRouter } from '../routes/index.js';

import {
  createQueueFixture,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';
import { bearer } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;

beforeEach(() => {
  app = createApp();
  resetEmitter();
  counter.reset();
});

async function staffOf(
  fixture: QueueFixture,
  roles: readonly StaffRole[] = ['receptionist'],
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.receptionistId,
): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub, kind: 'staff', hospitalId, roles } });
}

function freshPhone(): string {
  return `+88017${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
}

/** A guest booking as `POST /bookings` makes it, and the token its link is exchanged for. */
async function bookAsGuest(
  fixture: QueueFixture,
): Promise<{ bookingId: string; serial: number; token: string }> {
  const booked = await request(app)
    .post(`${BASE}/bookings`)
    .set('Idempotency-Key', randomUUID())
    .send({
      sessionId: fixture.sessionId,
      method: 'at_hospital',
      guest: { name: 'নাসরিন আক্তার (ডেমো)', phone: freshPhone(), ageYears: 41, sex: 'female' },
    });
  expect(booked.status).toBe(201);
  const link = new URL(booked.body.data.trackingUrl as string).searchParams.get('t');
  if (link === null) throw new Error('no tracking token');
  const opened = await request(app).get(`${BASE}/guest/link/${link}`);
  expect(opened.status).toBe(200);
  return {
    bookingId: booked.body.data.bookingId as string,
    serial: booked.body.data.serial as number,
    token: opened.body.data.token as string,
  };
}

// ---------------------------------------------------------------------------
// F-01: a patient's write is answered with the patients' copy
// ---------------------------------------------------------------------------

describe('F-01: what a patient is handed back names nobody else (FR-NET-02, plan I2c)', () => {
  /** What reception typed about another patient, which is that patient's health. */
  const PRIORITY_REASON = 'বয়স্ক, শ্বাসকষ্ট — audit probe (ডেমো)';

  let fixture: QueueFixture;
  let mine: { bookingId: string; serial: number; token: string };

  beforeEach(async () => {
    fixture = await createQueueFixture(4);
    mine = await bookAsGuest(fixture);
    // Reception moves serial 3 forward with a reason, as the counter does for
    // an elderly patient in distress (`FR-QUE-22`).
    const moved = await request(app)
      .post(`${BASE}/sessions/${fixture.sessionId}/reorder`)
      .set('Authorization', bearer(await staffOf(fixture)))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: randomUUID(),
        clientTs: new Date().toISOString(),
        bookingId: fixture.bookingIds[2],
        toIndex: 0,
        reason: PRIORITY_REASON,
      });
    expect(moved.status).toBe(200);
  });

  function expectNothingOfOthers(body: unknown): void {
    const text = JSON.stringify(body);
    for (const patientId of fixture.patientIds) expect(text).not.toContain(patientId);
    for (const bookingId of fixture.bookingIds) expect(text).not.toContain(bookingId);
    expect(text).not.toContain(PRIORITY_REASON);
  }

  it('GET /bookings/:id (control: already the patients’ copy)', async () => {
    const response = await request(app)
      .get(`${BASE}/bookings/${mine.bookingId}`)
      .set('Authorization', bearer(mine.token));
    expect(response.status).toBe(200);
    expectNothingOfOthers(response.body);
  });

  it('POST /bookings/:id/late', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings/${mine.bookingId}/late`)
      .set('Authorization', bearer(mine.token))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: randomUUID(),
        clientTs: new Date().toISOString(),
        expectedMinutes: 15,
      });
    expect(response.status).toBe(200);
    expectNothingOfOthers(response.body);
  });

  it('POST /events/:id/undo of the patient’s own lateness', async () => {
    const late = await request(app)
      .post(`${BASE}/bookings/${mine.bookingId}/late`)
      .set('Authorization', bearer(mine.token))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: randomUUID(),
        clientTs: new Date().toISOString(),
        expectedMinutes: 15,
      });
    expect(late.status).toBe(200);
    const event = await sql<{ id: string }>`
      SELECT id FROM queue_events
       WHERE session_id = ${fixture.sessionId}::uuid AND type = 'PATIENT_LATE'
       ORDER BY seq DESC LIMIT 1
    `.execute(db);
    const eventId = event.rows[0]?.id;
    if (eventId === undefined) throw new Error('no late event');

    const response = await request(app)
      .post(`${BASE}/events/${eventId}/undo`)
      .set('Authorization', bearer(mine.token))
      .set('Idempotency-Key', randomUUID())
      .send({ clientEventId: randomUUID(), clientTs: new Date().toISOString() });
    // A patient's undo is refused today (F-12, it fails closed); whatever it
    // answers, it must not be the staff copy.
    expect([200, 403, 404]).toContain(response.status);
    expectNothingOfOthers(response.body);
  });

  it('POST /bookings/:id/cancel', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings/${mine.bookingId}/cancel`)
      .set('Authorization', bearer(mine.token))
      .set('Idempotency-Key', randomUUID())
      .send({ clientEventId: randomUUID() });
    expect(response.status).toBe(200);
    expectNothingOfOthers(response.body);
  });

  it('staff are still answered with the queue as reception holds it', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings/${fixture.bookingIds[0]}/late`)
      .set('Authorization', bearer(await staffOf(fixture)))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: randomUUID(),
        clientTs: new Date().toISOString(),
        expectedMinutes: 5,
      });
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain(fixture.patientIds[0]);
  });
});

// ---------------------------------------------------------------------------
// F-02: a replay key is one action in one chamber
// ---------------------------------------------------------------------------

describe('F-02: a client event id replays only in the chamber it was used in (FR-QUE-51)', () => {
  it('the same key sent for another chamber is not answered with the first chamber’s queue', async () => {
    const first = await createQueueFixture(3);
    const second = await createQueueFixture(3, 1);
    const key = randomUUID();

    const applied = await request(app)
      .post(`${BASE}/sessions/${first.sessionId}/delay`)
      .set('Authorization', bearer(await staffOf(first)))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: key,
        clientTs: new Date().toISOString(),
        minutes: 10,
        declaredBy: 'reception',
      });
    expect(applied.status).toBe(200);

    // The same hospital or another: either way, the second chamber's action
    // must not be silently swallowed as a "duplicate" of the first's.
    const reused = await request(app)
      .post(`${BASE}/sessions/${second.sessionId}/delay`)
      .set('Authorization', bearer(await staffOf(second)))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: key,
        clientTs: new Date().toISOString(),
        minutes: 10,
        declaredBy: 'reception',
      });

    const answeredWithFirst =
      reused.status === 200 &&
      (reused.body.data.state?.plan?.sessionId as string | undefined) === first.sessionId;
    expect(answeredWithFirst).toBe(false);
    expect(JSON.stringify(reused.body)).not.toContain(first.patientIds[0]);
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('an offline batch entry carrying another chamber’s key is a conflict, not "accepted"', async () => {
    const first = await createQueueFixture(3);
    const second = await createQueueFixture(3, 1);
    const key = randomUUID();

    const applied = await request(app)
      .post(`${BASE}/sessions/${first.sessionId}/delay`)
      .set('Authorization', bearer(await staffOf(first)))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: key,
        clientTs: new Date().toISOString(),
        minutes: 10,
        declaredBy: 'reception',
      });
    expect(applied.status).toBe(200);

    const batch = await request(app)
      .post(`${BASE}/sync/events`)
      .set('Authorization', bearer(await staffOf(second)))
      .send({
        sessionId: second.sessionId,
        events: [
          {
            clientEventId: key,
            clientTs: new Date().toISOString(),
            type: 'DELAY_DECLARED',
            payload: { minutes: 10, reason: null, declaredBy: 'reception' },
          },
        ],
      });
    expect(batch.status).toBe(200);
    expect(batch.body.data.accepted).toEqual([]);
    expect(batch.body.data.conflicts).toEqual([
      expect.objectContaining({ clientEventId: key, code: 'IDEMPOTENCY_KEY_REUSED' }),
    ]);
  });

  it('another hospital reusing the key learns nothing of the first hospital’s chamber', async () => {
    const first = await createQueueFixture(3);
    let other: QueueFixture | null = null;
    for (let offset = 1; offset < 40 && other === null; offset += 1) {
      const candidate = await createQueueFixture(3, offset);
      if (candidate.hospitalId !== first.hospitalId) other = candidate;
    }
    if (other === null) throw new Error('no chamber at a second hospital');
    const key = randomUUID();

    const applied = await request(app)
      .post(`${BASE}/sessions/${first.sessionId}/delay`)
      .set('Authorization', bearer(await staffOf(first)))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: key,
        clientTs: new Date().toISOString(),
        minutes: 10,
        declaredBy: 'reception',
      });
    expect(applied.status).toBe(200);

    const reused = await request(app)
      .post(`${BASE}/sessions/${other.sessionId}/delay`)
      .set('Authorization', bearer(await staffOf(other)))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientEventId: key,
        clientTs: new Date().toISOString(),
        minutes: 10,
        declaredBy: 'reception',
      });

    const text = JSON.stringify(reused.body);
    expect(text).not.toContain(first.sessionId);
    for (const patientId of first.patientIds) expect(text).not.toContain(patientId);
  });
});

// ---------------------------------------------------------------------------
// Capacity under a crowd
// ---------------------------------------------------------------------------

describe('capacity holds when many book the last place at once (FR-PAT-20)', () => {
  it('twelve simultaneous guests for one remaining place: one serial, eleven refusals', async () => {
    const fixture = await createQueueFixture(4);
    await sql`UPDATE sessions SET capacity = 5 WHERE id = ${fixture.sessionId}::uuid`.execute(db);

    const attempts = await Promise.all(
      Array.from(
        { length: 12 },
        async () =>
          await request(app)
            .post(`${BASE}/bookings`)
            .set('Idempotency-Key', randomUUID())
            .send({
              sessionId: fixture.sessionId,
              method: 'at_hospital',
              guest: {
                name: 'জামাল উদ্দিন (ডেমো)',
                phone: freshPhone(),
                ageYears: 52,
                sex: 'male',
              },
            }),
      ),
    );

    const made = attempts.filter((response) => response.status === 201);
    const full = attempts.filter((response) => response.body?.error?.code === 'SESSION_FULL');
    expect(made).toHaveLength(1);
    expect(full).toHaveLength(11);

    const live = await sql<{ n: string; distinct_serials: string }>`
      SELECT count(*)::text AS n, count(DISTINCT serial_number)::text AS distinct_serials
        FROM bookings WHERE session_id = ${fixture.sessionId}::uuid AND status <> 'cancelled'
    `.execute(db);
    expect(live.rows[0]).toEqual({ n: '5', distinct_serials: '5' });
  });
});

// ---------------------------------------------------------------------------
// Malformed input never becomes a 5xx
// ---------------------------------------------------------------------------

interface LayerLike {
  readonly route?: { readonly path: unknown; readonly stack: readonly { method?: string }[] };
  readonly handle?: unknown;
}

function mountedRoutes(): { method: string; path: string }[] {
  const found: { method: string; path: string }[] = [];
  const walk = (router: unknown): void => {
    const stack = (router as { stack?: unknown }).stack;
    for (const layer of Array.isArray(stack) ? (stack as LayerLike[]) : []) {
      if (layer.route === undefined) {
        walk(layer.handle);
        continue;
      }
      if (typeof layer.route.path !== 'string') continue;
      for (const handler of layer.route.stack) {
        if (handler.method !== undefined) {
          found.push({ method: handler.method.toUpperCase(), path: layer.route.path });
        }
      }
    }
  };
  walk(buildApiRouter());
  return found;
}

/** Values a careless or hostile client sends in place of an id. */
const PARAMS = ['00000000-0000-0000-0000-000000000000', 'not-a-uuid', "1' OR '1'='1", '%00'];

/** Bodies with the wrong shape, the wrong types, and too much of everything. */
const BODIES: readonly unknown[] = [
  {},
  [],
  {
    sessionId: 'not-a-uuid',
    bookingId: "1' OR '1'='1",
    patientId: { $gt: '' },
    clientEventId: 'zz',
    clientTs: 'yesterday',
    phone: '<script>alert(1)</script>',
    minutes: -1e308,
    expectedMinutes: 'ten',
    name: 'ক'.repeat(5_000),
    idempotencyKey: 'x',
    role: 'platform_admin',
    roles: ['platform_admin'],
    hospitalId: '00000000-0000-0000-0000-000000000000',
  },
];

describe('no route answers malformed input with a 5xx (GR-03)', () => {
  let hospitalId: string;
  let otherId: string;
  let everyRole: string;

  beforeAll(async () => {
    const fixture = await createQueueFixture(1);
    hospitalId = fixture.hospitalId;
    otherId = await otherHospitalId(hospitalId);
    everyRole = await signToken({
      kind: 'access',
      claims: {
        sub: await staffIdFor(hospitalId, 'hospital_admin'),
        kind: 'staff',
        hospitalId,
        roles: [...FACILITY_ROLES],
      },
    });
  });

  it('every mounted route, as nobody and as a member of staff holding every role', async () => {
    // Reuse a listener and connection for the thousands of malformed requests.
    // Per-request ephemeral listeners exhaust Windows TCP ports (NFR-01).
    // The Django contract harness supplies an HTTP proxy handler too.
    const server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = request(server);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const crashes: string[] = [];
      for (const route of mountedRoutes()) {
        for (const value of PARAMS) {
          const path = route.path
            .replace(/:hospitalId\b/g, otherId)
            .replace(/:\w+/g, encodeURIComponent(value));
          for (const token of [null, everyRole]) {
            const bodies =
              route.method === 'GET' || route.method === 'DELETE' ? [undefined] : BODIES;
            for (const body of bodies) {
              let call = client[
                route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
              ](
                `${BASE}${path}?limit=-1&from=notadate&to=2026-13-45&q=${encodeURIComponent("' OR 1=1--")}`,
              ).agent(agent);
              if (token !== null) call = call.set('Authorization', bearer(token));
              if (route.method !== 'GET') call = call.set('Idempotency-Key', randomUUID());
              const response = body === undefined ? await call : await call.send(body as object);
              if (response.status >= 500) {
                crashes.push(
                  `${route.method} ${route.path} [${value}] ${token === null ? 'anon' : 'staff'} → ${String(response.status)} ${String(response.body?.error?.code)}`,
                );
              }
            }
          }
        }
        // Syntactically broken JSON, once per writing route.
        if (route.method !== 'GET') {
          const path = route.path.replace(/:\w+/g, PARAMS[0] ?? '');
          const broken = await client[
            route.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete'
          ](`${BASE}${path}`)
            .agent(agent)
            .set('Authorization', bearer(everyRole))
            .set('Content-Type', 'application/json')
            .set('Idempotency-Key', randomUUID())
            .send('{"a":');
          if (broken.status >= 500) {
            crashes.push(`${route.method} ${route.path} [broken JSON] → ${String(broken.status)}`);
          }
        }
      }
      expect(crashes).toEqual([]);
    } finally {
      agent.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  }, 600_000);
});
