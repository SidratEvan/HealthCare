'use client';

/**
 * The mapping step of `S-B-14` (`APP_FLOW.md` B6, `PRD.md` §14b
 * `FR-IMP-15`–`18`).
 *
 * A hospital's export has its own column names. This is where an
 * administrator says which of them is which: for each thing the import needs,
 * the column of their file that feeds it. The server has already proposed —
 * from rules, from the mapping this hospital confirmed last time, or from a
 * model — and every proposal says where it came from, how sure it is and why.
 * A proposal is only that. Nothing happens until the person presses confirm,
 * and what happens then is the ordinary check and preview, not a write
 * (`FR-IMP-19`).
 *
 * ## The table reads the way the question is asked
 *
 * One row per thing *we* need, not per column of *their* file. The
 * administrator's question is "have you got everything you need from my
 * file?", and a required field with no column is a row with a gap in it,
 * visible at a glance. The file's leftover columns are listed underneath as
 * what will not be imported, which is the other thing they want to know:
 * the address and the national ID are staying behind (`FR-IMP-02`).
 *
 * ## What it never shows
 *
 * A value from the file. A column is described by what kind of thing it holds
 * and how full it is; the rows themselves are shown later, in the preview,
 * after the check has read them.
 */

import {
  STRUCTURE_TYPES,
  mappingProblems,
  type ColumnMapping,
  type FieldProposal,
  type ImportSet,
  type StructureType,
} from '@platform/domain';
import {
  columnKindName,
  format,
  formatNumber,
  importFieldName,
  numeralsFor,
  structureTypeName,
  t,
  type ConsoleKey,
} from '@platform/i18n';
import { Button, Card, Chip, FilterChip, useLocale } from '@platform/ui';

import type { MappingAnalysis } from '@/lib/imports';
import type { ReactNode } from 'react';

const REASON: Readonly<Record<string, ConsoleKey>> = {
  same_name: 'importMapReasonSame',
  known_name: 'importMapReasonKnown',
  similar_name: 'importMapReasonSimilar',
  shape: 'importMapReasonShape',
};

const SOURCE: Readonly<Record<string, ConsoleKey>> = {
  rule: 'importMapSourceRule',
  saved: 'importMapSourceSaved',
  model: 'importMapSourceModel',
  manual: 'importMapSourceManual',
};

function sureness(confidence: number): ConsoleKey {
  if (confidence >= 0.85) return 'importMapSureHigh';
  if (confidence >= 0.6) return 'importMapSureMedium';
  return 'importMapSureLow';
}

export function ImportMapping({
  set,
  analysis,
  fields,
  busy,
  offlineReason,
  problem,
  onChoose,
  onRowType,
  onConfirm,
  onCancel,
}: {
  readonly set: ImportSet;
  readonly analysis: MappingAnalysis;
  /** The administrator's current choice for each field. */
  readonly fields: Readonly<Record<string, number | null>>;
  readonly busy: boolean;
  readonly offlineReason: string | null;
  readonly problem: string | null;
  readonly onChoose: (field: string, column: number | null) => void;
  readonly onRowType: (rowType: StructureType) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);

  const mapping: ColumnMapping = { rowType: analysis.rowType, fields };
  const problems = analysis.needsRowType
    ? []
    : mappingProblems(set, mapping, analysis.columns.length);
  const missing = problems.flatMap((entry) =>
    entry.kind === 'required_unmapped' ? [entry.field] : [],
  );
  const oneOf = problems.flatMap((entry) =>
    entry.kind === 'one_of_unmapped' ? [entry.fields] : [],
  );

  const used = new Set(Object.values(fields).filter((column) => column !== null));
  const leftOut = analysis.columns.filter((column) => !used.has(column.index));
  const proposals = new Map(analysis.proposal.map((entry) => [entry.field, entry]));

  const blocked =
    offlineReason ??
    (analysis.needsRowType
      ? t('importMapRowType', locale)
      : missing.length > 0
        ? format('importMapMissing', locale, {
            fields: missing.map((field) => importFieldName(field, locale)).join(', '),
          })
        : oneOf.length > 0
          ? format('importMapOneOf', locale, {
              fields: (oneOf[0] ?? []).map((field) => importFieldName(field, locale)).join(', '),
            })
          : problems.length > 0
            ? t('importMappingInvalid', locale)
            : null);

  return (
    <Card data-testid="import-mapping">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-title-md">{t('importMapTitle', locale)}</h2>
          <p className="text-body-sm text-ink-secondary">
            {format('importMapIntro', locale, {
              rows: formatNumber(analysis.rowCount, numerals),
            })}
          </p>
        </div>

        {analysis.fromSaved ? (
          <p
            className="rounded-sm bg-brand-100 px-3 py-2 text-body-sm"
            data-testid="map-from-saved"
          >
            {t('importMapSaved', locale)}
          </p>
        ) : null}

        {/* FR-IMP-16, FR-IMP-17: what part a model played, and what it was
            not given. Said only when one was asked. */}
        {analysis.model === 'used' ? (
          <p
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
            data-testid="map-model-used"
          >
            {t('importMapModelUsed', locale)}
          </p>
        ) : analysis.model === 'unavailable' ? (
          <p
            className="rounded-sm bg-sunken px-3 py-2 text-body-sm text-ink-secondary"
            data-testid="map-model-unavailable"
          >
            {t('importMapModelUnavailable', locale)}
          </p>
        ) : null}

        {set === 'structure' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body-md font-semibold">{t('importMapRowType', locale)}</legend>
            <p className="text-caption text-ink-muted">{t('importMapRowTypeHint', locale)}</p>
            <div className="flex flex-wrap gap-2" data-testid="map-row-type">
              {STRUCTURE_TYPES.map((type) => (
                <FilterChip
                  key={type}
                  selected={analysis.rowType === type}
                  onToggle={() => {
                    if (analysis.rowType !== type) onRowType(type);
                  }}
                >
                  {structureTypeName(type, locale)}
                </FilterChip>
              ))}
            </div>
          </fieldset>
        ) : null}

        {analysis.needsRowType ? null : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-body-sm">
                <thead>
                  <tr className="border-b border-line text-ink-secondary">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      {t('importMapFieldHead', locale)}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      {t('importMapColumnHead', locale)}
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      {t('importMapWhyHead', locale)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.fields.map((entry) => (
                    <FieldRow
                      key={entry.field}
                      field={entry.field}
                      required={entry.required}
                      eased={analysis.oneOf.some((group) => group.includes(entry.field))}
                      chosen={fields[entry.field] ?? null}
                      proposal={proposals.get(entry.field) ?? null}
                      analysis={analysis}
                      onChoose={onChoose}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* FR-IMP-18: what stays behind, named. */}
            <p className="text-body-sm text-ink-secondary" data-testid="map-not-imported">
              {leftOut.length === 0
                ? t('importMapAllUsed', locale)
                : format('importMapNotImported', locale, {
                    columns: leftOut.map((column) => column.name).join(', '),
                  })}
            </p>
          </>
        )}

        {blocked === null || analysis.needsRowType || offlineReason !== null ? null : (
          <p className="text-body-sm text-warn-700" data-testid="map-missing">
            {blocked}
          </p>
        )}

        {problem === null ? null : (
          <p role="alert" className="text-body-sm text-alert-700" data-testid="map-problem">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {blocked === null ? (
            <Button loading={busy} onClick={onConfirm} data-testid="map-confirm">
              {t('importMapConfirm', locale)}
            </Button>
          ) : (
            <Button disabled disabledReason={blocked} data-testid="map-confirm">
              {t('importMapConfirm', locale)}
            </Button>
          )}
          <Button variant="quiet" onClick={onCancel} data-testid="map-cancel">
            {t('importMapCancel', locale)}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FieldRow({
  field,
  required,
  eased,
  chosen,
  proposal,
  analysis,
  onChoose,
}: {
  readonly field: string;
  readonly required: boolean;
  /** One of a pair of which either is enough, so not marked required on its own. */
  readonly eased: boolean;
  readonly chosen: number | null;
  readonly proposal: FieldProposal | null;
  readonly analysis: MappingAnalysis;
  readonly onChoose: (field: string, column: number | null) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const column = chosen === null ? null : (analysis.columns[chosen] ?? null);

  // The proposal stands while the choice is still the one proposed; a change
  // makes it the administrator's own.
  const asProposed = proposal !== null && proposal.column === chosen && chosen !== null;
  const id = `map-${field}`;

  return (
    <tr className="border-b border-line align-top" data-testid={`map-row-${field}`}>
      <th scope="row" className="py-3 pr-4 font-normal">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-body-md">
          {importFieldName(field, locale)}
          {required && !eased ? <Chip tone="caution">{t('importMapRequired', locale)}</Chip> : null}
        </label>
      </th>
      <td className="py-3 pr-4">
        <select
          id={id}
          data-testid={id}
          value={chosen === null ? '' : String(chosen)}
          onChange={(event) => {
            onChoose(field, event.target.value === '' ? null : Number(event.target.value));
          }}
          className="min-h-touch w-full max-w-xs rounded-sm border border-line-strong bg-surface px-3 text-body-md text-ink"
        >
          <option value="">{t('importMapNone', locale)}</option>
          {analysis.columns.map((candidate) => (
            <option key={candidate.index} value={String(candidate.index)}>
              {candidate.name}
            </option>
          ))}
        </select>
        {column === null ? null : (
          <p className="mt-1 text-caption text-ink-muted" data-testid={`map-holds-${field}`}>
            {format('importMapHolds', locale, {
              kind: columnKindName(column.profile.kind, locale),
              filled: formatNumber(Math.round(column.profile.filled * 100), numerals),
            })}
          </p>
        )}
      </td>
      <td className="py-3" data-testid={`map-why-${field}`}>
        {chosen === null ? (
          <span className="text-ink-muted">{t('importMapSourceNothing', locale)}</span>
        ) : asProposed ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={proposal.source === 'model' ? 'caution' : 'neutral'}>
                {t(SOURCE[proposal.source ?? 'rule'] ?? 'importMapSourceRule', locale)}
              </Chip>
              {proposal.confidence === null || proposal.source === 'saved' ? null : (
                <span className="text-ink-secondary">
                  {t(sureness(proposal.confidence), locale)}
                </span>
              )}
            </div>
            {proposal.note !== undefined && proposal.note !== '' ? (
              <p className="text-caption text-ink-muted">{proposal.note}</p>
            ) : proposal.reason === null ? null : (
              <p className="text-caption text-ink-muted">
                {t(REASON[proposal.reason] ?? 'importMapReasonKnown', locale)}
              </p>
            )}
          </div>
        ) : (
          <Chip tone="neutral">{t('importMapSourceManual', locale)}</Chip>
        )}
      </td>
    </tr>
  );
}
