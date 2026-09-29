import { describe, expect, it } from 'vitest';

import { parseCsv } from '../csv.js';
import {
  IMPORT_COLUMNS,
  columnIndex,
  missingColumns,
  readDate,
  readRow,
  readTime,
  readWeekday,
  takaToPoisha,
  templateCsv,
  type ImportSet,
} from '../sets.js';

function row(set: ImportSet, values: Record<string, string>) {
  const header = IMPORT_COLUMNS[set];
  return readRow(
    set,
    header.map((column) => values[column] ?? ''),
    columnIndex(set, header),
  );
}

describe('reading what a Bangladeshi spreadsheet holds (FR-IMP-05)', () => {
  it('reads dates day first, and refuses a date that does not exist', () => {
    expect(readDate('05/10/2026')).toBe('2026-10-05');
    expect(readDate('5-10-2026')).toBe('2026-10-05');
    expect(readDate('2026-10-05')).toBe('2026-10-05');
    expect(readDate('০৫/১০/২০২৬')).toBe('2026-10-05');
    expect(readDate('31/02/2026')).toBeNull();
    expect(readDate('tomorrow')).toBeNull();
  });

  it('reads times on either clock', () => {
    expect(readTime('17:00')).toBe('17:00');
    expect(readTime('5:00 PM')).toBe('17:00');
    expect(readTime('5 pm')).toBe('17:00');
    expect(readTime('12:30 am')).toBe('00:30');
    expect(readTime('১৭:০০')).toBe('17:00');
    expect(readTime('17')).toBeNull();
    expect(readTime('25:00')).toBeNull();
  });

  it('reads weekdays in both languages, Monday as 1', () => {
    expect(readWeekday('Saturday')).toBe(6);
    expect(readWeekday('sat')).toBe(6);
    expect(readWeekday('শনিবার')).toBe(6);
    expect(readWeekday('রবি')).toBe(7);
    expect(readWeekday('1')).toBe(1);
    expect(readWeekday('8')).toBeNull();
  });

  it('reads taka as written, into poisha (DB-P5)', () => {
    expect(takaToPoisha('800')).toBe(80_000);
    expect(takaToPoisha('1,500')).toBe(150_000);
    expect(takaToPoisha('৳৮০০')).toBe(80_000);
    expect(takaToPoisha('800.5')).toBe(80_050);
    expect(takaToPoisha('eight hundred')).toBeNull();
  });
});

describe('set B — the patient register', () => {
  it('normalises the mobile (DB-P6) and keeps nothing it was not asked for', () => {
    const result = row('patients', {
      ref: 'P-1',
      full_name: 'রহিমা খাতুন (ডেমো)',
      date_of_birth: '01/02/1980',
      sex: 'F',
      mobile: '০১৭১২ ৩৪৫৬৭৮',
      blood_group: 'o+ve',
    });
    expect(result).toEqual({
      ok: true,
      record: {
        ref: 'P-1',
        fullName: 'রহিমা খাতুন (ডেমো)',
        dateOfBirth: '1980-02-01',
        ageYears: null,
        sex: 'female',
        phone: '+8801712345678',
        bloodGroup: 'O+',
      },
    });
  });

  it('names every problem in the row, with its field', () => {
    const result = row('patients', {
      ref: 'P-2',
      sex: 'unknown',
      mobile: '12345',
      blood_group: 'Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { field: 'full_name', code: 'required' },
        { field: 'age_years', code: 'required' },
        { field: 'sex', code: 'unknown_value' },
        { field: 'mobile', code: 'not_bd_mobile' },
        { field: 'blood_group', code: 'unknown_value' },
      ]),
    );
  });
});

describe('set A — structure', () => {
  it('reads each kind of row', () => {
    expect(
      row('structure', {
        type: 'schedule',
        ref: 'S-1',
        doctor_ref: 'DR-1',
        weekday: 'শনিবার',
        start: '5:00 pm',
        end: '9:00 pm',
        serials: '30',
      }),
    ).toEqual({
      ok: true,
      record: {
        type: 'schedule',
        ref: 'S-1',
        doctorRef: 'DR-1',
        weekday: 6,
        startTime: '17:00',
        endTime: '21:00',
        capacity: 30,
      },
    });
    const doctor = row('structure', {
      type: 'doctor',
      ref: 'DR-1',
      name_bn: 'ডা. ক (ডেমো)',
      name_en: 'Dr K (Demo)',
      bmdc_number: 'a-12345',
      specialties: 'Internal Medicine; cardiology',
      department_ref: 'D-1',
      fee_taka: '800',
    });
    expect(doctor.ok && doctor.record).toMatchObject({
      bmdcNumber: 'A-12345',
      specialties: ['internal_medicine', 'cardiology'],
      feePoisha: 80_000,
    });
  });

  it('refuses a type it does not know, a chamber that ends before it starts, and a facility role it cannot give', () => {
    const unknown = row('structure', { type: 'nurse', ref: 'X' });
    expect(unknown.ok ? [] : unknown.errors).toEqual([{ field: 'type', code: 'unknown_type' }]);

    const backwards = row('structure', {
      type: 'schedule',
      ref: 'S-2',
      doctor_ref: 'DR-1',
      weekday: '1',
      start: '21:00',
      end: '17:00',
    });
    expect(backwards.ok ? [] : backwards.errors).toEqual([
      { field: 'end', code: 'end_before_start' },
    ]);

    const platform = row('structure', {
      type: 'staff',
      ref: 'ST-1',
      name_en: 'Someone (Demo)',
      email: 'someone@example.invalid',
      role: 'platform_admin',
    });
    expect(platform.ok ? [] : platform.errors).toEqual([{ field: 'role', code: 'unknown_value' }]);
  });
});

describe('set C — appointments', () => {
  it('keys an appointment by patient, doctor and day, and reads paid in either language', () => {
    const result = row('appointments', {
      patient_ref: 'P-1',
      doctor_ref: 'DR-1',
      date: '03/10/2026',
      start: '17:00',
      serial: '৫',
      paid: 'হ্যাঁ',
    });
    expect(result).toEqual({
      ok: true,
      record: {
        ref: 'P-1|DR-1|2026-10-03',
        patientRef: 'P-1',
        doctorRef: 'DR-1',
        date: '2026-10-03',
        startTime: '17:00',
        serial: 5,
        paid: true,
      },
    });
  });
});

describe('templates (FR-IMP-09)', () => {
  it.each(['structure', 'patients', 'appointments'] as const)(
    'the %s template reads back with its own columns and example rows marked as examples',
    (set) => {
      const table = parseCsv(templateCsv(set));
      if (typeof table === 'string') throw new Error(table);
      expect(missingColumns(set, table.header)).toEqual([]);
      expect(table.rows.length).toBeGreaterThan(0);
      const index = columnIndex(set, table.header);
      for (const entry of table.rows) {
        const read = readRow(set, entry.cells, index);
        expect(read.ok, JSON.stringify(read)).toBe(true);
        if (read.ok) expect(read.record.ref.startsWith('EXAMPLE')).toBe(true);
      }
    },
  );

  it('names the columns a wrong file is missing', () => {
    expect(missingColumns('patients', ['ref', 'name'])).toEqual(['full_name', 'sex']);
  });
});
