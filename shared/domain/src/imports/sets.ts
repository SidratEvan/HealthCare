/**
 * What each import set holds, and how one row of it is read (pilot step 24,
 * `FR-IMP-01`, `FR-IMP-02`, `FR-IMP-05`, `FR-IMP-09`).
 *
 * Only the fields `FR-IMP-02` names have a column; a column the template does
 * not have is ignored, never stored. A row is checked here for everything that
 * can be known from the row alone — required fields, dates, times, mobile
 * numbers (`DB-P6`), allowed values. Whether a referenced department or
 * patient exists is the service's check, because it needs the database and
 * the rest of the file.
 *
 * Errors are codes (`{field, code}`), never sentences: the screen words them
 * in the language it is read in (`FR-IMP-05`), and the database stores no
 * prose (`import_rows.errors`).
 *
 * Pure. Latin or Bengali digits, the ways dates and times are written in a
 * Bangladeshi spreadsheet, and weekday names in either language are all read.
 */

import { BED_KINDS, BLOOD_GROUPS, SEXES, type BedKind, type Sex } from '../types/enums.js';
import { normaliseBdMobile } from '../util/phone.js';

/** The sets a hospital can import now. `records` (set D) waits (`FR-IMP-12`). */
export const IMPORT_SETS = ['structure', 'patients', 'appointments'] as const;
export type ImportSet = (typeof IMPORT_SETS)[number];

export const IMPORT_COLUMNS = {
  structure: [
    'type',
    'ref',
    'name_bn',
    'name_en',
    'code',
    'bmdc_number',
    'degrees',
    'specialties',
    'department_ref',
    'room',
    'fee_taka',
    'doctor_ref',
    'weekday',
    'start',
    'end',
    'serials',
    'ward_ref',
    'floor',
    'bed_kind',
    'bed_label',
    'nightly_taka',
    'role',
    'email',
  ],
  patients: ['ref', 'full_name', 'date_of_birth', 'age_years', 'sex', 'mobile', 'blood_group'],
  appointments: ['patient_ref', 'doctor_ref', 'date', 'start', 'serial', 'paid'],
} as const satisfies Record<ImportSet, readonly string[]>;

/** The roles a staff row may carry — a facility's own (`FR-ROLE-01`). */
const STAFF_ROLES = [
  'receptionist',
  'doctor',
  'ward',
  'emergency',
  'lab',
  'pharmacy',
  'hospital_admin',
] as const;
export type ImportedRole = (typeof STAFF_ROLES)[number];

export type ImportErrorCode =
  | 'required'
  | 'invalid'
  | 'unknown_type'
  | 'unknown_value'
  | 'not_bd_mobile'
  | 'bad_date'
  | 'bad_time'
  | 'out_of_range'
  | 'end_before_start'
  | 'duplicate_in_file'
  | 'unknown_ref'
  | 'no_chamber'
  | 'serial_taken'
  | 'conflict';

export interface ImportError {
  readonly field: string;
  readonly code: ImportErrorCode;
}

export type StructureRecord =
  | {
      readonly type: 'department';
      readonly ref: string;
      readonly nameBn: string;
      readonly nameEn: string;
      readonly code: string;
    }
  | {
      readonly type: 'doctor';
      readonly ref: string;
      readonly nameBn: string;
      readonly nameEn: string;
      readonly bmdcNumber: string;
      readonly degrees: string | null;
      readonly specialties: readonly string[];
      readonly departmentRef: string;
      readonly room: string | null;
      readonly feePoisha: number;
    }
  | {
      readonly type: 'schedule';
      readonly ref: string;
      readonly doctorRef: string;
      readonly weekday: number;
      readonly startTime: string;
      readonly endTime: string;
      readonly capacity: number | null;
    }
  | {
      readonly type: 'ward';
      readonly ref: string;
      readonly nameBn: string;
      readonly nameEn: string;
      readonly floor: number;
      readonly kind: BedKind;
    }
  | {
      readonly type: 'bed';
      readonly ref: string;
      readonly wardRef: string;
      readonly label: string;
      readonly kind: BedKind;
      readonly nightlyPoisha: number;
    }
  | {
      readonly type: 'staff';
      readonly ref: string;
      readonly fullName: string;
      readonly email: string;
      readonly role: ImportedRole;
    };

export interface PatientRecord {
  readonly ref: string;
  readonly fullName: string;
  readonly dateOfBirth: string | null;
  readonly ageYears: number | null;
  readonly sex: Sex;
  readonly phone: string | null;
  readonly bloodGroup: string | null;
}

export interface AppointmentRecord {
  /** The hospital's own key for an appointment: patient, doctor and day. */
  readonly ref: string;
  readonly patientRef: string;
  readonly doctorRef: string;
  readonly date: string;
  readonly startTime: string | null;
  readonly serial: number;
  readonly paid: boolean;
}

export type ImportRecord<S extends ImportSet> = S extends 'structure'
  ? StructureRecord
  : S extends 'patients'
    ? PatientRecord
    : AppointmentRecord;

export type RowResult<T> =
  | { readonly ok: true; readonly record: T }
  | { readonly ok: false; readonly errors: readonly ImportError[] };

/** Which kind of external reference a record's `ref` names (`external_refs.kind`). */
export function refKindOf(record: StructureRecord | PatientRecord | AppointmentRecord): string {
  if ('type' in record) return record.type;
  if ('patientRef' in record) return 'appointment';
  return 'patient';
}

// ---------------------------------------------------------------------------
// Reading a row
// ---------------------------------------------------------------------------

/** A header matched to the template: the index of each template column, or -1. */
export function columnIndex(set: ImportSet, header: readonly string[]): Record<string, number> {
  const normalised = header.map((name) => name.trim().toLowerCase());
  const index: Record<string, number> = {};
  for (const column of IMPORT_COLUMNS[set]) index[column] = normalised.indexOf(column);
  return index;
}

/** The template columns missing from a header, so a wrong file is named at once. */
export function missingColumns(set: ImportSet, header: readonly string[]): string[] {
  const index = columnIndex(set, header);
  const required: readonly string[] =
    set === 'structure'
      ? ['type', 'ref']
      : set === 'patients'
        ? ['ref', 'full_name', 'sex']
        : ['patient_ref', 'doctor_ref', 'date', 'serial'];
  return required.filter((column) => (index[column] ?? -1) < 0);
}

class Reader {
  readonly errors: ImportError[] = [];

  constructor(
    private readonly cells: readonly string[],
    private readonly index: Record<string, number>,
  ) {}

  raw(field: string): string {
    const at = this.index[field] ?? -1;
    return at < 0 ? '' : (this.cells[at] ?? '').trim();
  }

  optional(field: string): string | null {
    const value = this.raw(field);
    return value === '' ? null : value;
  }

  required(field: string): string {
    const value = this.raw(field);
    if (value === '') this.errors.push({ field, code: 'required' });
    return value;
  }

  fail(field: string, code: ImportErrorCode): void {
    this.errors.push({ field, code });
  }
}

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Bengali digits to Latin, so `০১৭১২…` and `৮০০` read as numbers. */
export function latinDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)));
}

function wholeNumber(value: string): number | null {
  const text = latinDigits(value).replace(/,/g, '').trim();
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

/** Taka as written — `800`, `800.50`, `1,500`, `৳৮০০` — to integer poisha (`DB-P5`). */
export function takaToPoisha(value: string): number | null {
  const text = latinDigits(value).replace(/[,৳\s]|tk\.?|taka/gi, '');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** `2026-10-05`, `05/10/2026`, `5-10-2026` → `2026-10-05`; day first, as Bangladesh writes it. */
export function readDate(value: string): string | null {
  const text = latinDigits(value).trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (iso !== null) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dayFirst !== null) {
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    year = Number(dayFirst[3]);
  } else {
    return null;
  }
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day)
    return null;
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `17:00`, `5:00 PM`, `5 pm`, `১৭:০০` → `17:00`. */
export function readTime(value: string): string | null {
  const text = latinDigits(value).trim().toLowerCase().replace(/\s+/g, ' ');
  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(text);
  if (match === null) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const half = match[3];
  if (match[2] === undefined && half === undefined) return null;
  if (half !== undefined) {
    if (hour < 1 || hour > 12) return null;
    if (half === 'pm' && hour !== 12) hour += 12;
    if (half === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  mon: 1,
  monday: 1,
  সোম: 1,
  সোমবার: 1,
  tue: 2,
  tuesday: 2,
  মঙ্গল: 2,
  মঙ্গলবার: 2,
  wed: 3,
  wednesday: 3,
  বুধ: 3,
  বুধবার: 3,
  thu: 4,
  thursday: 4,
  বৃহস্পতি: 4,
  বৃহস্পতিবার: 4,
  fri: 5,
  friday: 5,
  শুক্র: 5,
  শুক্রবার: 5,
  sat: 6,
  saturday: 6,
  শনি: 6,
  শনিবার: 6,
  sun: 7,
  sunday: 7,
  রবি: 7,
  রবিবার: 7,
};

/** A weekday as ISO 1–7 (Monday = 1), from a number or a name in either language. */
export function readWeekday(value: string): number | null {
  const text = latinDigits(value).trim().toLowerCase();
  if (/^[1-7]$/.test(text)) return Number(text);
  return WEEKDAYS[text] ?? null;
}

const SEX_WORDS: Readonly<Record<string, Sex>> = {
  m: 'male',
  male: 'male',
  পুরুষ: 'male',
  ছেলে: 'male',
  f: 'female',
  female: 'female',
  মহিলা: 'female',
  নারী: 'female',
  মেয়ে: 'female',
  o: 'other',
  other: 'other',
  অন্য: 'other',
  অন্যান্য: 'other',
};

const YES = new Set(['yes', 'y', 'true', '1', 'paid', 'হ্যাঁ', 'হা', 'পরিশোধিত']);
const NO = new Set(['no', 'n', 'false', '0', 'unpaid', 'না', 'বাকি', '']);

function readStructure(row: Reader): StructureRecord | null {
  const type = row.required('type').toLowerCase();
  const ref = row.required('ref');
  switch (type) {
    case 'department': {
      const nameBn = row.required('name_bn');
      const nameEn = row.required('name_en');
      const code = row.required('code').toUpperCase();
      if (code !== '' && !/^[A-Z][A-Z0-9-]{1,11}$/.test(code)) row.fail('code', 'invalid');
      return { type, ref, nameBn, nameEn, code };
    }
    case 'doctor': {
      const nameBn = row.required('name_bn');
      const nameEn = row.required('name_en');
      const bmdcNumber = latinDigits(row.required('bmdc_number')).toUpperCase();
      if (bmdcNumber !== '' && !/^[A-Z]{0,6}-?\d{1,7}$/.test(bmdcNumber))
        row.fail('bmdc_number', 'invalid');
      const specialties = (row.optional('specialties') ?? '')
        .split(/[;|]/)
        .map((entry) => entry.trim().toLowerCase().replace(/\s+/g, '_'))
        .filter((entry) => entry !== '');
      if (specialties.some((entry) => !/^[a-z][a-z_-]{1,40}$/.test(entry)))
        row.fail('specialties', 'invalid');
      const departmentRef = row.required('department_ref');
      const feeText = row.required('fee_taka');
      const feePoisha = feeText === '' ? 0 : takaToPoisha(feeText);
      if (feePoisha === null) row.fail('fee_taka', 'invalid');
      return {
        type,
        ref,
        nameBn,
        nameEn,
        bmdcNumber,
        degrees: row.optional('degrees'),
        specialties: specialties.slice(0, 5),
        departmentRef,
        room: row.optional('room'),
        feePoisha: feePoisha ?? 0,
      };
    }
    case 'schedule': {
      const doctorRef = row.required('doctor_ref');
      const weekdayText = row.required('weekday');
      const weekday = weekdayText === '' ? 0 : readWeekday(weekdayText);
      if (weekday === null) row.fail('weekday', 'unknown_value');
      const startText = row.required('start');
      const endText = row.required('end');
      const startTime = startText === '' ? '' : readTime(startText);
      const endTime = endText === '' ? '' : readTime(endText);
      if (startTime === null) row.fail('start', 'bad_time');
      if (endTime === null) row.fail('end', 'bad_time');
      if (
        startTime !== null &&
        endTime !== null &&
        startTime !== '' &&
        endTime !== '' &&
        endTime <= startTime
      ) {
        row.fail('end', 'end_before_start');
      }
      const serialsText = row.optional('serials');
      const capacity = serialsText === null ? null : wholeNumber(serialsText);
      if (serialsText !== null && (capacity === null || capacity < 1 || capacity > 500))
        row.fail('serials', 'out_of_range');
      return {
        type,
        ref,
        doctorRef,
        weekday: weekday ?? 0,
        startTime: startTime ?? '',
        endTime: endTime ?? '',
        capacity,
      };
    }
    case 'ward': {
      const nameBn = row.required('name_bn');
      const nameEn = row.required('name_en');
      const floorText = row.required('floor');
      const floor = floorText === '' ? 0 : wholeNumber(floorText);
      if (floor === null || floor > 60) row.fail('floor', 'out_of_range');
      const kind = bedKindOf(row);
      return { type, ref, nameBn, nameEn, floor: floor ?? 0, kind };
    }
    case 'bed': {
      const wardRef = row.required('ward_ref');
      const label = row.required('bed_label');
      if (label.length > 20) row.fail('bed_label', 'invalid');
      const kind = bedKindOf(row);
      const priceText = row.required('nightly_taka');
      const nightlyPoisha = priceText === '' ? 0 : takaToPoisha(priceText);
      if (nightlyPoisha === null) row.fail('nightly_taka', 'invalid');
      return { type, ref, wardRef, label, kind, nightlyPoisha: nightlyPoisha ?? 0 };
    }
    case 'staff': {
      const fullName = row.optional('name_bn') ?? row.optional('name_en') ?? '';
      if (fullName === '') row.fail('name_bn', 'required');
      const email = row.required('email');
      if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) row.fail('email', 'invalid');
      const roleText = row.required('role').toLowerCase().replace(/\s+/g, '_');
      const role = (STAFF_ROLES as readonly string[]).includes(roleText)
        ? (roleText as ImportedRole)
        : null;
      if (roleText !== '' && role === null) row.fail('role', 'unknown_value');
      return { type, ref, fullName, email, role: role ?? 'receptionist' };
    }
    default:
      if (type !== '') row.fail('type', 'unknown_type');
      return null;
  }
}

function bedKindOf(row: Reader): BedKind {
  const text = row.required('bed_kind').toLowerCase();
  const kind = (BED_KINDS as readonly string[]).includes(text) ? (text as BedKind) : null;
  if (text !== '' && kind === null) row.fail('bed_kind', 'unknown_value');
  return kind ?? 'general';
}

function readPatient(row: Reader): PatientRecord {
  const ref = row.required('ref');
  const fullName = row.required('full_name');
  const dobText = row.optional('date_of_birth');
  const dateOfBirth = dobText === null ? null : readDate(dobText);
  if (dobText !== null && dateOfBirth === null) row.fail('date_of_birth', 'bad_date');
  const ageText = row.optional('age_years');
  const ageYears = ageText === null ? null : wholeNumber(ageText);
  if (ageText !== null && (ageYears === null || ageYears > 130))
    row.fail('age_years', 'out_of_range');
  if (dobText === null && ageText === null) row.fail('age_years', 'required');
  const sexText = row.required('sex').toLowerCase();
  const sex =
    SEX_WORDS[sexText] ??
    ((SEXES as readonly string[]).includes(sexText) ? (sexText as Sex) : null);
  if (sexText !== '' && sex === null) row.fail('sex', 'unknown_value');
  const mobileText = row.optional('mobile');
  const phone = mobileText === null ? null : normaliseBdMobile(latinDigits(mobileText));
  if (mobileText !== null && phone === null) row.fail('mobile', 'not_bd_mobile');
  const bloodText = row.optional('blood_group');
  const blood =
    bloodText === null ? null : bloodText.toUpperCase().replace(/\s+/g, '').replace('VE', '');
  const bloodGroup =
    blood === null ? null : (BLOOD_GROUPS as readonly string[]).includes(blood) ? blood : undefined;
  if (bloodGroup === undefined) row.fail('blood_group', 'unknown_value');
  return {
    ref,
    fullName,
    dateOfBirth,
    ageYears,
    sex: sex ?? 'other',
    phone,
    bloodGroup: bloodGroup ?? null,
  };
}

function readAppointment(row: Reader): AppointmentRecord {
  const patientRef = row.required('patient_ref');
  const doctorRef = row.required('doctor_ref');
  const dateText = row.required('date');
  const date = dateText === '' ? '' : readDate(dateText);
  if (date === null) row.fail('date', 'bad_date');
  const startText = row.optional('start');
  const startTime = startText === null ? null : readTime(startText);
  if (startText !== null && startTime === null) row.fail('start', 'bad_time');
  const serialText = row.required('serial');
  const serial = serialText === '' ? 0 : wholeNumber(serialText);
  if (serial === null || (serialText !== '' && (serial < 1 || serial > 999)))
    row.fail('serial', 'out_of_range');
  const paidText = latinDigits(row.raw('paid')).toLowerCase();
  const paid = YES.has(paidText) ? true : NO.has(paidText) ? false : null;
  if (paid === null) row.fail('paid', 'unknown_value');
  return {
    ref: `${patientRef}|${doctorRef}|${date ?? ''}`,
    patientRef,
    doctorRef,
    date: date ?? '',
    startTime,
    serial: serial ?? 0,
    paid: paid ?? false,
  };
}

/** One row of a set, read and checked on its own. */
export function readRow<S extends ImportSet>(
  set: S,
  cells: readonly string[],
  index: Record<string, number>,
): RowResult<ImportRecord<S>> {
  const row = new Reader(cells, index);
  const record =
    set === 'structure'
      ? readStructure(row)
      : set === 'patients'
        ? readPatient(row)
        : readAppointment(row);
  if (record === null || row.errors.length > 0) {
    return {
      ok: false,
      errors: row.errors.length > 0 ? row.errors : [{ field: 'type', code: 'required' }],
    };
  }
  return { ok: true, record: record as ImportRecord<S> };
}

/**
 * The template for a set: the header, then one example row that says it is
 * an example (`FR-IMP-09`). Example rows are demo-labelled and invented; they
 * name nobody (`FR-SEC-08`).
 */
export function templateCsv(set: ImportSet): string {
  const header = IMPORT_COLUMNS[set];
  const examples: Record<ImportSet, readonly Record<string, string>[]> = {
    structure: [
      {
        type: 'department',
        ref: 'EXAMPLE-D-01',
        name_bn: 'মেডিসিন (উদাহরণ)',
        name_en: 'Medicine (example)',
        code: 'MED',
      },
      {
        type: 'doctor',
        ref: 'EXAMPLE-DR-01',
        name_bn: 'ডা. উদাহরণ',
        name_en: 'Dr Example',
        bmdc_number: 'A-00000',
        degrees: 'MBBS',
        specialties: 'medicine',
        department_ref: 'EXAMPLE-D-01',
        room: '204',
        fee_taka: '800',
      },
      {
        type: 'schedule',
        ref: 'EXAMPLE-S-01',
        doctor_ref: 'EXAMPLE-DR-01',
        weekday: 'Saturday',
        start: '17:00',
        end: '21:00',
        serials: '30',
      },
      {
        type: 'ward',
        ref: 'EXAMPLE-W-01',
        name_bn: 'সাধারণ ওয়ার্ড (উদাহরণ)',
        name_en: 'General ward (example)',
        floor: '3',
        bed_kind: 'general',
      },
      {
        type: 'bed',
        ref: 'EXAMPLE-B-301',
        ward_ref: 'EXAMPLE-W-01',
        bed_label: '301',
        bed_kind: 'general',
        nightly_taka: '1500',
      },
      {
        type: 'staff',
        ref: 'EXAMPLE-ST-01',
        name_bn: 'উদাহরণ কর্মী',
        role: 'receptionist',
        email: 'example@example.invalid',
      },
    ],
    patients: [
      {
        ref: 'EXAMPLE-P-000001',
        full_name: 'উদাহরণ রোগী',
        date_of_birth: '01/01/1980',
        age_years: '',
        sex: 'female',
        mobile: '01700000000',
        blood_group: 'O+',
      },
    ],
    appointments: [
      {
        patient_ref: 'EXAMPLE-P-000001',
        doctor_ref: 'EXAMPLE-DR-01',
        date: '2026-10-03',
        start: '17:00',
        serial: '5',
        paid: 'no',
      },
    ],
  };
  const quote = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [header.join(',')];
  for (const example of examples[set])
    lines.push(header.map((column) => quote(example[column] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
