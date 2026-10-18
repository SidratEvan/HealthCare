/** C5/C6/C7: scoped audits, valid report bytes and atomic stock comparisons. */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REPORT_MAX_BYTES } from '@platform/domain';

import { storage } from '../adapters/storage.js';
import { createApp } from '../app.js';
import { db } from '../config/db.js';
import * as clinicalRepo from '../repositories/clinical.repo.js';
import * as labRepo from '../repositories/lab.repo.js';

import {
  labFixture,
  freshVisit,
  orderRow,
  reportsOf,
  stockedMedicine,
  TINY_PDF_BASE64,
  type LabFixture,
} from './support/labFixture.js';
import { bearer } from './support/tokens.js';

const BASE = '/api/v1';
let fixture: LabFixture;
const app = createApp();
beforeEach(async () => {
  fixture = await labFixture('Shapla General');
});

async function reportable(): Promise<string> {
  const { bookingId } = await freshVisit(fixture.hospitalId);
  const key = randomUUID();
  const response = await request(app)
    .post(`${BASE}/test-orders`)
    .set('Authorization', bearer(fixture.doctorToken))
    .set('Idempotency-Key', key)
    .send({ bookingId, tests: [{ testCode: 'CBC' }], idempotencyKey: key })
    .expect(201);
  const id = (response.body as { data: { orders: { id: string }[] } }).data.orders[0]!.id;
  for (const action of ['collect', 'process']) {
    const actionKey = randomUUID();
    await request(app)
      .patch(`${BASE}/test-orders/${id}/state`)
      .set('Authorization', bearer(fixture.labToken))
      .set('Idempotency-Key', actionKey)
      .send({ action, idempotencyKey: actionKey })
      .expect(200);
  }
  return id;
}
function upload(id: string, content: string, fileType = 'application/pdf', key = randomUUID()) {
  return request(app)
    .post(`${BASE}/test-orders/${id}/report`)
    .set('Authorization', bearer(fixture.labToken))
    .set('Idempotency-Key', key)
    .send({ content, fileType, idempotencyKey: key });
}
interface Flag {
  medicineId: string;
  inStock: boolean;
  expectedUpdatedAt: string | null;
}
function write(flags: readonly Flag[]) {
  const key = randomUUID();
  return request(app)
    .put(`${BASE}/hospitals/${fixture.hospitalId}/pharmacy-stock`)
    .set('Authorization', bearer(fixture.pharmacyToken))
    .set('Idempotency-Key', key)
    .send({ flags, idempotencyKey: key });
}

describe('C5 patient label audit (DB-P7)', () => {
  it('records actor, hospital, patient and test order before returning a label', async () => {
    const id = await reportable();
    await request(app)
      .get(`${BASE}/test-orders/${id}/patient`)
      .set('Authorization', bearer(fixture.labToken))
      .expect(200);
    const audit = await sql<{
      actor_staff_id: string;
      hospital_id: string;
      patient_id: string;
      meta: Record<string, unknown>;
    }>`
      SELECT actor_staff_id, hospital_id, patient_id, meta FROM audit_log
       WHERE action = 'RECORD_VIEW' AND subject_table = 'test_orders' AND subject_id = ${id}::uuid
       ORDER BY created_at DESC LIMIT 1
    `.execute(db);
    expect(audit.rows[0]).toMatchObject({
      actor_staff_id: fixture.labStaffId,
      hospital_id: fixture.hospitalId,
      patient_id: (await labRepo.findTestOrder(id))?.patientId,
      meta: { surface: 'S-B-08', read: 'patient_label' },
    });
  });
  it('fails closed when durable audit writing fails', async () => {
    const id = await reportable();
    vi.spyOn(clinicalRepo, 'recordRecordView').mockRejectedValueOnce(
      new Error('synthetic audit failure'),
    );
    const response = await request(app)
      .get(`${BASE}/test-orders/${id}/patient`)
      .set('Authorization', bearer(fixture.labToken))
      .expect(500);
    expect(response.body).not.toHaveProperty('data');
    expect(JSON.stringify(response.body)).not.toContain(
      (await labRepo.findTestOrder(id))?.patientId,
    );
  });
  it('refuses a foreign hospital without writing a read audit', async () => {
    const foreign = await labFixture('Padma Specialised');
    fixture = foreign;
    const id = await reportable();
    fixture = await labFixture('Shapla General');
    const audit = vi.spyOn(clinicalRepo, 'recordRecordView');
    await request(app)
      .get(`${BASE}/test-orders/${id}/patient`)
      .set('Authorization', bearer(fixture.labToken))
      .expect(404);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('C6 report validation (FR-LAB-03)', () => {
  it.each([
    ['invalid characters', TINY_PDF_BASE64 + '!'],
    ['missing padding', 'JVBERi0'],
    ['empty decoded payload', '===='],
    ['wrong signature', Buffer.from('<html>synthetic</html>').toString('base64')],
    ['noncanonical padding', 'JVBERi1='],
  ])('rejects %s before storage or clinical writes', async (_name, content) => {
    const id = await reportable();
    const put = vi.spyOn(storage(), 'put');
    await upload(id, content).expect(400);
    expect(put).not.toHaveBeenCalled();
    expect(await reportsOf(id)).toHaveLength(0);
    expect((await orderRow(id)).state).toBe('processing');
  });
  it('rejects declared MIME mismatch before storage', async () => {
    const id = await reportable();
    const put = vi.spyOn(storage(), 'put');
    await upload(id, TINY_PDF_BASE64, 'image/png').expect(400);
    expect(put).not.toHaveBeenCalled();
  });
  it('accepts exactly 10 MiB and rejects the next byte before storage', async () => {
    const bytes = Buffer.alloc(REPORT_MAX_BYTES, 32);
    bytes.write('%PDF-1.4\n');
    const id = await reportable();
    await upload(id, bytes.toString('base64')).expect(201);
    const other = await reportable();
    const put = vi.spyOn(storage(), 'put');
    await upload(other, Buffer.concat([bytes, Buffer.from(' ')]).toString('base64')).expect(400);
    expect(put).not.toHaveBeenCalled();
    expect(await reportsOf(other)).toHaveLength(0);
  });
  it('refuses a key replay against a different order', async () => {
    const id = await reportable();
    const key = randomUUID();
    await upload(id, TINY_PDF_BASE64, 'application/pdf', key).expect(201);
    const other = await reportable();
    const put = vi.spyOn(storage(), 'put');
    await upload(other, TINY_PDF_BASE64, 'application/pdf', key).expect(422);
    expect(put).not.toHaveBeenCalled();
    expect(await reportsOf(other)).toHaveLength(0);
  });
  it('serializes one upload key raced against two different orders', async () => {
    const first = await reportable();
    const second = await reportable();
    const key = randomUUID();
    const responses = await Promise.all([
      upload(first, TINY_PDF_BASE64, 'application/pdf', key),
      upload(second, TINY_PDF_BASE64, 'application/pdf', key),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    expect((await reportsOf(first)).length + (await reportsOf(second)).length).toBe(1);
  });
});

describe('C7 conditional shelf writes (FR-PHR-02)', () => {
  it('round trips PostgreSQL microseconds and rejects a stale single write', async () => {
    const row = await stockedMedicine(fixture.hospitalId);
    await sql`UPDATE pharmacy_stock SET updated_at = '2026-10-10T00:00:00.123456Z'::timestamptz
      WHERE hospital_id = ${fixture.hospitalId}::uuid AND medicine_id = ${row.medicineId}::uuid`.execute(
      db,
    );
    const shelf = await request(app)
      .get(`${BASE}/hospitals/${fixture.hospitalId}/pharmacy-stock`)
      .set('Authorization', bearer(fixture.pharmacyToken))
      .expect(200);
    const current = (
      shelf.body as { data: { rows: { medicineId: string; updatedAt: string }[] } }
    ).data.rows.find((entry) => entry.medicineId === row.medicineId);
    expect(current?.updatedAt).toMatch(/\.\d{6}Z$/);
    const flag = {
      medicineId: row.medicineId,
      inStock: !row.inStock,
      expectedUpdatedAt: current?.updatedAt ?? null,
    };
    await write([flag]).expect(200);
    await write([{ ...flag, inStock: row.inStock }]).expect(409);
    expect((await stockedMedicine(fixture.hospitalId)).inStock).toBe(!row.inStock);
  });
  it('rolls back the complete list when one version is stale', async () => {
    const shelf = await request(app)
      .get(`${BASE}/hospitals/${fixture.hospitalId}/pharmacy-stock`)
      .set('Authorization', bearer(fixture.pharmacyToken))
      .expect(200);
    const rows = (
      shelf.body as {
        data: { rows: { medicineId: string; inStock: boolean; updatedAt: string }[] };
      }
    ).data.rows.slice(0, 2);
    expect(rows).toHaveLength(2);
    const flags = rows.map((row) => ({
      medicineId: row.medicineId,
      inStock: !row.inStock,
      expectedUpdatedAt: row.updatedAt,
    }));
    await write([flags[0]!]).expect(200);
    await write(flags).expect(409);
    const untouched = await sql<{
      in_stock: boolean;
      updated_at: string;
    }>`SELECT in_stock, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at FROM pharmacy_stock WHERE hospital_id = ${fixture.hospitalId}::uuid AND medicine_id = ${rows[1]!.medicineId}::uuid`.execute(
      db,
    );
    expect(untouched.rows[0]).toEqual({
      in_stock: rows[1]!.inStock,
      updated_at: rows[1]!.updatedAt,
    });
  });
  it('allows only one of two concurrent edits from the same version', async () => {
    const row = await stockedMedicine(fixture.hospitalId);
    const responses = await Promise.all([write([row]), write([{ ...row, inStock: !row.inStock }])]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });
  it('rejects missing versions, duplicate rows and lists over 200 without partial writes', async () => {
    const row = await stockedMedicine(fixture.hospitalId);
    const key = randomUUID();
    await request(app)
      .put(`${BASE}/hospitals/${fixture.hospitalId}/pharmacy-stock`)
      .set('Authorization', bearer(fixture.pharmacyToken))
      .set('Idempotency-Key', key)
      .send({ flags: [{ medicineId: row.medicineId, inStock: false }], idempotencyKey: key })
      .expect(400);
    await write([row, row]).expect(409);
    await write(Array.from({ length: 201 }, () => row)).expect(400);
    expect(await stockedMedicine(fixture.hospitalId)).toEqual(row);
  });
});
