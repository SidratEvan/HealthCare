/**
 * The schedule notation on a prescription (`FR-DOC-04`, `FR-DOC-07`; plan R2).
 */

import { describe, expect, it } from 'vitest';

import { readMedicineRows, readSchedule, scheduleText, type MedicineRow } from '../prescription.js';

describe('readSchedule', () => {
  it('reads morning, midday and night', () => {
    expect(readSchedule('1+0+1')).toEqual({ morning: 1, midday: 0, night: 1 });
    expect(readSchedule('0+0+2')).toEqual({ morning: 0, midday: 0, night: 2 });
  });

  it('reads a half, written either way', () => {
    expect(readSchedule('½+0+½')).toEqual({ morning: 0.5, midday: 0, night: 0.5 });
    expect(readSchedule('1/2+0+1/2')).toEqual({ morning: 0.5, midday: 0, night: 0.5 });
  });

  it('reads Bengali digits and forgives spaces', () => {
    expect(readSchedule('১+০+১')).toEqual({ morning: 1, midday: 0, night: 1 });
    expect(readSchedule(' 1 + 1 + 1 ')).toEqual({ morning: 1, midday: 1, night: 1 });
  });

  it('refuses what is not the notation, rather than guessing', () => {
    for (const raw of ['', '1+1', '1+0+1+1', 'twice', '10+0+0', '1++1', '-1+0+1', '1.5+0+0']) {
      expect(readSchedule(raw), raw).toBeNull();
    }
  });

  it('refuses a schedule of no doses at all', () => {
    expect(readSchedule('0+0+0')).toBeNull();
  });
});

describe('scheduleText', () => {
  it('writes the one canonical form', () => {
    expect(scheduleText({ morning: 1, midday: 0, night: 1 })).toBe('1+0+1');
    expect(scheduleText({ morning: 0.5, midday: 0, night: 0.5 })).toBe('½+0+½');
  });

  it('writes back what it read', () => {
    for (const raw of ['1+0+1', '½+½+½', '0+1+0', '2+0+2']) {
      const read = readSchedule(raw);
      expect(read).not.toBeNull();
      if (read !== null) expect(scheduleText(read)).toBe(raw);
    }
  });
});

describe('readMedicineRows', () => {
  const row = (fields: Partial<MedicineRow>): MedicineRow => ({
    key: fields.name ?? 'row',
    medicineId: null,
    name: '',
    strength: '',
    schedule: '',
    days: '',
    instructionBn: '',
    ...fields,
  });

  it('leaves out a row with no name, so an unused row never holds a signature', () => {
    expect(readMedicineRows([row({ key: 'a' })])).toEqual({ body: [], problems: new Map() });
  });

  it('sends only what was written, the schedule in its canonical form', () => {
    const { body, problems } = readMedicineRows([
      row({
        name: ' Paracetamol ',
        medicineId: '0190d1e4-0000-7000-8000-000000000001',
        strength: '500 mg',
        schedule: '১ + ১ + ১',
        days: '৩',
        instructionBn: 'খাবারের পরে',
      }),
      row({ name: 'Cetirizine' }),
    ]);
    expect(problems.size).toBe(0);
    expect(body).toEqual([
      {
        name: 'Paracetamol',
        medicineId: '0190d1e4-0000-7000-8000-000000000001',
        strength: '500 mg',
        schedule: '1+1+1',
        durationDays: 3,
        instructionBn: 'খাবারের পরে',
      },
      { name: 'Cetirizine' },
    ]);
  });

  it('names the row and the field that is not right, and does not send it', () => {
    const { body, problems } = readMedicineRows([
      row({ key: 'x', name: 'Omeprazole', schedule: 'twice' }),
      row({ key: 'y', name: 'Metformin', days: '400' }),
    ]);
    expect(body).toEqual([]);
    expect(problems.get('x')).toEqual({ schedule: true, days: false });
    expect(problems.get('y')).toEqual({ schedule: false, days: true });
  });
});
