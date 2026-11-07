/**
 * Importing a hospital's own data (pilot step 24, `S-B-14`, `FR-IMP-01`…`10`,
 * BACKEND.md §7.7 `/hospital/imports`).
 *
 * The files here are synthetic, as `FR-IMP-11` requires of every environment
 * but a hospital's own production: invented names carrying the demo label,
 * numbers nobody holds. The facility is made the way `pnpm staff:create`
 * makes one and removed afterwards, so the seeded six stay the only facilities
 * other files count.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { time, MAX_IMPORT_BYTES } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { createFirstAdministrator } from '../services/staffAuth.service.js';

import { asOwner } from './support/ownerDb.js';
import { bearer, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let hospitalId: string;
let token: string;

const STRUCTURE_HEADER =
  'type,ref,name_bn,name_en,code,bmdc_number,degrees,specialties,department_ref,room,fee_taka,doctor_ref,weekday,start,end,serials,ward_ref,floor,bed_kind,bed_label,nightly_taka,role,email';

function structureRow(values: Record<string, string>): string {
  return STRUCTURE_HEADER.split(',')
    .map((column) => values[column] ?? '')
    .join(',');
}

/** Tomorrow in Dhaka, and its ISO weekday, so a schedule made now has a chamber then. */
const tomorrow = time.toDhakaDate(time.addMinutes(time.fromDate(new Date()), 24 * 60));
const tomorrowWeekday = time.dhakaWeekday(time.addMinutes(time.fromDate(new Date()), 24 * 60));
const bmdc = `A-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const suffix = randomUUID().slice(0, 6);

function structureFile(fee = '800'): string {
  return [
    STRUCTURE_HEADER,
    structureRow({
      type: 'department',
      ref: 'D-1',
      name_bn: 'মেডিসিন (ডেমো)',
      name_en: 'Medicine (Demo)',
      code: 'MED',
    }),
    structureRow({
      type: 'doctor',
      ref: 'DR-1',
      name_bn: 'ডা. আমদানি (ডেমো)',
      name_en: 'Dr Imported (Demo)',
      bmdc_number: bmdc,
      specialties: 'medicine',
      department_ref: 'D-1',
      room: '12',
      fee_taka: fee,
    }),
    structureRow({
      type: 'schedule',
      ref: 'S-1',
      doctor_ref: 'DR-1',
      weekday: String(tomorrowWeekday),
      start: '5:00 PM',
      end: '9:00 PM',
      serials: '30',
    }),
    structureRow({
      type: 'ward',
      ref: 'W-1',
      name_bn: 'ওয়ার্ড (ডেমো)',
      name_en: 'Ward (Demo)',
      floor: '2',
      bed_kind: 'general',
    }),
    structureRow({
      type: 'bed',
      ref: 'B-201',
      ward_ref: 'W-1',
      bed_label: '201',
      bed_kind: 'general',
      nightly_taka: '"1,200"',
    }),
    structureRow({
      type: 'staff',
      ref: 'ST-1',
      name_bn: 'আমদানি কর্মী (ডেমো)',
      role: 'receptionist',
      email: `imported-${suffix}@import.demo.invalid`,
    }),
    // The template's own example row: skipped, never written.
    structureRow({
      type: 'department',
      ref: 'EXAMPLE-D-01',
      name_bn: 'উদাহরণ',
      name_en: 'Example',
      code: 'EXM',
    }),
  ].join('\r\n');
}

async function upload(
  set: string,
  csv: string,
  fileName = `${set}.csv`,
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/hospital/imports`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({ set, fileName, csv });
}

async function act(
  batchId: string,
  action: 'commit' | 'undo' | 'discard',
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/hospital/imports/${batchId}/${action}`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({});
}

async function count(query: ReturnType<typeof sql<{ n: number }>>): Promise<number> {
  return (await query.execute(db)).rows[0]?.n ?? -1;
}

beforeAll(async () => {
  app = createApp();
  const made = await createFirstAdministrator({
    hospitalCode: `I${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    hospital: {
      nameBn: 'আমদানি হাসপাতাল (ডেমো)',
      nameEn: 'Import Test Hospital (Demo)',
      kind: 'hospital',
      division: 'Dhaka',
      district: 'Dhaka',
    },
    email: `admin-${suffix}@import.demo.invalid`,
    fullName: 'প্রশাসক (ডেমো)',
  });
  hospitalId = made.hospitalId;
  token = await signToken({
    kind: 'access',
    claims: { sub: made.staffId, kind: 'staff', hospitalId, roles: ['hospital_admin'] },
  });
});

afterAll(async () => {
  const ids = [hospitalId];
  // As the owner: the API's role may not delete an audit row (`ownerDb.ts`).
  await asOwner(async (owner) => {
    const run = async (query: ReturnType<typeof sql>): Promise<void> => {
      await query.execute(owner);
    };
    await run(
      sql`DELETE FROM bookings WHERE session_id IN (SELECT id FROM sessions WHERE hospital_id = ANY(${ids}::uuid[]))`,
    );
    await run(sql`DELETE FROM sessions WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM external_refs WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM import_batches WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM patients WHERE owner_hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM beds WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM wards WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(
      sql`DELETE FROM session_templates WHERE doctor_hospital_id IN (SELECT id FROM doctor_hospitals WHERE hospital_id = ANY(${ids}::uuid[]))`,
    );
    await run(sql`DELETE FROM doctor_hospitals WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM doctors WHERE bmdc_number = ${bmdc}`);
    await run(sql`DELETE FROM departments WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM audit_log WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM staff_roles WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`UPDATE hospitals SET created_by = NULL WHERE id = ANY(${ids}::uuid[])`);
    await run(
      sql`DELETE FROM sessions_auth WHERE subject_id IN (SELECT id FROM staff_users WHERE hospital_id = ANY(${ids}::uuid[]))`,
    );
    await run(sql`DELETE FROM staff_users WHERE hospital_id = ANY(${ids}::uuid[])`);
    await run(sql`DELETE FROM hospitals WHERE id = ANY(${ids}::uuid[])`);
  });
});

describe('who may import (FR-ROLE-01)', () => {
  it('is the hospital administrator alone', async () => {
    expect((await request(app).get(`${BASE}/hospital/imports`)).status).toBe(401);
    const reception = await staffToken(['receptionist', 'ward', 'doctor'], hospitalId);
    expect(
      (await request(app).get(`${BASE}/hospital/imports`).set('Authorization', bearer(reception)))
        .status,
    ).toBe(403);
  });

  it('hands out each set’s template as a file a spreadsheet opens (FR-IMP-09)', async () => {
    const response = await request(app)
      .get(`${BASE}/hospital/imports/templates/patients`)
      .set('Authorization', bearer(token));
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.startsWith('﻿ref,full_name,date_of_birth')).toBe(true);
    // Set D waits (FR-IMP-12).
    const records = await request(app)
      .get(`${BASE}/hospital/imports/templates/records`)
      .set('Authorization', bearer(token));
    expect(records.status).toBe(400);
  });
});

describe('checking a file writes nothing but the batch (FR-IMP-05)', () => {
  it('refuses a file that is not the set, before any batch exists', async () => {
    const response = await upload('patients', 'name,phone\nX,017');
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: 'IMPORT_FILE',
      details: { reason: 'missing_columns', columns: ['ref', 'full_name', 'sex'] },
    });
  });

  it('names every error by row and field, and cannot be committed', async () => {
    const response = await upload(
      'structure',
      [
        STRUCTURE_HEADER,
        structureRow({
          type: 'doctor',
          ref: 'DR-X',
          name_bn: 'ক',
          name_en: 'K',
          bmdc_number: 'A-1',
          department_ref: 'NOPE',
          fee_taka: '500',
        }),
        structureRow({ type: 'surgeon', ref: 'X' }),
      ].join('\n'),
    );
    expect(response.status).toBe(200);
    expect(response.body.data.counts).toEqual({ add: 0, update: 0, skip: 0, error: 2 });
    expect(response.body.data.errors).toEqual([
      { rowNumber: 2, field: 'department_ref', code: 'unknown_ref' },
      { rowNumber: 3, field: 'type', code: 'unknown_type' },
    ]);
    const refused = await act(response.body.data.id as string, 'commit');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: 'IMPORT_STATE',
      details: { reason: 'has_errors' },
    });
    expect((await act(response.body.data.id as string, 'discard')).body.data.state).toBe(
      'discarded',
    );
  });

  it('warns of what it does not refuse: one patient under two identifiers, a column written two ways (FR-IMP-21)', async () => {
    const response = await upload(
      'patients',
      [
        'ref,full_name,date_of_birth,age_years,sex,mobile,blood_group',
        'W-1,সতর্ক রোগী (ডেমো),05/10/1975,,F,01812345671,',
        'W-2,অন্য রোগী (ডেমো),1980-02-03,,M,01912345671,',
        'W-OLD,সতর্ক রোগী (ডেমো),,48,F,8801812345671,',
      ].join('\n'),
      'warned.csv',
    );
    expect(response.status).toBe(200);
    // Nothing is refused, and nothing is merged: three rows, three patients.
    expect(response.body.data.counts).toEqual({ add: 3, update: 0, skip: 0, error: 0 });
    expect(response.body.data.errors).toEqual([]);
    const expected = {
      samePerson: [{ rows: [2, 4], because: ['phone_and_name'] }],
      samePersonTotal: 1,
      mixedFormats: [
        {
          field: 'date_of_birth',
          kind: 'date',
          formats: [
            { format: 'day_first', rows: 1, firstRow: 2 },
            { format: 'iso', rows: 1, firstRow: 3 },
          ],
        },
        {
          field: 'mobile',
          kind: 'phone',
          formats: [
            { format: 'local', rows: 2, firstRow: 2 },
            { format: 'country', rows: 1, firstRow: 4 },
          ],
        },
      ],
    };
    expect(response.body.data.warnings).toEqual(expected);
    // A warning names rows by number and carries nothing from them.
    const said = JSON.stringify(response.body.data.warnings);
    for (const value of ['সতর্ক', '1812345671', '1975', 'W-OLD']) expect(said).not.toContain(value);

    // The same when the batch is opened again: worked out from its rows, not kept.
    const batchId = response.body.data.id as string;
    const again = await request(app)
      .get(`${BASE}/hospital/imports/${batchId}`)
      .set('Authorization', bearer(token));
    expect(again.body.data.warnings).toEqual(expected);

    // The audit records that the administrator was warned, in counts.
    const audit = await sql<{ warnings: unknown }>`
      SELECT meta->'warnings' AS warnings FROM audit_log
       WHERE hospital_id = ${hospitalId} AND action = 'IMPORT' AND subject_id = ${batchId}
    `.execute(db);
    expect(audit.rows[0]?.warnings).toEqual({
      samePerson: 1,
      mixedFormats: ['date_of_birth', 'mobile'],
    });

    // Once it is closed there is nothing left to decide, and nothing is said.
    const dropped = await act(batchId, 'discard');
    expect(dropped.body.data.state).toBe('discarded');
    expect(dropped.body.data.warnings).toEqual({
      samePerson: [],
      samePersonTotal: 0,
      mixedFormats: [],
    });
  });

  it('says nothing of a file with nothing to warn about', async () => {
    const response = await upload(
      'patients',
      [
        'ref,full_name,date_of_birth,age_years,sex,mobile,blood_group',
        'Q-1,প্রথম রোগী (ডেমো),05/10/1975,,F,01812345672,',
        'Q-2,দ্বিতীয় জন (ডেমো),06/11/1980,,M,01812345672,',
      ].join('\n'),
      'quiet.csv',
    );
    expect(response.body.data.counts).toMatchObject({ add: 2, error: 0 });
    // One phone, two names: a family, not a duplicate.
    expect(response.body.data.warnings).toEqual({
      samePerson: [],
      samePersonTotal: 0,
      mixedFormats: [],
    });
    await act(response.body.data.id as string, 'discard');
  });
});

describe('set A, then B, then C — and undoing them (FR-IMP-01…07)', () => {
  let structureBatch: string;
  let patientsBatch: string;
  let appointmentsBatch: string;

  it('previews the structure, writes it all on approval, and makes the chambers', async () => {
    const preview = await upload('structure', structureFile());
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      state: 'checked',
      counts: { add: 6, update: 0, skip: 1, error: 0 },
    });
    structureBatch = preview.body.data.id as string;
    // Nothing written yet.
    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM departments WHERE hospital_id = ${hospitalId}`,
      ),
    ).toBe(0);

    const committed = await act(structureBatch, 'commit');
    expect(committed.status).toBe(200);
    expect(committed.body.data.state).toBe('committed');

    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM departments WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL`,
      ),
    ).toBe(1);
    // Occupancy is never imported (FR-IMP-03): the bed waits for the ward.
    const bed = await sql<{ state: string; nightly_poisha: number }>`
      SELECT state::text AS state, nightly_poisha FROM beds WHERE hospital_id = ${hospitalId}
    `.execute(db);
    expect(bed.rows).toEqual([{ state: 'out_of_service', nightly_poisha: 120_000 }]);
    // The schedule made tomorrow's chamber.
    const chambers = await sql<{ day: string }>`
      SELECT to_char(session_date, 'YYYY-MM-DD') AS day FROM sessions
       WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL AND template_id IS NOT NULL
    `.execute(db);
    expect(chambers.rows.map((row) => row.day)).toContain(tomorrow);
    // The account exists, and holds no password until an administrator issues one.
    const account = await sql<{ password_hash: string }>`
      SELECT password_hash FROM staff_users WHERE email = ${`imported-${suffix}@import.demo.invalid`}
    `.execute(db);
    expect(account.rows[0]?.password_hash.startsWith('scrypt$')).toBe(false);
  });

  it('updates rather than duplicates when the same file comes again (FR-IMP-04)', async () => {
    const again = await upload('structure', structureFile('950'));
    expect(again.body.data.counts).toMatchObject({ add: 0, update: 6, error: 0 });
    expect((await act(again.body.data.id as string, 'commit')).status).toBe(200);
    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM doctor_hospitals WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL`,
      ),
    ).toBe(1);
    const fee = await sql<{
      fee_poisha: number;
    }>`SELECT fee_poisha FROM doctor_hospitals WHERE hospital_id = ${hospitalId}`.execute(db);
    expect(fee.rows[0]?.fee_poisha).toBe(95_000);
  });

  it('imports patients the hospital holds, and appointments into their chambers (FR-IMP-10)', async () => {
    const patients = await upload(
      'patients',
      [
        'ref,full_name,date_of_birth,age_years,sex,mobile,blood_group',
        'P-1,আমদানি রোগী (ডেমো),01/02/1980,,F,01812345670,O+',
        'P-2,দ্বিতীয় রোগী (ডেমো),,34,M,,',
      ].join('\n'),
    );
    expect(patients.body.data.counts).toMatchObject({ add: 2, error: 0 });
    patientsBatch = patients.body.data.id as string;
    expect((await act(patientsBatch, 'commit')).status).toBe(200);
    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM patients WHERE owner_hospital_id = ${hospitalId}`,
      ),
    ).toBe(2);

    // This hospital's counter finds its own imported patient by the number;
    // another hospital's counter does not (FR-IMP-10).
    const adminId = (
      await sql<{ id: string }>`
        SELECT id FROM staff_users WHERE hospital_id = ${hospitalId} ORDER BY created_at LIMIT 1
      `.execute(db)
    ).rows[0]?.id;
    const other = (
      await sql<{ id: string }>`
        SELECT id FROM hospitals WHERE id <> ${hospitalId} AND deleted_at IS NULL ORDER BY name_en LIMIT 1
      `.execute(db)
    ).rows[0]?.id;
    const counterAt = async (facility: string): Promise<string> =>
      await signToken({
        kind: 'access',
        claims: {
          sub: adminId ?? '',
          kind: 'staff',
          hospitalId: facility,
          roles: ['receptionist'],
        },
      });
    const here = await request(app)
      .get(`${BASE}/registration/patients?phone=01812345670`)
      .set('Authorization', bearer(await counterAt(hospitalId)));
    expect(here.body.data.patients).toMatchObject([
      { fullName: 'আমদানি রোগী (ডেমো)', owner: 'hospital' },
    ]);
    const elsewhere = await request(app)
      .get(`${BASE}/registration/patients?phone=01812345670`)
      .set('Authorization', bearer(await counterAt(other ?? '')));
    expect(elsewhere.body.data.patients).toEqual([]);

    const appointments = await upload(
      'appointments',
      [
        'patient_ref,doctor_ref,date,start,serial,paid',
        `P-1,DR-1,${tomorrow},17:30,3,yes`,
        `P-2,DR-1,${tomorrow},,4,no`,
        `P-9,DR-1,${tomorrow},,5,no`,
      ].join('\n'),
    );
    expect(appointments.body.data.counts).toMatchObject({ add: 2, error: 1 });
    expect(appointments.body.data.errors).toEqual([
      { rowNumber: 4, field: 'patient_ref', code: 'unknown_ref' },
    ]);
    expect((await act(appointments.body.data.id as string, 'discard')).status).toBe(200);

    const fixed = await upload(
      'appointments',
      [
        'patient_ref,doctor_ref,date,start,serial,paid',
        `P-1,DR-1,${tomorrow},17:30,3,yes`,
        `P-2,DR-1,${tomorrow},,4,no`,
      ].join('\n'),
    );
    appointmentsBatch = fixed.body.data.id as string;
    expect((await act(appointmentsBatch, 'commit')).status).toBe(200);
    const bookings = await sql<{ serial_number: number; source: string; paid: boolean }>`
      SELECT b.serial_number, b.source::text AS source, (b.intake->'import'->>'paid')::boolean AS paid
        FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE s.hospital_id = ${hospitalId} AND b.deleted_at IS NULL ORDER BY b.serial_number
    `.execute(db);
    expect(bookings.rows).toEqual([
      { serial_number: 3, source: 'import', paid: true },
      { serial_number: 4, source: 'import', paid: false },
    ]);
  });

  it('will not undo patients while their appointments stand, and says which rows (FR-IMP-07)', async () => {
    const blocked = await act(patientsBatch, 'undo');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('IMPORT_UNDO_BLOCKED');
    expect(blocked.body.error.details.blocking).toEqual([
      { rowNumber: 2, kind: 'patient' },
      { rowNumber: 3, kind: 'patient' },
    ]);
  });

  it('undoes the appointments, then the patients', async () => {
    expect((await act(appointmentsBatch, 'undo')).body.data.state).toBe('undone');
    expect(
      await count(sql<{ n: number }>`
      SELECT count(*)::int AS n FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE s.hospital_id = ${hospitalId} AND b.deleted_at IS NULL
    `),
    ).toBe(0);
    expect((await act(patientsBatch, 'undo')).body.data.state).toBe('undone');
    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM patients WHERE owner_hospital_id = ${hospitalId} AND deleted_at IS NULL`,
      ),
    ).toBe(0);
    // Undone is final: it cannot be undone twice.
    expect((await act(patientsBatch, 'undo')).status).toBe(409);
  });

  it('audits every step with who, the file and its fingerprint (FR-IMP-08)', async () => {
    const audit = await sql<{ event: string; sha: string | null }>`
      SELECT meta->>'event' AS event, meta->>'fileSha256' AS sha FROM audit_log
       WHERE hospital_id = ${hospitalId} AND action = 'IMPORT' AND subject_id = ${structureBatch}
       ORDER BY created_at
    `.execute(db);
    expect(audit.rows.map((row) => row.event)).toEqual(['checked', 'committed']);
    expect(audit.rows[0]?.sha).toMatch(/^[0-9a-f]{64}$/);
    const history = await request(app)
      .get(`${BASE}/hospital/imports`)
      .set('Authorization', bearer(token));
    expect((history.body.data.batches as unknown[]).length).toBeGreaterThanOrEqual(6);
  });
});

describe('persisted undo protection (FR-IMP-07)', () => {
  async function department(ref: string, name: string, code = ref): Promise<string> {
    const checked = await upload(
      'structure',
      [
        STRUCTURE_HEADER,
        structureRow({ type: 'department', ref, code, name_bn: name, name_en: name }),
      ].join('\n'),
    );
    expect(checked.status).toBe(200);
    const id = checked.body.data.id as string;
    expect((await act(id, 'commit')).status).toBe(200);
    return id;
  }

  it('restores an unchanged update, retaining the original identifier', async () => {
    await department('SAFE', 'Before (Demo)');
    const updated = await department('SAFE', 'After (Demo)');
    expect((await act(updated, 'undo')).status).toBe(200);
    const row = await sql<{
      name_en: string;
      deleted_at: string | null;
    }>`SELECT d.name_en, d.deleted_at FROM departments d JOIN external_refs r ON r.entity_id=d.id WHERE r.hospital_id=${hospitalId} AND r.external_ref='SAFE'`.execute(
      db,
    );
    expect(row.rows).toEqual([{ name_en: 'Before (Demo)', deleted_at: null }]);
  });

  it('adopts an existing code as an update and never deletes the original department', async () => {
    await department('ADOPT-ORIGINAL', 'Original (Demo)', 'ADOPT');
    const adopted = await department('ADOPT-ALIAS', 'Renamed (Demo)', 'ADOPT');
    const undo = await act(adopted, 'undo');
    expect(undo.status).toBe(200);
    const rows = await sql<{
      name_en: string;
      deleted_at: string | null;
    }>`SELECT name_en, deleted_at FROM departments WHERE hospital_id=${hospitalId} AND code='ADOPT'`.execute(
      db,
    );
    expect(rows.rows).toEqual([{ name_en: 'Original (Demo)', deleted_at: null }]);
  });

  it('blocks the entire batch after a later edit, preserving its other row', async () => {
    const checked = await upload(
      'structure',
      [
        STRUCTURE_HEADER,
        ...['LATER-A', 'LATER-B'].map((ref) =>
          structureRow({ type: 'department', ref, code: ref, name_bn: 'Demo', name_en: 'Demo' }),
        ),
      ].join('\n'),
    );
    const batch = checked.body.data.id as string;
    expect((await act(batch, 'commit')).status).toBe(200);
    await sql`UPDATE departments SET name_en='Colleague (Demo)' WHERE hospital_id=${hospitalId} AND code='LATER-A'`.execute(
      db,
    );
    const undo = await act(batch, 'undo');
    expect(undo.status).toBe(409);
    expect(undo.body.error.code).toBe('IMPORT_UNDO_BLOCKED');
    const rows = await sql<{
      name_en: string;
      deleted_at: string | null;
    }>`SELECT name_en, deleted_at FROM departments WHERE hospital_id=${hospitalId} AND code IN ('LATER-A','LATER-B') ORDER BY code`.execute(
      db,
    );
    expect(rows.rows).toEqual([
      { name_en: 'Colleague (Demo)', deleted_at: null },
      { name_en: 'Demo', deleted_at: null },
    ]);
    expect(
      (
        await request(app)
          .get(`${BASE}/hospital/imports/${batch}`)
          .set('Authorization', bearer(token))
      ).body.data.state,
    ).toBe('committed');
  });

  it('refuses legacy batches without after-state evidence', async () => {
    const batch = await department('LEGACY', 'Legacy (Demo)');
    await sql`UPDATE import_rows SET previous=previous-'__importUndo' WHERE batch_id=${batch}`.execute(
      db,
    );
    expect((await act(batch, 'undo')).status).toBe(409);
    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM departments WHERE hospital_id=${hospitalId} AND code='LEGACY' AND deleted_at IS NULL`,
      ),
    ).toBe(1);
  });

  it('restores a replacement schedule and its existing external reference together', async () => {
    const scheduleFile = (capacity: string) =>
      [
        STRUCTURE_HEADER,
        structureRow({
          type: 'schedule',
          ref: 'SAFE-SCHED',
          doctor_ref: 'DR-1',
          weekday: String(tomorrowWeekday),
          start: '09:00',
          end: '11:00',
          serials: capacity,
        }),
      ].join('\n');
    const first = await upload('structure', scheduleFile('20'));
    expect((await act(first.body.data.id as string, 'commit')).status).toBe(200);
    const original = (
      await sql<{
        entity_id: string;
      }>`SELECT entity_id FROM external_refs WHERE hospital_id=${hospitalId} AND external_ref='SAFE-SCHED'`.execute(
        db,
      )
    ).rows[0]?.entity_id;
    const second = await upload('structure', scheduleFile('21'));
    const batch = second.body.data.id as string;
    expect((await act(batch, 'commit')).status).toBe(200);
    expect((await act(batch, 'undo')).status).toBe(200);
    const restored = await sql<{
      entity_id: string;
      deleted_at: string | null;
      capacity: number;
    }>`SELECT r.entity_id,t.deleted_at,t.capacity FROM external_refs r JOIN session_templates t ON t.id=r.entity_id WHERE r.hospital_id=${hospitalId} AND r.external_ref='SAFE-SCHED'`.execute(
      db,
    );
    expect(restored.rows).toEqual([{ entity_id: original, deleted_at: null, capacity: 20 }]);
  });

  it('blocks a schedule undo after a chamber starts, even with no bookings', async () => {
    const checked = await upload(
      'structure',
      [
        STRUCTURE_HEADER,
        structureRow({
          type: 'schedule',
          ref: 'USED-SCHED',
          doctor_ref: 'DR-1',
          weekday: String(tomorrowWeekday),
          start: '11:00',
          end: '12:00',
          serials: '20',
        }),
      ].join('\n'),
    );
    const batch = checked.body.data.id as string;
    expect((await act(batch, 'commit')).status).toBe(200);
    await sql`UPDATE sessions SET status='running', actual_start=now() WHERE template_id IN (SELECT entity_id FROM external_refs WHERE hospital_id=${hospitalId} AND external_ref='USED-SCHED')`.execute(
      db,
    );
    expect((await act(batch, 'undo')).status).toBe(409);
    expect(
      (
        await request(app)
          .get(`${BASE}/hospital/imports/${batch}`)
          .set('Authorization', bearer(token))
      ).body.data.state,
    ).toBe('committed');
  });

  it('preserves imported staff permissions by refusing incomplete role restoration', async () => {
    const checked = await upload(
      'structure',
      [
        STRUCTURE_HEADER,
        structureRow({
          type: 'staff',
          ref: 'ST-1',
          name_bn: 'Updated Demo',
          role: 'ward',
          email: `imported-${suffix}@import.demo.invalid`,
        }),
      ].join('\n'),
    );
    const batch = checked.body.data.id as string;
    expect((await act(batch, 'commit')).status).toBe(200);
    expect((await act(batch, 'undo')).status).toBe(409);
    const roles = await sql<{
      role: string;
    }>`SELECT r.role::text AS role FROM staff_roles r JOIN external_refs e ON e.entity_id=r.staff_user_id WHERE e.hospital_id=${hospitalId} AND e.external_ref='ST-1' AND r.deleted_at IS NULL`.execute(
      db,
    );
    expect(roles.rows).toEqual([{ role: 'ward' }]);
  });

  it('recognises an already-linked doctor as an update and preserves that membership', async () => {
    const checked = await upload(
      'structure',
      [
        STRUCTURE_HEADER,
        structureRow({
          type: 'doctor',
          ref: 'DR-ALIAS',
          name_bn: 'Demo',
          name_en: 'Demo',
          bmdc_number: bmdc,
          department_ref: 'D-1',
          fee_taka: '950',
          room: '12',
        }),
      ].join('\n'),
    );
    const batch = checked.body.data.id as string;
    expect((await act(batch, 'commit')).status).toBe(200);
    expect(
      (
        await sql<{
          action: string;
        }>`SELECT action FROM import_rows WHERE batch_id=${batch}`.execute(db)
      ).rows,
    ).toEqual([{ action: 'update' }]);
    expect((await act(batch, 'undo')).status).toBe(409);
    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM doctor_hospitals WHERE hospital_id=${hospitalId} AND deleted_at IS NULL`,
      ),
    ).toBe(1);
  });

  it('serializes a concurrent alias import and Undo without a reference to a deleted membership', async () => {
    const doctor = (ref: string) =>
      structureRow({
        type: 'doctor',
        ref,
        name_bn: 'Demo',
        name_en: 'Demo',
        bmdc_number: bmdc,
        department_ref: 'RACE-D',
        fee_taka: '950',
        room: '12',
      });
    const original = await upload(
      'structure',
      [
        STRUCTURE_HEADER,
        structureRow({
          type: 'department',
          ref: 'RACE-D',
          code: 'RACE',
          name_bn: 'Demo',
          name_en: 'Demo',
        }),
        doctor('RACE-DR'),
      ].join('\n'),
    );
    const first = original.body.data.id as string;
    expect((await act(first, 'commit')).status).toBe(200);
    const alias = await upload('structure', [STRUCTURE_HEADER, doctor('RACE-ALIAS')].join('\n'));
    const second = alias.body.data.id as string;
    const results = await asOwner(async (owner) => {
      await sql`SELECT pg_advisory_lock(hashtextextended(${`import:${hospitalId}`}, 0))`.execute(
        owner,
      );
      const work = Promise.all([act(second, 'commit'), act(first, 'undo')]);
      try {
        await expect
          .poll(
            async () =>
              (
                await sql<{
                  n: number;
                }>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%'`.execute(
                  owner,
                )
              ).rows[0]?.n ?? 0,
            { timeout: 5000 },
          )
          .toBeGreaterThanOrEqual(2);
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtextextended(${`import:${hospitalId}`}, 0))`.execute(
          owner,
        );
      }
      return await work;
    });
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await count(
        sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM external_refs r JOIN doctor_hospitals d ON d.id=r.entity_id WHERE r.hospital_id=${hospitalId} AND r.kind='doctor' AND d.deleted_at IS NOT NULL`,
      ),
    ).toBe(0);
  });
});

describe('all CSV doors enforce actual UTF-8, after authentication (FR-IMP-09/22)', () => {
  it.each(['', '/analyse', '/mapped'])(
    'accepts the larger envelope at %s without the global 256KiB rejection',
    async (path) => {
      const csv = 'ref,full_name,sex\n' + ' '.repeat(270 * 1024);
      const response = await request(app)
        .post(`${BASE}/hospital/imports${path}`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send({
          set: 'patients',
          csv,
          ...(path === '/analyse' ? {} : { fileName: 'envelope.csv' }),
          ...(path === '/mapped'
            ? { mapping: { rowType: null, fields: { ref: 0, full_name: 1, sex: 2 } } }
            : {}),
        });
      expect(response.status).not.toBe(413);
      expect(response.status).toBeLessThan(500);
      expect([200, 201, 422]).toContain(response.status);
    },
  );

  it.each(['', '/analyse', '/mapped'])('rejects oversized multibyte CSV at %s', async (path) => {
    const csv = 'ক'.repeat(Math.floor(MAX_IMPORT_BYTES / 3) + 1);
    const response = await request(app)
      .post(`${BASE}/hospital/imports${path}`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send({
        set: 'patients',
        csv,
        ...(path === '/analyse' ? {} : { fileName: 'too-big.csv' }),
        ...(path === '/mapped' ? { mapping: { rowType: null, fields: {} } } : {}),
      });
    expect(response.status).toBe(400);
  });

  it.each(['', '/analyse', '/mapped'])(
    'rejects an unauthenticated invalid large body before parsing at %s',
    async (path) => {
      const response = await request(app)
        .post(`${BASE}/hospital/imports${path}`)
        .set('Content-Type', 'application/json')
        .send('x'.repeat(270 * 1024));
      expect(response.status).toBe(401);
    },
  );
});
