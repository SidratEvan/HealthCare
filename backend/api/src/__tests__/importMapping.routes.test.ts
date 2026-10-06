/**
 * A hospital's own export, mapped onto the template (`S-B-14`, `PRD.md` §14b
 * `FR-IMP-13`–`20`).
 *
 * The path the onboarding story needs: a patient register in the hospital's
 * own column names goes in, the server proposes which column is which, an
 * administrator's confirmed mapping takes it to the importer that already
 * exists, and from there it is previewed, approved and undoable exactly as a
 * template file is. Along the way, what must hold: analysing writes nothing,
 * nothing unmapped reaches the database, the check still decides, and no cell
 * value is kept in a saved mapping or an audit row.
 *
 * Every file here is synthetic (`FR-IMP-11`, `FR-SEC-08`).
 */

import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { createFirstAdministrator } from '../services/staffAuth.service.js';

import { asOwner } from './support/ownerDb.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let hospitalId: string;
let token: string;

const suffix = randomUUID().slice(0, 6);

/** A patient register as a hospital's own system exports it. */
const REGISTER = [
  'Patient ID,Patient Name,DOB,Gender,Contact No,Blood Grp,Address,NID',
  `P-${suffix}-1,Rahima Khatun (Demo),05/03/1988,F,01712345678,B+,"House 4, Mirpur",1234567890`,
  `P-${suffix}-2,Karim Uddin (Demo),12/11/1975,M,01812345678,O+,"Road 7, Dhanmondi",2345678901`,
  // A mobile number that is not one: the check's to refuse, not the mapping's.
  `P-${suffix}-3,Salma Begum (Demo),01/01/1990,Female,12345,,Uttara,`,
].join('\r\n');

const GOOD_MAPPING = {
  rowType: null,
  fields: { ref: 0, full_name: 1, date_of_birth: 2, sex: 3, mobile: 4, blood_group: 5 },
};

function post(path: string, body: object, as: string = token): request.Test {
  return request(app)
    .post(`${BASE}${path}`)
    .set('Authorization', bearer(as))
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

async function count(table: 'import_batches' | 'import_mapping_profiles'): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM ${sql.table(table)} WHERE hospital_id = ${hospitalId}
  `.execute(db);
  return Number(result.rows[0]?.n ?? '-1');
}

beforeAll(async () => {
  app = createApp();
  const made = await createFirstAdministrator({
    hospitalCode: `M${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    hospital: {
      nameBn: 'ম্যাপিং হাসপাতাল (ডেমো)',
      nameEn: 'Mapping Test Hospital (Demo)',
      kind: 'hospital',
      division: 'Dhaka',
      district: 'Dhaka',
    },
    email: `admin-${suffix}@mapping.demo.invalid`,
    fullName: 'প্রশাসক (ডেমো)',
  });
  hospitalId = made.hospitalId;
  token = await signToken({
    kind: 'access',
    claims: { sub: made.staffId, kind: 'staff', hospitalId, roles: ['hospital_admin'] },
  });
});

afterAll(async () => {
  await asOwner(async (owner) => {
    const run = async (query: ReturnType<typeof sql>): Promise<void> => {
      await query.execute(owner);
    };
    await run(sql`DELETE FROM external_refs WHERE hospital_id = ${hospitalId}`);
    await run(sql`DELETE FROM import_batches WHERE hospital_id = ${hospitalId}`);
    await run(sql`DELETE FROM import_mapping_profiles WHERE hospital_id = ${hospitalId}`);
    await run(sql`DELETE FROM patients WHERE owner_hospital_id = ${hospitalId}`);
    await run(sql`DELETE FROM audit_log WHERE hospital_id = ${hospitalId}`);
    await run(sql`DELETE FROM staff_roles WHERE hospital_id = ${hospitalId}`);
    await run(sql`UPDATE hospitals SET created_by = NULL WHERE id = ${hospitalId}`);
    await run(
      sql`DELETE FROM sessions_auth WHERE subject_id IN (SELECT id FROM staff_users WHERE hospital_id = ${hospitalId})`,
    );
    await run(sql`DELETE FROM staff_users WHERE hospital_id = ${hospitalId}`);
    await run(sql`DELETE FROM hospital_settings WHERE hospital_id = ${hospitalId}`);
    await run(sql`DELETE FROM hospitals WHERE id = ${hospitalId}`);
  });
});

describe('who may map an import (FR-ADM-11)', () => {
  const calls: readonly [string, object][] = [
    ['/hospital/imports/analyse', { set: 'patients', csv: REGISTER }],
    [
      '/hospital/imports/mapped',
      { set: 'patients', fileName: 'register.csv', csv: REGISTER, mapping: GOOD_MAPPING },
    ],
  ];

  it.each(calls)('%s needs a token', async (path, body) => {
    const response = await request(app)
      .post(`${BASE}${path}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect(response.status).toBe(401);
  });

  it.each(calls)('%s is the hospital administrator’s alone', async (path, body) => {
    for (const other of [
      await staffToken(['receptionist', 'doctor'], hospitalId),
      await nationalToken(['platform_admin']),
      await patientToken(),
    ]) {
      expect((await post(path, body, other)).status).toBe(403);
    }
  });
});

describe('analysing a file (FR-IMP-13 to FR-IMP-15)', () => {
  it('says what each column holds and proposes which is which, and writes nothing', async () => {
    const response = await post('/hospital/imports/analyse', { set: 'patients', csv: REGISTER });

    expect(response.status).toBe(200);
    const data = response.body.data as {
      templateShaped: boolean;
      rowCount: number;
      columns: { index: number; name: string; profile: { kind: string } }[];
      fields: { field: string; required: boolean }[];
      oneOf: string[][];
      proposal: {
        field: string;
        column: number | null;
        source: string | null;
        reason: string | null;
        confidence: number | null;
      }[];
      fromSaved: boolean;
    };

    expect(data).toMatchObject({ templateShaped: false, rowCount: 3, fromSaved: false });
    expect(data.columns.map((column) => column.name)).toEqual([
      'Patient ID',
      'Patient Name',
      'DOB',
      'Gender',
      'Contact No',
      'Blood Grp',
      'Address',
      'NID',
    ]);
    expect(data.columns[2]?.profile.kind).toBe('date');
    expect(data.oneOf).toEqual([['date_of_birth', 'age_years']]);

    const proposed = Object.fromEntries(data.proposal.map((entry) => [entry.field, entry]));
    expect(proposed['ref']).toMatchObject({ column: 0, source: 'rule', reason: 'known_name' });
    expect(proposed['mobile']).toMatchObject({ column: 4, source: 'rule' });
    expect(proposed['age_years']).toMatchObject({ column: null, source: null });

    // The address and the national id are proposed for nothing (FR-IMP-02).
    const used = new Set(data.proposal.map((entry) => entry.column));
    expect(used.has(6)).toBe(false);
    expect(used.has(7)).toBe(false);

    // And nothing was written: not a batch, not a profile.
    expect(await count('import_batches')).toBe(0);
    expect(await count('import_mapping_profiles')).toBe(0);
  });

  it('carries no value from any row in its answer (FR-IMP-17)', async () => {
    const response = await post('/hospital/imports/analyse', { set: 'patients', csv: REGISTER });
    const raw = JSON.stringify(response.body);

    for (const value of ['Rahima', 'Karim', 'Salma', '01712345678', 'Mirpur', '1234567890']) {
      expect(raw).not.toContain(value);
    }
  });

  it('says a file already in the template’s shape needs no mapping', async () => {
    const response = await post('/hospital/imports/analyse', {
      set: 'patients',
      csv: 'ref,full_name,sex,age_years\nP-1,A (Demo),f,30\n',
    });
    expect(response.body.data).toMatchObject({ templateShaped: true, proposal: [] });
  });

  it('refuses a file whose first row is a patient, not headings (FR-IMP-14)', async () => {
    const response = await post('/hospital/imports/analyse', {
      set: 'patients',
      csv: 'P-1,Rahima Khatun (Demo),05/03/1988,F,01712345678\nP-2,Karim (Demo),12/11/1975,M,01812345678\n',
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: 'IMPORT_FILE',
      details: { reason: 'no_header_row' },
    });
    // The refusal does not repeat the row it refused.
    expect(JSON.stringify(response.body)).not.toContain('Rahima');
  });

  it('guesses which kind of row a structure file holds, and takes a correction', async () => {
    const doctors =
      'Doctor ID,Doctor Name,Bangla Name,BMDC Reg No,Department,Consultation Fee\nD-1,Dr A (Demo),ডা. ক (ডেমো),A-12345,CARD,800\n';

    const guessed = await post('/hospital/imports/analyse', { set: 'structure', csv: doctors });
    expect(guessed.body.data).toMatchObject({ rowType: 'doctor', needsRowType: false });

    const corrected = await post('/hospital/imports/analyse', {
      set: 'structure',
      csv: doctors,
      rowType: 'staff',
    });
    expect(corrected.body.data.rowType).toBe('staff');
    expect((corrected.body.data.fields as { field: string }[]).map((entry) => entry.field)).toEqual(
      ['ref', 'name_bn', 'email', 'role'],
    );
  });

  it('asks which kind of row when a structure file gives no clue', async () => {
    const response = await post('/hospital/imports/analyse', {
      set: 'structure',
      csv: 'Alpha,Beta\nx,y\n',
    });
    expect(response.body.data).toMatchObject({ needsRowType: true, rowType: null, fields: [] });
  });
});

describe('a confirmed mapping (FR-IMP-18, FR-IMP-19)', () => {
  it('is refused, with nothing written, while a required field has no column', async () => {
    const response = await post('/hospital/imports/mapped', {
      set: 'patients',
      fileName: 'register.csv',
      csv: REGISTER,
      mapping: { rowType: null, fields: { ...GOOD_MAPPING.fields, sex: null } },
    });

    expect(response.status).toBe(422);
    expect(response.body.error.details).toMatchObject({
      reason: 'mapping_invalid',
      problems: [{ kind: 'required_unmapped', field: 'sex' }],
    });
    expect(await count('import_batches')).toBe(0);
  });

  it('is refused for a field the template does not have, or a column the file does not', async () => {
    const stray = await post('/hospital/imports/mapped', {
      set: 'patients',
      fileName: 'register.csv',
      csv: REGISTER,
      mapping: { rowType: null, fields: { ...GOOD_MAPPING.fields, national_id: 7 } },
    });
    expect(stray.status).toBe(422);
    expect(stray.body.error.details.problems).toContainEqual({
      kind: 'unknown_field',
      field: 'national_id',
    });

    const beyond = await post('/hospital/imports/mapped', {
      set: 'patients',
      fileName: 'register.csv',
      csv: REGISTER,
      mapping: { rowType: null, fields: { ...GOOD_MAPPING.fields, mobile: 60 } },
    });
    expect(beyond.status).toBe(422);
    expect(await count('import_batches')).toBe(0);
  });

  let batchId: string;

  it('goes to the existing check, which still decides row by row', async () => {
    const response = await post('/hospital/imports/mapped', {
      set: 'patients',
      fileName: 'register.csv',
      csv: REGISTER,
      mapping: GOOD_MAPPING,
    });

    expect(response.status).toBe(200);
    batchId = response.body.data.id as string;
    // Two good rows and one the check refuses: the mapping made nothing good.
    expect(response.body.data).toMatchObject({
      state: 'checked',
      fileName: 'register.csv',
      counts: { add: 2, update: 0, skip: 0, error: 1 },
    });
    expect(response.body.data.errors).toEqual([
      { rowNumber: 4, field: 'mobile', code: 'not_bd_mobile' },
    ]);
  });

  it('records the fingerprint of the file the hospital gave, not of its rewriting (FR-IMP-08)', async () => {
    const row = await sql<{ file_sha256: string }>`
      SELECT file_sha256 FROM import_batches WHERE id = ${batchId}
    `.execute(db);
    expect(row.rows[0]?.file_sha256).toBe(
      createHash('sha256').update(REGISTER, 'utf8').digest('hex'),
    );
  });

  it('never lets an unmapped column reach the database: no address, no national id (FR-IMP-02)', async () => {
    const rows = await sql<{ raw: unknown }>`
      SELECT raw FROM import_rows WHERE batch_id = ${batchId}
    `.execute(db);
    const stored = JSON.stringify(rows.rows);

    expect(stored).toContain('Rahima Khatun');
    expect(stored).not.toContain('Mirpur');
    expect(stored).not.toContain('Dhanmondi');
    expect(stored).not.toContain('1234567890');
  });

  it('has written no patient yet: approval is still a separate act (FR-IMP-06)', async () => {
    const patients = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM patients WHERE owner_hospital_id = ${hospitalId}
    `.execute(db);
    expect(patients.rows[0]?.n).toBe('0');
  });

  it('is then previewed, corrected and committed like any import, and can be undone', async () => {
    // Approval is refused while a row is an error, exactly as for a template file.
    const refused = await post(`/hospital/imports/${batchId}/commit`, {});
    expect(refused.status).toBe(409);
    await post(`/hospital/imports/${batchId}/discard`, {});

    const fixed = REGISTER.replace(',12345,', ',01912345678,');
    const again = await post('/hospital/imports/mapped', {
      set: 'patients',
      fileName: 'register.csv',
      csv: fixed,
      mapping: GOOD_MAPPING,
    });
    expect(again.body.data.counts).toMatchObject({ add: 3, error: 0 });

    const committed = await post(`/hospital/imports/${again.body.data.id as string}/commit`, {});
    expect(committed.status).toBe(200);
    const written = await sql<{ full_name: string }>`
      SELECT full_name FROM patients WHERE owner_hospital_id = ${hospitalId} ORDER BY full_name
    `.execute(db);
    expect(written.rows.map((row) => row.full_name)).toEqual([
      'Karim Uddin (Demo)',
      'Rahima Khatun (Demo)',
      'Salma Begum (Demo)',
    ]);

    const undone = await post(`/hospital/imports/${again.body.data.id as string}/undo`, {});
    expect(undone.status).toBe(200);
    const after = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM patients
       WHERE owner_hospital_id = ${hospitalId} AND deleted_at IS NULL
    `.execute(db);
    expect(after.rows[0]?.n).toBe('0');
  });
});

describe('the same export next time (FR-IMP-20)', () => {
  it('is offered the mapping that was confirmed, including what was chosen by hand', async () => {
    // Confirm with one choice no rule would make: the blood group left out.
    const chosen = { rowType: null, fields: { ...GOOD_MAPPING.fields, blood_group: null } };
    const confirmed = await post('/hospital/imports/mapped', {
      set: 'patients',
      fileName: 'register-next-month.csv',
      csv: REGISTER.replace(',12345,', ',01912345678,'),
      mapping: chosen,
    });
    expect(confirmed.status).toBe(200);

    // Next month: same headings, different rows.
    const nextMonth = [
      'Patient ID,Patient Name,DOB,Gender,Contact No,Blood Grp,Address,NID',
      `P-${suffix}-9,New Patient (Demo),02/02/2001,M,01612345678,A+,Banani,9`,
    ].join('\n');
    const analysed = await post('/hospital/imports/analyse', { set: 'patients', csv: nextMonth });

    expect(analysed.body.data.fromSaved).toBe(true);
    const proposed = Object.fromEntries(
      (
        analysed.body.data.proposal as {
          field: string;
          column: number | null;
          source: string | null;
        }[]
      ).map((entry) => [entry.field, entry]),
    );
    expect(proposed['ref']).toMatchObject({ column: 0, source: 'saved' });
    expect(proposed['blood_group']).toMatchObject({ column: null });
    expect(await count('import_mapping_profiles')).toBe(1);
  });

  it('is one hospital’s own: another hospital with the same export starts from the rules', async () => {
    const other = await createFirstAdministrator({
      hospitalCode: `N${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      hospital: {
        nameBn: 'অন্য হাসপাতাল (ডেমো)',
        nameEn: 'Other Mapping Hospital (Demo)',
        kind: 'clinic',
        division: 'Dhaka',
        district: 'Dhaka',
      },
      email: `admin-${randomUUID().slice(0, 8)}@mapping.demo.invalid`,
      fullName: 'প্রশাসক (ডেমো)',
    });
    const otherToken = await signToken({
      kind: 'access',
      claims: {
        sub: other.staffId,
        kind: 'staff',
        hospitalId: other.hospitalId,
        roles: ['hospital_admin'],
      },
    });

    try {
      const analysed = await post(
        '/hospital/imports/analyse',
        { set: 'patients', csv: REGISTER },
        otherToken,
      );
      expect(analysed.body.data.fromSaved).toBe(false);
    } finally {
      await asOwner(async (owner) => {
        await sql`DELETE FROM staff_roles WHERE hospital_id = ${other.hospitalId}`.execute(owner);
        await sql`DELETE FROM staff_users WHERE hospital_id = ${other.hospitalId}`.execute(owner);
        await sql`DELETE FROM hospital_settings WHERE hospital_id = ${other.hospitalId}`.execute(
          owner,
        );
        await sql`DELETE FROM hospitals WHERE id = ${other.hospitalId}`.execute(owner);
      });
    }
  });
});

describe('what is kept about a mapping (FR-IMP-20)', () => {
  it('audits who confirmed which heading for which field, and from where', async () => {
    const rows = await sql<{ meta: Record<string, unknown>; actor: string | null }>`
      SELECT meta, actor_staff_id::text AS actor FROM audit_log
       WHERE hospital_id = ${hospitalId} AND meta ->> 'change' = 'import_mapping_confirmed'
       ORDER BY created_at
    `.execute(db);

    expect(rows.rows.length).toBeGreaterThanOrEqual(3);
    const first = rows.rows[0]?.meta as {
      set: string;
      fields: Record<string, { heading: string; source: string }>;
      notImported: string[];
    };
    expect(first.set).toBe('patients');
    expect(first.fields['mobile']).toEqual({ heading: 'Contact No', source: 'rule' });
    expect(first.notImported).toEqual(['Address', 'NID']);
    expect(rows.rows.every((row) => row.actor !== null)).toBe(true);

    // The last confirmation left the blood group out: that was a person's choice,
    // and what the others carried over was the saved mapping.
    const last = rows.rows.at(-1)?.meta as {
      fields: Record<string, { source: string }>;
      notImported: string[];
    };
    expect(last.fields['blood_group']).toBeUndefined();
    expect(last.notImported).toContain('Blood Grp');
  });

  it('keeps headings and positions, and no value from any row, anywhere', async () => {
    const profiles = await sql<{ mapping: unknown; sources: unknown; header_sha256: string }>`
      SELECT mapping, sources, header_sha256 FROM import_mapping_profiles
       WHERE hospital_id = ${hospitalId}
    `.execute(db);
    const audits = await sql<{ meta: unknown }>`
      SELECT meta FROM audit_log
       WHERE hospital_id = ${hospitalId} AND meta ->> 'change' = 'import_mapping_confirmed'
    `.execute(db);

    const kept = JSON.stringify([profiles.rows, audits.rows]);
    for (const value of [
      'Rahima',
      'Karim',
      'Salma',
      '01712345678',
      'Mirpur',
      '1234567890',
      suffix,
    ]) {
      expect(kept, value).not.toContain(value);
    }
    expect(profiles.rows[0]?.header_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
