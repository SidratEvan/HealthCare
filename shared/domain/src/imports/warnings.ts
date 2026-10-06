/**
 * What a checked import is warned about without being refused (`FR-IMP-21`).
 *
 * The check (`sets.ts`, `import.service`) refuses what is wrong: a missing
 * name, a date that is not a date, the same identifier twice. Some things are
 * not wrong and are still worth a person's look before they approve:
 *
 * - **Two rows that look like the same patient** under two identifiers: the
 *   same name with the same mobile number, or the same name with the same
 *   date of birth. They are *flagged, never merged*. Deciding that two
 *   records are one person is the hospital's to do in its own system; an
 *   import that merged on a guess would put one patient's history under
 *   another's name. A shared mobile number alone is not a flag: a family
 *   shares a phone.
 * - **A column that writes its dates or its mobile numbers in more than one
 *   way.** Every way counted here is one the reader accepts, so nothing is
 *   refused; the administrator is told which ways were found and how each is
 *   read, because `05/10/2026` is read day first and a file that meant May
 *   would otherwise be imported wrong without a single error.
 *
 * Pure, and it names rows by number only. Nothing here carries a value from
 * a row: the answer is safe to show, log and audit (`FR-IMP-11`).
 */

import { normaliseBdMobile } from '../util/phone.js';

import { latinDigits, readDate, type ImportSet } from './sets.js';

/** One row of a checked file: its number in the file and its cells by template column. */
export interface WarnedRow {
  readonly rowNumber: number;
  /** Null once a closed batch's contents have been cleared. */
  readonly raw: Readonly<Record<string, string>> | null;
}

export const SAME_PERSON_REASONS = ['phone_and_name', 'name_and_birth'] as const;
export type SamePersonReason = (typeof SAME_PERSON_REASONS)[number];

/** Rows that look like one patient under more than one identifier. */
export interface SamePersonGroup {
  /** Row numbers in the file, ascending. Always two or more. */
  readonly rows: readonly number[];
  readonly because: readonly SamePersonReason[];
}

export const VALUE_FORMATS = {
  date: ['iso', 'day_first'],
  phone: ['local', 'country'],
} as const;
export type FormatKind = keyof typeof VALUE_FORMATS;
export type ValueFormat = (typeof VALUE_FORMATS)[FormatKind][number];

/** A column whose readable values are written in more than one way. */
export interface MixedFormat {
  /** The template column (`date_of_birth`, `mobile`, `date`). */
  readonly field: string;
  readonly kind: FormatKind;
  /** Each way found, most rows first, with the first row written that way. */
  readonly formats: readonly {
    readonly format: ValueFormat;
    readonly rows: number;
    readonly firstRow: number;
  }[];
}

export interface ImportWarnings {
  /** At most `MAX_GROUPS_LISTED`, in file order. */
  readonly samePerson: readonly SamePersonGroup[];
  /** How many groups there are in all, listed or not. */
  readonly samePersonTotal: number;
  readonly mixedFormats: readonly MixedFormat[];
}

export const NO_WARNINGS: ImportWarnings = {
  samePerson: [],
  samePersonTotal: 0,
  mixedFormats: [],
};

/** A screen can list this many groups; a file with more has a different problem. */
export const MAX_GROUPS_LISTED = 50;

/** The columns of each set whose values have more than one accepted spelling. */
const FORMAT_FIELDS: Readonly<Record<ImportSet, readonly (readonly [string, FormatKind])[]>> = {
  structure: [],
  patients: [
    ['date_of_birth', 'date'],
    ['mobile', 'phone'],
  ],
  appointments: [['date', 'date']],
};

/**
 * The titles people put before a name, in the spellings a register uses.
 * `Md. Karim Uddin` and `Mohammad Karim Uddin` are the same name written by
 * two clerks. Only ever compared together with a phone or a birth date.
 */
const NAME_PREFIXES = new Set([
  'md',
  'mohammad',
  'mohammed',
  'muhammad',
  'mohd',
  'mst',
  'mosammat',
  'mosammad',
  'মো',
  'মোঃ',
  'মোহাম্মদ',
  'মুহাম্মদ',
  'মোছা',
  'মোছাঃ',
  'মোসাম্মৎ',
]);

/** A name as it is compared: case, punctuation, spacing and a leading title set aside. */
export function foldPersonName(name: string): string {
  const words = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,:;'"()[\]]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');
  const rest = words.length > 1 && NAME_PREFIXES.has(words[0] ?? '') ? words.slice(1) : words;
  return rest.join(' ');
}

function dateFormatOf(value: string): ValueFormat | null {
  if (readDate(value) === null) return null;
  return /^\d{4}-/.test(latinDigits(value).trim()) ? 'iso' : 'day_first';
}

function phoneFormatOf(value: string): ValueFormat | null {
  const digits = latinDigits(value).replace(/[\s\-().]/g, '');
  if (normaliseBdMobile(digits) === null) return null;
  return digits.startsWith('0') ? 'local' : 'country';
}

function mixedFormatsOf(set: ImportSet, rows: readonly WarnedRow[]): MixedFormat[] {
  const found: MixedFormat[] = [];
  for (const [field, kind] of FORMAT_FIELDS[set]) {
    const seen = new Map<ValueFormat, { rows: number; firstRow: number }>();
    for (const row of rows) {
      const value = row.raw?.[field];
      if (value === undefined || value.trim() === '') continue;
      const format = kind === 'date' ? dateFormatOf(value) : phoneFormatOf(value);
      // What cannot be read is the check's to refuse, not a format.
      if (format === null) continue;
      const entry = seen.get(format);
      if (entry === undefined) seen.set(format, { rows: 1, firstRow: row.rowNumber });
      else entry.rows += 1;
    }
    if (seen.size < 2) continue;
    found.push({
      field,
      kind,
      formats: [...seen.entries()]
        .map(([format, entry]) => ({ format, ...entry }))
        .sort((a, b) => b.rows - a.rows || a.firstRow - b.firstRow),
    });
  }
  return found;
}

function samePersonOf(rows: readonly WarnedRow[]): SamePersonGroup[] {
  interface Patient {
    readonly rowNumber: number;
    readonly ref: string;
  }
  const patients: Patient[] = [];
  /** A row's group, by position in `patients`: the usual union of sets. */
  const parent: number[] = [];
  const find = (at: number): number => {
    let root = at;
    while (parent[root] !== root) root = parent[root] ?? root;
    parent[at] = root;
    return root;
  };
  const firstWith = new Map<string, number>();
  const reasons = new Map<number, Set<SamePersonReason>>();

  const join = (key: string, at: number, because: SamePersonReason): void => {
    const other = firstWith.get(key);
    if (other === undefined) {
      firstWith.set(key, at);
      return;
    }
    const a = find(other);
    const b = find(at);
    const merged = new Set([...(reasons.get(a) ?? []), ...(reasons.get(b) ?? []), because]);
    parent[b] = a;
    reasons.delete(b);
    reasons.set(a, merged);
  };

  for (const row of rows) {
    const raw = row.raw;
    if (raw === null) continue;
    const ref = (raw['ref'] ?? '').trim();
    const name = foldPersonName(raw['full_name'] ?? '');
    // A template's example row is skipped by the import, and names nobody.
    if (ref === '' || name === '' || ref.toUpperCase().startsWith('EXAMPLE')) continue;

    const at = patients.length;
    patients.push({ rowNumber: row.rowNumber, ref });
    parent.push(at);

    const phone = normaliseBdMobile(latinDigits(raw['mobile'] ?? ''));
    if (phone !== null) join(`phone|${phone}|${name}`, at, 'phone_and_name');
    const born = readDate(raw['date_of_birth'] ?? '');
    if (born !== null) join(`born|${born}|${name}`, at, 'name_and_birth');
  }

  const members = new Map<number, Patient[]>();
  patients.forEach((patient, at) => {
    const root = find(at);
    const group = members.get(root);
    if (group === undefined) members.set(root, [patient]);
    else group.push(patient);
  });

  const groups: SamePersonGroup[] = [];
  for (const [root, group] of members) {
    // The same identifier twice is an error the check already names.
    if (new Set(group.map((patient) => patient.ref)).size < 2) continue;
    const because = reasons.get(root) ?? new Set<SamePersonReason>();
    groups.push({
      rows: group.map((patient) => patient.rowNumber).sort((a, b) => a - b),
      because: SAME_PERSON_REASONS.filter((reason) => because.has(reason)),
    });
  }
  return groups.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));
}

/** What a person should look at before approving this file. Empty for most files. */
export function importWarnings(set: ImportSet, rows: readonly WarnedRow[]): ImportWarnings {
  const samePerson = set === 'patients' ? samePersonOf(rows) : [];
  return {
    samePerson: samePerson.slice(0, MAX_GROUPS_LISTED),
    samePersonTotal: samePerson.length,
    mixedFormats: mixedFormatsOf(set, rows),
  };
}

/** Whether there is anything to say. */
export function hasWarnings(warnings: ImportWarnings): boolean {
  return warnings.samePersonTotal > 0 || warnings.mixedFormats.length > 0;
}
