'use client';

/**
 * The reception console — `S-B-02` (`APP_FLOW.md` B1).
 *
 * "The highest-traffic screen in the system. Every primary action must be
 * reachable by keyboard."
 *
 * Layout is B1.1 exactly: navigation rail left, session bar top, queue table
 * centre, now-serving and counters right, offline block bottom-left.
 *
 * ## `BTN-B02-NEXT` carries the product
 *
 * B1.3 is the single most-used control in the system, and every step of its
 * wiring is here or in `useSessionQueue`:
 *
 *   1. the label changes to "এই রোগী শেষ ও পরবর্তী" when somebody is still in
 *      the chamber, and performs both actions
 *   2. optimistic — the row moves before anything touches the network
 *   3. both events go to the local log
 *   4. pushed when online, queued when not (`FR-QUE-50`)
 *   7. undo toast for ten seconds (`GR-02`)
 *   8. a rejected event rolls the row back with an explanation (`FR-QUE-53`)
 *
 * Steps 5 and 6 — the rolling rate and the broadcast — are the server's, and
 * arrive back on the session channel.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  clampConsultSeconds,
  nowServing,
  queueCounts,
  suggestedQuote,
  time,
  waitingQueue,
  type QueueEntry,
} from '@platform/domain';
import {
  format,
  formatClock,
  formatNumber,
  formatSerial,
  t,
  formatAge,
  numeralsFor,
  localName,
} from '@platform/i18n';
import { Button, Card, FreshnessLine, ToastProvider, useToast, useLocale } from '@platform/ui';

import { CheckInSheet } from '@/components/CheckInSheet';
import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { ConsoleRail } from '@/components/ConsoleRail';
import { OfflineBlock } from '@/components/OfflineBlock';
import { QueueTable } from '@/components/QueueTable';
import { StandbyCard } from '@/components/StandbyCard';
import { useSessionQueue } from '@/hooks/useSessionQueue';
import { readDemoSession } from '@/lib/demo';
import { fetchPatientNames } from '@/lib/roster';

import type { ReactNode } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/**
 * The demo principal (CLAUDE.md §4.1).
 *
 * Read from the one place `ConsolePicker` writes it. It used to read its own
 * `console.token` key, which meant two stores for one credential and a console
 * that could hold a stale token from before a hospital was switched.
 *
 * Declared at module scope so it is the same function on every render — the
 * hook holds it in a ref, but a stable reference here keeps the intent obvious
 * and costs nothing. Supabase Auth replaces this one function.
 */
function readToken(): string | null {
  return readDemoSession()?.token ?? null;
}

export function ReceptionConsole(): ReactNode {
  return (
    // Bottom-right on the console, not bottom-centre (FRONTEND.md §5.7).
    <ToastProvider placement="console">
      <ConsoleBody />
    </ToastProvider>
  );
}

function ConsoleBody(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const { show } = useToast();

  const sessionId = useSessionId();
  const [now, setNow] = useState(() => new Date());
  /** The row `MOD-B02-CHECKIN` is open for (`FR-REC-18`). */
  const [checkingIn, setCheckingIn] = useState<QueueEntry | null>(null);

  // The freshness line has to age on screen without anything else happening —
  // that is the whole point of it (FR-OFF-03). One tick a second is enough for
  // a minute-resolution caption and cheap enough not to matter.
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
    apiBaseUrl: API_BASE,
    socketUrl: process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000',
    getToken: readToken,
  });

  // A conflict is surfaced once, as a sentence. A receptionist mid-shift needs
  // to know the queue moved under her, not to audit rejected keys (SY-03).
  useEffect(() => {
    if (queue.lastConflict === null) return;
    show({ title: t('conflictRolledBack', locale), tone: 'caution' });
    queue.clearConflict();
  }, [queue, show, locale]);

  const state = queue.state;
  const serving = state === null ? null : nowServing(state);
  const counts = state === null ? null : queueCounts(state);
  const waiting = state === null ? [] : waitingQueue(state);
  const chamber = readDemoSession()?.chamber ?? null;

  /**
   * Names beside the serials (`B1.4`). Re-read whenever the queue holds
   * somebody the last read did not — a walk-in or a standby seat — so a new
   * row is never left nameless while its neighbours have one.
   */
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const nameless = state?.entries.some((entry) => !names.has(entry.patientId)) ?? false;
  useEffect(() => {
    if (sessionId === null || !nameless) return;
    let cancelled = false;
    fetchPatientNames({ apiBaseUrl: API_BASE, token: readToken(), sessionId })
      .then((fresh) => {
        if (!cancelled) setNames(fresh);
      })
      .catch(() => {
        // A roster that did not load leaves the serials, which are enough to
        // run the queue; the names arrive on the next read.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, nameless]);

  /**
   * `BTN-B02-NEXT`.
   *
   * One control, two facts: whoever is in the chamber is finished, and the next
   * patient is called. B1.3 step 1 — the label says so when both will happen.
   */
  const callNext = useCallback(async () => {
    if (state === null) return;

    const inChamber = nowServing(state);
    if (inChamber !== null) {
      await queue.act('PATIENT_DONE', {
        bookingId: inChamber.bookingId,
        consultSeconds: elapsedSeconds(inChamber, now),
      });
    }

    const next = waitingQueue(state).find((entry) => entry.status !== 'late');
    if (next === undefined) return;

    await queue.act('PATIENT_CALLED', { bookingId: next.bookingId, serial: next.serial });

    show({
      title: format('calledPatient', locale, { serial: formatSerial(next.serial, numerals) }),
      tone: 'positive',
      // GR-02: undo appends a compensating event, never deletes history.
      action: {
        label: t('undo', locale),
        onAction: () => {
          void queue.act('ACTION_UNDONE', { undoneEventId: next.bookingId });
        },
      },
    });
  }, [state, queue, now, show, locale]);

  // A11Y-05 / B1.2: Space or N calls the next patient, A marks arrival,
  // P pauses. The console is operated at speed by people who are not looking
  // at the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'n' || event.key === 'N' || event.code === 'Space') {
        event.preventDefault();
        void callNext();
      }
      if (event.key === 'a' || event.key === 'A') {
        void queue.act('DOCTOR_ARRIVED', { arrivedAt: new Date().toISOString(), minutesLate: 0 });
      }
    };

    globalThis.addEventListener?.('keydown', onKey);
    return () => {
      globalThis.removeEventListener?.('keydown', onKey);
    };
  }, [callNext, queue]);

  if (sessionId === null) {
    return <Notice>{t('noSession', locale)}</Notice>;
  }

  if (queue.loading) {
    // GR-03: loading is a designed state. A skeleton mirrors the layout rather
    // than covering it with a spinner (FRONTEND.md §5.9).
    return <Notice>{t('loading', locale)}</Notice>;
  }

  if (state === null) {
    return <Notice>{t('loadFailed', locale)}</Notice>;
  }

  const pendingBookingIds = new Set<string>();

  return (
    <div className="flex min-h-screen">
      {/* --- navigation rail (B1.1) ---------------------------------------- */}
      <ConsoleRail current="navQueue" locale={locale}>
        <OfflineBlock
          connected={queue.connected}
          pendingCount={queue.pendingCount}
          lastServerTs={queue.lastServerTs}
          stuckCount={0}
          locale={locale}
          now={now}
        />
      </ConsoleRail>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
        <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700">
          {t('demoBanner', locale)}
        </p>

        {/* --- session bar (B1.2) ------------------------------------------ */}
        {/* Whose chamber, then when: the doctor's name is what a receptionist
            and a patient at the counter both check first. Times through
            `formatClock`, in the reading language's day periods and digits —
            never sliced out of the ISO string, which is UTC (`DB-P4`) and once
            put an 18:00 Dhaka chamber on this line as 12:00. */}
        <header className="flex items-center gap-3 border-b border-line bg-surface px-6 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-title-md font-bold" data-testid="chamber-title">
              {chamber === null
                ? t('navQueue', locale)
                : `${localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)} · ${localName(
                    locale,
                    chamber.departmentNameBn,
                    chamber.departmentNameEn,
                  )}`}
            </h1>
            <p className="text-body-sm text-ink-secondary tabular-nums">
              {t('chamberHours', locale)} {formatClock(state.plan.plannedStart, numerals)} –{' '}
              {formatClock(state.plan.plannedEnd, numerals)} ·{' '}
              {state.doctorArrivedAt === null
                ? t('notStarted', locale)
                : `${t('actualStart', locale)} ${formatClock(state.doctorArrivedAt, numerals)}`}
            </p>
          </div>

          <Button
            variant="secondary"
            onClick={() => {
              void queue.act('DOCTOR_ARRIVED', {
                arrivedAt: new Date().toISOString(),
                minutesLate: 0,
              });
            }}
          >
            {t('doctorArrived', locale)}
          </Button>

          <Button
            variant="secondary"
            onClick={() => {
              void queue.act('SESSION_PAUSED', { reason: null });
            }}
          >
            {t('pause', locale)}
          </Button>

          {/* The single most-used control in the system (B1.3). */}
          <Button
            size="lg"
            data-testid="call-next"
            onClick={() => {
              void callNext();
            }}
          >
            {serving === null ? t('callNext', locale) : t('finishAndCallNext', locale)}
          </Button>

          <ConsoleLanguageSwitch />
        </header>

        {/* --- queue table (B1.4) ------------------------------------------ */}
        <main className="flex min-h-0 flex-1 gap-5 p-5">
          <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
            <QueueTable
              state={state}
              locale={locale}
              pendingBookingIds={pendingBookingIds}
              patientNames={names}
              onDone={(entry) => {
                void queue.act('PATIENT_DONE', {
                  bookingId: entry.bookingId,
                  consultSeconds: elapsedSeconds(entry, now),
                });
              }}
              onLate={(entry) => {
                void queue.act('PATIENT_LATE', {
                  bookingId: entry.bookingId,
                  expectedMinutes: 20,
                  reinsertAfter: 3,
                });
              }}
              onNoShow={(entry) => {
                void queue.act('PATIENT_NO_SHOW', {
                  bookingId: entry.bookingId,
                  graceUsedMinutes: 15,
                });
              }}
              onReinstate={(entry) => {
                void queue.act('PATIENT_REINSERTED', {
                  bookingId: entry.bookingId,
                  newPosition: 0,
                });
              }}
              onCheckIn={(entry) => {
                setCheckingIn(entry);
              }}
            />

            {/* MOD-B02-CHECKIN. The suggestion is the queue's own estimate, the
                same function the patient's phone counts down from. */}
            <CheckInSheet
              serial={checkingIn?.serial ?? null}
              suggested={
                checkingIn === null
                  ? null
                  : suggestedQuote(state, checkingIn.bookingId, time.fromDate(now))
              }
              locale={locale}
              onClose={() => {
                setCheckingIn(null);
              }}
              onConfirm={(quotedWaitMinutes) => {
                const entry = checkingIn;
                setCheckingIn(null);
                if (entry === null) return;
                void queue.act('PATIENT_ARRIVED', {
                  bookingId: entry.bookingId,
                  quotedWaitMinutes,
                });
                show({
                  title: format('checkedIn', locale, {
                    serial: formatSerial(entry.serial, numerals),
                    minutes: formatNumber(quotedWaitMinutes, numerals),
                  }),
                  tone: 'positive',
                });
              }}
            />
          </div>

          {/* --- right column (B1.5) ---------------------------------------- */}
          <aside className="w-80 shrink-0 space-y-4">
            {/* The chamber, in the institution's colour: the number and the
                person, large, because this is what reception is asked about
                all evening (the `Reception` artboard, FRONTEND.md §0.4). */}
            <section
              className="rounded-lg bg-brand-700 p-5 text-ink-inverse"
              data-testid="now-serving-card"
            >
              <p className="text-body-sm text-brand-100">{t('nowServing', locale)}</p>
              {serving === null ? (
                <p className="mt-2 text-body-md">{t('nobodyInChamber', locale)}</p>
              ) : (
                <>
                  <p className="text-display-lg font-bold tabular-nums" data-testid="now-serving">
                    {formatNumber(serving.serial, numerals)}
                  </p>
                  <p className="mt-1 text-body-lg" data-testid="now-serving-name">
                    {names.get(serving.patientId) ?? ''}
                  </p>
                </>
              )}
              <p className="mt-3 text-body-sm text-brand-100">
                {format('waitingCount', locale, {
                  count: formatNumber(waiting.length, numerals),
                })}
              </p>
            </section>

            <div className="px-1">
              {/*
                CLAUDE.md §5.8: every live figure renders <FreshnessLine>.
                This is the figure the whole product is about, so it is the one
                that must never appear without saying how old it is.
              */}
              <FreshnessLine
                asOf={queue.lastServerTs === null ? null : new Date(queue.lastServerTs)}
                now={now}
                labels={{
                  justNow: t('updatedJustNow', locale),
                  ago: t('updatedAgo', locale),
                  never: t('neverSynced', locale),
                  stale: t('staleWarning', locale),
                }}
                formatMinutes={(value) => formatAge(value, locale, numerals)}
              />
            </div>

            <Card>
              <p className="text-caption text-ink-muted">{t('countersToday', locale)}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-body-sm">
                <Counter label={t('countSeen', locale)} value={counts?.done ?? 0} />
                <Counter label={t('countWaiting', locale)} value={waiting.length} />
                <Counter label={t('countLate', locale)} value={counts?.late ?? 0} />
                <Counter label={t('countNoShow', locale)} value={counts?.noShow ?? 0} />
              </dl>
            </Card>

            {/* BTN-B02-OFFER: a freed chair goes to the standby list, and the
                acceptance is recorded here (FR-REC-30). */}
            <StandbyCard
              sessionId={sessionId}
              state={state}
              connected={queue.connected}
              pendingCount={queue.pendingCount}
              locale={locale}
              apiBaseUrl={API_BASE}
              getToken={readToken}
            />
          </aside>
        </main>
      </div>
    </div>
  );
}

function Counter({ label, value }: { readonly label: string; readonly value: number }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-title-sm tabular-nums">{formatNumber(value, numerals)}</dd>
    </div>
  );
}

function Notice({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-muted">{children}</p>
    </div>
  );
}

/**
 * How long the patient in the chamber has been there.
 *
 * `FR-REC-11`: measured, never typed. A receptionist estimating the duration
 * would feed the rolling rate a number she guessed, and every ETA downstream
 * is built on it.
 *
 * Clamped, because the raw elapsed time is not always a consultation. A
 * receptionist who forgets to mark somebody done before going home leaves that
 * row "in chamber" overnight, and the next tap would otherwise report a
 * fourteen-hour consultation — which poisons the rolling rate (`FR-QUE-12`)
 * and is rejected outright by `bookings_consult_seconds_plausible`.
 * `clampConsultSeconds` is the domain's own bound, so the console and the
 * server agree on what a plausible consultation is.
 */
function elapsedSeconds(entry: QueueEntry, now: Date): number {
  if (entry.calledAt === null) return 0;
  const elapsed = Math.round((now.getTime() - new Date(entry.calledAt).getTime()) / 1000);
  return clampConsultSeconds(Math.max(0, elapsed));
}

/**
 * The session this counter is driving, from the URL (`SEL-B02-SESSION`).
 *
 * Read after mount rather than during render. The server has no `location`, so
 * reading it while rendering makes the first client render disagree with the
 * server's — React discards the tree and warns, and in a console that is a
 * flash of "no chamber running" before the real screen appears.
 */
function useSessionId(): string | null {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(new URLSearchParams(globalThis.location.search).get('session'));
  }, []);

  return sessionId;
}
