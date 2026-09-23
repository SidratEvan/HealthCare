/**
 * The lab and pharmacy endpoints (BACKEND.md §7.6, `FR-LAB-*`, `FR-PHR-02`).
 *
 * What is proven here and nowhere else:
 *
 *   - **The auth matrix** (`FR-ROLE-01`): ordering is a doctor's, the bench is
 *     the lab's, the shelf is the pharmacy's, and the availability search is
 *     everybody's. A role at the wrong hospital is refused as loudly as no
 *     role at all.
 *   - **The lifecycle only moves forward** (`FR-LAB-02`), and its stamps are
 *     written once — a turnaround measurement that a replay could move is not
 *     a measurement.
 *   - **An upload delivers** (`FR-LAB-03`): the report reaches the wallet and
 *     the ordering doctor in the upload's own transaction, and the order ends
 *     `delivered` with `delivered_to` naming who.
 *   - **A report opens, and only behind its signature**: the URL the patient
 *     is given serves the file; the same URL with a tampered signature or a
 *     past expiry is a 404, not a 403.
 *   - **A replay is answered, not repeated** (`FR-OFF-01`, `SY-02`).
 *   - **The patient's search degrades honestly** (`FR-PHR-02`, `PRD.md` §3.2):
 *     a pharmacy that never flagged a medicine is *unknown*, never absent and
 *     never "out of stock".
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { resetEmitter, type RecordingEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';

import {
  freshVisit,
  labFixture,
  orderRow,
  reportsOf,
  seededOrder,
  stockedMedicine,
  TINY_PDF_BASE64,
  type LabFixture,
} from './support/labFixture.js';
import { bearer, guestToken, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let emitted: RecordingEmitter;
let shapla: LabFixture;
let padma: LabFixture;

beforeEach(async () => {
  app = createApp();
  emitted = resetEmitter();
  shapla = await labFixture('Shapla General');
  padma = await labFixture('Padma Specialised');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Orders one test against a freshly signed consultation. */
async function orderTest(
  lab: LabFixture,
  codes: readonly string[] = ['CBC'],
  key = randomUUID(),
): Promise<{ status: number; body: { data?: { orders?: { id: string; state: string }[] } } }> {
  const { bookingId } = await freshVisit(lab.hospitalId);
  const response = await request(app)
    .post(`${BASE}/test-orders`)
    .set('Authorization', bearer(lab.doctorToken))
    .set('Idempotency-Key', key)
    .send({
      bookingId,
      tests: codes.map((testCode) => ({ testCode })),
      idempotencyKey: key,
    });
  return { status: response.status, body: response.body as never };
}

/** Walks a fresh order to a named state through the real endpoints. */
async function orderIn(lab: LabFixture, state: 'sample_collected' | 'processing'): Promise<string> {
  const created = await orderTest(lab);
  const id = created.body.data?.orders?.[0]?.id;
  if (id === undefined) throw new Error('No order was created.');

  const actions = state === 'sample_collected' ? ['collect'] : ['collect', 'process'];
  for (const action of actions) {
    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(lab.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action, idempotencyKey: randomUUID() });
  }
  return id;
}

// ---------------------------------------------------------------------------
// Who may do what (`FR-ROLE-01`)
// ---------------------------------------------------------------------------

describe('the auth matrix', () => {
  it('lets only a doctor order a test', async () => {
    const { bookingId } = await freshVisit(shapla.hospitalId);
    const body = { bookingId, tests: [{ testCode: 'CBC' }], idempotencyKey: randomUUID() };

    for (const token of [shapla.labToken, shapla.pharmacyToken, shapla.wardToken]) {
      const response = await request(app)
        .post(`${BASE}/test-orders`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send(body);
      expect(response.status).toBe(403);
    }

    for (const token of [await patientToken(), await guestToken()]) {
      const response = await request(app)
        .post(`${BASE}/test-orders`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send(body);
      expect(response.status).toBe(403);
    }

    await request(app).post(`${BASE}/test-orders`).send(body).expect(401);
  });

  it('lets the lab and the covering administrator work the queue, and nobody else', async () => {
    const id = await orderIn(shapla, 'sample_collected');

    for (const token of [shapla.doctorToken, shapla.pharmacyToken, shapla.wardToken]) {
      const response = await request(app)
        .patch(`${BASE}/test-orders/${id}/state`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send({ action: 'process', idempotencyKey: randomUUID() });
      expect(response.status).toBe(403);
    }

    // An administrator covering a bench at nine at night is the situation
    // this product is built for, not an exception to police.
    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.adminToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'process', idempotencyKey: randomUUID() })
      .expect(200);
  });

  it("refuses a lab acting on another hospital's order", async () => {
    const id = await orderIn(shapla, 'sample_collected');

    const response = await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(padma.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'process', idempotencyKey: randomUUID() });

    expect(response.status).toBe(403);
    expect(await orderRow(id)).toMatchObject({ state: 'sample_collected' });
  });

  it("refuses a lab reading another hospital's queue", async () => {
    await request(app)
      .get(`${BASE}/hospitals/${padma.hospitalId}/test-orders`)
      .set('Authorization', bearer(shapla.labToken))
      .expect(403);
  });

  it('lets only the pharmacy and the administrator touch the shelf', async () => {
    const url = `${BASE}/hospitals/${shapla.hospitalId}/pharmacy-stock`;

    for (const token of [shapla.labToken, shapla.doctorToken, shapla.wardToken]) {
      await request(app).get(url).set('Authorization', bearer(token)).expect(403);
    }

    await request(app).get(url).set('Authorization', bearer(shapla.pharmacyToken)).expect(200);
    await request(app).get(url).set('Authorization', bearer(shapla.adminToken)).expect(200);
    await request(app).get(url).expect(401);
  });

  it('lets anybody search medicine availability, with no token at all', async () => {
    const { genericName } = await stockedMedicine(shapla.hospitalId);
    await request(app)
      .get(`${BASE}/medicines`)
      .query({ q: genericName.slice(0, 4) })
      .expect(200);
  });
});

// ---------------------------------------------------------------------------
// Ordering (`FR-DOC-06`, `FR-LAB-01`)
// ---------------------------------------------------------------------------

describe('ordering tests from a consultation', () => {
  it('creates one order per test ticked, and broadcasts them to the bench', async () => {
    const created = await orderTest(shapla, ['CBC', 'XR-CHEST', 'ECG']);

    expect(created.status).toBe(201);
    expect(created.body.data?.orders).toHaveLength(3);

    const broadcast = emitted.forRoom(ROOMS.lab(shapla.hospitalId));
    expect(broadcast.map((entry) => entry.event)).toContain('test.ordered');
  });

  it('names the test from the catalogue, so a console cannot rename it', async () => {
    const { bookingId } = await freshVisit(shapla.hospitalId);
    const key = randomUUID();

    const response = await request(app)
      .post(`${BASE}/test-orders`)
      .set('Authorization', bearer(shapla.doctorToken))
      .set('Idempotency-Key', key)
      .send({
        bookingId,
        tests: [{ testCode: 'CBC', testName: 'Something else entirely' }],
        idempotencyKey: key,
      });

    const order = (response.body as { data: { orders: { testName: string }[] } }).data.orders[0];
    expect(order?.testName).toContain('CBC');
  });

  it('refuses an unknown code that arrives without a name', async () => {
    const { bookingId } = await freshVisit(shapla.hospitalId);
    const key = randomUUID();

    // A 400: the request is malformed, not a step the order's state forbids.
    // Nothing in the catalogue names it and the console supplied no name, so
    // the row would carry a test nobody could read on a wallet.
    await request(app)
      .post(`${BASE}/test-orders`)
      .set('Authorization', bearer(shapla.doctorToken))
      .set('Idempotency-Key', key)
      .send({ bookingId, tests: [{ testCode: 'NOT-A-TEST' }], idempotencyKey: key })
      .expect(400);
  });

  it('treats the same chip ticked twice in one request as one order', async () => {
    const created = await orderTest(shapla, ['CBC', 'CBC']);
    expect(created.body.data?.orders).toHaveLength(1);
  });

  it('answers a replay with the orders it already made, and creates none', async () => {
    const { bookingId } = await freshVisit(shapla.hospitalId);
    const key = randomUUID();
    const body = {
      bookingId,
      tests: [{ testCode: 'CBC' }, { testCode: 'LFT' }],
      idempotencyKey: key,
    };

    const first = await request(app)
      .post(`${BASE}/test-orders`)
      .set('Authorization', bearer(shapla.doctorToken))
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`${BASE}/test-orders`)
      .set('Authorization', bearer(shapla.doctorToken))
      .set('Idempotency-Key', key)
      .send(body);

    const firstIds = (first.body as { data: { orders: { id: string }[] } }).data.orders.map(
      (order) => order.id,
    );
    const replayed = replay.body as { data: { orders: { id: string }[]; duplicate: boolean } };

    expect(replayed.data.duplicate).toBe(true);
    expect(replayed.data.orders.map((order) => order.id).sort()).toEqual([...firstIds].sort());
  });

  it("refuses a doctor ordering onto another hospital's bench", async () => {
    const { bookingId } = await freshVisit(padma.hospitalId);
    const key = randomUUID();

    await request(app)
      .post(`${BASE}/test-orders`)
      .set('Authorization', bearer(shapla.doctorToken))
      .set('Idempotency-Key', key)
      .send({ bookingId, tests: [{ testCode: 'CBC' }], idempotencyKey: key })
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// The lifecycle (`FR-LAB-02`)
// ---------------------------------------------------------------------------

describe('the lifecycle, through the endpoints', () => {
  it('walks forward and stamps each state as it goes', async () => {
    const created = await orderTest(shapla);
    const id = created.body.data?.orders?.[0]?.id ?? '';

    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'collect', idempotencyKey: randomUUID() })
      .expect(200);

    const collected = await orderRow(id);
    expect(collected.state).toBe('sample_collected');
    expect(collected.sampleAt).not.toBeNull();

    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'process', idempotencyKey: randomUUID() })
      .expect(200);

    expect((await orderRow(id)).state).toBe('processing');
    expect(emitted.forRoom(ROOMS.lab(shapla.hospitalId)).map((e) => e.event)).toContain(
      'test.updated',
    );
  });

  it('treats a stale tap from an outbox as a replay, not as going backwards', async () => {
    // A console that was offline while the bench moved on replays *collect*
    // against an order already processing. Its outcome has held since the
    // sample was taken, so it is answered as applied and nothing moves — the
    // refusal `canActOnTestOrder` would give is for a live tap, and a live
    // console never shows *collect* on a processing order.
    const id = await orderIn(shapla, 'processing');
    const before = await orderRow(id);

    const response = await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'collect', idempotencyKey: randomUUID() });

    expect(response.status).toBe(200);
    expect((response.body as { data: { duplicate: boolean } }).data.duplicate).toBe(true);

    const after = await orderRow(id);
    expect(after.state).toBe('processing');
    expect(after.sampleAt?.getTime()).toBe(before.sampleAt?.getTime());
  });

  it('refuses to cancel an order and then carry on working it', async () => {
    // The one genuinely backwards move a console can still ask for: work on
    // something already called off.
    const id = await orderIn(shapla, 'sample_collected');

    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'cancel', idempotencyKey: randomUUID() })
      .expect(200);

    const response = await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'process', idempotencyKey: randomUUID() });

    expect(response.status).toBe(422);
    expect((response.body as { error: { code: string } }).error.code).toBe(
      'TEST_TRANSITION_INVALID',
    );
    expect((await orderRow(id)).state).toBe('cancelled');
  });

  it('refuses to skip a state, so nothing is reported without a sample', async () => {
    const created = await orderTest(shapla);
    const id = created.body.data?.orders?.[0]?.id ?? '';

    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'ready', idempotencyKey: randomUUID() })
      .expect(422);
  });

  it('will not accept "deliver" as an action a console may send', async () => {
    const id = await orderIn(shapla, 'processing');

    // Not a 422 but a 400: the enum does not contain it, so validation
    // refuses the body before any guard runs. Delivery is the server's step.
    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'deliver', idempotencyKey: randomUUID() })
      .expect(400);
  });

  it('answers a replayed state button without moving the stamp', async () => {
    const id = await orderIn(shapla, 'sample_collected');
    const first = await orderRow(id);

    const replay = await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'collect', idempotencyKey: randomUUID() });

    expect(replay.status).toBe(200);
    expect((replay.body as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
    expect((await orderRow(id)).sampleAt?.getTime()).toBe(first.sampleAt?.getTime());
  });

  it('cancels open work but never a result that belongs to the patient', async () => {
    const open = await orderIn(shapla, 'sample_collected');
    await request(app)
      .patch(`${BASE}/test-orders/${open}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'cancel', idempotencyKey: randomUUID() })
      .expect(200);

    const delivered = await seededOrder(shapla.hospitalId, 'delivered');
    expect(delivered).not.toBeNull();

    const refused = await request(app)
      .patch(`${BASE}/test-orders/${delivered?.id ?? ''}/state`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'cancel', idempotencyKey: randomUUID() });

    expect(refused.status).toBe(422);
    expect((refused.body as { error: { details: { guard: string } } }).error.details.guard).toBe(
      'REPORT_EXISTS',
    );
  });
});

// ---------------------------------------------------------------------------
// The report (`FR-LAB-03`)
// ---------------------------------------------------------------------------

describe('uploading a report delivers it', () => {
  it('stores the file, delivers to the wallet and the doctor, and ends delivered', async () => {
    const id = await orderIn(shapla, 'processing');
    const key = randomUUID();

    const response = await request(app)
      .post(`${BASE}/test-orders/${id}/report`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', key)
      .send({ fileType: 'application/pdf', content: TINY_PDF_BASE64, idempotencyKey: key });

    expect(response.status).toBe(201);

    const after = await orderRow(id);
    expect(after.state).toBe('delivered');
    expect(after.readyAt).not.toBeNull();
    expect(after.deliveredAt).not.toBeNull();

    const [report] = await reportsOf(id);
    expect(report?.deliveredAt).not.toBeNull();
    // `FR-LAB-03` names both. The order came out of a consultation, so it has
    // an ordering doctor to reach.
    expect(report?.deliveredTo.sort()).toEqual(['doctor', 'patient']);
  });

  it('refuses an upload before a sample was taken, and stores nothing', async () => {
    const created = await orderTest(shapla);
    const id = created.body.data?.orders?.[0]?.id ?? '';
    const key = randomUUID();

    await request(app)
      .post(`${BASE}/test-orders/${id}/report`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', key)
      .send({ fileType: 'application/pdf', content: TINY_PDF_BASE64, idempotencyKey: key })
      .expect(422);

    expect(await reportsOf(id)).toHaveLength(0);
    expect((await orderRow(id)).state).toBe('ordered');
  });

  it('answers a replayed upload without delivering a second copy', async () => {
    const id = await orderIn(shapla, 'processing');
    const key = randomUUID();
    const body = {
      fileType: 'application/pdf',
      content: TINY_PDF_BASE64,
      idempotencyKey: key,
    };

    await request(app)
      .post(`${BASE}/test-orders/${id}/report`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    const replay = await request(app)
      .post(`${BASE}/test-orders/${id}/report`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', key)
      .send(body);

    expect(replay.status).toBe(200);
    expect((replay.body as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
    expect(await reportsOf(id)).toHaveLength(1);
  });

  it('refuses a file type that is neither PDF nor an image', async () => {
    const id = await orderIn(shapla, 'processing');
    const key = randomUUID();

    await request(app)
      .post(`${BASE}/test-orders/${id}/report`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', key)
      .send({
        fileType: 'application/x-msdownload',
        content: TINY_PDF_BASE64,
        idempotencyKey: key,
      })
      .expect(400);
  });
});

// ---------------------------------------------------------------------------
// The signed URL (`BACKEND.md` §0: "signed URLs only")
// ---------------------------------------------------------------------------

describe('a report opens only behind its signature', () => {
  async function uploadedReportUrl(): Promise<string> {
    const id = await orderIn(shapla, 'processing');
    const key = randomUUID();

    await request(app)
      .post(`${BASE}/test-orders/${id}/report`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', key)
      .send({ fileType: 'application/pdf', content: TINY_PDF_BASE64, idempotencyKey: key });

    const [report] = await reportsOf(id);
    return report?.fileUrl ?? '';
  }

  it('serves the file the lab uploaded', async () => {
    const url = await uploadedReportUrl();
    const response = await request(app).get(`${BASE}${url}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    // Nothing between the API and the patient may keep a copy.
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('is a 404 for a tampered signature, never a 403', async () => {
    const url = await uploadedReportUrl();
    // A 403 would tell a caller guessing at keys that this one exists.
    await request(app)
      .get(`${BASE}${url.replace(/sig=[^&]+/, 'sig=forged')}`)
      .expect(404);
  });

  it('is a 404 once the URL has expired', async () => {
    const url = await uploadedReportUrl();
    const past = Math.floor(Date.now() / 1000) - 60;
    await request(app)
      .get(`${BASE}${url.replace(/expires=\d+/, `expires=${String(past)}`)}`)
      .expect(404);
  });

  it('is a 404 for a key nobody stored', async () => {
    await request(app).get(`${BASE}/files/reports%2Fnot-a-report.pdf?expires=0&sig=x`).expect(404);
  });
});

// ---------------------------------------------------------------------------
// The queue and its turnaround (`FR-LAB-01`, `FR-LAB-04`)
// ---------------------------------------------------------------------------

describe('the bench queue', () => {
  it('opens on work rather than on nothing', async () => {
    // `CLAUDE.md` §5.3: no feature ships with an empty screen, and the seed
    // guarantees every lab has open orders (`seed_04_history`).
    const response = await request(app)
      .get(`${BASE}/hospitals/${shapla.hospitalId}/test-orders`)
      .set('Authorization', bearer(shapla.labToken))
      .expect(200);

    const data = (response.body as { data: { orders: unknown[] } }).data;
    expect(data.orders.length).toBeGreaterThan(0);
  });

  it('measures turnaround per test type, and says where it has none', async () => {
    const response = await request(app)
      .get(`${BASE}/hospitals/${shapla.hospitalId}/test-orders`)
      .query({ state: 'all', days: 30 })
      .set('Authorization', bearer(shapla.labToken))
      .expect(200);

    const { turnaround } = (
      response.body as {
        data: {
          turnaround: {
            testCode: string;
            medianSeconds: number | null;
            open: number;
          }[];
        };
      }
    ).data;

    expect(turnaround.length).toBeGreaterThan(0);
    // Slowest median first, and a type with no measurement last rather than
    // counted as zero.
    const measured = turnaround.filter((entry) => entry.medianSeconds !== null);
    expect(measured.length).toBeGreaterThan(0);
    for (let index = 1; index < measured.length; index += 1) {
      expect(measured[index - 1]?.medianSeconds ?? 0).toBeGreaterThanOrEqual(
        measured[index]?.medianSeconds ?? 0,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The pharmacy (`FR-PHR-02`)
// ---------------------------------------------------------------------------

describe('the shelf and what the public is told', () => {
  it('shows the pharmacy what a patient searching would be told right now', async () => {
    const response = await request(app)
      .get(`${BASE}/hospitals/${shapla.hospitalId}/pharmacy-stock`)
      .set('Authorization', bearer(shapla.pharmacyToken))
      .expect(200);

    const { rows } = (
      response.body as { data: { rows: { publishedAs: string; inStock: boolean }[] } }
    ).data;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(['in_stock', 'out_of_stock', 'unknown']).toContain(row.publishedAs);
    }
  });

  it('renews the freshness even when the flag did not change', async () => {
    const { medicineId, inStock } = await stockedMedicine(shapla.hospitalId);

    const before = await sql<{ updated_at: Date }>`
      SELECT updated_at FROM pharmacy_stock
       WHERE hospital_id = ${shapla.hospitalId}::uuid AND medicine_id = ${medicineId}::uuid
    `.execute(db);

    const key = randomUUID();
    await request(app)
      .put(`${BASE}/hospitals/${shapla.hospitalId}/pharmacy-stock`)
      .set('Authorization', bearer(shapla.pharmacyToken))
      .set('Idempotency-Key', key)
      .send({ flags: [{ medicineId, inStock }], idempotencyKey: key })
      .expect(200);

    const after = await sql<{ updated_at: Date }>`
      SELECT updated_at FROM pharmacy_stock
       WHERE hospital_id = ${shapla.hospitalId}::uuid AND medicine_id = ${medicineId}::uuid
    `.execute(db);

    // Re-sending an unchanged flag is how somebody says "still true".
    expect(after.rows[0]?.updated_at.getTime() ?? 0).toBeGreaterThan(
      before.rows[0]?.updated_at.getTime() ?? 0,
    );
  });

  it('flags a medicine out of stock, and the search says so', async () => {
    const { medicineId, genericName } = await stockedMedicine(shapla.hospitalId);
    const key = randomUUID();

    await request(app)
      .put(`${BASE}/hospitals/${shapla.hospitalId}/pharmacy-stock`)
      .set('Authorization', bearer(shapla.pharmacyToken))
      .set('Idempotency-Key', key)
      .send({ flags: [{ medicineId, inStock: false }], idempotencyKey: key })
      .expect(200);

    const search = await request(app)
      .get(`${BASE}/medicines`)
      .query({ q: genericName })
      .expect(200);

    const medicines = (
      search.body as {
        data: {
          medicines: {
            medicineId: string;
            pharmacies: { hospitalId: string; answer: string }[];
          }[];
        };
      }
    ).data.medicines;

    const found = medicines.find((entry) => entry.medicineId === medicineId);
    const here = found?.pharmacies.find((entry) => entry.hospitalId === shapla.hospitalId);
    expect(here?.answer).toBe('out_of_stock');
  });

  it('calls a pharmacy that never flagged a medicine unknown, never absent', async () => {
    // `PRD.md` §3.2. An absent hospital reads as "does not stock it", which
    // is a claim nobody made.
    const { medicineId, genericName } = await stockedMedicine(shapla.hospitalId);

    await sql`
      DELETE FROM pharmacy_stock
       WHERE hospital_id = ${shapla.hospitalId}::uuid AND medicine_id = ${medicineId}::uuid
    `.execute(db);

    const search = await request(app)
      .get(`${BASE}/medicines`)
      .query({ q: genericName })
      .expect(200);

    const medicines = (
      search.body as {
        data: {
          medicines: {
            medicineId: string;
            pharmacies: { hospitalId: string; answer: string }[];
            summary: { unknown: number };
          }[];
        };
      }
    ).data.medicines;

    const found = medicines.find((entry) => entry.medicineId === medicineId);
    const here = found?.pharmacies.find((entry) => entry.hospitalId === shapla.hospitalId);

    expect(here).toBeDefined();
    expect(here?.answer).toBe('unknown');
    expect(found?.summary.unknown ?? 0).toBeGreaterThan(0);
  });

  it('counts the answers rather than reaching a verdict', async () => {
    const { genericName } = await stockedMedicine(shapla.hospitalId);

    const search = await request(app)
      .get(`${BASE}/medicines`)
      .query({ q: genericName })
      .expect(200);

    const medicines = (
      search.body as {
        data: {
          medicines: {
            pharmacies: unknown[];
            summary: { inStock: number; outOfStock: number; unknown: number };
          }[];
        };
      }
    ).data.medicines;

    for (const medicine of medicines) {
      const { inStock, outOfStock, unknown } = medicine.summary;
      expect(inStock + outOfStock + unknown).toBe(medicine.pharmacies.length);
    }
  });

  it('refuses a search term too short to mean anything', async () => {
    await request(app).get(`${BASE}/medicines`).query({ q: 'a' }).expect(400);
  });
});
