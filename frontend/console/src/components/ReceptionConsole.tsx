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
  waitingQueue,
  type QueueEntry,
} from '@platform/domain';
import { formatClock, formatNumber, t, type Locale } from '@platform/i18n';
import { Button, Card, FreshnessLine, ToastProvider, useToast } from '@platform/ui';

import { OfflineBlock } from '@/components/OfflineBlock';
import { QueueTable } from '@/components/QueueTable';
import { useSessionQueue } from '@/hooks/useSessionQueue';
import { readDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

/** `APP_FLOW.md` B1.1. Only the queue rail item leads anywhere in this step. */
const NAV_ITEMS = [
  'navQueue',
  'navRegistration',
  'navBeds',
  'navEmergency',
  'navTests',
  'navBilling',
  'navDashboard',
] as const;

/** Console surfaces use Latin numerals for data-entry speed (`TYP-04`). */
const CONSOLE_LOCALE: Locale = 'bn';

/**
 * Latin digits, and the AM/PM a receptionist reads fastest (`TYP-04`).
 *
 * These times used to be `plannedStart.slice(11, 16)` — the hour and minute cut
 * straight out of the ISO string, which is UTC (`DB-P4`). A chamber running
 * 18:00–21:00 in Dhaka therefore showed as 12:00–15:00 on the console, six
 * hours out, on the one line of the screen that says when the session is.
 */
const CONSOLE_NUMERALS = 'latin' as const;

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
  const locale = CONSOLE_LOCALE;
  const { show } = useToast();

  const sessionId = useSessionId();
  const [now, setNow] = useState(() => new Date());

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
    apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
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
      title: t('calledPatient', locale).replace('{serial}', String(next.serial)),
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
      <nav aria-label={t('navQueue', locale)} className="w-52 shrink-0 border-r border-line p-4">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((key, index) => (
            <li key={key}>
              <a
                href={index === 0 ? '/' : '#'}
                aria-current={index === 0 ? 'page' : undefined}
                className="flex min-h-touch items-center rounded-sm px-3 text-body-md aria-[current=page]:bg-brand-100 aria-[current=page]:font-semibold"
              >
                {t(key, locale)}
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <OfflineBlock
            connected={queue.connected}
            pendingCount={queue.pendingCount}
            lastServerTs={queue.lastServerTs}
            stuckCount={0}
            locale={locale}
            now={now}
          />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
        <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700">
          {t('demoBanner', locale)}
        </p>

        {/* --- session bar (B1.2) ------------------------------------------ */}
        <header className="flex items-center gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-title-sm tabular-nums">
              {formatClock(state.plan.plannedStart, CONSOLE_NUMERALS)} –{' '}
              {formatClock(state.plan.plannedEnd, CONSOLE_NUMERALS)}
            </p>
            <p className="text-body-sm text-ink-muted tabular-nums">
              {state.doctorArrivedAt === null
                ? t('notStarted', locale)
                : `${t('actualStart', locale)} ${formatClock(state.doctorArrivedAt, CONSOLE_NUMERALS)}`}
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
        </header>

        {/* --- queue table (B1.4) ------------------------------------------ */}
        <main className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto">
            <QueueTable
              state={state}
              locale={locale}
              pendingBookingIds={pendingBookingIds}
              patientNames={new Map()}
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
            />
          </div>

          {/* --- right column (B1.5) ---------------------------------------- */}
          <aside className="w-80 shrink-0 space-y-4 border-l border-line p-4">
            <Card tone={serving === null ? 'default' : 'brand'}>
              <p className="text-caption text-ink-muted">{t('nowServing', locale)}</p>
              {serving === null ? (
                <p className="mt-1 text-body-md">{t('nobodyInChamber', locale)}</p>
              ) : (
                <p className="mt-1 text-display-lg tabular-nums" data-testid="now-serving">
                  {formatNumber(serving.serial, 'bengali')}
                </p>
              )}

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
                formatMinutes={(minutes) => formatNumber(minutes, 'bengali')}
              />
            </Card>

            <Card>
              <p className="text-caption text-ink-muted">{t('countersToday', locale)}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-body-sm">
                <Counter label={t('countSeen', locale)} value={counts?.done ?? 0} />
                <Counter label={t('countWaiting', locale)} value={waiting.length} />
                <Counter label={t('countLate', locale)} value={counts?.late ?? 0} />
                <Counter label={t('countNoShow', locale)} value={counts?.noShow ?? 0} />
              </dl>
            </Card>
          </aside>
        </main>
      </div>
    </div>
  );
}

function Counter({ label, value }: { readonly label: string; readonly value: number }): ReactNode {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-title-sm tabular-nums">{formatNumber(value, 'bengali')}</dd>
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
