/**
 * Mapping a hospital's own export onto the import template (`PRD.md` §14b,
 * `FR-IMP-13`–`20`; `S-B-14`).
 *
 * Two calls, and the line between them is the point:
 *
 *   - **`analyse`** reads a file and proposes. It writes nothing — not a
 *     batch, not a row, not a profile. It answers with the file's columns and
 *     what each holds, and for each template field the column proposed for it.
 *   - **`confirm`** takes the mapping a person confirmed, rewrites the file
 *     into the template's shape, and hands it to `check`, the importer that
 *     already exists. From there everything is as it was: a preview, an
 *     approval, an all-or-nothing write, an undo, an audit (`FR-IMP-05`–`08`).
 *
 * **Nothing in this file decides what is importable, and nothing in it writes
 * to a hospital's records.** A mapping only says which column is which. The
 * check still refuses a bad mobile number, a duplicate, an unknown doctor; a
 * wrong mapping produces a preview full of errors and no data (`FR-IMP-19`).
 *
 * ## Proposals come from the server's own rules, or from this hospital's
 * last confirmed mapping
 *
 * A saved mapping is found by a hash of the folded heading row, so the same
 * export next month maps itself (`FR-IMP-20`). What is saved is headings'
 * positions; no cell value is stored, here or anywhere (`0038`).
 *
 * ## The audit says who chose what, and from where
 *
 * One `SETTINGS_CHANGE` row per confirmed mapping: the set, the kind of row,
 * the batch it became, and for each field the heading chosen and whether a
 * rule proposed it, a saved mapping carried it over, a model suggested it or
 * the administrator picked it by hand. Headings are a file's column names and
 * are not patient data; a cell value never reaches this row (`FR-IMP-20`).
 */

import { createHash } from 'node:crypto';

import {
  applyMapping,
  guessStructureType,
  hasTemplateHeader,
  headerLooksLikeData,
  headerSignature,
  mappingProblems,
  modelMappingRequest,
  parseCsv,
  profileColumns,
  proposeMapping,
  targetFields,
  targetOf,
  targetOneOf,
  unmappedColumns,
  withModelSuggestions,
  type ColumnMapping,
  type CsvTable,
  type FieldProposal,
  type FileColumn,
  type ImportSet,
  type MappingSource,
  type StructureType,
} from '@platform/domain';

import { proposeSafely } from '../adapters/mapping.js';
import { AppError } from '../errors/AppError.js';
import * as repo from '../repositories/import.repo.js';

import { MAX_IMPORT_ROWS, check, type BatchView, type ImportActor } from './import.service.js';

const refused = (reason: string, extra: Record<string, unknown> = {}): AppError =>
  new AppError('IMPORT_FILE', { details: { reason, ...extra } });

/** What `POST /hospital/imports/analyse` answers. */
export interface MappingAnalysis {
  /**
   * The file already has the template's columns: there is nothing to map, and
   * the caller sends it to the ordinary check (`FR-IMP-13`).
   */
  readonly templateShaped: boolean;
  readonly rowCount: number;
  readonly columns: readonly FileColumn[];
  /** For a structure file: the kind of row it holds, chosen, remembered or guessed. */
  readonly rowType: StructureType | null;
  /** True when a structure file's kind has to be chosen before fields can be shown. */
  readonly needsRowType: boolean;
  readonly fields: readonly { readonly field: string; readonly required: boolean }[];
  /** Groups of fields of which one is enough (a date of birth or an age). */
  readonly oneOf: readonly (readonly string[])[];
  readonly proposal: readonly FieldProposal[];
  /** True when the proposal is this hospital's last confirmed mapping for these headings. */
  readonly fromSaved: boolean;
  /**
   * What part a model played (`FR-IMP-16`):
   * `used` — it suggested at least one column, marked `source: 'model'`;
   * `nothing` — it was asked and suggested nothing that could be used;
   * `unavailable` — it was asked and could not answer, so the rules stand alone;
   * `not_asked` — there was nothing to ask, or no model is configured.
   */
  readonly model: 'used' | 'nothing' | 'unavailable' | 'not_asked';
}

function readFile(csv: string): CsvTable {
  const table = parseCsv(csv);
  if (table === 'empty' || table === 'unterminated_quote') throw refused(table);
  if (table.rows.length > MAX_IMPORT_ROWS) throw refused('too_many_rows', { max: MAX_IMPORT_ROWS });
  return table;
}

function headerHash(table: CsvTable): string {
  return createHash('sha256').update(headerSignature(table.header), 'utf8').digest('hex');
}

/** A saved mapping as proposals: each confirmed choice, offered again. */
function proposalsFromSaved(
  saved: repo.MappingProfile,
  fields: readonly { readonly field: string }[],
  columnCount: number,
): readonly FieldProposal[] {
  return fields.map(({ field }) => {
    const column = saved.mapping[field] ?? null;
    return column === null || column >= columnCount
      ? { field, column: null, confidence: null, source: null, reason: null }
      : { field, column, confidence: 1, source: 'saved' as const, reason: null };
  });
}

/**
 * Reads a file and proposes a mapping (`FR-IMP-13`–`15`). Writes nothing.
 */
export async function analyse(
  actor: ImportActor,
  input: {
    readonly set: ImportSet;
    readonly csv: string;
    readonly rowType?: StructureType | undefined;
  },
): Promise<MappingAnalysis> {
  const table = readFile(input.csv);

  if (hasTemplateHeader(input.set, table.header)) {
    return {
      templateShaped: true,
      rowCount: table.rows.length,
      columns: [],
      rowType: null,
      needsRowType: false,
      fields: [],
      oneOf: [],
      proposal: [],
      fromSaved: false,
      model: 'not_asked',
    };
  }

  // `FR-IMP-14`: a first row that is a patient is not a row of headings, and
  // everything after this point shows, stores and may send headings.
  if (headerLooksLikeData(table.header)) throw refused('no_header_row');

  const columns = profileColumns(table);
  const saved = await repo.findMappingProfile({
    hospitalId: actor.hospitalId,
    set: input.set,
    headerSha256: headerHash(table),
  });

  // The kind of row, for a structure file: what was asked for, else what this
  // hospital confirmed for these headings before, else a guess from them.
  const rowType =
    input.set === 'structure'
      ? (input.rowType ?? saved?.rowType ?? guessStructureType(columns))
      : null;

  const target = targetOf(input.set, rowType);
  if (target === null) {
    return {
      templateShaped: false,
      rowCount: table.rows.length,
      columns,
      rowType: null,
      needsRowType: true,
      fields: [],
      oneOf: [],
      proposal: [],
      fromSaved: false,
      model: 'not_asked',
    };
  }

  const fields = targetFields(target).map(({ field, required }) => ({ field, required }));
  // A saved mapping is offered only for the kind of row it was confirmed for.
  const useSaved = saved !== null && saved.rowType === rowType;

  if (useSaved) {
    // The hospital's own confirmed mapping: nothing to ask anybody.
    return {
      templateShaped: false,
      rowCount: table.rows.length,
      columns,
      rowType,
      needsRowType: false,
      fields,
      oneOf: targetOneOf(target),
      proposal: proposalsFromSaved(saved, fields, columns.length),
      fromSaved: true,
      model: 'not_asked',
    };
  }

  // Rules first. A model is asked only about what they left open, and only
  // with headings and profiles: `modelMappingRequest` is built from
  // `columns`, which hold no value from any row (`FR-IMP-17`).
  const rules = proposeMapping(target, columns);
  const asked = modelMappingRequest(target, columns, rules);
  let proposal = rules;
  let model: MappingAnalysis['model'] = 'not_asked';

  if (asked !== null) {
    const answer = await proposeSafely(asked);
    if (answer.kind === 'suggestions') {
      // Untrusted: kept only where it names a field that was asked about and
      // a column that was offered (`withModelSuggestions`).
      proposal = withModelSuggestions(rules, asked, answer.suggestions);
      model = proposal.some((entry) => entry.source === 'model') ? 'used' : 'nothing';
    } else if (answer.reason !== 'off') {
      // It could not answer. The rules stand, and the screen says so.
      model = 'unavailable';
    }
  }

  return {
    templateShaped: false,
    rowCount: table.rows.length,
    columns,
    rowType,
    needsRowType: false,
    fields,
    oneOf: targetOneOf(target),
    proposal,
    fromSaved: false,
    model,
  };
}

/** Where each confirmed choice came from, for the audit and the saved profile. */
function sourcesOf(input: {
  readonly mapping: ColumnMapping;
  readonly rules: readonly FieldProposal[];
  readonly saved: repo.MappingProfile | null;
  readonly suggestedByModel: readonly string[];
}): Record<string, MappingSource> {
  const sources: Record<string, MappingSource> = {};
  const byModel = new Set(input.suggestedByModel);

  for (const [field, column] of Object.entries(input.mapping.fields)) {
    if (column === null) continue;
    const rule = input.rules.find((proposal) => proposal.field === field);

    if (input.saved !== null && (input.saved.mapping[field] ?? null) === column) {
      sources[field] = 'saved';
    } else if (rule?.column === column) {
      sources[field] = 'rule';
    } else if (byModel.has(field)) {
      // The caller says a model suggested it. Only believed when no rule and
      // no saved mapping accounts for the same choice, and it changes nothing
      // but this word on the audit row.
      sources[field] = 'model';
    } else {
      sources[field] = 'manual';
    }
  }
  return sources;
}

/**
 * Takes a confirmed mapping to the existing check (`FR-IMP-18`–`20`).
 *
 * Refused before anything is written when the mapping names a field the
 * template does not have, a column the file does not have, or leaves a
 * required field with no column. Then the file is rewritten into the
 * template's shape and checked exactly as an ordinary upload is; the batch
 * carries the original file's fingerprint, because that is the file the
 * hospital gave (`FR-IMP-08`).
 */
export async function confirm(
  actor: ImportActor,
  input: {
    readonly set: ImportSet;
    readonly fileName: string;
    readonly csv: string;
    readonly mapping: ColumnMapping;
    /** Fields whose column a model suggested, as the screen reports it. */
    readonly suggestedByModel?: readonly string[] | undefined;
  },
): Promise<BatchView> {
  const table = readFile(input.csv);
  if (headerLooksLikeData(table.header)) throw refused('no_header_row');

  const problems = mappingProblems(input.set, input.mapping, table.header.length);
  if (problems.length > 0) throw refused('mapping_invalid', { problems });

  const target = targetOf(input.set, input.mapping.rowType);
  if (target === null)
    throw refused('mapping_invalid', { problems: [{ kind: 'row_type_required' }] });

  const columns = profileColumns(table);
  const headerSha256 = headerHash(table);
  const saved = await repo.findMappingProfile({
    hospitalId: actor.hospitalId,
    set: input.set,
    headerSha256,
  });
  const sources = sourcesOf({
    mapping: input.mapping,
    rules: proposeMapping(target, columns),
    saved: saved !== null && saved.rowType === input.mapping.rowType ? saved : null,
    suggestedByModel: input.suggestedByModel ?? [],
  });

  // The existing importer, unchanged: this is where rows are read, checked
  // and stored for the preview (`FR-IMP-05`, `FR-IMP-19`).
  const batch = await check(actor, {
    set: input.set,
    fileName: input.fileName,
    csv: applyMapping(input.set, table, input.mapping),
    fileSha256: createHash('sha256').update(input.csv, 'utf8').digest('hex'),
  });

  // Only what a mapping is: which heading feeds which field. No cell value.
  const chosen = Object.fromEntries(
    Object.entries(input.mapping.fields)
      .filter((entry): entry is [string, number] => entry[1] !== null)
      .map(([field, column]) => [
        field,
        { heading: columns[column]?.name ?? '', source: sources[field] ?? 'manual' },
      ]),
  );

  await repo.saveMappingProfile({
    hospitalId: actor.hospitalId,
    set: input.set,
    headerSha256,
    rowType: input.mapping.rowType,
    mapping: input.mapping.fields,
    sources,
    approvedBy: actor.staffId,
    audit: {
      ip: actor.ip,
      userAgent: actor.userAgent,
      batchId: batch.id,
      fields: chosen,
      notImported: unmappedColumns(input.mapping, columns).map((column) => column.name),
    },
  });

  return batch;
}
