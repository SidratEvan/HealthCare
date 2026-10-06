/**
 * `pnpm mapping:try` — what a model would be sent for a file, and what it
 * answers (`FR-IMP-16`, `FR-IMP-17`).
 *
 *   pnpm mapping:try --set patients --file database/seeds/samples/hospital-export-patients-abbreviated.csv
 *   pnpm mapping:try --set structure --type doctor --file doctors.csv
 *
 * Two uses. Before a model is switched on anywhere, it prints **exactly what
 * would leave the server** for a given file — headings, the kind of value in
 * each column, made-up examples — so that a hospital's IT can read it and see
 * that no row is in it. And with `MAPPING_PROVIDER=claude` and a key set, it
 * asks and prints the suggestions, which is how the adapter is tried against
 * the live service without opening the console.
 *
 * It reads a file and writes nothing: no database, no batch, no profile.
 * Never point it at a real hospital's export on a machine outside Bangladesh
 * for any reason other than this — what it *prints to your terminal* includes
 * nothing from the rows, but the file itself is still real data (`FR-SEC-08`,
 * `FR-IMP-11`).
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  IMPORT_SETS,
  STRUCTURE_TYPES,
  guessStructureType,
  headerLooksLikeData,
  modelMappingRequest,
  parseCsv,
  profileColumns,
  proposeMapping,
  targetOf,
  withModelSuggestions,
  type ImportSet,
  type StructureType,
} from '@platform/domain';

import { mappingProvider } from '../adapters/mapping.js';
import { env } from '../env.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      set: { type: 'string' },
      type: { type: 'string' },
      file: { type: 'string' },
    },
    strict: true,
  });

  const set = values.set as ImportSet | undefined;
  if (set === undefined || !(IMPORT_SETS as readonly string[]).includes(set)) {
    fail(`--set must be one of ${IMPORT_SETS.join(', ')}.`);
  }
  if (values.file === undefined) fail('--file is required: the CSV to read.');
  if (values.type !== undefined && !(STRUCTURE_TYPES as readonly string[]).includes(values.type)) {
    fail(`--type must be one of ${STRUCTURE_TYPES.join(', ')}.`);
  }

  const table = parseCsv(readFileSync(values.file, 'utf8'));
  if (typeof table === 'string') fail(`The file could not be read as CSV: ${table}.`);
  if (headerLooksLikeData(table.header)) {
    fail('The first row reads as data, not headings. Nothing is sent for such a file (FR-IMP-14).');
  }

  const columns = profileColumns(table);
  const rowType =
    set === 'structure'
      ? ((values.type as StructureType | undefined) ?? guessStructureType(columns))
      : null;
  const target = targetOf(set, rowType);
  if (target === null) fail('Could not tell what this file is a list of. Give --type.');

  const rules = proposeMapping(target, columns);
  const heading = (index: number | null): string =>
    index === null ? '(nothing)' : (columns[index]?.name ?? '?');

  console.log(`\n${String(table.rows.length)} rows, ${String(columns.length)} columns.`);
  console.log('\nPlaced by the rules:');
  for (const entry of rules) {
    console.log(`  ${entry.field.padEnd(16)} <- ${heading(entry.column)}`);
  }

  const asked = modelMappingRequest(target, columns, rules);
  if (asked === null) {
    console.log(
      '\nNothing is left to ask a model: every field has a column, or no column is spare.',
    );
    return;
  }

  console.log('\nWhat a model would be sent, in full (no value from any row):\n');
  console.log(JSON.stringify(asked, null, 2));

  if (env.MAPPING_PROVIDER === 'off') {
    console.log('\nMAPPING_PROVIDER=off: nobody was asked. Set it and MAPPING_API_KEY to ask.');
    return;
  }

  console.log(`\nAsking ${env.MAPPING_PROVIDER} (${env.MAPPING_MODEL})…`);
  const answer = await mappingProvider().propose(asked);
  if (answer.kind === 'unavailable') {
    console.log(`No suggestions: ${answer.reason}. An import carries on without them.`);
    return;
  }

  console.log('\nKept after checking (a suggestion is only a proposal):');
  for (const entry of withModelSuggestions(rules, asked, answer.suggestions)) {
    if (entry.source !== 'model') continue;
    console.log(
      `  ${entry.field.padEnd(16)} <- ${heading(entry.column)}  (${String(entry.confidence)})  ${entry.note ?? ''}`,
    );
  }
  const kept = withModelSuggestions(rules, asked, answer.suggestions).filter(
    (entry) => entry.source === 'model',
  ).length;
  console.log(
    `\n${String(answer.suggestions.length)} suggested, ${String(kept)} kept, ${String(answer.suggestions.length - kept)} dropped as outside what was asked.`,
  );
}

await main();
