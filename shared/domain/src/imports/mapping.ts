/**
 * Mapping a hospital's own export onto the import template (`PRD.md` §14b,
 * `FR-IMP-13`–`20`).
 *
 * A hospital's export does not arrive in our column names. This file is the
 * step between such a file and the check that already exists: it looks at the
 * file's columns, proposes which of them is which template field, and — once a
 * person has confirmed — rewrites the file into the template's shape. Nothing
 * here writes to a hospital's records and nothing here decides what is
 * importable: the rewritten file goes to `check` (`FR-IMP-05`), which decides
 * exactly as it does for a file that arrived in the template (`FR-IMP-19`).
 *
 * ## What a profile holds, and what it never does
 *
 * A column's profile is the kind of value it holds, how full it is, and how
 * varied. It holds no value from any row. That is deliberate and it is the
 * property the model adapter rests on (`FR-IMP-17`): a profile can be shown to
 * something outside this server without a patient going with it.
 *
 * ## Why a first row that reads as data stops the upload
 *
 * A file with no heading row has a patient in its first line. Everything after
 * this point treats the first row as column *names* — shows them on screen,
 * stores them in a saved mapping, and may send them to a model. `FR-IMP-14`:
 * "a patient's details are never taken for a column name."
 *
 * ## Rules, in order
 *
 * A column is proposed for a field when its name is the template's own, when
 * it is one of the other names hospitals use for that field in Bangla or
 * English, when it contains one of those names, or — last and least — when it
 * is the only column whose values have the shape that field needs. Each
 * proposal carries which of those it was and how sure that makes it
 * (`FR-IMP-15`). Pure and deterministic: the same file gets the same
 * proposal.
 */

import { normaliseBdMobile } from '../util/phone.js';

import { csvLine, type CsvTable } from './csv.js';
import {
  IMPORT_COLUMNS,
  latinDigits,
  readDate,
  readTime,
  takaToPoisha,
  type ImportSet,
} from './sets.js';

// ---------------------------------------------------------------------------
// What can be mapped onto
// ---------------------------------------------------------------------------

/** The kinds of row a structure file can hold (`FR-IMP-01` set A). */
export const STRUCTURE_TYPES = [
  'department',
  'doctor',
  'schedule',
  'ward',
  'bed',
  'staff',
] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

/**
 * What a file is being mapped onto: a set, and for the structure set which
 * kind of row.
 *
 * Our structure template is one sheet with a `type` column, because that is
 * the tidiest thing to hand a hospital. A hospital's own export is never that:
 * it is a doctors list, or a bed list. So a mapped structure file is one kind
 * of row throughout, and that kind is part of the mapping.
 */
export type MappingTarget =
  | { readonly set: 'patients' | 'appointments'; readonly rowType: null }
  | { readonly set: 'structure'; readonly rowType: StructureType };

/** The kind of value a column holds, judged from its cells. */
export const COLUMN_KINDS = [
  'empty',
  'text',
  'integer',
  'money',
  'date',
  'time',
  'phone',
  'email',
] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export interface TargetField {
  /** The template column (`IMPORT_COLUMNS`). */
  readonly field: string;
  readonly required: boolean;
  /** The kinds of value this field is; empty when any text will do. */
  readonly kinds: readonly ColumnKind[];
  /** Other names for it, as hospitals write them. Folded on use. */
  readonly names: readonly string[];
}

const REF_NAMES = ['id', 'ref', 'reference', 'আইডি'];
const PATIENT_REF_NAMES = [
  'patient id',
  'patient no',
  'patient number',
  'patient code',
  'pid',
  'mrn',
  'uhid',
  'hospital no',
  'reg no',
  'registration no',
  'রোগীর আইডি',
  'রোগী নম্বর',
  'রোগীর নম্বর',
  'নিবন্ধন নম্বর',
];
const DOCTOR_REF_NAMES = [
  'doctor id',
  'doctor code',
  'dr id',
  'doctor',
  'consultant',
  'ডাক্তারের আইডি',
  'ডাক্তার',
];
const NAME_BN = ['name bn', 'bangla name', 'name bangla', 'name in bangla', 'বাংলা নাম', 'নাম'];
const NAME_EN = ['name', 'name en', 'english name', 'name english', 'full name', 'ইংরেজি নাম'];

const FIELDS: Readonly<Record<string, readonly TargetField[]>> = {
  patients: [
    { field: 'ref', required: true, kinds: [], names: [...PATIENT_REF_NAMES, ...REF_NAMES] },
    {
      field: 'full_name',
      required: true,
      kinds: ['text'],
      names: ['name', 'patient name', 'full name', 'নাম', 'রোগীর নাম', 'পুরো নাম'],
    },
    {
      field: 'date_of_birth',
      required: false,
      kinds: ['date'],
      names: ['dob', 'date of birth', 'birth date', 'birthdate', 'জন্ম তারিখ', 'জন্মতারিখ'],
    },
    {
      field: 'age_years',
      required: false,
      kinds: ['integer'],
      names: ['age', 'age years', 'বয়স'],
    },
    { field: 'sex', required: true, kinds: ['text'], names: ['sex', 'gender', 'লিঙ্গ'] },
    {
      field: 'mobile',
      required: false,
      kinds: ['phone'],
      names: [
        'mobile',
        'mobile no',
        'mobile number',
        'phone',
        'phone no',
        'phone number',
        'contact',
        'contact no',
        'cell',
        'মোবাইল',
        'মোবাইল নম্বর',
        'ফোন',
        'ফোন নম্বর',
      ],
    },
    {
      field: 'blood_group',
      required: false,
      kinds: ['text'],
      names: ['blood group', 'blood grp', 'blood', 'bg', 'রক্তের গ্রুপ', 'ব্লাড গ্রুপ'],
    },
  ],
  appointments: [
    { field: 'patient_ref', required: true, kinds: [], names: [...PATIENT_REF_NAMES, 'patient'] },
    { field: 'doctor_ref', required: true, kinds: [], names: DOCTOR_REF_NAMES },
    {
      field: 'date',
      required: true,
      kinds: ['date'],
      names: ['date', 'appointment date', 'visit date', 'তারিখ'],
    },
    {
      field: 'start',
      required: false,
      kinds: ['time'],
      names: ['time', 'start', 'start time', 'appointment time', 'সময়'],
    },
    {
      field: 'serial',
      required: true,
      kinds: ['integer'],
      names: ['serial', 'serial no', 'sl', 'sl no', 'token', 'token no', 'সিরিয়াল', 'ক্রমিক'],
    },
    {
      field: 'paid',
      required: false,
      kinds: ['text', 'integer'],
      names: ['paid', 'payment', 'payment status', 'পরিশোধ'],
    },
  ],
  'structure:department': [
    {
      field: 'ref',
      required: true,
      kinds: [],
      names: ['department id', 'dept id', ...REF_NAMES],
    },
    { field: 'name_bn', required: true, kinds: ['text'], names: NAME_BN },
    {
      field: 'name_en',
      required: true,
      kinds: ['text'],
      names: [...NAME_EN, 'department', 'department name', 'dept name'],
    },
    {
      field: 'code',
      required: true,
      kinds: ['text'],
      names: ['code', 'short code', 'dept code', 'department code', 'কোড'],
    },
  ],
  'structure:doctor': [
    { field: 'ref', required: true, kinds: [], names: [...DOCTOR_REF_NAMES, ...REF_NAMES] },
    { field: 'name_bn', required: true, kinds: ['text'], names: NAME_BN },
    {
      field: 'name_en',
      required: true,
      kinds: ['text'],
      names: [...NAME_EN, 'doctor name', 'dr name'],
    },
    {
      field: 'bmdc_number',
      required: true,
      kinds: [],
      names: [
        'bmdc',
        'bmdc no',
        'bmdc number',
        'bmdc reg',
        'bmdc reg no',
        'বিএমডিসি',
        'বিএমডিসি নম্বর',
      ],
    },
    {
      field: 'degrees',
      required: false,
      kinds: ['text'],
      names: ['degree', 'degrees', 'qualification', 'qualifications', 'ডিগ্রি', 'যোগ্যতা'],
    },
    {
      field: 'specialties',
      required: false,
      kinds: ['text'],
      names: ['specialty', 'speciality', 'specialties', 'specialization', 'বিশেষত্ব'],
    },
    {
      field: 'department_ref',
      required: true,
      kinds: [],
      names: ['department', 'dept', 'department id', 'dept id', 'department code', 'বিভাগ'],
    },
    {
      field: 'room',
      required: false,
      kinds: [],
      names: ['room', 'room no', 'chamber', 'chamber no', 'রুম', 'কক্ষ'],
    },
    {
      field: 'fee_taka',
      required: true,
      kinds: ['integer', 'money'],
      names: ['fee', 'fees', 'consultation fee', 'visit fee', 'visit', 'ফি', 'ভিজিট'],
    },
  ],
  'structure:schedule': [
    { field: 'ref', required: true, kinds: [], names: ['schedule id', ...REF_NAMES] },
    { field: 'doctor_ref', required: true, kinds: [], names: DOCTOR_REF_NAMES },
    {
      field: 'weekday',
      required: true,
      kinds: ['text', 'integer'],
      names: ['day', 'weekday', 'week day', 'বার', 'দিন'],
    },
    {
      field: 'start',
      required: true,
      kinds: ['time'],
      names: ['start', 'start time', 'from', 'time from', 'শুরু'],
    },
    {
      field: 'end',
      required: true,
      kinds: ['time'],
      names: ['end', 'end time', 'to', 'time to', 'শেষ'],
    },
    {
      field: 'serials',
      required: false,
      kinds: ['integer'],
      names: ['serials', 'capacity', 'max patients', 'limit', 'সিরিয়াল সংখ্যা'],
    },
  ],
  'structure:ward': [
    { field: 'ref', required: true, kinds: [], names: ['ward id', 'ward no', ...REF_NAMES] },
    { field: 'name_bn', required: true, kinds: ['text'], names: NAME_BN },
    { field: 'name_en', required: true, kinds: ['text'], names: [...NAME_EN, 'ward', 'ward name'] },
    { field: 'floor', required: true, kinds: ['integer'], names: ['floor', 'floor no', 'তলা'] },
    {
      field: 'bed_kind',
      required: true,
      kinds: ['text'],
      names: ['bed type', 'bed kind', 'type', 'kind', 'category', 'বেডের ধরন'],
    },
  ],
  'structure:bed': [
    { field: 'ref', required: true, kinds: [], names: ['bed id', ...REF_NAMES] },
    {
      field: 'ward_ref',
      required: true,
      kinds: [],
      names: ['ward', 'ward id', 'ward no', 'ওয়ার্ড'],
    },
    {
      field: 'bed_label',
      required: true,
      kinds: [],
      names: ['bed', 'bed no', 'bed number', 'label', 'বেড নম্বর'],
    },
    {
      field: 'bed_kind',
      required: true,
      kinds: ['text'],
      names: ['bed type', 'bed kind', 'type', 'kind', 'category', 'বেডের ধরন'],
    },
    {
      field: 'nightly_taka',
      required: true,
      kinds: ['integer', 'money'],
      names: ['rate', 'price', 'charge', 'rent', 'per night', 'nightly', 'ভাড়া'],
    },
  ],
  'structure:staff': [
    {
      field: 'ref',
      required: true,
      kinds: [],
      names: ['employee id', 'staff id', 'emp id', ...REF_NAMES],
    },
    {
      field: 'name_bn',
      required: true,
      kinds: ['text'],
      names: [...NAME_BN, ...NAME_EN, 'staff name', 'employee name'],
    },
    {
      field: 'email',
      required: true,
      kinds: ['email'],
      names: ['email', 'e mail', 'mail', 'ইমেইল'],
    },
    {
      field: 'role',
      required: true,
      kinds: ['text'],
      names: ['role', 'designation', 'position', 'পদবি', 'ভূমিকা'],
    },
  ],
};

/**
 * Pairs of fields of which one is enough.
 *
 * A patient needs a date of birth or an age, not both (`readPatient`). The
 * check enforces it per row; the mapping asks for it per file, so that a file
 * with neither column is stopped here with a sentence rather than failing on
 * every row.
 */
const ONE_OF: Readonly<Record<string, readonly (readonly string[])[]>> = {
  patients: [['date_of_birth', 'age_years']],
};

function targetKey(target: MappingTarget): string {
  return target.set === 'structure' ? `structure:${target.rowType}` : target.set;
}

/** The fields a file can be mapped onto for this target, in template order. */
export function targetFields(target: MappingTarget): readonly TargetField[] {
  return FIELDS[targetKey(target)] ?? [];
}

/** The groups of which one field is enough, for this target. */
export function targetOneOf(target: MappingTarget): readonly (readonly string[])[] {
  return ONE_OF[targetKey(target)] ?? [];
}

// ---------------------------------------------------------------------------
// Profiling (`FR-IMP-14`)
// ---------------------------------------------------------------------------

export interface ColumnProfile {
  readonly kind: ColumnKind;
  /** The share of rows with something in this column, 0 to 1, to two places. */
  readonly filled: number;
  /** How varied the values are. Never the values. */
  readonly distinct: 'none' | 'one' | 'few' | 'many' | 'unique';
  /** The longest value's length. */
  readonly maxLength: number;
}

export interface FileColumn {
  readonly index: number;
  /** The heading as the file has it. */
  readonly name: string;
  readonly profile: ColumnProfile;
}

/** How many rows a profile reads. Enough to be right, few enough to be instant. */
const PROFILE_ROWS = 500;

/** The kind of one cell. */
export function kindOfValue(raw: string): ColumnKind {
  const value = raw.trim();
  if (value === '') return 'empty';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';

  const latin = latinDigits(value);
  if (normaliseBdMobile(latin) !== null) return 'phone';
  if (readDate(value) !== null) return 'date';
  if (readTime(value) !== null) return 'time';
  if (/^\d{1,9}$/.test(latin.replace(/,/g, ''))) return 'integer';
  if (takaToPoisha(value) !== null) return 'money';
  return 'text';
}

/**
 * What each column of a file holds.
 *
 * A column is a kind when at least four in five of its filled cells are that
 * kind; otherwise it is text, which is always true. Whole numbers and money
 * are counted together towards money, because a fee column is mostly `800`
 * with the odd `800.50`.
 */
export function profileColumns(table: CsvTable): readonly FileColumn[] {
  const rows = table.rows.slice(0, PROFILE_ROWS);

  return table.header.map((name, index) => {
    const counts = new Map<ColumnKind, number>();
    const seen = new Set<string>();
    let filled = 0;
    let maxLength = 0;

    for (const row of rows) {
      const cell = (row.cells[index] ?? '').trim();
      if (cell === '') continue;
      filled += 1;
      maxLength = Math.max(maxLength, cell.length);
      seen.add(cell);
      const kind = kindOfValue(cell);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }

    let kind: ColumnKind = filled === 0 ? 'empty' : 'text';
    if (filled > 0) {
      const needed = filled * 0.8;
      const numeric = (counts.get('integer') ?? 0) + (counts.get('money') ?? 0);
      for (const candidate of ['email', 'phone', 'date', 'time', 'integer'] as const) {
        if ((counts.get(candidate) ?? 0) >= needed) {
          kind = candidate;
          break;
        }
      }
      if (kind === 'text' && numeric >= needed) kind = 'money';
    }

    const distinct: ColumnProfile['distinct'] =
      filled === 0
        ? 'none'
        : seen.size === 1
          ? 'one'
          : seen.size === filled
            ? 'unique'
            : seen.size <= 12
              ? 'few'
              : 'many';

    return {
      index,
      name: name.trim(),
      profile: {
        kind,
        filled: rows.length === 0 ? 0 : Math.round((filled / rows.length) * 100) / 100,
        distinct,
        maxLength,
      },
    };
  });
}

/**
 * Whether a first row reads as data rather than as headings (`FR-IMP-14`).
 *
 * A heading is a word. A phone number, a date or an email address in the
 * first row is a person; so is a row that is mostly numbers.
 */
export function headerLooksLikeData(header: readonly string[]): boolean {
  const kinds = header.map(kindOfValue).filter((kind) => kind !== 'empty');
  if (kinds.length === 0) return true;
  if (kinds.some((kind) => kind === 'phone' || kind === 'date' || kind === 'email')) return true;
  const numeric = kinds.filter((kind) => kind === 'integer' || kind === 'money').length;
  return numeric * 2 >= kinds.length;
}

/** Whether the file already has the template's own columns (`FR-IMP-13`). */
export function hasTemplateHeader(set: ImportSet, header: readonly string[]): boolean {
  const names = new Set(header.map((name) => name.trim().toLowerCase()));
  const required =
    set === 'structure'
      ? ['type', 'ref']
      : set === 'patients'
        ? ['ref', 'full_name', 'sex']
        : ['patient_ref', 'doctor_ref', 'date', 'serial'];
  return required.every((column) => names.has(column));
}

/**
 * A heading row as one line that identifies an export's format: the headings
 * folded and joined. The API hashes it; a saved mapping is found by that hash
 * when the same export comes again (`FR-IMP-20`).
 */
export function headerSignature(header: readonly string[]): string {
  return header.map(foldHeading).join('\u001f');
}

// ---------------------------------------------------------------------------
// Proposing (`FR-IMP-15`)
// ---------------------------------------------------------------------------

/** Folds a heading for comparison: one case, separators as single spaces. */
export function foldHeading(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[_\-./\\()[\]:#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where a proposal came from (`FR-IMP-15`). `model` and `saved` are set by the API. */
export type MappingSource = 'rule' | 'saved' | 'model' | 'manual';

/** Why a rule proposed a column, as a code the screen words in either language. */
export type ProposalReason = 'same_name' | 'known_name' | 'similar_name' | 'shape';

export interface FieldProposal {
  readonly field: string;
  /** The file column proposed for it, or null when nothing fits. */
  readonly column: number | null;
  /** 0 to 1. Null when nothing is proposed. */
  readonly confidence: number | null;
  readonly source: MappingSource | null;
  readonly reason: ProposalReason | null;
  /** A sentence from a model, when the model proposed it. Shown as written. */
  readonly note?: string | undefined;
}

/** Below this a rule says nothing rather than guess. */
const MIN_CONFIDENCE = 0.5;

function nameScore(
  heading: string,
  field: TargetField,
): { readonly score: number; readonly reason: ProposalReason } | null {
  if (heading === '') return null;
  if (heading === foldHeading(field.field)) return { score: 1, reason: 'same_name' };

  const names = field.names.map(foldHeading);
  if (names.includes(heading)) return { score: 0.9, reason: 'known_name' };

  // A heading that contains one of the names as whole words ("patient mobile
  // number" contains "mobile number"), or a name that contains the heading.
  const padded = ` ${heading} `;
  const within = names.some(
    (name) => name.length >= 3 && (padded.includes(` ${name} `) || ` ${name} `.includes(padded)),
  );
  return within ? { score: 0.6, reason: 'similar_name' } : null;
}

/**
 * Proposes a column for each field of a target, by rules alone.
 *
 * Every field gets an entry; one nothing fits has a null column. A column is
 * proposed for one field only, the one it fits best, so two fields never
 * silently share a column — a person can still choose that by hand.
 */
export function proposeMapping(
  target: MappingTarget,
  columns: readonly FileColumn[],
): readonly FieldProposal[] {
  const fields = targetFields(target);
  const candidates: {
    field: string;
    column: number;
    score: number;
    reason: ProposalReason;
  }[] = [];

  for (const field of fields) {
    for (const column of columns) {
      if (column.profile.kind === 'empty') continue;
      const named = nameScore(foldHeading(column.name), field);
      if (named === null) continue;

      // The values agree with the name, or argue with it.
      const fits = field.kinds.length === 0 || field.kinds.includes(column.profile.kind);
      const agrees = field.kinds.length > 0 && fits;
      const score = agrees
        ? Math.min(1, named.score + 0.05)
        : fits || column.profile.kind === 'text'
          ? named.score
          : named.score * 0.6;
      candidates.push({ field: field.field, column: column.index, score, reason: named.reason });
    }

    // The only column of a distinctive kind, for the one field of that kind:
    // a phone column is the mobile whatever it is called.
    const distinctive: readonly ColumnKind[] = field.kinds.filter(
      (kind) => kind === 'phone' || kind === 'date' || kind === 'time' || kind === 'email',
    );
    if (distinctive.length > 0) {
      const sameKind = columns.filter((column) => distinctive.includes(column.profile.kind));
      const fieldsOfKind = fields.filter((other) =>
        other.kinds.some((kind) => distinctive.includes(kind)),
      );
      const only = sameKind[0];
      if (sameKind.length === 1 && fieldsOfKind.length === 1 && only !== undefined) {
        candidates.push({ field: field.field, column: only.index, score: 0.5, reason: 'shape' });
      }
    }
  }

  // Best first; a tie goes to the earlier field and then the earlier column,
  // so the same file always gets the same proposal.
  const order = new Map(fields.map((field, index) => [field.field, index]));
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (order.get(a.field) ?? 0) - (order.get(b.field) ?? 0) ||
      a.column - b.column,
  );

  const taken = new Set<number>();
  const chosen = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (candidate.score < MIN_CONFIDENCE) continue;
    if (chosen.has(candidate.field) || taken.has(candidate.column)) continue;
    chosen.set(candidate.field, candidate);
    taken.add(candidate.column);
  }

  return fields.map((field) => {
    const pick = chosen.get(field.field);
    return pick === undefined
      ? { field: field.field, column: null, confidence: null, source: null, reason: null }
      : {
          field: field.field,
          column: pick.column,
          confidence: Math.round(pick.score * 100) / 100,
          source: 'rule' as const,
          reason: pick.reason,
        };
  });
}

/**
 * Which kind of row a structure file most likely holds: the type whose
 * required fields the rules place most of, and most surely. Null when no type
 * places even half of what it requires.
 */
export function guessStructureType(columns: readonly FileColumn[]): StructureType | null {
  let best: { type: StructureType; score: number } | null = null;

  for (const type of STRUCTURE_TYPES) {
    const target: MappingTarget = { set: 'structure', rowType: type };
    const required = targetFields(target).filter((field) => field.required);
    const proposals = proposeMapping(target, columns);
    const placed = required.filter((field) =>
      proposals.some((proposal) => proposal.field === field.field && proposal.column !== null),
    );
    if (placed.length * 2 < required.length) continue;

    const confidence = proposals.reduce((sum, proposal) => sum + (proposal.confidence ?? 0), 0);
    const score = placed.length / required.length + confidence / 100;
    if (best === null || score > best.score) best = { type, score };
  }

  return best?.type ?? null;
}

// ---------------------------------------------------------------------------
// A confirmed mapping (`FR-IMP-18`, `FR-IMP-19`)
// ---------------------------------------------------------------------------

/** Which file column feeds each template field. Null: that field is not imported. */
export interface ColumnMapping {
  readonly rowType: StructureType | null;
  readonly fields: Readonly<Record<string, number | null>>;
}

export type MappingProblem =
  | { readonly kind: 'row_type_required' }
  | { readonly kind: 'unknown_field'; readonly field: string }
  | { readonly kind: 'no_such_column'; readonly field: string }
  | { readonly kind: 'required_unmapped'; readonly field: string }
  | { readonly kind: 'one_of_unmapped'; readonly fields: readonly string[] };

/** The target a mapping is for, or null when a structure mapping names no row type. */
export function targetOf(set: ImportSet, rowType: StructureType | null): MappingTarget | null {
  if (set === 'structure') return rowType === null ? null : { set, rowType };
  return { set, rowType: null };
}

/**
 * What stops a mapping being used (`FR-IMP-18`): a field the template does
 * not have, a column the file does not have, a required field with no column,
 * or a pair of which neither is mapped.
 */
export function mappingProblems(
  set: ImportSet,
  mapping: ColumnMapping,
  columnCount: number,
): readonly MappingProblem[] {
  const target = targetOf(set, mapping.rowType);
  if (target === null) return [{ kind: 'row_type_required' }];

  const fields = targetFields(target);
  const known = new Set(fields.map((field) => field.field));
  const problems: MappingProblem[] = [];

  for (const [field, column] of Object.entries(mapping.fields)) {
    if (!known.has(field)) problems.push({ kind: 'unknown_field', field });
    else if (column !== null && (column < 0 || column >= columnCount)) {
      problems.push({ kind: 'no_such_column', field });
    }
  }

  const mapped = (field: string): boolean => (mapping.fields[field] ?? null) !== null;
  const eased = new Set(targetOneOf(target).flat());

  for (const field of fields) {
    if (field.required && !eased.has(field.field) && !mapped(field.field)) {
      problems.push({ kind: 'required_unmapped', field: field.field });
    }
  }
  for (const group of targetOneOf(target)) {
    if (!group.some(mapped)) problems.push({ kind: 'one_of_unmapped', fields: group });
  }

  return problems;
}

/** The file columns a mapping leaves out, to be listed as not imported (`FR-IMP-18`). */
export function unmappedColumns(
  mapping: ColumnMapping,
  columns: readonly FileColumn[],
): readonly FileColumn[] {
  const used = new Set(Object.values(mapping.fields).filter((column) => column !== null));
  return columns.filter((column) => !used.has(column.index));
}

/**
 * Rewrites a file into the template's shape (`FR-IMP-19`).
 *
 * The result is a CSV with the template's own heading row, which is what the
 * existing check takes. A structure file gets its `type` column filled with
 * the kind of row the mapping says the whole file is. Row order is kept, so
 * the row numbers the check reports are the rows of the file the hospital
 * uploaded.
 */
export function applyMapping(set: ImportSet, table: CsvTable, mapping: ColumnMapping): string {
  const columns: readonly string[] = IMPORT_COLUMNS[set];
  const lines = [csvLine(columns)];

  for (const row of table.rows) {
    lines.push(
      csvLine(
        columns.map((column) => {
          if (set === 'structure' && column === 'type') return mapping.rowType ?? '';
          const at = mapping.fields[column] ?? null;
          return at === null ? '' : (row.cells[at] ?? '').trim();
        }),
      ),
    );
  }

  return `${lines.join('\n')}\n`;
}
