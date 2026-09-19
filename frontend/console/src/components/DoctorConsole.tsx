'use client';

/**
 * The doctor console — `S-B-05` (`APP_FLOW.md` B2).
 *
 * Two columns, and the split is the point. The left is *this consultation*: who
 * is in front of the doctor, what they said before coming in, what they have
 * been seen for before. The right is *the record*: what the doctor concludes,
 * and the one button that both files it and calls the next patient.
 *
 * ## It runs on the same queue as reception
 *
 * `useSessionQueue` is shared with `S-B-02` — same socket, same reducer, same
 * offline log. That is not code reuse for its own sake: `FR-QUE-53` requires the
 * doctor's *next* and reception's *next* to be serialised against each other,
 * and the only way two screens can be trusted to agree is for them to be
 * reading the same state from the same place.
 *
 * ## What this screen does not have
 *
 * No medicine rows, no formulary autocomplete, no printed prescription. The
 * owner dropped e-prescriptions from this version (`FR-DOC-04`, `FR-DOC-05`,
 * `FR-DOC-07`), so `TBL-B05-RX`, `BTN-B05-ADDRX` and the print half of
 * `BTN-B05-SIGN` are absent. What remains is `INP-B05-DX`, `INP-B05-ADVICE`,
 * `SEL-B05-FOLLOWUP`, `BTN-B05-DRAFT` and `BTN-B05-SIGN` — a visit record,
 * which is what the wallet reads and what step 13 is built on.
 *
 * `BTN-B05-SCAN` (the wallet QR) is step 13 and `BTN-B05-TEST` is step 17. Both
 * are absent rather than disabled: a control that cannot work should not be on
 * a screen a doctor is learning.
 *
 * ## The failure that is spelled out in the document
 *
 * B2: "if the prescription fails to save, the consultation is **not** marked
 * done, and the doctor sees a retry banner with the draft preserved locally."
 * So the record is saved first and the queue advances only on success, and a
 * failure leaves every field exactly as typed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { nowServing, queueCounts, waitingQueue } from '@platform/domain';
import type { QueueEntry } from '@platform/domain';
import { formatClock, formatNumber, formatTaka, t, type Locale } from '@platform/i18n';
import { Button, Card, Chip, FreshnessLine, Input, ToastProvider, useToast } from '@platform/ui';

import { OfflineBlock } from '@/components/OfflineBlock';
import { PatientPanel } from '@/components/PatientPanel';
import { useSessionQueue } from '@/hooks/useSessionQueue';
import { readDemoSession } from '@/lib/demo';
import { fetchSessionFee, saveVisit, type VisitDraft } from '@/lib/visits';

import type { ReactNode } from 'react';

const LOCALE: Locale = 'bn';

/** Console surfaces use Latin numerals for reading speed (`TYP-04`). */
const NUMERALS = 'latin' as const;

/** `SEL-B05-FOLLOWUP`: "7/14/30 days or date". */
const FOLLOW_UP_CHOICES = [7, 14, 30] as const;

function readToken(): string | null {
  return readDemoSession()?.token ?? null;
}

export function DoctorConsole(): ReactNode {
  return (
    <ToastProvider placement="console">
      <DoctorBody />
    </ToastProvider>
  );
}

function DoctorBody(): ReactNode {
  const { show } = useToast();
  const sessionId = useSessionId();
  const [now, setNow] = useState(() => new Date());

  // The freshness caption has to age on screen without anything else happening
  // (`FR-OFF-03`).
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const queue = useSessionQueue({
    sessionId: sessionId ?? '',
    apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
    socketUrl: process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000',
    getToken: readToken,
  });

  useEffect(() => {
    if (queue.lastConflict === null) return;
    show({ title: t('conflictRolledBack', LOCALE), tone: 'caution' });
    queue.clearConflict();
  }, [queue, show]);

  /**
   * The chamber's fee, for `FR-DOC-09`.
   *
   * Not in the queue state, and correctly so: the state is the event log
   * reduced, and a fee is not an event. Fetched once per session from the
   * roster, where `DB-P5` already copied it onto every booking.
   */
  const [feePoisha, setFeePoisha] = useState<number | null>(null);
  useEffect(() => {
    if (sessionId === null) return;

    void fetchSessionFee({
      apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
      token: readToken(),
      sessionId,
    })
      .then(setFeePoisha)
      .catch(() => {
        // Earnings are absent rather than zero. Nothing else on the screen
        // depends on this number (`FR-OFF-05`).
      });
  }, [sessionId]);

  const state = queue.state;
  const serving = state === null ? null : nowServing(state);
  const counts = state === null ? null : queueCounts(state);
  const waiting = state === null ? [] : waitingQueue(state);

  // --- the note being written ----------------------------------------------
  const [draft, setDraft] = useState<VisitDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * A new patient in the chamber is a new note.
   *
   * Keyed on the booking, so the fields clear exactly when the person changes
   * and never while the doctor is typing about the same one — a re-render from a
   * socket message must not wipe a half-written diagnosis.
   */
  const servingBookingId = serving?.bookingId ?? null;
  useEffect(() => {
    setDraft(emptyDraft());
    setFailed(false);
  }, [servingBookingId]);

  const canSign = useMemo(
    () =>
      draft.diagnosisText.trim() !== '' ||
      draft.adviceTextBn.trim() !== '' ||
      draft.followUpDays !== null,
    [draft],
  );

  const submit = useCallback(
    async (sign: boolean) => {
      if (servingBookingId === null) return;

      setBusy(true);
      setFailed(false);
      try {
        const result = await saveVisit({
          apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
          token: readToken(),
          bookingId: servingBookingId,
          draft,
          sign,
        });

        if (!sign) {
          show({ title: t('draftSaved', LOCALE), tone: 'positive' });
          return;
        }

        // The queue came back with the record, so the screen already knows who
        // is next without waiting for the socket to say so.
        const called = result.queue?.state.entries.find((entry) => entry.status === 'in_chamber');
        show({
          title:
            called === undefined
              ? t('signedNobodyLeft', LOCALE)
              : t('signedAndCalled', LOCALE).replace(
                  '{serial}',
                  formatNumber(called.serial, NUMERALS),
                ),
          tone: 'positive',
        });
      } catch {
        // B2's failure rule: not marked done, draft preserved, retry offered.
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [servingBookingId, draft, show],
  );

  if (sessionId === null) {
    return <p className="p-6 text-body-md text-ink-muted">{t('loading', LOCALE)}</p>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SessionHeader
        counts={counts}
        delayMinutes={state?.delayMinutes ?? 0}
        avgConsultSeconds={state?.rate.currentSeconds ?? null}
        plannedStart={state?.plan.plannedStart ?? null}
        plannedEnd={state?.plan.plannedEnd ?? null}
        feePoisha={feePoisha}
        lastServerTs={queue.lastServerTs}
        now={now}
        onDelay={() => {
          void queue.act('DELAY_DECLARED', { minutes: 30, reason: null, declaredBy: 'doctor' });
          show({ title: t('declareDelay', LOCALE), tone: 'positive' });
        }}
        busy={queue.loading}
      />

      <main className="mx-auto grid w-full max-w-[1400px] flex-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* Left: who is here, and everything known about them. */}
        <div className="flex min-w-0 flex-col gap-5">
          {serving === null ? (
            <Card>
              <p className="text-body-md text-ink-secondary">{t('nobodyToSee', LOCALE)}</p>
            </Card>
          ) : (
            <PatientPanel entry={serving} />
          )}

          <UpNext waiting={waiting} />
        </div>

        {/* Right: the record, and the one button that files it. */}
        <div className="flex min-w-0 flex-col gap-5">
          <VisitNote
            disabled={serving === null || busy}
            draft={draft}
            onChange={setDraft}
            canSign={canSign}
            failed={failed}
            onDraft={() => {
              void submit(false);
            }}
            onSign={() => {
              void submit(true);
            }}
          />

          <OfflineBlock
            connected={queue.connected}
            pendingCount={queue.pendingCount}
            lastServerTs={queue.lastServerTs}
            stuckCount={0}
            locale={LOCALE}
            now={now}
          />
        </div>
      </main>
    </div>
  );
}

/**
 * The session header (`FR-DOC-01`): seen, waiting, average duration, and
 * whether the chamber is running late.
 *
 * `BTN-B05-DELAY` lives here because a doctor declaring a delay is doing it
 * about the *session*, not about the patient in front of them — and because
 * `FR-DOC-02` exists so they can do it without phoning reception.
 */
function SessionHeader({
  counts,
  delayMinutes,
  avgConsultSeconds,
  plannedStart,
  plannedEnd,
  feePoisha,
  lastServerTs,
  now,
  onDelay,
  busy,
}: {
  readonly counts: ReturnType<typeof queueCounts> | null;
  readonly delayMinutes: number;
  readonly avgConsultSeconds: number | null;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly feePoisha: number | null;
  readonly lastServerTs: string | null;
  readonly now: Date;
  readonly onDelay: () => void;
  readonly busy: boolean;
}): ReactNode {
  const late = delayMinutes > 0;

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <div className="min-w-0">
          <h1 className="font-reading text-title-md">{t('doctorConsole', LOCALE)}</h1>
          <p className="text-body-sm tabular-nums text-ink-muted">
            {plannedStart === null || plannedEnd === null
              ? t('notStarted', LOCALE)
              : `${t('plannedWindow', LOCALE)} ${formatClock(plannedStart, NUMERALS)}–${formatClock(plannedEnd, NUMERALS)}`}
          </p>
        </div>

        {/* A11Y-03: the state is a word, never only a colour. */}
        <Chip tone={late ? 'caution' : 'positive'}>
          {late
            ? `${t('runningLate', LOCALE)} · ${formatNumber(delayMinutes, NUMERALS)} ${t('minutesShort', LOCALE)}`
            : t('onTime', LOCALE)}
        </Chip>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Stat label={t('countSeen', LOCALE)} value={counts === null ? null : counts.done} />
          <Stat label={t('countWaiting', LOCALE)} value={counts === null ? null : counts.waiting} />
          <Stat
            label={t('currentRate', LOCALE)}
            value={avgConsultSeconds === null ? null : Math.round(avgConsultSeconds / 60)}
            unit={t('minutesShort', LOCALE)}
          />
          {/* `FR-DOC-09` session earnings: what has actually been seen, at this
              chamber's fee. Absent rather than zero when the fee is unknown. */}
          {feePoisha === null || counts === null ? null : (
            <div>
              <dt className="text-caption text-ink-muted">{t('sessionEarnings', LOCALE)}</dt>
              <dd className="text-title-sm font-semibold tabular-nums">
                {formatTaka(feePoisha * counts.done, NUMERALS)}
              </dd>
            </div>
          )}
        </dl>

        {/*
          DoD §5.8: every one of the figures above is live — seen, waiting, the
          rolling average, and the money derived from them. A doctor deciding
          whether to speed up must know whether the numbers are this minute's or
          from before the network dropped (`FR-OFF-03`).
        */}
        <FreshnessLine
          asOf={lastServerTs === null ? null : new Date(lastServerTs)}
          now={now}
          labels={{
            justNow: t('updatedJustNow', LOCALE),
            ago: t('updatedAgo', LOCALE),
            never: t('neverSynced', LOCALE),
            stale: t('staleWarning', LOCALE),
          }}
          formatMinutes={(minutes) => formatNumber(minutes, NUMERALS)}
        />

        <div className="ms-auto">
          <Button variant="secondary" size="sm" onClick={onDelay} loading={busy}>
            {t('declareDelay', LOCALE)}
          </Button>
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly unit?: string;
}): ReactNode {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-title-sm font-semibold tabular-nums">
        {value === null ? '—' : formatNumber(value, NUMERALS)}
        {unit === undefined || value === null ? '' : ` ${unit}`}
      </dd>
    </div>
  );
}

/**
 * `INP-B05-DX`, `INP-B05-ADVICE`, `SEL-B05-FOLLOWUP`, and the two buttons.
 *
 * The primary is never silently disabled (`FRONTEND.md` §5.1): when there is
 * nothing to sign it carries the reason, so a doctor is told what is missing
 * rather than left tapping a dead control.
 */
function VisitNote({
  disabled,
  draft,
  onChange,
  canSign,
  failed,
  onDraft,
  onSign,
}: {
  readonly disabled: boolean;
  readonly draft: VisitDraft;
  readonly onChange: (draft: VisitDraft) => void;
  readonly canSign: boolean;
  readonly failed: boolean;
  readonly onDraft: () => void;
  readonly onSign: () => void;
}): ReactNode {
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="font-reading text-title-sm">{t('visitNote', LOCALE)}</h2>

        {failed ? (
          <p
            role="alert"
            data-testid="visit-failed"
            className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
          >
            {t('visitSaveFailed', LOCALE)}
          </p>
        ) : null}

        <Input
          label={t('diagnosis', LOCALE)}
          helper={t('diagnosisHint', LOCALE)}
          density="console"
          data-testid="visit-diagnosis"
          value={draft.diagnosisText}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...draft, diagnosisText: event.target.value });
          }}
        />

        {/* A textarea rather than an Input: advice runs to several sentences and
            a single-line field would hide most of what the patient will read. */}
        <div className="flex flex-col gap-2">
          <label htmlFor="advice" className="font-ui text-body-sm font-semibold text-ink">
            {t('adviceBn', LOCALE)}
          </label>
          <textarea
            id="advice"
            data-testid="visit-advice"
            rows={4}
            value={draft.adviceTextBn}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...draft, adviceTextBn: event.target.value });
            }}
            className="w-full rounded-md border border-line-strong bg-surface p-3 text-body-md text-ink disabled:opacity-60"
          />
          <p className="text-caption text-ink-muted">{t('adviceHint', LOCALE)}</p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-body-sm font-semibold text-ink">
            {t('followUp', LOCALE)}
          </legend>
          <div className="flex flex-wrap gap-2">
            <FollowUpChoice
              label={t('followUpNone', LOCALE)}
              active={draft.followUpDays === null}
              disabled={disabled}
              onSelect={() => {
                onChange({ ...draft, followUpDays: null });
              }}
            />
            {FOLLOW_UP_CHOICES.map((days) => (
              <FollowUpChoice
                key={days}
                label={t('followUpDays', LOCALE).replace('{days}', formatNumber(days, NUMERALS))}
                active={draft.followUpDays === days}
                disabled={disabled}
                onSelect={() => {
                  onChange({ ...draft, followUpDays: days });
                }}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          {/*
            `ButtonProps` is a discriminated union: disabling requires a reason
            (§5.1), so `disabled={someBoolean}` does not compile and every
            branch below carries the sentence a doctor should read instead of a
            dead control.
          */}
          {disabled ? (
            <Button
              variant="secondary"
              size="lg"
              disabled
              disabledReason={t('nobodyToSee', LOCALE)}
              data-testid="save-draft"
            >
              {t('saveDraft', LOCALE)}
            </Button>
          ) : (
            <Button variant="secondary" size="lg" data-testid="save-draft" onClick={onDraft}>
              {t('saveDraft', LOCALE)}
            </Button>
          )}

          {disabled || !canSign ? (
            <Button
              size="lg"
              disabled
              disabledReason={
                disabled ? t('nobodyToSee', LOCALE) : t('needSomethingToSign', LOCALE)
              }
              data-testid="sign-and-next"
            >
              {t('signAndNext', LOCALE)}
            </Button>
          ) : (
            <Button size="lg" data-testid="sign-and-next" onClick={onSign}>
              {t('signAndNext', LOCALE)}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function FollowUpChoice({
  label,
  active,
  disabled,
  onSelect,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      // A radio group in behaviour, so the choice is announced as one.
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      className={`min-h-touch rounded-pill border px-4 text-body-sm ${
        active
          ? 'border-brand-600 bg-brand-100 font-semibold text-brand-700'
          : 'border-line-strong bg-surface text-ink'
      } disabled:opacity-60`}
    >
      {label}
    </button>
  );
}

/** Who the doctor sees after this one. Three is enough to pace a chamber. */
function UpNext({ waiting }: { readonly waiting: readonly QueueEntry[] }): ReactNode {
  if (waiting.length === 0) return null;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-title-sm">{t('waitingNext', LOCALE)}</h2>
        <ul className="flex flex-wrap gap-2">
          {waiting.slice(0, 3).map((entry) => (
            <li key={entry.bookingId}>
              <Chip tone="neutral">{formatNumber(entry.serial, NUMERALS)}</Chip>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function emptyDraft(): VisitDraft {
  return { diagnosisText: '', adviceTextBn: '', followUpDays: null };
}

/**
 * The chamber this console is open on.
 *
 * Read from the URL after mount, for the same reason reception does: the server
 * has no `location`, and reading it during render makes the first client render
 * disagree with the server's.
 */
function useSessionId(): string | null {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(new URLSearchParams(globalThis.location.search).get('session'));
  }, []);

  return sessionId;
}
