/**
 * A patient's own old papers (plan R3; `PRD.md` `FR-PAT-62`; `BACKEND.md` §7.6).
 *
 * Added by a signed-in patient to a profile their account holds, read by its
 * bytes, private, labelled as the patient's, and seen by a doctor only under
 * the patient's live consent, with the opening audited.
 *
 * Runs against the seeded demo database (CLAUDE.md §6).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { bearer, guestToken, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';
const PDF = Buffer.from('%PDF-1.4\n% demo paper (ডেমো)\n%%EOF\n', 'utf8');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let app: Express;
let fixture: QueueFixture;

interface Account {
  readonly userId: string;
  readonly patientId: string;
  readonly token: string;
}
let a: Account;
let b: Account;

beforeAll(async () => {
  const rows = await sql<{ user_id: string; patient_id: string }>`
    SELECT DISTINCT ON (p.owner_user_id) p.owner_user_id AS user_id, p.id AS patient_id
      FROM patients p
     WHERE p.owner_user_id IS NOT NULL AND p.deleted_at IS NULL
     ORDER BY p.owner_user_id, p.id
     LIMIT 2
  `.execute(db);
  const [first, second] = await Promise.all(
    rows.rows.map(async (row) => ({
      userId: row.user_id,
      patientId: row.patient_id,
      token: await patientToken(row.user_id),
    })),
  );
  if (first === undefined || second === undefined) throw new Error('the seed holds accounts');
  a = first;
  b = second;
});

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(1);
});

async function upload(
  token: string,
  body: Record<string, unknown> = {},
  file: Buffer = PDF,
): Promise<request.Response> {
  const key = randomUUID();
  return await request(app)
    .post(`${BASE}/me/documents`)
    .set('authorization', bearer(token))
    .set('idempotency-key', key)
    .send({
      patientId: a.patientId,
      contentType: 'application/pdf',
      dataBase64: file.toString('base64'),
      docType: 'prescription',
      docDate: '2025-03-04',
      doctorName: 'ডা. পরীক্ষা (ডেমো)',
      idempotencyKey: key,
      ...body,
    });
}

async function doctor(): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: {
      sub: fixture.doctorStaffId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['doctor'],
    },
  });
}

describe('a patient adds and keeps their own papers (FR-PAT-62)', () => {
  it('adds a PDF, lists it as the patient’s, opens it, and removes it', async () => {
    const added = await upload(a.token);
    expect(added.status).toBe(201);
    const id = added.body.data.document.id as string;
    expect(added.body.data.document).toMatchObject({
      docType: 'prescription',
      docDate: '2025-03-04',
      contentType: 'application/pdf',
      source: 'patient_provided',
    });

    const listed = await request(app)
      .get(`${BASE}/me/documents?patient=${a.patientId}`)
      .set('authorization', bearer(a.token));
    expect((listed.body.data.documents as { id: string }[]).map((d) => d.id)).toContain(id);

    const link = await request(app)
      .get(`${BASE}/patients/${a.patientId}/documents/${id}/url`)
      .set('authorization', bearer(a.token));
    expect(link.status).toBe(200);
    const file = await request(app).get(`${BASE}${link.body.data.url as string}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');

    const removed = await request(app)
      .delete(`${BASE}/me/documents/${id}`)
      .set('authorization', bearer(a.token));
    expect(removed.status).toBe(200);
    const after = await request(app)
      .get(`${BASE}/me/documents?patient=${a.patientId}`)
      .set('authorization', bearer(a.token));
    expect((after.body.data.documents as { id: string }[]).map((d) => d.id)).not.toContain(id);
    // Removed is kept as removed, not deleted.
    const row = await sql<{ deleted_at: Date | null }>`
      SELECT deleted_at FROM patient_documents WHERE id = ${id}::uuid
    `.execute(db);
    expect(row.rows[0]?.deleted_at).not.toBeNull();
  });

  it('reads the bytes, not the name: a page or a mislabelled picture is refused', async () => {
    const page = await upload(a.token, {}, Buffer.from('<html>not a paper</html>'));
    expect(page.status).toBe(422);
    expect(page.body.error.code).toBe('DOCUMENT_NOT_SUPPORTED');

    const mislabelled = await upload(a.token, {}, PNG);
    expect(mislabelled.status).toBe(422);

    const png = await upload(a.token, { contentType: 'image/png' }, PNG);
    expect(png.status).toBe(201);
  });

  it('refuses a paper dated after today', async () => {
    const response = await upload(a.token, { docDate: '2099-01-01' });
    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('DOCUMENT_DATE_IN_FUTURE');
  });

  it('is the account’s own: another account, a link, staff and nobody are refused', async () => {
    expect((await upload(b.token)).status).toBe(403);
    expect((await upload(await guestToken())).status).toBe(403);
    expect((await upload(await doctor())).status).toBe(403);
    const key = randomUUID();
    const anonymous = await request(app)
      .post(`${BASE}/me/documents`)
      .set('idempotency-key', key)
      .send({});
    expect(anonymous.status).toBe(401);

    const added = await upload(a.token);
    const id = added.body.data.document.id as string;
    expect(
      (
        await request(app)
          .get(`${BASE}/me/documents?patient=${a.patientId}`)
          .set('authorization', bearer(b.token))
      ).status,
    ).toBe(403);
    // Somebody else's paper and no paper are the same answer.
    expect(
      (
        await request(app)
          .delete(`${BASE}/me/documents/${id}`)
          .set('authorization', bearer(b.token))
      ).status,
    ).toBe(404);
  });
});

describe('a doctor sees a patient’s paper only under consent (FR-PAT-62, FR-SEC-04)', () => {
  it('refuses without consent, opens and audits with it, and the record lists it as the patient’s', async () => {
    const added = await upload(a.token);
    const id = added.body.data.document.id as string;

    const refused = await request(app)
      .get(`${BASE}/patients/${a.patientId}/documents/${id}/url`)
      .set('authorization', bearer(await doctor()));
    expect(refused.status).toBe(403);

    await sql`
      INSERT INTO consents (patient_id, hospital_id, scope, granted_via)
      VALUES (${a.patientId}::uuid, ${fixture.hospitalId}::uuid, 'full', 'app')
    `.execute(db);

    const records = await request(app)
      .get(`${BASE}/patients/${a.patientId}/records`)
      .set('authorization', bearer(await doctor()));
    expect(records.status).toBe(200);
    const listed = (records.body.data.documents as { id: string; source: string }[]).find(
      (paper) => paper.id === id,
    );
    expect(listed?.source).toBe('patient_provided');

    const opened = await request(app)
      .get(`${BASE}/patients/${a.patientId}/documents/${id}/url`)
      .set('authorization', bearer(await doctor()));
    expect(opened.status).toBe(200);
    const audit = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_log
       WHERE subject_table = 'patient_documents' AND subject_id = ${id}::uuid
         AND actor_staff_id = ${fixture.doctorStaffId}::uuid
    `.execute(db);
    expect(audit.rows[0]?.n).toBe(1);

    await sql`
      UPDATE consents SET revoked_at = now()
       WHERE patient_id = ${a.patientId}::uuid AND hospital_id = ${fixture.hospitalId}::uuid
         AND revoked_at IS NULL
    `.execute(db);
  });
});
