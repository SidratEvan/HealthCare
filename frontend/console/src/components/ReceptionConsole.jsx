'use client';

/**
 * The reception console — `S-B-02` (`APP_FLOW.md` B1).
 *
 * "The highest-traffic screen in the system. Every primary action must be
 * reachable by keyboard."
 *
 * Batch 3A uses the approved desk overview and expandable chamber cards.
 * Each chamber retains V1's controller, replay and guarded actions.
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

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clampConsultSeconds,
  nowServing,
  queueCounts,
  suggestedQuote,
  time,
  unseenAtEnd,
  waitingQueue,
} from '@platform/domain';
import {
  format,
  formatClock,
  formatDateTime,
  formatNumber,
  formatSerial,
  t,
  CONSOLE,
  formatAge,
  numeralsFor,
  localName,
} from '@platform/i18n';
import {
  Button,
  BilingualLabel,
  ConsoleAction,
  ConsoleStatus,
  FreshnessLine,
  Sheet,
  SheetActions,
  ToastProvider,
  useToast,
  useLocale,
} from '@platform/ui';

import { CheckInSheet } from '@/components/CheckInSheet';
import { OfflineBlock } from '@/components/OfflineBlock';
import { QueueTable } from '@/components/QueueTable';
import { ReceptionWorkspace } from '@/components/ReceptionWorkspace';
import { StandbyCard } from '@/components/StandbyCard';
import { WalkInSheet } from '@/components/WalkInSheet';
import { useSessionQueue } from '@/hooks/useSessionQueue';
import { readDemoSession } from '@/lib/demo';
import { fetchPatientNames } from '@/lib/roster';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/** What the counter is told after an undo (`GR-02`). */
const UNDO_COPY = {
  undone: 'actionUndone',
  nothing: 'undoNothing',
  expired: 'undoExpired',
  offline: 'undoOffline',
  refused: 'undoRefused',
};

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
function readToken() {
  return readDemoSession()?.token ?? null;
}

export function ReceptionConsole() {
  return (
    // Bottom-right on the console, not bottom-centre (FRONTEND.md §5.7).
    <ToastProvider placement="console">
      <ReceptionWorkspace renderQueue={(props) => <ReceptionQueue {...props} />} />
    </ToastProvider>
  );
}

function ReceptionQueue(props) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const { show } = useToast();

  const urlSessionId = useSessionId();
  const sessionId = props.chamber.id || urlSessionId;
  const [now, setNow] = useState(() => new Date());
  /** The row `MOD-B02-CHECKIN` is open for (`FR-REC-18`). */
  const [checkingIn, setCheckingIn] = useState(null);
  /** `MOD-B02-WALKIN` (pilot step 23). */
  const [walkingIn, setWalkingIn] = useState(false);

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
    flushOtherSessions: !props.multi,
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
  const chamber = props.chamber;
  const testId = (name) => (props.multi ? `${name}-${sessionId ?? ''}` : name);
  useEffect(() => {
    props.onReport(props.chamber.id, {
      state: queue.state,
      connected: queue.connected,
      pendingCount: queue.pendingCount,
      lastServerTs: queue.lastServerTs,
    });
  }, [
    props.onReport,
    props.chamber.id,
    queue.state,
    queue.connected,
    queue.pendingCount,
    queue.lastServerTs,
  ]);

  /**
   * Names beside the serials (`B1.4`). Re-read whenever the queue holds
   * somebody the last read did not — a walk-in or a standby seat — so a new
   * row is never left nameless while its neighbours have one.
   */
  const [names, setNames] = useState(new Map());
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
   * Undo (`GR-02`, `FR-REC-16`): the toast's button with the keys of the tap
   * it belongs to, or `Ctrl+Z` for whatever this console did last.
   *
   * It used to send `ACTION_UNDONE` through the sync batch with a *booking*
   * id where an event id belongs — nothing was undone and a junk event stayed
   * in the log. The hook now knows which event each action became.
   */
  const undo = useCallback(
    async (clientEventIds) => {
      const outcome =
        clientEventIds === undefined ? await queue.undoLast() : await queue.undo(clientEventIds);
      show({
        title: t(UNDO_COPY[outcome], locale),
        tone: outcome === 'undone' ? 'positive' : 'caution',
      });
    },
    [queue, show, locale],
  );

  /**
   * `BTN-B02-NEXT`.
   *
   * One control, two facts: whoever is in the chamber is finished, and the next
   * patient is called. B1.3 step 1 — the label says so when both will happen.
   *
   * Both are queued together and sent in one flush. Sending the first and
   * waiting for the server before queueing the second left the "called" half
   * a round trip behind the tap on a slow connection (`NFR-02`).
   */
  const callNext = useCallback(async () => {
    if (state === null) return;

    // A paused chamber refuses the call (`canCallNext`). Say so here, in
    // words, rather than sending it to be rolled back as a "conflict" — which
    // is what a receptionist pressing N during a prayer break used to get.
    if (state.status === 'paused') {
      show({ title: t('pausedResumeFirst', locale), tone: 'caution' });
      return;
    }
    // And one that has ended takes nothing at all (`BTN-B02-END`).
    if (state.status === 'ended' || state.status === 'cancelled') {
      show({
        title: t(
          state.status === 'cancelled' ? 'receptionChamberCancelled' : 'chamberHasEnded',
          locale,
        ),
        tone: 'caution',
      });
      return;
    }

    const inChamber = nowServing(state);
    const next = waitingQueue(state).find((entry) => entry.status !== 'late');
    const actions = [];
    if (inChamber !== null) {
      actions.push({
        type: 'PATIENT_DONE',
        payload: { bookingId: inChamber.bookingId, consultSeconds: elapsedSeconds(inChamber, now) },
      });
    }
    if (next !== undefined) {
      actions.push({
        type: 'PATIENT_CALLED',
        payload: { bookingId: next.bookingId, serial: next.serial },
      });
    }
    const taken = actions.length > 0 ? await queue.actMany(actions) : [];
    if (next === undefined) return;

    show({
      title: format('calledPatient', locale, { serial: formatSerial(next.serial, numerals) }),
      tone: 'positive',
      // GR-02: undo appends a compensating event, never deletes history.
      action: {
        label: t('undo', locale),
        // The whole tap: the call, and the finish that went with it.
        onAction: () => {
          void undo(taken);
        },
      },
    });
  }, [state, queue, now, show, locale, undo]);

  /**
   * `BTN-B02-PAUSE` — one control, both directions (`FR-REC-05`, B1.2:
   * "resume with the same button"). A chamber that could be paused from here
   * and resumed only by calling the API by hand was frozen by a single tap.
   */
  const sessionStatus = state?.status ?? null;
  const togglePause = useCallback(() => {
    if (sessionStatus === 'paused') void queue.act('SESSION_RESUMED', {});
    else if (sessionStatus === 'running') void queue.act('SESSION_PAUSED', { reason: null });
  }, [sessionStatus, queue]);

  /**
   * `BTN-B02-END`, `MOD-B02-END` — ending the chamber on screen.
   *
   * Until this existed nothing in the product ended a chamber: it stayed
   * "running" for ever, and the next morning it was the first one the picker
   * offered. What it must not do is strand anybody silently, so it is off
   * while a patient is in the chamber (and the server refuses that too), and
   * when patients are left unseen the confirmation says how many and waits for
   * a deliberate tick. Nobody's status is changed by it.
   */
  const [ending, setEnding] = useState(false);
  const [endAcknowledged, setEndAcknowledged] = useState(false);
  const [endBusy, setEndBusy] = useState(false);
  const confirmEnd = useCallback(async () => {
    setEndBusy(true);
    const outcome = await queue.end();
    setEndBusy(false);
    setEnding(false);
    // Ended: the screen says so itself, from the server's answer.
    if (outcome === 'ended') return;
    show({
      title: t(
        outcome === 'in-chamber'
          ? 'endRefusedInChamber'
          : outcome === 'offline'
            ? 'endNeedsConnection'
            : 'endFailed',
        locale,
      ),
      tone: 'caution',
    });
  }, [queue, show, locale]);

  // A11Y-05 / B1.2: Space or N calls the next patient, A marks arrival,
  // P pauses and resumes. The console is operated at speed by people who are
  // not looking at the mouse — so a key is answered by the queue as it is on
  // the screen, never by the one before the last redraw (`useWindowKeydown`).
  // Stable registration reads the functions from the current render. Waiting
  // for an effect after a pause/resume redraw leaves the keyboard one state
  // behind the screen (A11Y-05, FR-REC-05).
  const liveCommands = useRef(null);
  liveCommands.current =
    state === null
      ? null
      : {
          next: () => {
            void callNext();
          },
          pause: togglePause,
          undo: () => {
            void undo();
          },
          arrived: () => {
            if (sessionStatus !== 'ended' && sessionStatus !== 'cancelled')
              void queue.act('DOCTOR_ARRIVED', arrivalNow(state.plan.plannedStart));
          },
          walkIn: () => {
            if (queue.connected && sessionStatus !== 'ended' && sessionStatus !== 'cancelled')
              setWalkingIn(true);
          },
        };
  const hasState = state !== null;
  useEffect(() => {
    if (sessionId === null || !hasState) return;
    props.onCommands(sessionId, {
      next: () => liveCommands.current?.next(),
      pause: () => liveCommands.current?.pause(),
      undo: () => liveCommands.current?.undo(),
      arrived: () => liveCommands.current?.arrived(),
      walkIn: () => liveCommands.current?.walkIn(),
    });
    return () => props.onCommands(sessionId, null);
  }, [sessionId, hasState, props.onCommands]);

  if (sessionId === null) {
    return <Notice>{t('noSession', locale)}</Notice>;
  }

  if (queue.loading) {
    // GR-03: loading is a designed state. A skeleton mirrors the layout rather
    // than covering it with a spinner (FRONTEND.md §5.9).
    return (
      <div className="cf-reception-loading">
        <h2>{localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)}</h2>
        <p role="status">{t('loading', locale)}</p>
      </div>
    );
  }

  if (state === null) {
    // Offline with nothing kept for this chamber is its own sentence: it is
    // not a failure to retry, and it resolves itself (`FR-OFF-05`).
    return (
      <Notice>
        <span data-testid="queue-not-kept">
          {queue.connected ? t('loadFailed', locale) : t('queueNotKeptOffline', locale)}
        </span>
      </Notice>
    );
  }

  const pendingBookingIds = queue.pendingBookingIds;
  const paused = state.status === 'paused';
  const ended = state.status === 'ended' || state.status === 'cancelled';
  const unseen = unseenAtEnd(state);
  /** An ended chamber takes no action; a tap on a row says so instead of trying. */
  const afterEnd = () => {
    if (!ended) return false;
    show({
      title: t(
        state.status === 'cancelled' ? 'receptionChamberCancelled' : 'chamberHasEnded',
        locale,
      ),
      tone: 'caution',
    });
    return true;
  };

  const arrived = state.entries.filter(
    (entry) => entry.status === 'waiting' && entry.arrivedAt !== null,
  ).length;
  const primaryLabel =
    state.status === 'scheduled'
      ? CONSOLE.doctorArrived
      : paused
        ? CONSOLE.resume
        : serving !== null && waiting.length === 0
          ? CONSOLE.markDone
          : serving === null
            ? CONSOLE.callNext
            : CONSOLE.finishAndCallNext;
  return (
    <article
      data-session-status={state.status}
      className="cf-reception-chamber"
      data-testid={`reception-chamber-${sessionId}`}
      data-session-id={sessionId}
      data-active={props.active ? 'true' : 'false'}
      onFocusCapture={props.onActivate}
      onClickCapture={props.onActivate}
    >
      <header className="cf-reception-summary">
        <div className="cf-reception-identity">
          <h2>
            <button
              type="button"
              className="cf-reception-expand"
              aria-expanded={props.expanded}
              aria-controls={`queue-${sessionId}`}
              data-testid={props.multi ? `open-receptionist-${sessionId}` : 'chamber-toggle'}
              onClick={props.onToggle}
            >
              <span data-testid={testId('chamber-title')}>
                {localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)}
              </span>
              <span aria-hidden="true">{props.expanded ? '⌃' : '⌄'}</span>
            </button>
          </h2>
          <p className="cf-secondary">
            {localName(locale, chamber.departmentNameBn, chamber.departmentNameEn)}
            {chamber.room === null ? '' : ` · ${chamber.room}`} ·{' '}
            {formatClock(state.plan.plannedStart, numerals)} –{' '}
            {formatClock(state.plan.plannedEnd, numerals)}
          </p>
          {/* The day it belongs to, in words: yesterday's chamber still running
            after midnight and today's for the same doctor cannot be taken for
            each other (BTN-B01-CHAMBER, owner's decision 2026-10-05). */}
          {chamber.today === undefined ? null : (
            <p
              className={chamber.today ? 'cf-secondary' : 'cf-feedback cf-tone-caution'}
              data-testid={testId('chamber-when')}
              data-today={String(chamber.today)}
            >
              {chamber.today
                ? format('chamberToday', locale, {
                    time: formatClock(state.plan.plannedStart, numerals),
                  })
                : format('chamberEarlierDay', locale, {
                    when: formatDateTime(state.plan.plannedStart, numerals),
                  })}
            </p>
          )}
          <ConsoleStatus
            tone={
              ended
                ? 'neutral'
                : paused
                  ? 'caution'
                  : state.status === 'running'
                    ? 'positive'
                    : 'information'
            }
            label={
              ended
                ? state.status === 'cancelled'
                  ? CONSOLE.receptionChamberCancelled
                  : CONSOLE.chamberEnded
                : paused
                  ? CONSOLE.pause
                  : state.status === 'running'
                    ? CONSOLE.actualStart
                    : CONSOLE.notStarted
            }
          />
        </div>
        <div className="cf-reception-current">
          <strong data-testid={serving === null ? undefined : testId('now-serving')}>
            {serving === null ? '—' : formatSerial(serving.serial, numerals)}
          </strong>
          <div>
            <small>{t('nowServing', locale)}</small>
            <p data-testid={testId('now-serving-name')}>
              {serving === null
                ? t('nobodyInChamber', locale)
                : (names.get(serving.patientId) ?? '—')}
            </p>
          </div>
        </div>
        <div className="cf-reception-counts">
          <p>
            <strong data-testid={testId('count-waiting')}>
              {formatNumber(waiting.length, numerals)}
            </strong>{' '}
            {t('countWaiting', locale)}
          </p>
          <p className="cf-secondary">
            {formatNumber(arrived, numerals)} · {t('statusArrived', locale)}
          </p>
        </div>
        <div className="cf-reception-actions">
          <ConsoleAction
            label={CONSOLE.addWalkin}
            variant="secondary"
            data-testid={testId('add-walkin')}
            {...(queue.connected && !ended
              ? {}
              : {
                  disabled: true,
                  disabledReason: t(ended ? 'chamberHasEnded' : 'walkInOffline', locale),
                })}
            onClick={() => setWalkingIn(true)}
          />
          {!ended ? (
            <a
              className="cf-reg-queue-link"
              data-testid={testId('registration-desk')}
              href={`/?view=registration&from=${encodeURIComponent(sessionId)}`}
            >
              {t('registrationTitle', locale)}
            </a>
          ) : null}
          {ended ? (
            <ConsoleAction
              label={CONSOLE.callNext}
              variant="secondary"
              data-testid={testId('call-next')}
              disabled
              disabledReason={t('chamberHasEnded', locale)}
            />
          ) : (
            <ConsoleAction
              label={primaryLabel}
              data-testid={testId(paused ? 'resume-primary' : 'call-next')}
              {...(state.status === 'running' && waiting.length === 0 && serving === null
                ? { disabled: true, disabledReason: t('emptyQueue', locale) }
                : {})}
              onClick={() => {
                if (state.status === 'scheduled')
                  void queue.act('DOCTOR_ARRIVED', arrivalNow(state.plan.plannedStart));
                else if (paused) togglePause();
                else void callNext();
              }}
            />
          )}
        </div>
      </header>
      <div className="cf-reception-freshness">
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
        {queue.pendingCount > 0 ? (
          <span role="status">
            {formatNumber(queue.pendingCount, numerals)} · {t('pendingToSync', locale)}
          </span>
        ) : null}
      </div>
      <div id={`queue-${sessionId}`} hidden={!props.expanded} className="cf-reception-expanded">
        {paused ? (
          <p role="status" data-testid={testId('paused-banner')}>
            {t('pausedResumeFirst', locale)}
          </p>
        ) : null}
        {ended ? (
          <p role="status" data-testid={testId('ended-banner')}>
            {t('chamberEnded', locale)}{' '}
            <a href="/" data-testid={testId('back-to-chambers')}>
              {t('backToChambers', locale)}
            </a>
          </p>
        ) : null}
        <div className="cf-reception-toolbar">
          <dl className="cf-reception-statistics">
            <Counter
              name="seen"
              label={t('countSeen', locale)}
              value={counts?.done ?? 0}
              scope={props.multi ? sessionId : null}
            />
            <Counter
              name="late"
              label={t('countLate', locale)}
              value={counts?.late ?? 0}
              scope={props.multi ? sessionId : null}
            />
            <Counter
              name="no-show"
              label={t('countNoShow', locale)}
              value={counts?.noShow ?? 0}
              scope={props.multi ? sessionId : null}
            />
          </dl>
          <div className="cf-reception-actions">
            {paused ? (
              <ConsoleAction
                label={CONSOLE.callNext}
                variant="secondary"
                data-testid={testId('call-next')}
                disabled
                disabledReason={t('pausedResumeFirst', locale)}
              />
            ) : null}
            {!ended ? (
              <ConsoleAction
                label={paused ? CONSOLE.resume : CONSOLE.pause}
                variant="secondary"
                data-testid={testId(paused ? 'resume-session' : 'pause-session')}
                {...(paused || state.status === 'running'
                  ? {}
                  : { disabled: true, disabledReason: t('pauseNeedsRunning', locale) })}
                onClick={togglePause}
              />
            ) : null}
            <details className="cf-reception-menu">
              <summary data-testid={testId('chamber-more')}>
                <BilingualLabel label={CONSOLE.receptionMore} />
              </summary>
              <div className="cf-stack">
                <ConsoleAction
                  label={CONSOLE.undo}
                  variant="secondary"
                  onClick={() => void undo()}
                />
                <p className="cf-secondary">{t('receptionUndoHelp', locale)}</p>
                {!ended ? (
                  <ConsoleAction
                    label={CONSOLE.endChamber}
                    variant="secondary"
                    data-testid={testId('end-chamber')}
                    {...(serving !== null || !queue.connected
                      ? {
                          disabled: true,
                          disabledReason: t(
                            serving !== null ? 'endPatientInChamber' : 'endNeedsConnection',
                            locale,
                          ),
                        }
                      : {})}
                    onClick={() => {
                      setEndAcknowledged(false);
                      setEnding(true);
                    }}
                  />
                ) : null}
              </div>
            </details>
          </div>
        </div>
        {serving === null ? null : (
          <section className="cf-reception-patient" data-testid={testId('now-serving-card')}>
            <div>
              <strong>{formatSerial(serving.serial, numerals)}</strong>
              <h3>{names.get(serving.patientId) ?? '—'}</h3>
              <p>{t('nowServing', locale)}</p>
            </div>
            <ConsoleAction
              label={CONSOLE.markDone}
              variant="secondary"
              onClick={() => {
                if (!afterEnd())
                  void queue.act('PATIENT_DONE', {
                    bookingId: serving.bookingId,
                    consultSeconds: elapsedSeconds(serving, now),
                  });
              }}
            />
          </section>
        )}
        <QueueTable
          state={state}
          locale={locale}
          pendingBookingIds={pendingBookingIds}
          patientNames={names}
          scope={props.multi ? sessionId : null}
          ended={ended}
          onDone={(entry) => {
            if (!afterEnd())
              void queue.act('PATIENT_DONE', {
                bookingId: entry.bookingId,
                consultSeconds: elapsedSeconds(entry, now),
              });
          }}
          onLate={(entry) => {
            if (!afterEnd())
              void queue.act('PATIENT_LATE', {
                bookingId: entry.bookingId,
                expectedMinutes: 20,
                reinsertAfter: 3,
              });
          }}
          onNoShow={(entry) => {
            if (!afterEnd())
              void queue.act('PATIENT_NO_SHOW', {
                bookingId: entry.bookingId,
                graceUsedMinutes: 15,
              });
          }}
          onReinstate={(entry) => {
            if (!afterEnd())
              void queue.act('PATIENT_REINSERTED', { bookingId: entry.bookingId, newPosition: 0 });
          }}
          onCheckIn={(entry) => {
            if (!afterEnd()) setCheckingIn(entry);
          }}
        />
        <OfflineBlock
          connected={queue.connected}
          pendingCount={queue.pendingCount}
          lastServerTs={queue.lastServerTs}
          stuckCount={queue.stuckCount}
          onRetryStuck={() => void queue.retryStuck()}
          onDiscardStuck={() => void queue.discardStuck()}
          durable={queue.durable}
          locale={locale}
          now={now}
          scope={props.multi ? sessionId : null}
        />
        <StandbyCard
          sessionId={sessionId}
          state={state}
          connected={queue.connected}
          pendingCount={queue.pendingCount}
          locale={locale}
          apiBaseUrl={API_BASE}
          getToken={readToken}
        />
      </div>
      <Sheet
        console
        open={ending}
        onOpenChange={(open) => {
          if (!open && !endBusy) setEnding(false);
        }}
        variant="modal"
        dismissible={false}
        title={t('endChamberTitle', locale)}
        // Which chamber: the doctor, and the day it belongs to.
        description={`${
          chamber === null
            ? t('navQueue', locale)
            : localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)
        } · ${formatDateTime(state.plan.plannedStart, numerals)}`}
      >
        <div className="flex flex-col gap-4" data-testid={testId('end-chamber-sheet')}>
          <p
            className="text-body-md"
            data-testid={testId('end-unseen')}
            data-unseen={String(unseen)}
          >
            {unseen > 0
              ? format('endChamberUnseen', locale, { count: formatNumber(unseen, numerals) })
              : t('endChamberNobodyLeft', locale)}{' '}
            {t('endChamberConsequence', locale)}
          </p>

          {/* Patients left unseen: a deliberate tick, not a second tap in
              the same place (owner's decision, 2026-10-05). */}
          {unseen > 0 ? (
            <label className="flex min-h-touch items-center gap-3 text-body-md">
              <input
                type="checkbox"
                checked={endAcknowledged}
                data-testid="end-acknowledge"
                onChange={(event) => {
                  setEndAcknowledged(event.target.checked);
                }}
              />
              {t('endChamberAcknowledge', locale)}
            </label>
          ) : null}

          {/* GR-01: the safe option on the left. */}
          <SheetActions destructive>
            {unseen > 0 && !endAcknowledged ? (
              <Button
                variant="danger-quiet"
                data-testid={testId('end-confirm')}
                disabled
                disabledReason={t('endChamberAcknowledge', locale)}
              >
                {t('endChamberConfirm', locale)}
              </Button>
            ) : (
              <Button
                variant="danger-quiet"
                data-testid={testId('end-confirm')}
                loading={endBusy}
                onClick={() => {
                  void confirmEnd();
                }}
              >
                {t('endChamberConfirm', locale)}
              </Button>
            )}
            <Button
              variant="secondary"
              data-testid={testId('end-keep')}
              onClick={() => {
                setEnding(false);
              }}
            >
              {t('endChamberKeep', locale)}
            </Button>
          </SheetActions>
        </div>
      </Sheet>

      <WalkInSheet
        sessionId={sessionId}
        open={walkingIn}
        online={queue.connected && !ended}
        waiting={waiting.length}
        chamberName={localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)}
        onAdded={(message) => {
          setWalkingIn(false);
          show({ title: message, tone: 'positive' });
        }}
        onClose={() => setWalkingIn(false)}
      />
      <CheckInSheet
        serial={checkingIn?.serial ?? null}
        suggested={
          checkingIn === null
            ? null
            : suggestedQuote(state, checkingIn.bookingId, time.fromDate(now))
        }
        locale={locale}
        onClose={() => setCheckingIn(null)}
        onConfirm={(quotedWaitMinutes) => {
          const entry = checkingIn;
          setCheckingIn(null);
          if (entry === null || afterEnd()) return;
          void queue.act('PATIENT_ARRIVED', { bookingId: entry.bookingId, quotedWaitMinutes });
          show({
            title: format('checkedIn', locale, {
              serial: formatSerial(entry.serial, numerals),
              minutes: formatNumber(quotedWaitMinutes, numerals),
            }),
            tone: 'positive',
          });
        }}
      />
    </article>
  );
}

function Counter({ name, label, value, scope }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd
        className="text-title-sm tabular-nums"
        data-testid={scope === null ? `count-${name}` : `count-${name}-${scope}`}
      >
        {formatNumber(value, numerals)}
      </dd>
    </div>
  );
}

function Notice({ children }) {
  return (
    <div className="cf-reception-loading">
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
/**
 * The doctor's arrival as this console draws it before the server answers:
 * now, and how late that is against the planned start (`FR-REC-02`).
 *
 * It used to say zero minutes late, always. Online the server stamps both
 * itself and this is only what the screen shows for a moment; queued offline,
 * the time is what the server keeps and the lateness is worked out there from
 * it (`sync.service`), so the two sums are the same one.
 */
function arrivalNow(plannedStart) {
  const arrivedAt = time.fromDate(new Date());
  return {
    arrivedAt,
    minutesLate: plannedStart === null ? 0 : time.differenceInMinutes(arrivedAt, plannedStart),
  };
}

function elapsedSeconds(entry, now) {
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
function useSessionId() {
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    setSessionId(new URLSearchParams(globalThis.location.search).get('session'));
  }, []);

  return sessionId;
}
