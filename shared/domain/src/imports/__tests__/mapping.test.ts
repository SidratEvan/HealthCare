/**
 * Mapping a hospital's own export onto the template (`FR-IMP-13`–`19`).
 *
 * Every file here is synthetic (`FR-IMP-11`, `FR-SEC-08`): the headings are
 * the kind hospitals' systems export, the rows are made up.
 */

import { describe, expect, it } from 'vitest';

import { parseCsv, type CsvTable } from '../csv.js';
import {
  STRUCTURE_TYPES,
  applyMapping,
  foldHeading,
  guessStructureType,
  hasTemplateHeader,
  headerLooksLikeData,
  headerSignature,
  kindOfValue,
  mappingProblems,
  profileColumns,
  proposeMapping,
  targetFields,
  unmappedColumns,
  type ColumnMapping,
  type MappingTarget,
} from '../mapping.js';
import { IMPORT_COLUMNS, columnIndex, readRow } from '../sets.js';

function table(text: string): CsvTable {
  const parsed = parseCsv(text);
  if (typeof parsed === 'string') throw new Error(`could not parse: ${parsed}`);
  return parsed;
}

/** A patient register as a hospital system exports it. */
const PATIENT_EXPORT = table(
  [
    'Patient ID,Patient Name,DOB,Gender,Contact No,Blood Grp,Address,NID',
    'P-1001,Rahima Khatun (Demo),05/03/1988,F,01712345678,B+,"House 4, Mirpur",1234567890',
    'P-1002,Karim Uddin (Demo),12/11/1975,M,01812345678,O+,"Road 7, Dhanmondi",2345678901',
    'P-1003,Salma Begum (Demo),,Female,01912345678,,Uttara,',
  ].join('\n'),
);

/** The same register with Bangla headings and an age instead of a birth date. */
const BANGLA_EXPORT = table(
  [
    'রোগীর আইডি,রোগীর নাম,বয়স,লিঙ্গ,মোবাইল নম্বর',
    'P-2001,রহিমা খাতুন (ডেমো),৩৪,মহিলা,০১৭১২৩৪৫৬৭৮',
    'P-2002,করিম উদ্দিন (ডেমো),৫১,পুরুষ,০১৮১২৩৪৫৬৭৮',
  ].join('\n'),
);

const DOCTOR_EXPORT = table(
  [
    'Doctor ID,Doctor Name,Bangla Name,BMDC Reg No,Qualification,Department,Room No,Consultation Fee',
    'D-01,Dr Ayesha (Demo),ডা. আয়েশা (ডেমো),A-12345,MBBS FCPS,CARD,204,800',
    'D-02,Dr Karim (Demo),ডা. করিম (ডেমো),A-23456,MBBS MD,MED,101,"1,000"',
  ].join('\n'),
);

const PATIENTS: MappingTarget = { set: 'patients', rowType: null };

function proposalFor(
  target: MappingTarget,
  file: CsvTable,
): Record<string, { column: string | null; reason: string | null; confidence: number | null }> {
  const columns = profileColumns(file);
  return Object.fromEntries(
    proposeMapping(target, columns).map((proposal) => [
      proposal.field,
      {
        column: proposal.column === null ? null : (columns[proposal.column]?.name ?? null),
        reason: proposal.reason,
        confidence: proposal.confidence,
      },
    ]),
  );
}

describe('the kind of a value', () => {
  it.each([
    ['01712345678', 'phone'],
    ['+8801712345678', 'phone'],
    ['০১৭১২৩৪৫৬৭৮', 'phone'],
    ['05/03/1988', 'date'],
    ['2026-10-05', 'date'],
    ['5:30 PM', 'time'],
    ['17:00', 'time'],
    ['34', 'integer'],
    ['৩৪', 'integer'],
    ['800.50', 'money'],
    ['someone@example.org', 'email'],
    ['Rahima Khatun', 'text'],
    ['', 'empty'],
    ['   ', 'empty'],
  ])('reads %s as %s', (value, kind) => {
    expect(kindOfValue(value)).toBe(kind);
  });
});

describe('a column’s profile (FR-IMP-14)', () => {
  const columns = profileColumns(PATIENT_EXPORT);
  const byName = Object.fromEntries(columns.map((column) => [column.name, column.profile]));

  it('says what each column holds', () => {
    expect(byName['Contact No']?.kind).toBe('phone');
    expect(byName['DOB']?.kind).toBe('date');
    expect(byName['Patient Name']?.kind).toBe('text');
    expect(byName['Patient ID']?.kind).toBe('text');
  });

  it('says how full and how varied, never what', () => {
    expect(byName['Contact No']).toMatchObject({ filled: 1, distinct: 'unique' });
    expect(byName['DOB']?.filled).toBeCloseTo(0.67, 2);

    // The property the model adapter rests on (FR-IMP-17): nothing in a
    // profile is a value from a row.
    const serialised = JSON.stringify(columns);
    for (const value of ['Rahima', 'Karim', '01712345678', 'Mirpur', '1234567890', 'P-1001']) {
      expect(serialised).not.toContain(value);
    }
  });

  it('calls a column with nothing in it empty', () => {
    const sparse = table('a,b\nx,\ny,\n');
    expect(profileColumns(sparse)[1]?.profile).toMatchObject({ kind: 'empty', distinct: 'none' });
  });

  it('counts whole numbers and decimals together as money', () => {
    const fees = table('Fee\n800\n800.50\n1000\n1200.75\n');
    expect(profileColumns(fees)[0]?.profile.kind).toBe('money');
  });
});

describe('a first row that is a patient, not headings (FR-IMP-14)', () => {
  it('is caught by a phone number, a date or an email in it', () => {
    expect(headerLooksLikeData(['P-1001', 'Rahima Khatun', '01712345678'])).toBe(true);
    expect(headerLooksLikeData(['Rahima Khatun', '05/03/1988', 'F'])).toBe(true);
    expect(headerLooksLikeData(['Admin', 'admin@example.org'])).toBe(true);
  });

  it('is caught when it is mostly numbers, or nothing', () => {
    expect(headerLooksLikeData(['1', '34', 'F'])).toBe(true);
    expect(headerLooksLikeData(['', ''])).toBe(true);
  });

  it('lets real headings through, in either language', () => {
    expect(headerLooksLikeData(PATIENT_EXPORT.header)).toBe(false);
    expect(headerLooksLikeData(BANGLA_EXPORT.header)).toBe(false);
    expect(headerLooksLikeData(['Sl', 'Name', 'Age', 'Phone 1', 'Phone 2'])).toBe(false);
  });
});

describe('a file already in the template’s shape (FR-IMP-13)', () => {
  it('is recognised, whatever the case and order of its columns', () => {
    expect(hasTemplateHeader('patients', ['Sex', 'REF', 'full_name', 'mobile'])).toBe(true);
    expect(hasTemplateHeader('patients', PATIENT_EXPORT.header)).toBe(false);
    expect(hasTemplateHeader('structure', ['type', 'ref', 'name_en'])).toBe(true);
  });
});

describe('what the rules propose (FR-IMP-15)', () => {
  it('places an English patient register, and says why for each column', () => {
    const proposal = proposalFor(PATIENTS, PATIENT_EXPORT);

    expect(proposal['ref']).toMatchObject({ column: 'Patient ID', reason: 'known_name' });
    expect(proposal['full_name']).toMatchObject({ column: 'Patient Name', reason: 'known_name' });
    expect(proposal['date_of_birth']).toMatchObject({ column: 'DOB', reason: 'known_name' });
    expect(proposal['sex']).toMatchObject({ column: 'Gender', reason: 'known_name' });
    expect(proposal['mobile']).toMatchObject({ column: 'Contact No', reason: 'known_name' });
    expect(proposal['blood_group']).toMatchObject({ column: 'Blood Grp', reason: 'known_name' });
    // No age column in this file.
    expect(proposal['age_years']).toMatchObject({ column: null, reason: null, confidence: null });
  });

  it('is surer when the values agree with the name', () => {
    const proposal = proposalFor(PATIENTS, PATIENT_EXPORT);
    // A column called "Contact No" that holds phone numbers.
    expect(proposal['mobile']?.confidence).toBeGreaterThan(proposal['ref']?.confidence ?? 1);
  });

  it('places a Bangla register', () => {
    const proposal = proposalFor(PATIENTS, BANGLA_EXPORT);

    expect(proposal['ref']?.column).toBe('রোগীর আইডি');
    expect(proposal['full_name']?.column).toBe('রোগীর নাম');
    expect(proposal['age_years']?.column).toBe('বয়স');
    expect(proposal['sex']?.column).toBe('লিঙ্গ');
    expect(proposal['mobile']?.column).toBe('মোবাইল নম্বর');
  });

  it('never proposes what must not be imported: an address and a national id (FR-IMP-02)', () => {
    const columns = profileColumns(PATIENT_EXPORT);
    const proposed = new Set(proposeMapping(PATIENTS, columns).map((proposal) => proposal.column));
    const address = columns.find((column) => column.name === 'Address')?.index;
    const nid = columns.find((column) => column.name === 'NID')?.index;

    expect(proposed.has(address ?? -1)).toBe(false);
    expect(proposed.has(nid ?? -1)).toBe(false);
  });

  it('takes the template’s own names with the most confidence', () => {
    const own = table('ref,full_name,sex,mobile\nP-1,A (Demo),f,01712345678\n');
    const proposal = proposalFor(PATIENTS, own);

    expect(proposal['ref']).toMatchObject({ reason: 'same_name', confidence: 1 });
    expect(proposal['mobile']).toMatchObject({ reason: 'same_name', confidence: 1 });
  });

  it('places a column by a name that contains a known one', () => {
    const file = table(
      'Reg,Name of Patient,Patient Mobile Number,Sex\nP-1,A (Demo),01712345678,F\n',
    );
    const proposal = proposalFor(PATIENTS, file);

    expect(proposal['mobile']).toMatchObject({
      column: 'Patient Mobile Number',
      reason: 'similar_name',
    });
  });

  it('places the only phone column as the mobile, whatever it is called', () => {
    const file = table(
      'Code,Person,Sex,Reach At\nP-1,A (Demo),F,01712345678\nP-2,B (Demo),M,01812345678\n',
    );
    const proposal = proposalFor(PATIENTS, file);

    expect(proposal['mobile']).toMatchObject({
      column: 'Reach At',
      reason: 'shape',
      confidence: 0.5,
    });
  });

  it('does not guess between two phone columns', () => {
    const file = table('Code,Person,Sex,Home,Office\nP-1,A (Demo),F,01712345678,01812345678\n');
    expect(proposalFor(PATIENTS, file)['mobile']?.column).toBeNull();
  });

  it('gives one column to one field', () => {
    const columns = profileColumns(DOCTOR_EXPORT);
    const used = proposeMapping({ set: 'structure', rowType: 'doctor' }, columns)
      .map((proposal) => proposal.column)
      .filter((column) => column !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('proposes the same thing for the same file, every time', () => {
    const columns = profileColumns(DOCTOR_EXPORT);
    const target: MappingTarget = { set: 'structure', rowType: 'doctor' };
    expect(proposeMapping(target, columns)).toEqual(proposeMapping(target, columns));
  });

  it('proposes nothing for headings it does not know', () => {
    const file = table('Alpha,Beta,Gamma\nx,y,z\n');
    expect(
      proposeMapping(PATIENTS, profileColumns(file)).every((entry) => entry.column === null),
    ).toBe(true);
  });
});

describe('a structure file is one kind of row', () => {
  it('guesses a doctors list', () => {
    expect(guessStructureType(profileColumns(DOCTOR_EXPORT))).toBe('doctor');
  });

  it('guesses a bed list', () => {
    const beds = table(
      'Bed ID,Ward,Bed No,Bed Type,Rate\nB1,W1,301,cabin,2500\nB2,W1,302,cabin,2500\n',
    );
    expect(guessStructureType(profileColumns(beds))).toBe('bed');
  });

  it('guesses nothing for a file that is none of them', () => {
    expect(guessStructureType(profileColumns(table('Alpha,Beta\nx,y\n')))).toBeNull();
  });

  it('has fields for every kind, each a column the template has', () => {
    for (const type of STRUCTURE_TYPES) {
      const fields = targetFields({ set: 'structure', rowType: type });
      expect(fields.length, type).toBeGreaterThan(0);
      for (const field of fields) {
        expect(IMPORT_COLUMNS.structure as readonly string[], `${type}.${field.field}`).toContain(
          field.field,
        );
      }
    }
    for (const set of ['patients', 'appointments'] as const) {
      for (const field of targetFields({ set, rowType: null })) {
        expect(IMPORT_COLUMNS[set] as readonly string[]).toContain(field.field);
      }
    }
  });
});

describe('a mapping somebody confirmed (FR-IMP-18)', () => {
  const good: ColumnMapping = {
    rowType: null,
    fields: { ref: 0, full_name: 1, date_of_birth: 2, sex: 3, mobile: 4, blood_group: 5 },
  };

  it('is accepted when every required field has a column', () => {
    expect(mappingProblems('patients', good, 8)).toEqual([]);
  });

  it('names a required field with no column', () => {
    const missing: ColumnMapping = { rowType: null, fields: { ...good.fields, sex: null } };
    expect(mappingProblems('patients', missing, 8)).toEqual([
      { kind: 'required_unmapped', field: 'sex' },
    ]);
  });

  it('needs a date of birth or an age, and either will do', () => {
    const neither: ColumnMapping = {
      rowType: null,
      fields: { ...good.fields, date_of_birth: null },
    };
    expect(mappingProblems('patients', neither, 8)).toEqual([
      { kind: 'one_of_unmapped', fields: ['date_of_birth', 'age_years'] },
    ]);
    expect(
      mappingProblems(
        'patients',
        { rowType: null, fields: { ...neither.fields, age_years: 6 } },
        8,
      ),
    ).toEqual([]);
  });

  it('refuses a field the template does not have and a column the file does not have', () => {
    expect(
      mappingProblems('patients', { rowType: null, fields: { ...good.fields, national_id: 7 } }, 8),
    ).toContainEqual({ kind: 'unknown_field', field: 'national_id' });
    expect(
      mappingProblems('patients', { rowType: null, fields: { ...good.fields, mobile: 40 } }, 8),
    ).toContainEqual({ kind: 'no_such_column', field: 'mobile' });
  });

  it('needs to know which kind of row a structure file holds', () => {
    expect(mappingProblems('structure', { rowType: null, fields: {} }, 8)).toEqual([
      { kind: 'row_type_required' },
    ]);
  });

  it('lists the columns it leaves out, so they can be shown as not imported', () => {
    const left = unmappedColumns(good, profileColumns(PATIENT_EXPORT)).map((column) => column.name);
    expect(left).toEqual(['Address', 'NID']);
  });
});

describe('rewriting a file into the template’s shape (FR-IMP-19)', () => {
  const mapping: ColumnMapping = {
    rowType: null,
    fields: { ref: 0, full_name: 1, date_of_birth: 2, sex: 3, mobile: 4, blood_group: 5 },
  };

  it('produces a file the existing check reads, row for row', () => {
    const rewritten = table(applyMapping('patients', PATIENT_EXPORT, mapping));

    expect(rewritten.header).toEqual(IMPORT_COLUMNS.patients);
    expect(rewritten.rows).toHaveLength(PATIENT_EXPORT.rows.length);

    const index = columnIndex('patients', rewritten.header);
    const first = readRow('patients', rewritten.rows[0]?.cells ?? [], index);
    expect(first).toEqual({
      ok: true,
      record: {
        ref: 'P-1001',
        fullName: 'Rahima Khatun (Demo)',
        dateOfBirth: '1988-03-05',
        ageYears: null,
        sex: 'female',
        phone: '+8801712345678',
        bloodGroup: 'B+',
      },
    });
  });

  it('leaves out what was not mapped: the address and the national id never reach the check', () => {
    const rewritten = applyMapping('patients', PATIENT_EXPORT, mapping);
    expect(rewritten).not.toContain('Mirpur');
    expect(rewritten).not.toContain('1234567890');
  });

  it('does not make a bad row good: the check still decides', () => {
    // The third patient has neither a birth date nor an age.
    const rewritten = table(applyMapping('patients', PATIENT_EXPORT, mapping));
    const index = columnIndex('patients', rewritten.header);
    const third = readRow('patients', rewritten.rows[2]?.cells ?? [], index);

    expect(third.ok).toBe(false);
  });

  it('fills a structure file’s type with the kind of row the mapping names', () => {
    const doctorMapping: ColumnMapping = {
      rowType: 'doctor',
      fields: {
        ref: 0,
        name_en: 1,
        name_bn: 2,
        bmdc_number: 3,
        degrees: 4,
        department_ref: 5,
        room: 6,
        fee_taka: 7,
      },
    };
    expect(mappingProblems('structure', doctorMapping, 8)).toEqual([]);

    const rewritten = table(applyMapping('structure', DOCTOR_EXPORT, doctorMapping));
    const index = columnIndex('structure', rewritten.header);
    const second = readRow('structure', rewritten.rows[1]?.cells ?? [], index);

    expect(second).toMatchObject({
      ok: true,
      record: { type: 'doctor', ref: 'D-02', bmdcNumber: 'A-23456', feePoisha: 100_000 },
    });
  });

  it('keeps a value with a comma or a quote in it whole', () => {
    const file = table('Code,Person,Sex,Age\nP-1,"Khan, ""Dr"" A (Demo)",F,40\n');
    const rewritten = table(
      applyMapping('patients', file, {
        rowType: null,
        fields: { ref: 0, full_name: 1, sex: 2, age_years: 3 },
      }),
    );
    const index = columnIndex('patients', rewritten.header);
    expect(rewritten.rows[0]?.cells[index['full_name'] ?? -1]).toBe('Khan, "Dr" A (Demo)');
  });
});

describe('recognising the same export again (FR-IMP-20)', () => {
  it('ignores case, spacing and separators in the headings', () => {
    expect(headerSignature(['Patient ID', 'Patient_Name'])).toBe(
      headerSignature(['patient  id', 'PATIENT-NAME']),
    );
    expect(foldHeading('  Contact_No. ')).toBe('contact no');
  });

  it('tells two different exports apart, and the same headings in another order', () => {
    expect(headerSignature(['Patient ID', 'Name'])).not.toBe(
      headerSignature(['Patient ID', 'DOB']),
    );
    expect(headerSignature(['Name', 'Patient ID'])).not.toBe(
      headerSignature(['Patient ID', 'Name']),
    );
  });
});
