/**
 * A visit, written as its printed prescription (`PRD.md` `FR-DOC-07`; plan
 * R2).
 *
 * "Patient-facing output prints and delivers in Bangla, including dosage
 * instructions." So the sheet is Bangla whatever language the screen that
 * prints it is in, with Bengali digits, and the schedule is printed in the
 * notation the doctor wrote with its reading beneath (`সকাল + দুপুর + রাত`).
 *
 * The result has the shape `@platform/ui`'s `PrescriptionSheet` draws; this
 * package does not depend on that one, so the shape is repeated rather than
 * imported, and the two apps' type checks hold them together.
 *
 * Pure, apart from the clock-free date formatting it shares with the rest of
 * this package.
 */

import { DHAKA, formatClock } from './datetime.js';
import { toBengaliDigits } from './numerals.js';

/** What the sheet needs to know about the visit; both apps' records carry it. */
export interface SheetVisit {
  readonly hospitalNameBn: string;
  readonly doctorNameBn: string;
  readonly doctorBmdc: string;
  readonly departmentNameBn: string;
  readonly serial: number;
  readonly visitedAt: string;
  readonly diagnosisText: string | null;
  readonly adviceTextBn: string | null;
  readonly followUpDate: string | null;
  readonly medicines: readonly {
    readonly name: string;
    readonly strength: string | null;
    readonly schedule: string | null;
    readonly durationDays: number | null;
    readonly instructionBn: string | null;
  }[];
}

/** The patient, when the printing screen knows them. */
export interface SheetPatient {
  readonly name: string;
  readonly ageYears: number | null;
  readonly sex: string | null;
}

const SEX_BN: Readonly<Record<string, string>> = {
  male: 'পুরুষ',
  female: 'নারী',
  other: 'অন্যান্য',
};

/** A calendar date (`YYYY-MM-DD`) as Bangla words: `১৫ অক্টোবর ২০২৬`. */
export function bnCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return toBengaliDigits(date);
  return new Intl.DateTimeFormat('bn-BD', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** An instant's Dhaka date as Bangla words. */
function bnDateOf(iso: string): string {
  return new Intl.DateTimeFormat('bn-BD', {
    timeZone: DHAKA,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

export function prescriptionSheet(
  visit: SheetVisit,
  patient: SheetPatient | null,
): {
  readonly hospital: string;
  readonly doctor: string;
  readonly doctorLine: string;
  readonly patientLine: string | null;
  readonly dateLine: string;
  readonly diagnosis: string | null;
  readonly medicines: readonly {
    readonly name: string;
    readonly detail: string | null;
    readonly instruction: string | null;
  }[];
  readonly advice: string | null;
  readonly followUp: string | null;
  readonly labels: {
    readonly diagnosis: string;
    readonly medicines: string;
    readonly scheduleLegend: string;
    readonly advice: string;
    readonly followUp: string;
    readonly signedNote: string;
  };
} {
  const patientLine =
    patient === null
      ? null
      : [
          `রোগী: ${patient.name}`,
          patient.ageYears === null ? null : `বয়স ${toBengaliDigits(String(patient.ageYears))}`,
          patient.sex === null ? null : (SEX_BN[patient.sex] ?? null),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');

  return {
    hospital: visit.hospitalNameBn,
    doctor: visit.doctorNameBn,
    doctorLine: `বিএমডিসি নং ${visit.doctorBmdc} · ${visit.departmentNameBn}`,
    patientLine,
    dateLine: `তারিখ ${bnDateOf(visit.visitedAt)} · সিরিয়াল ${toBengaliDigits(String(visit.serial))}`,
    diagnosis: visit.diagnosisText,
    medicines: visit.medicines.map((medicine) => {
      const parts = [
        medicine.strength,
        medicine.schedule === null ? null : toBengaliDigits(medicine.schedule),
        medicine.durationDays === null
          ? null
          : `${toBengaliDigits(String(medicine.durationDays))} দিন`,
      ].filter((part): part is string => part !== null && part !== '');
      return {
        name: medicine.name,
        detail: parts.length === 0 ? null : parts.join(' · '),
        instruction: medicine.instructionBn,
      };
    }),
    advice: visit.adviceTextBn,
    followUp: visit.followUpDate === null ? null : bnCalendarDate(visit.followUpDate),
    labels: {
      diagnosis: 'রোগনির্ণয়',
      medicines: 'ওষুধ',
      scheduleLegend: 'সেবনবিধি: সকাল + দুপুর + রাত',
      advice: 'পরামর্শ',
      followUp: 'আবার দেখাবেন:',
      signedNote: `চিকিৎসক রেকর্ডটি স্বাক্ষর করেছেন ${bnDateOf(visit.visitedAt)}, ${formatClock(visit.visitedAt, 'bengali')}।`,
    },
  };
}
