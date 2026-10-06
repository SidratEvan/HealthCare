/**
 * What a model is asked about a file, and what is kept of its answer
 * (`FR-IMP-16`, `FR-IMP-17`).
 *
 * Two properties, each of which is the reason the feature is allowed to
 * exist: no value from any row is in what a model is sent, and nothing a
 * model says can do more than fill a gap the rules left.
 */

import { describe, expect, it } from 'vitest';

import { parseCsv, type CsvTable } from '../csv.js';
import {
  modelMappingRequest,
  profileColumns,
  proposeMapping,
  withModelSuggestions,
  type MappingTarget,
  type ModelSuggestion,
} from '../mapping.js';

function table(text: string): CsvTable {
  const parsed = parseCsv(text);
  if (typeof parsed === 'string') throw new Error(`could not parse: ${parsed}`);
  return parsed;
}

const PATIENTS: MappingTarget = { set: 'patients', rowType: null };

/** Headings a rule cannot place: abbreviations a hospital system might export. */
const AWKWARD = table(
  [
    'MR#,Pt. Nm,Yrs,Sx,Pt. Cell,Grp,Vill,Father',
    'M-1,Rahima Khatun (Demo),38,F,01712345678,B+,Mirpur,Abdul Karim (Demo)',
    'M-2,Karim Uddin (Demo),51,M,01812345678,O+,Dhanmondi,Rahim Uddin (Demo)',
  ].join('\n'),
);

describe('what a model is asked (FR-IMP-17)', () => {
  const columns = profileColumns(AWKWARD);
  const rules = proposeMapping(PATIENTS, columns);
  const asked = modelMappingRequest(PATIENTS, columns, rules);

  it('is asked only about the fields the rules left open, and the columns they left unused', () => {
    expect(asked).not.toBeNull();
    // The only phone column is the mobile whatever it is called: a rule placed it.
    expect(asked?.alreadyMatched).toContainEqual({ field: 'mobile', heading: 'Pt. Cell' });
    expect(asked?.fields.map((field) => field.field)).not.toContain('mobile');
    expect(asked?.columns.map((column) => column.heading)).not.toContain('Pt. Cell');

    expect(asked?.fields.map((field) => field.field)).toEqual(
      expect.arrayContaining(['ref', 'full_name', 'sex', 'age_years']),
    );
    expect(asked?.columns.map((column) => column.heading)).toEqual(
      expect.arrayContaining(['MR#', 'Pt. Nm', 'Yrs', 'Sx']),
    );
  });

  it('carries headings, kinds and made-up examples, and no value from any row', () => {
    const sent = JSON.stringify(asked);

    for (const value of [
      'Rahima',
      'Karim',
      'Abdul',
      '01712345678',
      '01812345678',
      'Mirpur',
      'Dhanmondi',
      'M-1',
      'M-2',
    ]) {
      expect(sent, value).not.toContain(value);
    }
    // What a phone number looks like, said without one.
    const years = asked?.columns.find((column) => column.heading === 'Yrs');
    expect(years).toMatchObject({ holds: 'integer', looksLike: '123' });
  });

  it('says what each open field means, in a sentence', () => {
    for (const field of asked?.fields ?? []) {
      expect(field.means.length, field.field).toBeGreaterThan(10);
      expect(field.means, field.field).not.toBe(field.field);
    }
  });

  it('is not asked at all when the rules placed everything, or nothing is left over', () => {
    const tidy = table(
      'ref,full_name,date_of_birth,age_years,sex,mobile,blood_group\nP-1,A,,30,f,,\n',
    );
    const tidyColumns = profileColumns(tidy);
    expect(
      modelMappingRequest(PATIENTS, tidyColumns, proposeMapping(PATIENTS, tidyColumns)),
    ).toBeNull();

    // Open fields, but every column already used.
    const short = table('ref,full_name\nP-1,A\n');
    const shortColumns = profileColumns(short);
    expect(
      modelMappingRequest(PATIENTS, shortColumns, proposeMapping(PATIENTS, shortColumns)),
    ).toBeNull();
  });
});

describe('what is kept of a model’s answer (FR-IMP-16)', () => {
  const columns = profileColumns(AWKWARD);
  const rules = proposeMapping(PATIENTS, columns);
  const asked = modelMappingRequest(PATIENTS, columns, rules);
  if (asked === null) throw new Error('the awkward file should leave something to ask');

  const indexOf = (heading: string): number =>
    columns.find((column) => column.name === heading)?.index ?? -1;

  const good: ModelSuggestion[] = [
    {
      field: 'ref',
      column: indexOf('MR#'),
      confidence: 'high',
      reason: 'MR# is a medical record number.',
    },
    {
      field: 'full_name',
      column: indexOf('Pt. Nm'),
      confidence: 'high',
      reason: 'Pt. Nm abbreviates patient name.',
    },
    {
      field: 'age_years',
      column: indexOf('Yrs'),
      confidence: 'medium',
      reason: 'Yrs is years of age.',
    },
    { field: 'sex', column: indexOf('Sx'), confidence: 'medium', reason: 'Sx abbreviates sex.' },
  ];

  it('fills the gaps the rules left, marked as the model’s, with its reason', () => {
    const merged = withModelSuggestions(rules, asked, good);
    const ref = merged.find((entry) => entry.field === 'ref');

    expect(ref).toMatchObject({
      column: indexOf('MR#'),
      source: 'model',
      reason: null,
      note: 'MR# is a medical record number.',
    });
    // Never as sure as a rule's exact match.
    expect(ref?.confidence).toBeLessThan(0.9);
    expect(merged.find((entry) => entry.field === 'age_years')?.confidence).toBeLessThan(
      ref?.confidence ?? 0,
    );
  });

  it('never changes what a rule decided', () => {
    const overreach: ModelSuggestion[] = [
      {
        field: 'mobile',
        column: indexOf('MR#'),
        confidence: 'high',
        reason: 'I disagree with the rule.',
      },
    ];
    const merged = withModelSuggestions(rules, asked, overreach);

    expect(merged.find((entry) => entry.field === 'mobile')).toMatchObject({
      column: indexOf('Pt. Cell'),
      source: 'rule',
    });
  });

  it('drops a field the template does not have, and what must never be imported', () => {
    const stray: ModelSuggestion[] = [
      { field: 'national_id', column: indexOf('Vill'), confidence: 'high', reason: 'x' },
      { field: 'guardian', column: indexOf('Father'), confidence: 'high', reason: 'x' },
      { field: 'address', column: indexOf('Vill'), confidence: 'high', reason: 'x' },
    ];
    const merged = withModelSuggestions(rules, asked, stray);

    expect(merged).toEqual(rules);
    expect(merged.map((entry) => entry.field)).not.toContain('national_id');
  });

  it('drops a column that does not exist, was not offered, or is not a whole number', () => {
    const wild: ModelSuggestion[] = [
      { field: 'ref', column: 99, confidence: 'high', reason: 'x' },
      { field: 'full_name', column: indexOf('Pt. Cell'), confidence: 'high', reason: 'x' },
      { field: 'sex', column: 1.5, confidence: 'high', reason: 'x' },
      { field: 'age_years', column: -1, confidence: 'high', reason: 'x' },
    ];
    expect(withModelSuggestions(rules, asked, wild)).toEqual(rules);
  });

  it('keeps the first of two suggestions for one field, or for one column', () => {
    const twice: ModelSuggestion[] = [
      { field: 'ref', column: indexOf('MR#'), confidence: 'high', reason: 'first' },
      { field: 'ref', column: indexOf('Grp'), confidence: 'high', reason: 'second' },
      { field: 'full_name', column: indexOf('MR#'), confidence: 'high', reason: 'same column' },
    ];
    const merged = withModelSuggestions(rules, asked, twice);

    expect(merged.find((entry) => entry.field === 'ref')?.note).toBe('first');
    expect(merged.find((entry) => entry.field === 'full_name')?.column).toBeNull();
  });

  it('shortens a long reason and puts it on one line', () => {
    const windy: ModelSuggestion[] = [
      {
        field: 'ref',
        column: indexOf('MR#'),
        confidence: 'low',
        reason: `Line one.\n\n${'very '.repeat(100)}long.`,
      },
    ];
    const note = withModelSuggestions(rules, asked, windy).find(
      (entry) => entry.field === 'ref',
    )?.note;

    expect(note?.length).toBeLessThanOrEqual(200);
    expect(note).not.toContain('\n');
  });

  it('changes nothing when the model suggests nothing', () => {
    expect(withModelSuggestions(rules, asked, [])).toEqual(rules);
  });
});
