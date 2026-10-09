'use client';

/**
 * `S-B-14` Import (pilot step 24, `APP_FLOW.md` B6, `PRD.md` §14b,
 * `FR-IMP-01`…`09`).
 *
 * A hospital brings in what it already holds, one set at a time: choose the
 * set, download its template, choose the CSV saved from the hospital's own
 * system, and **যাচাই করুন** — which writes nothing but a preview: how many
 * rows add, update and are skipped, and every error with its row number,
 * column and reason. **অনুমোদন করে সংরক্ষণ** writes it all or nothing; the
 * history below lists every batch, and a committed one can be taken back.
 *
 * ## The four states (`GR-03`)
 *
 * Loading is the shape of the screen. With no batch yet, the three templates
 * are the call to action. A failed load says so with a retry. Offline, the
 * chosen file stays chosen and every action says it needs the connection.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { NO_WARNINGS, type ImportSet, type StructureType } from '@platform/domain';
import {
  format,
  formatDateTime,
  formatNumber,
  numeralsFor,
  t,
  type ConsoleKey,
} from '@platform/i18n';
import {
  Button,
  Card,
  Chip,
  FilterChip,
  Sheet,
  SheetActions,
  ToastProvider,
  useLocale,
  useToast,
} from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { DemoBanner } from '@/components/DemoBanner';
import { ImportMapping } from '@/components/ImportMapping';
import { ImportWarnings } from '@/components/ImportWarnings';
import {
  downloadTemplate,
  readImportFile,
  importApi,
  type ImportBatch,
  type ImportBatchView,
  type ImportFailure,
  type MappingAnalysis,
} from '@/lib/imports';

const SETS: readonly {
  readonly set: ImportSet;
  readonly key: ConsoleKey;
  readonly help: ConsoleKey;
}[] = [
  { set: 'structure', key: 'importSetStructure', help: 'importSetStructureHelp' },
  { set: 'patients', key: 'importSetPatients', help: 'importSetPatientsHelp' },
  { set: 'appointments', key: 'importSetAppointments', help: 'importSetAppointmentsHelp' },
];

const SET_NAME: Readonly<Record<string, ConsoleKey>> = {
  structure: 'importSetStructure',
  patients: 'importSetPatients',
  appointments: 'importSetAppointments',
  records: 'importSetRecords',
};

const STATE_NAME: Readonly<Record<string, ConsoleKey>> = {
  checked: 'importStateChecked',
  committed: 'importStateCommitted',
  undone: 'importStateUndone',
  discarded: 'importStateDiscarded',
};

const ERROR_NAME: Readonly<Record<string, ConsoleKey>> = {
  required: 'importErrRequired',
  invalid: 'importErrInvalid',
  unknown_type: 'importErrUnknownType',
  unknown_value: 'importErrUnknownValue',
  not_bd_mobile: 'importErrMobile',
  bad_date: 'importErrDate',
  bad_time: 'importErrTime',
  out_of_range: 'importErrRange',
  end_before_start: 'importErrEndBeforeStart',
  duplicate_in_file: 'importErrDuplicate',
  unknown_ref: 'importErrUnknownRef',
  no_chamber: 'importErrNoChamber',
  serial_taken: 'importErrSerialTaken',
  conflict: 'importErrConflict',
};

type Load = 'loading' | 'ready' | 'error' | 'offline';

/** Why a chosen file gave nothing to check (`FR-IMP-22`, plan E1). */
const READ_PROBLEM = {
  legacy_xls: 'importLegacyXls',
  unreadable: 'importUnreadable',
  too_big: 'importTooBig',
} as const;

export function HospitalImport(): ReactNode {
  return (
    <ToastProvider placement="console">
      <ImportScreen />
    </ToastProvider>
  );
}

function ImportScreen(): ReactNode {
  const locale = useLocale();
  const { show } = useToast();
  const numerals = numeralsFor(locale);
  const [history, setHistory] = useState<readonly ImportBatch[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [online, setOnline] = useState(true);
  const [set, setSet] = useState<ImportSet>('structure');
  const [file, setFile] = useState<{ readonly name: string; readonly text: string } | null>(null);
  /** An `.xlsx` chosen (`FR-IMP-22`, plan E1): the file, its sheets with rows, and which is read. */
  const [workbook, setWorkbook] = useState<{
    readonly source: File;
    readonly sheets: readonly string[];
    readonly sheet: string | null;
  } | null>(null);
  const [preview, setPreview] = useState<ImportBatchView | null>(null);
  /**
   * The mapping step (`FR-IMP-15`–`18`): shown when the file's columns are
   * not the template's. `chosen` starts as the server's proposal and becomes
   * the administrator's; nothing is saved until they confirm.
   */
  const [mapping, setMapping] = useState<{
    readonly analysis: MappingAnalysis;
    readonly chosen: Readonly<Record<string, number | null>>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    readonly kind: 'commit' | 'undo';
    readonly batch: ImportBatch;
  } | null>(null);

  const reload = useCallback(async () => {
    const result = await importApi.history();
    if (result.ok) {
      setHistory(result.value);
      setLoad('ready');
    } else {
      setLoad((current) =>
        current === 'ready' ? current : result.failure.kind === 'offline' ? 'offline' : 'error',
      );
      if (result.failure.kind === 'offline') setOnline(false);
    }
  }, []);

  useEffect(() => {
    setOnline(globalThis.navigator.onLine);
    void reload();
    const up = (): void => {
      setOnline(true);
      void reload();
    };
    const down = (): void => {
      setOnline(false);
    };
    globalThis.addEventListener('online', up);
    globalThis.addEventListener('offline', down);
    return () => {
      globalThis.removeEventListener('online', up);
      globalThis.removeEventListener('offline', down);
    };
  }, [reload]);

  function failureText(failure: ImportFailure): string {
    switch (failure.kind) {
      case 'offline':
        return t('importOffline', locale);
      case 'tooLarge':
        return t('importFileTooLarge', locale);
      case 'file':
        if (failure.reason === 'missing_columns') {
          return format('importFileMissingColumns', locale, {
            columns: failure.columns.join(', '),
          });
        }
        if (failure.reason === 'too_many_rows') return t('importFileTooManyRows', locale);
        if (failure.reason === 'no_header_row') return t('importFileNoHeader', locale);
        if (failure.reason === 'mapping_invalid') return t('importMappingInvalid', locale);
        return t('importFileUnreadable', locale);
      case 'state':
        if (failure.reason === 'conflict' && failure.rowNumber !== null) {
          return format('importCommitConflict', locale, {
            row: formatNumber(failure.rowNumber, numerals),
          });
        }
        return t('importWrongState', locale);
      case 'blocked':
        return format('importUndoBlocked', locale, {
          rows: failure.rows.map((row) => formatNumber(row, numerals)).join(', '),
        });
      case 'failed':
        return t('settingsSaveFailed', locale);
    }
  }

  /** The choices a proposal starts the administrator on. */
  function chosenFrom(analysis: MappingAnalysis): Record<string, number | null> {
    return Object.fromEntries(analysis.proposal.map((entry) => [entry.field, entry.column]));
  }

  /**
   * `BTN-B14-CHECK`. A file in the template's shape goes straight to the
   * check, as it always has. Any other file is read first: the server says
   * what its columns hold and proposes which is which, and the mapping step
   * opens (`FR-IMP-13`).
   */
  async function check(): Promise<void> {
    if (file === null || busy) return;
    setBusy(true);
    setProblem(null);
    setMapping(null);

    const analysed = await importApi.analyse(set, file.text);
    if (!analysed.ok) {
      setBusy(false);
      if (analysed.failure.kind === 'offline') setOnline(false);
      setProblem(failureText(analysed.failure));
      return;
    }
    if (!analysed.value.templateShaped) {
      setBusy(false);
      setMapping({ analysis: analysed.value, chosen: chosenFrom(analysed.value) });
      return;
    }

    const result = await importApi.check(set, file.name, file.text);
    setBusy(false);
    if (!result.ok) {
      if (result.failure.kind === 'offline') setOnline(false);
      setProblem(failureText(result.failure));
      return;
    }
    setPreview(result.value);
    void reload();
  }

  /** A structure file is one kind of row; choosing another re-reads it as that. */
  async function chooseRowType(rowType: StructureType): Promise<void> {
    if (file === null || busy) return;
    setBusy(true);
    setProblem(null);
    const analysed = await importApi.analyse(set, file.text, rowType);
    setBusy(false);
    if (!analysed.ok) {
      if (analysed.failure.kind === 'offline') setOnline(false);
      setProblem(failureText(analysed.failure));
      return;
    }
    setMapping({ analysis: analysed.value, chosen: chosenFrom(analysed.value) });
  }

  /** `BTN-B14-MAP-CONFIRM`: the confirmed mapping goes to the ordinary check. */
  async function confirmMapping(): Promise<void> {
    if (file === null || mapping === null || busy) return;
    setBusy(true);
    setProblem(null);

    // Which fields still hold a column a model suggested, for the audit.
    const byModel = mapping.analysis.proposal
      .filter((entry) => entry.source === 'model' && mapping.chosen[entry.field] === entry.column)
      .map((entry) => entry.field);

    const result = await importApi.checkMapped(
      set,
      file.name,
      file.text,
      { rowType: mapping.analysis.rowType, fields: mapping.chosen },
      byModel,
    );
    setBusy(false);
    if (!result.ok) {
      if (result.failure.kind === 'offline') setOnline(false);
      setProblem(failureText(result.failure));
      return;
    }
    setMapping(null);
    setPreview(result.value);
    void reload();
  }

  async function run(kind: 'commit' | 'undo' | 'discard', batch: ImportBatch): Promise<void> {
    setBusy(true);
    const result =
      kind === 'commit'
        ? await importApi.commit(batch.id)
        : kind === 'undo'
          ? await importApi.undo(batch.id)
          : await importApi.discard(batch.id);
    setBusy(false);
    setConfirming(null);
    if (!result.ok) {
      if (result.failure.kind === 'offline') setOnline(false);
      show({ title: failureText(result.failure), tone: 'alert' });
      return;
    }
    const done: Record<typeof kind, ConsoleKey> = {
      commit: 'importCommitted',
      undo: 'importUndone',
      discard: 'importDiscarded',
    };
    show({ title: t(done[kind], locale), tone: 'positive' });
    if (preview?.id === batch.id) setPreview(kind === 'commit' ? result.value : null);
    void reload();
  }

  const offlineReason = online ? null : t('importOffline', locale);

  return (
    <div className="min-h-screen">
      {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
      <DemoBanner />

      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6" data-testid="hospital-import">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-title-lg">{t('importTitle', locale)}</h1>
            <p className="text-body-sm text-ink-muted">{t('importIntro', locale)}</p>
          </div>
          <div className="flex items-center gap-3">
            <ConsoleLanguageSwitch className="" />
            <a
              href="/?view=settings"
              className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100"
            >
              {t('importBack', locale)}
            </a>
          </div>
        </header>

        {online ? null : (
          <p
            role="status"
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
            data-testid="import-offline"
          >
            {t('importOfflineKept', locale)}
          </p>
        )}

        {/* --- SEL-B14-SET, BTN-B14-TEMPLATE, INP-B14-FILE, BTN-B14-CHECK --- */}
        <Card>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body-md font-semibold">
              {t('importChooseSet', locale)}
            </legend>
            <div className="flex flex-wrap gap-2">
              {SETS.map((entry) => (
                <FilterChip
                  key={entry.set}
                  selected={set === entry.set}
                  onToggle={() => {
                    setSet(entry.set);
                    setPreview(null);
                    setMapping(null);
                    setProblem(null);
                  }}
                >
                  {t(entry.key, locale)}
                </FilterChip>
              ))}
              <span className="flex flex-col" aria-disabled="true">
                <Chip tone="neutral">{t('importSetRecords', locale)}</Chip>
                <span className="mt-1 text-caption text-ink-muted">
                  {t('importRecordsLater', locale)}
                </span>
              </span>
            </div>
          </fieldset>
          <p className="mt-3 text-body-sm text-ink-secondary">
            {t(SETS.find((entry) => entry.set === set)?.help ?? 'importSetStructureHelp', locale)}
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Button
              variant="secondary"
              data-testid="import-template"
              onClick={() => {
                void downloadTemplate(set).then((saved) => {
                  if (!saved) show({ title: t('importTemplateFailed', locale), tone: 'alert' });
                });
              }}
            >
              {t('importTemplate', locale)}
            </Button>
            <label className="flex flex-col gap-2 text-body-sm font-semibold text-ink">
              {t('importFile', locale)}
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                data-testid="import-file"
                className="text-body-sm"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  setPreview(null);
                  setMapping(null);
                  setProblem(null);
                  setWorkbook(null);
                  if (chosen === undefined) {
                    setFile(null);
                    return;
                  }
                  void readImportFile(chosen).then((read) => {
                    if (read.kind !== 'ok') {
                      setFile(null);
                      setProblem(t(READ_PROBLEM[read.kind], locale));
                      return;
                    }
                    setFile({ name: read.name, text: read.text });
                    setWorkbook(
                      read.sheets.length === 0
                        ? null
                        : { source: chosen, sheets: read.sheets, sheet: read.sheet },
                    );
                  });
                }}
              />
            </label>
            {offlineReason !== null ? (
              <Button disabled disabledReason={offlineReason} data-testid="import-check">
                {t('importCheck', locale)}
              </Button>
            ) : file === null ? (
              <Button
                disabled
                disabledReason={t('importChooseFileFirst', locale)}
                data-testid="import-check"
              >
                {t('importCheck', locale)}
              </Button>
            ) : (
              <Button loading={busy} onClick={() => void check()} data-testid="import-check">
                {t('importCheck', locale)}
              </Button>
            )}
          </div>
          {/* A workbook with more than one sheet holding rows: which one is read. */}
          {workbook === null || workbook.sheets.length < 2 ? null : (
            <label className="mt-3 flex flex-col gap-2 text-body-sm font-semibold text-ink">
              {t('importSheet', locale)}
              <select
                value={workbook.sheet ?? ''}
                data-testid="import-sheet"
                className="min-h-touch rounded-md border border-line-strong bg-surface px-3 text-body-md"
                onChange={(event) => {
                  const sheet = event.target.value;
                  setPreview(null);
                  setMapping(null);
                  setProblem(null);
                  void readImportFile(workbook.source, sheet).then((read) => {
                    if (read.kind !== 'ok') {
                      setFile(null);
                      setProblem(t(READ_PROBLEM[read.kind], locale));
                      return;
                    }
                    setFile({ name: read.name, text: read.text });
                    setWorkbook({ ...workbook, sheet: read.sheet });
                  });
                }}
              >
                {workbook.sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="mt-3 text-caption text-ink-muted" data-testid="import-own-file">
            {t('importOwnFile', locale)}
          </p>
          {problem === null || mapping !== null ? null : (
            <p
              role="alert"
              className="mt-3 text-body-sm text-alert-700"
              data-testid="import-problem"
            >
              {problem}
            </p>
          )}
        </Card>

        {/* --- TBL-B14-MAP, BTN-B14-MAP-CONFIRM: the file's own columns, matched --- */}
        {mapping === null ? null : (
          <ImportMapping
            set={set}
            analysis={mapping.analysis}
            fields={mapping.chosen}
            busy={busy}
            offlineReason={offlineReason}
            problem={problem}
            onChoose={(field, column) => {
              setMapping((current) =>
                current === null
                  ? current
                  : { ...current, chosen: { ...current.chosen, [field]: column } },
              );
            }}
            onRowType={(rowType) => {
              void chooseRowType(rowType);
            }}
            onConfirm={() => {
              void confirmMapping();
            }}
            onCancel={() => {
              setMapping(null);
              setProblem(null);
            }}
          />
        )}

        {/* --- TBL-B14-PREVIEW, BTN-B14-COMMIT, BTN-B14-DISCARD ------------------- */}
        {preview === null ? null : (
          <Card data-testid="import-preview">
            <h2 className="text-title-md">
              {format('importPreviewOf', locale, { file: preview.fileName })}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {(
                [
                  ['add', 'importCountAdd'],
                  ['update', 'importCountUpdate'],
                  ['skip', 'importCountSkip'],
                  ['error', 'importCountError'],
                ] as const
              ).map(([field, key]) => (
                <div
                  key={field}
                  className="rounded-md bg-sunken p-3"
                  data-testid={`import-count-${field}`}
                >
                  <dt className="text-caption text-ink-muted">{t(key, locale)}</dt>
                  <dd className="text-title-md tabular-nums">
                    {formatNumber(preview.counts[field], numerals)}
                  </dd>
                </div>
              ))}
            </dl>

            {/* --- TXT-B14-WARN (FR-IMP-21): not errors, and not hidden either ----- */}
            {preview.state !== 'checked' ? null : (
              <ImportWarnings warnings={preview.warnings ?? NO_WARNINGS} />
            )}

            {preview.errors.length === 0 ? null : (
              <table className="mt-4 w-full text-left text-body-sm" data-testid="import-errors">
                <caption className="mb-2 text-left text-body-md font-semibold">
                  {t('importErrorsHeading', locale)}
                </caption>
                <thead>
                  <tr className="border-b border-line text-ink-secondary">
                    <th className="py-2 pr-3">{t('importRow', locale)}</th>
                    <th className="py-2 pr-3">{t('importColumn', locale)}</th>
                    <th className="py-2">{t('importReason', locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.slice(0, 500).map((error) => (
                    <tr
                      key={`${String(error.rowNumber)}-${error.field}-${error.code}`}
                      className="border-b border-line"
                    >
                      <td className="py-2 pr-3 tabular-nums">
                        {formatNumber(error.rowNumber, numerals)}
                      </td>
                      <td className="py-2 pr-3 font-mono">{error.field}</td>
                      <td className="py-2">
                        {t(ERROR_NAME[error.code] ?? 'importErrInvalid', locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {preview.state === 'checked' ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {offlineReason !== null ? (
                  <Button disabled disabledReason={offlineReason} data-testid="import-commit">
                    {t('importCommit', locale)}
                  </Button>
                ) : preview.counts.error > 0 ? (
                  <Button
                    disabled
                    disabledReason={t('importCommitHasErrors', locale)}
                    data-testid="import-commit"
                  >
                    {t('importCommit', locale)}
                  </Button>
                ) : (
                  <Button
                    data-testid="import-commit"
                    onClick={() => {
                      setConfirming({ kind: 'commit', batch: preview });
                    }}
                  >
                    {t('importCommit', locale)}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  data-testid="import-discard"
                  {...(offlineReason === null
                    ? { onClick: () => void run('discard', preview) }
                    : { disabled: true as const, disabledReason: offlineReason })}
                >
                  {t('importDiscard', locale)}
                </Button>
              </div>
            ) : (
              <p className="mt-4 text-body-sm text-ink-secondary">
                {t(STATE_NAME[preview.state] ?? 'importStateChecked', locale)}
              </p>
            )}
          </Card>
        )}

        {/* --- TBL-B14-HISTORY, BTN-B14-UNDO --------------------------------------- */}
        <section className="flex flex-col gap-3" data-testid="import-history">
          <h2 className="text-title-md">{t('importHistory', locale)}</h2>
          {load === 'loading' ? (
            <div className="flex flex-col gap-3" aria-busy="true" data-testid="import-loading">
              <div className="h-16 rounded-md bg-sunken" />
              <div className="h-16 rounded-md bg-sunken" />
            </div>
          ) : load === 'error' || (load === 'offline' && history.length === 0) ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-md bg-alert-100 p-4"
              data-testid="import-load-failed"
            >
              <p className="text-body-md text-alert-700">
                {t(load === 'offline' ? 'importOffline' : 'importLoadFailed', locale)}
              </p>
              <Button variant="secondary" onClick={() => void reload()}>
                {t('retry', locale)}
              </Button>
            </div>
          ) : history.length === 0 ? (
            <Card data-testid="import-empty">
              <p className="text-body-md text-ink-secondary">{t('importHistoryEmpty', locale)}</p>
            </Card>
          ) : (
            history.map((batch) => (
              <Card key={batch.id} data-testid={`import-batch-${batch.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-body-md font-semibold">
                      {t(SET_NAME[batch.setKind] ?? 'importSetStructure', locale)} ·{' '}
                      {batch.fileName}
                    </p>
                    <p className="text-body-sm text-ink-muted">
                      {format('importBy', locale, {
                        name: batch.createdByName ?? '—',
                        when: formatDateTime(batch.createdAt, numerals),
                      })}
                      {' · '}
                      {format('importCountsLine', locale, {
                        add: formatNumber(batch.counts.add, numerals),
                        update: formatNumber(batch.counts.update, numerals),
                        skip: formatNumber(batch.counts.skip, numerals),
                        error: formatNumber(batch.counts.error, numerals),
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip
                      tone={
                        batch.state === 'committed'
                          ? 'positive'
                          : batch.state === 'checked'
                            ? 'caution'
                            : 'neutral'
                      }
                    >
                      {t(STATE_NAME[batch.state] ?? 'importStateChecked', locale)}
                    </Chip>
                    {batch.state === 'committed' ? (
                      offlineReason === null ? (
                        <Button
                          variant="secondary"
                          data-testid={`import-undo-${batch.id}`}
                          onClick={() => {
                            setConfirming({ kind: 'undo', batch });
                          }}
                        >
                          {t('importUndo', locale)}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          disabled
                          disabledReason={offlineReason}
                          data-testid={`import-undo-${batch.id}`}
                        >
                          {t('importUndo', locale)}
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>
              </Card>
            ))
          )}
        </section>
      </main>

      {/* GR-01: approving and taking back are both confirmed. */}
      <Sheet
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        variant="modal"
        title={t(confirming?.kind === 'undo' ? 'importUndoTitle' : 'importCommitTitle', locale)}
        description={t(confirming?.kind === 'undo' ? 'importUndoBody' : 'importCommitBody', locale)}
      >
        <div data-testid="import-confirm">
          <SheetActions>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(null);
              }}
            >
              {t('checkInCancel', locale)}
            </Button>
            <Button
              loading={busy}
              data-testid="import-confirm-yes"
              onClick={() => {
                if (confirming !== null) void run(confirming.kind, confirming.batch);
              }}
            >
              {t(confirming?.kind === 'undo' ? 'importUndo' : 'importCommit', locale)}
            </Button>
          </SheetActions>
        </div>
      </Sheet>
    </div>
  );
}
