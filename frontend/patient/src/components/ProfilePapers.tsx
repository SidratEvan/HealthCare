'use client';

/**
 * A profile's own old papers — `BTN-A12-UPLOAD` on the Profile tab
 * (`FRM-A19-DOC`; `PRD.md` `FR-PAT-62`; plan R3).
 *
 * Under each profile of a signed-in account: add a photograph or a PDF with
 * what it is, its date and the doctor if known; the list beneath, each paper
 * labelled as the patient's own, with **খুলুন** (a signed link minted at the
 * tap) and **সরান** (asked twice). Only a signed-in account reaches this: a
 * tracking link is never enough to add to somebody's record.
 *
 * All four states (`GR-03`): loading, none yet, a failure with a retry, and
 * offline, which holds the add and the remove rather than queueing a file.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { PATIENT_PROVIDED, paperDate, paperKindName, tp, type PatientKey } from '@platform/i18n';
import { Button, Input, useLocale } from '@platform/ui';

import { useOnline } from '@/hooks/useOnline';
import {
  addPaper,
  paperLink,
  papersOf,
  removePaper,
  type AccountFailure,
  type PatientPaper,
} from '@/lib/account';

const KINDS = ['prescription', 'report', 'discharge', 'other'] as const;
type Kind = (typeof KINDS)[number];

function problemKey(failure: AccountFailure): PatientKey {
  if (failure.kind === 'offline') return 'accountOffline';
  if (failure.kind === 'unsupported') return 'papersUnsupported';
  if (failure.kind === 'signedOut') return 'accountSignedOut';
  return 'accountFailed';
}

export function ProfilePapers({
  patientId,
  onSignedOut,
}: {
  readonly patientId: string;
  readonly onSignedOut: () => void;
}): ReactNode {
  const locale = useLocale();
  const online = useOnline();
  const [papers, setPapers] = useState<readonly PatientPaper[] | null>(null);
  const [loadProblem, setLoadProblem] = useState<PatientKey | null>(null);
  const [problem, setProblem] = useState<PatientKey | null>(null);
  const [notice, setNotice] = useState<PatientKey | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>('prescription');
  const [date, setDate] = useState('');
  const [doctor, setDoctor] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async () => {
    setLoadProblem(null);
    const result = await papersOf(patientId);
    if (result.ok) {
      setPapers(result.value);
      return;
    }
    if (result.failure.kind === 'signedOut') {
      onSignedOut();
      return;
    }
    setLoadProblem(problemKey(result.failure));
  }, [patientId, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (file === null) {
      setProblem('papersChooseFirst');
      return;
    }
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const result = await addPaper({
      patientId,
      file,
      docType: kind,
      docDate: date === '' ? null : date,
      doctorName: doctor,
    });
    setBusy(false);
    if (!result.ok) {
      if (result.failure.kind === 'signedOut') onSignedOut();
      setProblem(problemKey(result.failure));
      return;
    }
    setNotice('papersAdded');
    setFile(null);
    setDate('');
    setDoctor('');
    // A new file input: a chosen file cannot be cleared from the old one.
    setFormKey((value) => value + 1);
    await load();
  }

  async function open(paper: PatientPaper): Promise<void> {
    setProblem(null);
    const result = await paperLink(patientId, paper.id);
    if (!result.ok) {
      setProblem(problemKey(result.failure));
      return;
    }
    globalThis.open(result.value, '_blank', 'noopener');
  }

  async function remove(paper: PatientPaper): Promise<void> {
    setProblem(null);
    const result = await removePaper(paper.id);
    setConfirming(null);
    if (!result.ok) {
      setProblem(problemKey(result.failure));
      return;
    }
    await load();
  }

  return (
    <section
      className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
      data-testid={`papers-${patientId}`}
    >
      <h3 className="text-body-md font-semibold">{tp('papersTitle', locale)}</h3>
      <p className="text-caption text-ink-muted">{tp('papersHint', locale)}</p>

      {loadProblem !== null ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-sm bg-alert-100 p-3">
          <p className="text-body-sm text-alert-700">{tp(loadProblem, locale)}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {tp('tryAgain', locale)}
          </Button>
        </div>
      ) : papers === null ? (
        <div className="h-12 rounded-sm bg-sunken" aria-busy="true" />
      ) : papers.length === 0 ? (
        <p className="text-body-sm text-ink-muted" data-testid="papers-none">
          {tp('papersNone', locale)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="papers-list">
          {papers.map((paper) => (
            <li
              key={paper.id}
              className="flex flex-wrap items-center gap-2 rounded-sm bg-sunken px-3 py-2"
              data-testid={`paper-${paper.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-body-md font-semibold">{paperKindName(paper.docType, locale)}</p>
                <p className="text-caption text-ink-muted">
                  {[
                    PATIENT_PROVIDED[locale],
                    paper.docDate === null ? null : paperDate(paper.docDate, locale),
                    paper.doctorName,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void open(paper)}>
                {tp('papersOpen', locale)}
              </Button>
              {!online ? (
                <Button
                  variant="quiet"
                  size="sm"
                  disabled
                  disabledReason={tp('accountOffline', locale)}
                >
                  {tp('papersRemove', locale)}
                </Button>
              ) : confirming === paper.id ? (
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid={`paper-remove-sure-${paper.id}`}
                  onClick={() => void remove(paper)}
                >
                  {tp('papersRemoveSure', locale)}
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid={`paper-remove-${paper.id}`}
                  onClick={() => {
                    setConfirming(paper.id);
                  }}
                >
                  {tp('papersRemove', locale)}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        key={formKey}
        className="flex flex-col gap-3"
        onSubmit={(event) => void add(event)}
        data-testid="papers-form"
      >
        <label className="flex flex-col gap-2 text-body-sm font-semibold text-ink">
          {tp('papersFile', locale)}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            data-testid="papers-file"
            className="text-body-sm"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setProblem(null);
            }}
          />
        </label>
        <label className="flex flex-col gap-2 text-body-sm font-semibold text-ink">
          {tp('papersKind', locale)}
          <select
            value={kind}
            data-testid="papers-kind"
            onChange={(event) => {
              setKind(event.target.value as Kind);
            }}
            className="min-h-touch rounded-md border border-line-strong bg-surface px-3 text-body-md"
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {paperKindName(value, locale)}
              </option>
            ))}
          </select>
        </label>
        {/* A native date field: the shared Input is text-only by design. */}
        <label className="flex flex-col gap-2 text-body-sm font-semibold text-ink">
          {tp('papersDate', locale)}
          <input
            type="date"
            value={date}
            data-testid="papers-date"
            onChange={(event) => {
              setDate(event.target.value);
            }}
            className="min-h-touch rounded-md border border-line-strong bg-surface px-3 text-body-md"
          />
        </label>
        <Input
          label={tp('papersDoctor', locale)}
          value={doctor}
          data-testid="papers-doctor"
          onChange={(event) => {
            setDoctor(event.target.value);
          }}
        />
        {problem === null ? null : (
          <p role="alert" className="text-body-sm text-alert-700" data-testid="papers-problem">
            {tp(problem, locale)}
          </p>
        )}
        {notice === null ? null : (
          <p role="status" className="text-body-sm text-positive-700" data-testid="papers-added">
            {tp(notice, locale)}
          </p>
        )}
        <div>
          {!online ? (
            <Button disabled disabledReason={tp('accountOffline', locale)}>
              {tp('papersAdd', locale)}
            </Button>
          ) : (
            <Button type="submit" loading={busy} data-testid="papers-add">
              {tp('papersAdd', locale)}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
