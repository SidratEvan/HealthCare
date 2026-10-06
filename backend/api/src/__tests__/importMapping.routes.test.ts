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

import type { ModelMappingRequest } from '@platform/domain';

import {
  resetMappingProvider,
  setMappingProvider,
  type MappingAnswer,
} from '../adapters/mapping.js';
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

describe('a model’s suggestions, on top of the rules (FR-IMP-16, FR-IMP-17)', () => {
  /** A register whose headings no rule knows, except the one phone column. */
  const AWKWARD = [
    'MR#,Pt. Nm,Yrs,Sx,Pt. Cell,Vill,Father',
    `A-${suffix}-1,Rahima Khatun (Demo),38,F,01712345678,Mirpur,Abdul Karim (Demo)`,
    `A-${suffix}-2,Karim Uddin (Demo),51,M,01812345678,Dhanmondi,Rahim Uddin (Demo)`,
  ].join('\r\n');

  /** Stands in for the model: records what it was asked, answers as told. */
  function fakeModel(answer: MappingAnswer | (() => never)): { asked: ModelMappingRequest[] } {
    const asked: ModelMappingRequest[] = [];
    setMappingProvider({
      name: 'fake',
      propose: async (request) => {
        asked.push(request);
        if (typeof answer === 'function') return answer();
        return await Promise.resolve(answer);
      },
    });
    return { asked };
  }

  const SUGGESTIONS: MappingAnswer = {
    kind: 'suggestions',
    suggestions: [
      { field: 'ref', column: 0, confidence: 'high', reason: 'MR# is a medical record number.' },
      {
        field: 'full_name',
        column: 1,
        confidence: 'high',
        reason: 'Pt. Nm abbreviates patient name.',
      },
      { field: 'age_years', column: 2, confidence: 'medium', reason: 'Yrs is age in years.' },
      { field: 'sex', column: 3, confidence: 'medium', reason: 'Sx abbreviates sex.' },
      // What a model must never get through: a field the template lacks, a
      // column a rule already used, a column that does not exist.
      { field: 'guardian', column: 6, confidence: 'high', reason: 'Father is the guardian.' },
      { field: 'blood_group', column: 4, confidence: 'high', reason: 'Overriding the rule.' },
      { field: 'date_of_birth', column: 40, confidence: 'low', reason: 'No such column.' },
    ],
  };

  afterAll(() => {
    resetMappingProvider();
  });

  it('with no model configured, the rules stand alone and nobody is asked', async () => {
    resetMappingProvider();
    const response = await post('/hospital/imports/analyse', { set: 'patients', csv: AWKWARD });
    const data = response.body.data as {
      model: string;
      proposal: { field: string; column: number | null; source: string | null }[];
    };

    expect(data.model).toBe('not_asked');
    // The one thing a rule could place: the only phone column.
    expect(data.proposal.find((entry) => entry.field === 'mobile')).toMatchObject({
      column: 4,
      source: 'rule',
    });
    expect(data.proposal.find((entry) => entry.field === 'ref')?.column).toBeNull();
  });

  it('is asked only about what the rules left open, and is sent no value from any row', async () => {
    const model = fakeModel(SUGGESTIONS);
    await post('/hospital/imports/analyse', { set: 'patients', csv: AWKWARD });

    expect(model.asked).toHaveLength(1);
    const sent = JSON.stringify(model.asked[0]);
    for (const value of ['Rahima', 'Karim', 'Abdul', '01712345678', 'Mirpur', suffix]) {
      expect(sent, value).not.toContain(value);
    }
    expect(model.asked[0]?.columns.map((column) => column.heading)).toEqual([
      'MR#',
      'Pt. Nm',
      'Yrs',
      'Sx',
      'Vill',
      'Father',
    ]);
    expect(model.asked[0]?.fields.map((field) => field.field)).not.toContain('mobile');
  });

  it('fills the gaps with its suggestions, each marked as its own and with its reason', async () => {
    fakeModel(SUGGESTIONS);
    const response = await post('/hospital/imports/analyse', { set: 'patients', csv: AWKWARD });
    const data = response.body.data as {
      model: string;
      proposal: {
        field: string;
        column: number | null;
        source: string | null;
        note?: string;
        confidence: number | null;
      }[];
    };
    const by = Object.fromEntries(data.proposal.map((entry) => [entry.field, entry]));

    expect(data.model).toBe('used');
    expect(by['ref']).toMatchObject({
      column: 0,
      source: 'model',
      note: 'MR# is a medical record number.',
    });
    expect(by['sex']).toMatchObject({ column: 3, source: 'model' });
    // The rule's own choice is untouched, and nothing unasked got in.
    expect(by['mobile']).toMatchObject({ column: 4, source: 'rule' });
    expect(by['blood_group']?.column).toBeNull();
    expect(by['date_of_birth']?.column).toBeNull();
    expect(by['guardian']).toBeUndefined();
  });

  it('carries on with the rules when the model cannot answer, and says so', async () => {
    fakeModel({ kind: 'unavailable', reason: 'timeout' });
    const slow = await post('/hospital/imports/analyse', { set: 'patients', csv: AWKWARD });
    expect(slow.status).toBe(200);
    expect(slow.body.data.model).toBe('unavailable');
    expect(
      (slow.body.data.proposal as { field: string; column: number | null }[]).find(
        (entry) => entry.field === 'mobile',
      )?.column,
    ).toBe(4);

    // Even one that throws, which a provider must not do.
    fakeModel(() => {
      throw new Error('provider exploded');
    });
    const broken = await post('/hospital/imports/analyse', { set: 'patients', csv: AWKWARD });
    expect(broken.status).toBe(200);
    expect(broken.body.data.model).toBe('unavailable');
  });

  it('is not asked when this hospital has already confirmed a mapping for these headings', async () => {
    const model = fakeModel(SUGGESTIONS);
    // The register from the earlier tests: confirmed, so remembered.
    const response = await post('/hospital/imports/analyse', { set: 'patients', csv: REGISTER });

    expect(response.body.data).toMatchObject({ fromSaved: true, model: 'not_asked' });
    expect(model.asked).toHaveLength(0);
  });

  it('is still only a proposal: confirmed by a person, checked by the importer, audited as the model’s', async () => {
    fakeModel(SUGGESTIONS);
    const confirmed = await post('/hospital/imports/mapped', {
      set: 'patients',
      fileName: 'awkward.csv',
      csv: AWKWARD,
      // What the administrator confirmed: the model's four and the rule's one.
      mapping: { rowType: null, fields: { ref: 0, full_name: 1, age_years: 2, sex: 3, mobile: 4 } },
      suggestedByModel: ['ref', 'full_name', 'age_years', 'sex', 'mobile'],
    });

    expect(confirmed.status).toBe(200);
    // The same check as any import decided what is importable.
    expect(confirmed.body.data.counts).toMatchObject({ add: 2, error: 0 });

    const audit = await sql<{
      meta: { fields: Record<string, { heading: string; source: string }> };
    }>`
      SELECT meta FROM audit_log
       WHERE hospital_id = ${hospitalId} AND subject_id = ${confirmed.body.data.id as string}
         AND meta ->> 'change' = 'import_mapping_confirmed'
    `.execute(db);
    const fields = audit.rows[0]?.meta.fields ?? {};

    expect(fields['ref']).toEqual({ heading: 'MR#', source: 'model' });
    expect(fields['sex']).toEqual({ heading: 'Sx', source: 'model' });
    // Saying the model suggested it does not make it so: a rule placed this one.
    expect(fields['mobile']).toEqual({ heading: 'Pt. Cell', source: 'rule' });

    await post(`/hospital/imports/${confirmed.body.data.id as string}/discard`, {});
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

    // The confirmation that left the blood group out: that was a person's
    // choice, and it is on the record as a column not imported.
    const leftOut = rows.rows
      .map((row) => row.meta as { fields: Record<string, unknown>; notImported: string[] })
      .find((meta) => meta.notImported.includes('Blood Grp'));
    expect(leftOut).toBeDefined();
    expect(leftOut?.fields['blood_group']).toBeUndefined();
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
