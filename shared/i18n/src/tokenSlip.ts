/**
 * A serial, written as the token slip the counter prints (`PRD.md`
 * `FR-REC-21`; `APP_FLOW.md` `BTN-B02-SLIP`).
 *
 * "Print a token slip for walk-ins with serial, doctor, and estimated time."
 * Patient-facing paper is Bangla with Bengali digits, whatever language the
 * counter's screen is in, as the prescription is (`FR-DOC-07`).
 *
 * The estimate is the live page's own (`computeEtas`), and the slip says when
 * it was printed, because a time on paper does not update: the QR code is
 * how the patient follows the real one (`PRD.md` §3.2). With no estimate the
 * slip prints the chamber's hours and no guessed time.
 *
 * Pure, apart from the clock-free date formatting it shares with the rest of
 * this package.
 */

import { formatClock } from './datetime.js';
import { toBengaliDigits } from './numerals.js';
import { bnCalendarDate } from './prescription.js';

/** What the server's slip carries (`POST /bookings/:id/slip`). */
export interface SlipBooking {
  readonly serial: number;
  readonly hospitalNameBn: string;
  readonly doctorNameBn: string;
  readonly room: string | null;
  readonly sessionDate: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly estimate: {
    readonly etaAt: string;
    readonly bandMinutes: number;
    readonly patientsAhead: number;
  } | null;
  readonly trackingUrl: string | null;
}

export interface SlipLines {
  readonly hospital: string;
  readonly serialLabel: string;
  readonly serial: string;
  readonly doctor: string;
  readonly room: string | null;
  readonly chamberLine: string;
  /** `আনুমানিক সময়: সন্ধ্যা ৬:৩০ (± ১০ মিনিট)`, or that there is none yet. */
  readonly estimateLine: string;
  readonly aheadLine: string | null;
  /** Shown beside the QR code; `null` when there is no link to print. */
  readonly scanLine: string | null;
  readonly printedLine: string;
  readonly demoLine: string | null;
}

export function tokenSlip(
  booking: SlipBooking,
  printedAt: string,
  demonstration: boolean,
): SlipLines {
  const n = (value: number): string => toBengaliDigits(String(value));
  const estimate = booking.estimate;
  return {
    hospital: booking.hospitalNameBn,
    serialLabel: 'সিরিয়াল নম্বর',
    serial: n(booking.serial),
    doctor: booking.doctorNameBn,
    room: booking.room === null ? null : `রুম ${toBengaliDigits(booking.room)}`,
    chamberLine: `${bnCalendarDate(booking.sessionDate)} · চেম্বার ${formatClock(
      booking.plannedStart,
      'bengali',
    )} – ${formatClock(booking.plannedEnd, 'bengali')}`,
    estimateLine:
      estimate === null
        ? 'আনুমানিক সময় এখনো বলা যাচ্ছে না'
        : `আনুমানিক সময়: ${formatClock(estimate.etaAt, 'bengali')}${
            estimate.bandMinutes > 0 ? ` (± ${n(estimate.bandMinutes)} মিনিট)` : ''
          }`,
    aheadLine:
      estimate === null
        ? null
        : estimate.patientsAhead === 0
          ? 'আপনার আগে কেউ নেই'
          : `আপনার আগে আছেন ${n(estimate.patientsAhead)} জন`,
    scanLine:
      booking.trackingUrl === null
        ? null
        : 'ফোনে লাইভ সিরিয়াল দেখতে QR কোডটি স্ক্যান করুন। সময় বদলালে সেখানে দেখা যাবে।',
    printedLine: `ছাপা হয়েছে ${formatClock(printedAt, 'bengali')} — সময় বদলাতে পারে`,
    demoLine: demonstration ? 'ডেমো — প্রদর্শনের জন্য, আসল সিরিয়াল নয়' : null,
  };
}
