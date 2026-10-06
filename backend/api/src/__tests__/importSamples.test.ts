/**
 * The sample hospital exports in `database/seeds/samples` map by the rules
 * alone, and every row of each passes the importer's own reading.
 *
 * They are what is uploaded when the mapped import is shown to a hospital
 * (`FR-IMP-13`–`19`). A sample that stopped mapping — because a rule changed,
 * or somebody edited a heading — would fail in front of the people it is
 * shown to; this fails first.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  columnIndex,
  parseCsv,
  readRow,
  applyMapping,
  guessStructureType,
  mappingProblems,
  profileColumns,
  proposeMapping,
  targetOf,
  unmappedColumns,
  type ColumnMapping,
  type StructureType,
  type ImportSet,
} from '@platform/domain';

function sample(name: string): string {
  return readFileSync(
    new URL(`../../../../database/seeds/samples/${name}`, import.meta.url),
    'utf8',
  );
}

/** Maps a sample by the rules and reads every row the way the check does. */
function mapByRules(
  set: ImportSet,
  name: string,
): { readonly rowType: StructureType | null; readonly notImported: readonly string[] } {
  const table = parseCsv(sample(name));
  if (typeof table === 'string') throw new Error(`${name}: ${table}`);

  const columns = profileColumns(table);
  const rowType = set === 'structure' ? guessStructureType(columns) : null;
  const target = targetOf(set, rowType);
  if (target === null) throw new Error(`${name}: no kind of row could be guessed`);

  const mapping: ColumnMapping = {
    rowType,
    fields: Object.fromEntries(
      proposeMapping(target, columns).map((proposal) => [proposal.field, proposal.column]),
    ),
  };
  expect(mappingProblems(set, mapping, columns.length), name).toEqual([]);

  const rewritten = parseCsv(applyMapping(set, table, mapping));
  if (typeof rewritten === 'string') throw new Error(`${name}: rewritten file is ${rewritten}`);
  const index = columnIndex(set, rewritten.header);
  for (const row of rewritten.rows) {
    const result = readRow(set, row.cells, index);
    expect(result.ok, `${name} row ${String(row.rowNumber)}`).toBe(true);
  }

  return { rowType, notImported: unmappedColumns(mapping, columns).map((column) => column.name) };
}

describe('the sample exports (database/seeds/samples)', () => {
  it('a patient register in English headings: mapped, with the address and NID left behind', () => {
    const result = mapByRules('patients', 'hospital-export-patients.csv');
    expect(result.notImported).toEqual(['Address', 'NID']);
  });

  it('a patient register in Bangla headings, with ages', () => {
    const result = mapByRules('patients', 'hospital-export-patients-bangla.csv');
    expect(result.notImported).toEqual(['ঠিকানা']);
  });

  it('a departments list is recognised as one', () => {
    expect(mapByRules('structure', 'hospital-export-departments.csv').rowType).toBe('department');
  });

  it('a doctors list is recognised as one', () => {
    expect(mapByRules('structure', 'hospital-export-doctors.csv').rowType).toBe('doctor');
  });

  it('says every sample row is demonstration data (FR-DEM-07)', () => {
    for (const name of [
      'hospital-export-patients.csv',
      'hospital-export-patients-bangla.csv',
      'hospital-export-departments.csv',
      'hospital-export-doctors.csv',
    ]) {
      const rows = sample(name).trim().split(/\r?\n/).slice(1);
      for (const row of rows) expect(row, name).toMatch(/\(Demo\)|\(ডেমো\)/);
    }
  });
});
