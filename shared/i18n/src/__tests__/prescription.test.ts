/**
 * The printed prescription is Bangla, with Bengali digits, and says only what
 * the doctor wrote (`FR-DOC-07`; plan R2).
 */

import { describe, expect, it } from 'vitest';

import { bnCalendarDate, prescriptionSheet, type SheetVisit } from '../prescription.js';

const visit: SheetVisit = {
  hospitalNameBn: 'পদ্মা জেনারেল হাসপাতাল (ডেমো)',
  doctorNameBn: 'ডা. রাশেদা খানম (ডেমো)',
  doctorBmdc: 'A-12345',
  departmentNameBn: 'মেডিসিন',
  serial: 12,
  visitedAt: '2026-10-08T05:30:00.000Z',
  diagnosisText: 'শ্বাসনালীর সংক্রমণ',
  adviceTextBn: 'বিশ্রাম নিন।',
  followUpDate: '2026-10-15',
  medicines: [
    {
      name: 'Paracetamol (Napa)',
      strength: '500 mg',
      schedule: '1+1+1',
      durationDays: 3,
      instructionBn: 'খাবারের পরে',
    },
    { name: 'Cetirizine', strength: null, schedule: null, durationDays: null, instructionBn: null },
  ],
};

describe('prescriptionSheet', () => {
  const sheet = prescriptionSheet(visit, { name: 'নাসিমা আক্তার', ageYears: 38, sex: 'female' });

  it('names the hospital, the doctor and what the doctor is registered under', () => {
    expect(sheet.hospital).toBe(visit.hospitalNameBn);
    expect(sheet.doctor).toBe(visit.doctorNameBn);
    expect(sheet.doctorLine).toBe('বিএমডিসি নং A-12345 · মেডিসিন');
  });

  it('writes the patient and the date in Bangla, with Bengali digits', () => {
    expect(sheet.patientLine).toBe('রোগী: নাসিমা আক্তার · বয়স ৩৮ · নারী');
    expect(sheet.dateLine).toContain('অক্টোবর');
    expect(sheet.dateLine).toContain('সিরিয়াল ১২');
    expect(sheet.dateLine).not.toMatch(/[0-9]/);
  });

  it('prints each medicine as the doctor wrote it, schedule in Bengali digits', () => {
    expect(sheet.medicines[0]).toEqual({
      name: 'Paracetamol (Napa)',
      detail: '500 mg · ১+১+১ · ৩ দিন',
      instruction: 'খাবারের পরে',
    });
    // Nothing invented for what was left blank.
    expect(sheet.medicines[1]).toEqual({ name: 'Cetirizine', detail: null, instruction: null });
  });

  it('gives the follow-up as a Bangla date', () => {
    expect(sheet.followUp).toBe(bnCalendarDate('2026-10-15'));
    expect(sheet.followUp).toContain('অক্টোবর');
  });

  it('leaves the patient off when the printing screen does not know them', () => {
    expect(prescriptionSheet(visit, null).patientLine).toBeNull();
  });
});
