import { describe, expect, it } from 'vitest';

import {
  MAX_GROUPS_LISTED,
  NO_WARNINGS,
  foldPersonName,
  hasWarnings,
  importWarnings,
  type WarnedRow,
} from '../warnings.js';

/** Rows as the check keeps them: numbered from 2, the line after the header. */
function rows(...raws: (Record<string, string> | null)[]): WarnedRow[] {
  return raws.map((raw, at) => ({ rowNumber: at + 2, raw }));
}

const patient = (
  ref: string,
  fullName: string,
  more: Record<string, string> = {},
): Record<string, string> => ({ ref, full_name: fullName, sex: 'female', ...more });

describe('foldPersonName', () => {
  it('sets case, punctuation and spacing aside', () => {
    expect(foldPersonName('  Rahima   KHATUN (Demo) ')).toBe('rahima khatun demo');
    expect(foldPersonName('Rahima Khatun (Demo)')).toBe(foldPersonName('rahima khatun demo'));
  });

  it('reads a title before a name as a title, in either script', () => {
    expect(foldPersonName('Md. Karim Uddin')).toBe('karim uddin');
    expect(foldPersonName('Mohammad Karim Uddin')).toBe('karim uddin');
    expect(foldPersonName('মোঃ করিম উদ্দিন')).toBe('করিম উদ্দিন');
    expect(foldPersonName('মোহাম্মদ করিম উদ্দিন')).toBe('করিম উদ্দিন');
  });

  it('keeps a title that is the whole name', () => {
    expect(foldPersonName('Mohammad')).toBe('mohammad');
  });
});

describe('importWarnings: patients who look like the same person (FR-IMP-21)', () => {
  it('says nothing about a file with nothing to say', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'Rahima Khatun (Demo)', { mobile: '01712345678', age_years: '38' }),
        patient('P-2', 'Karim Uddin (Demo)', { mobile: '01812345678', age_years: '51' }),
      ),
    );
    expect(warnings).toEqual(NO_WARNINGS);
    expect(hasWarnings(warnings)).toBe(false);
  });

  it('flags the same name with the same mobile number under two identifiers', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'Rahima Khatun (Demo)', { mobile: '01712345678' }),
        patient('P-2', 'Karim Uddin (Demo)', { mobile: '01812345678' }),
        patient('OLD-77', 'rahima  khatun (demo)', { mobile: '+880 1712-345678' }),
      ),
    );
    expect(warnings.samePerson).toEqual([{ rows: [2, 4], because: ['phone_and_name'] }]);
    expect(warnings.samePersonTotal).toBe(1);
    expect(hasWarnings(warnings)).toBe(true);
  });

  it('flags the same name with the same date of birth, however the date is written', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'Md. Karim Uddin (Demo)', { date_of_birth: '05/10/1975' }),
        patient('P-9', 'Mohammad Karim Uddin (Demo)', { date_of_birth: '1975-10-05' }),
      ),
    );
    expect(warnings.samePerson).toEqual([{ rows: [2, 3], because: ['name_and_birth'] }]);
  });

  it('does not flag a family sharing one phone', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'Rahima Khatun (Demo)', { mobile: '01712345678' }),
        patient('P-2', 'Karim Uddin (Demo)', { mobile: '01712345678' }),
      ),
    );
    expect(warnings.samePerson).toEqual([]);
  });

  it('does not flag two people with one name and nothing else in common', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'Rahima Khatun (Demo)', { mobile: '01712345678', age_years: '38' }),
        patient('P-2', 'Rahima Khatun (Demo)', { mobile: '01812345678', age_years: '38' }),
      ),
    );
    expect(warnings.samePerson).toEqual([]);
  });

  it('leaves the same identifier twice to the check, which refuses it', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'Rahima Khatun (Demo)', { mobile: '01712345678' }),
        patient('P-1', 'Rahima Khatun (Demo)', { mobile: '01712345678' }),
      ),
    );
    expect(warnings.samePerson).toEqual([]);
  });

  it('puts three records of one person in one group, with both reasons', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('A', 'Shirin Akter (Demo)', { mobile: '01912345678' }),
        patient('B', 'Shirin Akter (Demo)', { mobile: '01912345678', date_of_birth: '1990-01-02' }),
        patient('X', 'Somebody Else (Demo)', { mobile: '01512345678' }),
        patient('C', 'Shirin Akter (Demo)', { date_of_birth: '02/01/1990' }),
      ),
    );
    expect(warnings.samePerson).toEqual([
      { rows: [2, 3, 5], because: ['phone_and_name', 'name_and_birth'] },
    ]);
  });

  it('ignores the template’s example row and rows whose contents are gone', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('EXAMPLE-P-000001', 'উদাহরণ রোগী', { mobile: '01700000000' }),
        patient('P-1', 'উদাহরণ রোগী', { mobile: '01700000000' }),
        null,
      ),
    );
    expect(warnings.samePerson).toEqual([]);
  });

  it('lists a bounded number of groups and counts them all', () => {
    const many: Record<string, string>[] = [];
    for (let at = 0; at < MAX_GROUPS_LISTED + 5; at += 1) {
      const mobile = `017${String(10000000 + at)}`;
      many.push(patient(`A-${String(at)}`, `Person ${String(at)} (Demo)`, { mobile }));
      many.push(patient(`B-${String(at)}`, `Person ${String(at)} (Demo)`, { mobile }));
    }
    const warnings = importWarnings('patients', rows(...many));
    expect(warnings.samePerson).toHaveLength(MAX_GROUPS_LISTED);
    expect(warnings.samePersonTotal).toBe(MAX_GROUPS_LISTED + 5);
    expect(warnings.samePerson[0]).toEqual({ rows: [2, 3], because: ['phone_and_name'] });
  });

  it('looks for the same person only among patients', () => {
    const warnings = importWarnings(
      'structure',
      rows(
        { type: 'staff', ref: 'S-1', full_name: 'Same Name (Demo)', mobile: '01712345678' },
        { type: 'staff', ref: 'S-2', full_name: 'Same Name (Demo)', mobile: '01712345678' },
      ),
    );
    expect(warnings).toEqual(NO_WARNINGS);
  });
});

describe('importWarnings: a column written in more than one way (FR-IMP-21)', () => {
  it('names a date column that mixes year-first and day-first, with how many of each', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'One (Demo)', { date_of_birth: '05/10/1975' }),
        patient('P-2', 'Two (Demo)', { date_of_birth: '5-10-1980' }),
        patient('P-3', 'Three (Demo)', { date_of_birth: '1990-01-02' }),
        patient('P-4', 'Four (Demo)', { age_years: '30' }),
      ),
    );
    expect(warnings.mixedFormats).toEqual([
      {
        field: 'date_of_birth',
        kind: 'date',
        formats: [
          { format: 'day_first', rows: 2, firstRow: 2 },
          { format: 'iso', rows: 1, firstRow: 4 },
        ],
      },
    ]);
  });

  it('names a mobile column that mixes 01… and 880…', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'One (Demo)', { mobile: '01712345678' }),
        patient('P-2', 'Two (Demo)', { mobile: '8801812345678' }),
        patient('P-3', 'Three (Demo)', { mobile: '+880 1912-345678' }),
        patient('P-4', 'Four (Demo)', { mobile: '০১৫১২৩৪৫৬৭৮' }),
      ),
    );
    expect(warnings.mixedFormats).toEqual([
      {
        field: 'mobile',
        kind: 'phone',
        formats: [
          { format: 'local', rows: 2, firstRow: 2 },
          { format: 'country', rows: 2, firstRow: 3 },
        ],
      },
    ]);
  });

  it('says nothing about a column written one way throughout', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'One (Demo)', { date_of_birth: '05/10/1975', mobile: '01712345678' }),
        patient('P-2', 'Two (Demo)', { date_of_birth: '06.11.1980', mobile: '01812-345678' }),
      ),
    );
    expect(warnings.mixedFormats).toEqual([]);
  });

  it('does not count a value the check refuses as a way of writing', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'One (Demo)', { date_of_birth: '05/10/1975', mobile: '01712345678' }),
        patient('P-2', 'Two (Demo)', { date_of_birth: 'October 1980', mobile: '12345' }),
      ),
    );
    expect(warnings.mixedFormats).toEqual([]);
  });

  it('reads an appointment file’s dates the same way', () => {
    const warnings = importWarnings(
      'appointments',
      rows(
        { patient_ref: 'P-1', doctor_ref: 'D-1', date: '2026-10-20', serial: '1' },
        { patient_ref: 'P-2', doctor_ref: 'D-1', date: '21/10/2026', serial: '2' },
      ),
    );
    expect(warnings.mixedFormats).toEqual([
      {
        field: 'date',
        kind: 'date',
        formats: [
          { format: 'iso', rows: 1, firstRow: 2 },
          { format: 'day_first', rows: 1, firstRow: 3 },
        ],
      },
    ]);
    expect(warnings.samePerson).toEqual([]);
  });

  it('carries no value from any row', () => {
    const warnings = importWarnings(
      'patients',
      rows(
        patient('P-1', 'Rahima Khatun (Demo)', {
          mobile: '01712345678',
          date_of_birth: '1990-01-02',
        }),
        patient('P-2', 'Rahima Khatun (Demo)', {
          mobile: '8801712345678',
          date_of_birth: '02/01/1990',
        }),
      ),
    );
    expect(hasWarnings(warnings)).toBe(true);
    const said = JSON.stringify(warnings);
    for (const value of ['Rahima', '1712345678', '1990', 'P-1', 'P-2']) {
      expect(said).not.toContain(value);
    }
  });
});
