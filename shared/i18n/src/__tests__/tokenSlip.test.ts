/**
 * The token slip is Bangla with Bengali digits, prints the live estimate with
 * the time it was printed, and never a time it does not have (`FR-REC-21`).
 */

import { describe, expect, it } from 'vitest';

import { tokenSlip, type SlipBooking } from '../tokenSlip.js';

const booking: SlipBooking = {
  serial: 14,
  hospitalNameBn: 'পদ্মা জেনারেল হাসপাতাল (ডেমো)',
  doctorNameBn: 'ডা. রাশেদা খানম (ডেমো)',
  room: '204',
  sessionDate: '2026-11-06',
  // 17:00–21:00 Dhaka.
  plannedStart: '2026-11-06T11:00:00.000Z',
  plannedEnd: '2026-11-06T15:00:00.000Z',
  estimate: { etaAt: '2026-11-06T12:30:00.000Z', bandMinutes: 10, patientsAhead: 3 },
  trackingUrl: 'https://app.example/s?b=x&t=y',
};

describe('tokenSlip (FR-REC-21)', () => {
  it('prints the serial, the doctor and the estimate in Bangla digits', () => {
    const slip = tokenSlip(booking, '2026-11-06T11:40:00.000Z', false);
    expect(slip.serial).toBe('১৪');
    expect(slip.doctor).toBe(booking.doctorNameBn);
    expect(slip.room).toBe('রুম ২০৪');
    expect(slip.chamberLine).toContain('বিকাল ৫:০০');
    expect(slip.chamberLine).toContain('রাত ৯:০০');
    expect(slip.estimateLine).toBe('আনুমানিক সময়: সন্ধ্যা ৬:৩০ (± ১০ মিনিট)');
    expect(slip.aheadLine).toBe('আপনার আগে আছেন ৩ জন');
    expect(slip.printedLine).toContain('বিকাল ৫:৪০');
    expect(slip.scanLine).not.toBeNull();
    expect(slip.demoLine).toBeNull();
    expect(JSON.stringify(slip)).not.toMatch(/[0-9]/u);
  });

  it('says there is no estimate yet rather than guess one', () => {
    const slip = tokenSlip({ ...booking, estimate: null }, '2026-11-06T11:40:00.000Z', false);
    expect(slip.estimateLine).toBe('আনুমানিক সময় এখনো বলা যাচ্ছে না');
    expect(slip.aheadLine).toBeNull();
  });

  it('has no scan line without a link, and labels a demonstration', () => {
    const slip = tokenSlip({ ...booking, trackingUrl: null }, '2026-11-06T11:40:00.000Z', true);
    expect(slip.scanLine).toBeNull();
    expect(slip.demoLine).toContain('ডেমো');
  });

  it('says nobody is ahead for the next patient', () => {
    const slip = tokenSlip(
      { ...booking, estimate: { etaAt: booking.plannedStart, bandMinutes: 0, patientsAhead: 0 } },
      '2026-11-06T11:00:00.000Z',
      false,
    );
    expect(slip.aheadLine).toBe('আপনার আগে কেউ নেই');
    expect(slip.estimateLine).toBe('আনুমানিক সময়: বিকাল ৫:০০');
  });
});
