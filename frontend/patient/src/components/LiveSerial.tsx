'use client';

/**
 * `S-A-08` Live serial (`APP_FLOW.md` A5, `FR-PAT-30`…`36`).
 *
 * The screen the product exists for. A reception console taps *next* and this
 * updates within two seconds (`NFR-01`, `FR-PAT-31`) — everything else in the
 * patient app is a way of getting somebody here.
 *
 * ## Where each number comes from
 *
 * Nothing on this screen is computed from a guess. The queue arrives over the
 * session channel as the state the server reduced; the ETAs arrive with it,
 * computed by `eta.ts` in `shared/domain` — the same function the console runs
 * (`FR-QUE-05`). What this file does is choose the sentence, format the
 * numerals, and refuse to show a figure it cannot stand behind.
 *
 * ## The four states (`GR-03`)
 *
 * Loading is a skeleton in the final layout's shape, never a spinner. Empty is
 * a link that has expired or a booking that is not there, each with its own
 * sentence. Error is an inline banner with a retry. Offline keeps the card on
 * screen with the connection stated — a number that has stopped updating,
 * labelled as such, is more use in a corridor than a blank page
 * (`FR-PAT-36`).
 */

import { useCallback, useMemo, useState } from 'react';

import {
  computeEtas,
  patientsAhead as aheadOf,
  readRefundPolicy,
  refundIfCancelledNow,
  time,
  type Eta,
  type QueueEntry,
  type QueueState,
  type RefundDecision,
  type Timestamp,
} from '@platform/domain';
import {
  formatClock,
  formatMinutes,
  formatSerial,
  formatTaka,
  tp,
  formatAge,
  numeralsFor,
  type Locale,
  localName,
} from '@platform/i18n';
import {
  Button,
  FreshnessLine,
  LiveSerialCard,
  Sheet,
  SheetActions,
  useLocale,
} from '@platform/ui';

import { BottomNav, BottomNavSpacer } from '@/components/BottomNav';
import { useNow } from '@/hooks/useNow';
import { useSessionChannel } from '@/hooks/useSessionChannel';
import { useTrackingLink } from '@/hooks/useTrackingLink';
import { SOCKET_URL, cancelBooking, declareLate } from '@/lib/api';

import type { BookingDetail, BookingView } from '@/lib/types';
import type { ReactNode } from 'react';

/** How late a patient may say they will be (`MOD-A08-LATE` step 1). */
const LATE_OPTIONS = [10, 20, 30, 45] as const;

/**
 * Travel time to the hospital, in minutes (`FR-PAT-32`).
 *
 * `TRAVEL_TIME_MODE=static` in this version, and the static value is the one
 * the requirement permits: "travel time may be a static per-hospital estimate
 * in v0". A per-hospital matrix and a live estimate both arrive with the
 * emergency search in step 15, which is where travel time is load-bearing.
 */
const TRAVEL_MINUTES = 30;

/** Rows either side of the patient in the preview (`LIST-A08-QUEUE`). */
const PREVIEW_BEFORE = 3;
const PREVIEW_AFTER = 2;

export function LiveSerial({ linkToken }: { readonly linkToken: string | null }): ReactNode {
  const link = useTrackingLink(linkToken);
  const now = useNow();

  const channel = useSessionChannel({
    sessionId: link.booking?.sessionId ?? '',
    socketUrl: SOCKET_URL,
    getToken: link.getToken,
  });

  // The socket's state once it has spoken, the first paint's before that. A
  // screen that waited for the handshake would show a skeleton for a second
  // over data it already had.
  const state = channel.state ?? link.initial?.state ?? null;
  const etas = channel.state === null ? (link.initial?.etas ?? []) : channel.etas;
  const freshAt = channel.lastServerTs ?? link.initial?.freshAt ?? null;

  if (link.loading) return <LiveSerialSkeleton />;
  if (link.error !== null) return <LiveSerialProblem error={link.error} onRetry={link.retry} />;
  if (link.booking === null || state === null) {
    return <LiveSerialProblem error="not-found" onRetry={link.retry} />;
  }

  return (
    <Ready
      booking={link.booking}
      payment={link.initial?.payment ?? null}
      state={state}
      etas={etas}
      freshAt={freshAt}
      now={now}
      stale={channel.isStale}
      token={link.token}
    />
  );
}

function Ready({
  booking,
  payment,
  state,
  etas,
  freshAt,
  now,
  stale,
  token,
}: {
  /** What was paid, for the refund `MOD-A08-CANCEL` has to state. */
  readonly payment: BookingView['payment'];
  readonly booking: BookingDetail;
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  readonly freshAt: string | null;
  readonly now: Date;
  readonly stale: boolean;
  readonly token: string | null;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const mine = state.entries.find((entry) => entry.bookingId === booking.id) ?? null;
  const ahead = mine === null ? 0 : aheadOf(state, mine.bookingId);
  const serving = state.entries.find((entry) => entry.status === 'in_chamber') ?? null;

  /**
   * This patient's estimate.
   *
   * Recomputed locally when the server's list does not carry one — which
   * happens for a row the server considered settled. `computeEtas` is the
   * domain's own function, so a locally-derived figure and a broadcast one are
   * the same number from the same code (`FR-QUE-05`).
   */
  const eta = useMemo(() => {
    const broadcast = etas.find((candidate) => candidate.bookingId === booking.id);
    if (broadcast !== undefined) return broadcast;

    return (
      computeEtas(state, time.fromDate(now)).find(
        (candidate) => candidate.bookingId === booking.id,
      ) ?? null
    );
  }, [etas, state, booking.id, now]);

  const called = mine?.status === 'in_chamber';
  const minutesUntil =
    eta === null || eta.confidence === 'unknown'
      ? null
      : Math.max(0, Math.round((Date.parse(eta.etaAt) - now.getTime()) / 60_000));

  const act = useCallback(
    async (run: (input: { bookingId: string; token: string }) => Promise<void>, done: string) => {
      if (token === null) {
        setFailure(tp('lateFailed', locale));
        return;
      }

      setFailure(null);
      setNotice(tp('lateSending', locale));

      try {
        await run({ bookingId: booking.id, token });
        setNotice(done);
      } catch {
        // `APP_FLOW.md` A5 step 7: if it does not land, tell the person to
        // speak to the counter. A silent failure here means somebody stands in
        // a corridor believing the hospital knows something it does not.
        setNotice(null);
        setFailure(tp('lateFailed', locale));
      }
    },
    [booking.id, token, locale],
  );

  return (
    <>
      <main className="mx-auto flex max-w-[480px] flex-col gap-5 p-5">
        <p className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700">
          {tp('demoBanner', locale)}
        </p>

        <header className="flex flex-col gap-1">
          <h1 className="font-reading text-title-lg">
            {localName(locale, booking.doctorNameBn, booking.doctorNameEn)}
          </h1>
          <p className="text-body-sm text-ink-muted">
            {localName(locale, booking.hospitalNameBn, booking.hospitalNameEn)}
          </p>
        </header>

        <LiveSerialCard
          serial={formatSerial(booking.serial, numerals)}
          nowServing={serving === null ? null : formatSerial(serving.serial, numerals)}
          seen={state.entries.filter((entry) => entry.status === 'done').length}
          total={state.entries.length}
          etaText={etaText(eta, locale)}
          confidence={eta?.confidence ?? 'unknown'}
          stale={stale}
          doctorArrived={state.doctorArrivedAt !== null}
          delayMinutes={state.delayMinutes}
          patientsAhead={ahead}
          called={called}
          labels={{
            status: statusLine(state, called, locale),
            yourSerial: tp('liveSerialTitle', locale),
            nowServing: tp('nowServing', locale),
            nobodyCalledYet: tp('nobodyCalledYet', locale),
            progress: tp('sessionProgress', locale),
            eta: tp('estimatedTime', locale),
            etaUnknown: tp('etaUnknown', locale),
            countdown:
              minutesUntil === null
                ? null
                : tp('countdown', locale).replace(
                    '{minutes}',
                    formatMinutes(minutesUntil, numerals),
                  ),
            disconnected: tp('disconnected', locale),
          }}
          freshness={
            <FreshnessLine
              asOf={freshAt === null ? null : new Date(freshAt)}
              now={now}
              staleAfterMinutes={booking.staleThresholdMinutes}
              labels={{
                justNow: tp('updatedJustNow', locale),
                ago: tp('updatedAgo', locale),
                never: tp('updatedNever', locale),
                stale: tp('staleWarning', locale),
              }}
              formatMinutes={(value) => formatAge(value, locale, numerals)}
            />
          }
        />

        {/* `FR-PAT-38`: the wait the counter quoted at check-in. Beside the
            live estimate, never instead of it, and never counting below zero:
            a promise that has run out says so. */}
        {mine !== null && !called && mine.arrivedAt !== null && mine.quotedWaitMinutes !== null ? (
          <CounterQuote
            arrivedAt={mine.arrivedAt}
            quotedWaitMinutes={mine.quotedWaitMinutes}
            now={now}
          />
        ) : null}

        {/* `BANNER-A08-LEAVE` (`FR-PAT-32`): travel + buffer has caught up with
          the remaining wait. Only while there is still a wait to beat — a
          person already being called does not need to be told to set off, and
          nor does one reception has already checked in (`FR-PAT-38`). */}
        {!called &&
        mine?.arrivedAt === null &&
        minutesUntil !== null &&
        minutesUntil <= TRAVEL_MINUTES + 10 ? (
          <p
            role="status"
            data-testid="leave-now"
            className="rounded-md bg-brand-100 px-4 py-3 text-body-md text-brand-900"
          >
            {tp('leaveNow', locale).replace('{minutes}', formatMinutes(TRAVEL_MINUTES, numerals))}
          </p>
        ) : null}

        {called ? (
          <p
            role="status"
            data-testid="called-takeover"
            className="rounded-md bg-brand-600 px-4 py-3 text-body-lg font-semibold text-white"
          >
            {booking.room === null
              ? tp('goToChamber', locale)
              : tp('goToRoom', locale).replace('{room}', booking.room)}
          </p>
        ) : null}

        {notice === null ? null : (
          <p
            role="status"
            data-testid="live-serial-notice"
            className="rounded-sm bg-sunken px-3 py-2 text-body-md text-ink-secondary"
          >
            {notice}
          </p>
        )}

        {failure === null ? null : (
          <p
            data-testid="live-serial-failure"
            className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700"
          >
            {failure}
          </p>
        )}

        <QueuePreview state={state} mine={mine} />

        <div className="flex flex-col gap-3">
          <LateSheet
            // Somebody checked in at the counter is not running late.
            disabled={mine === null || called || mine.arrivedAt !== null}
            onChoose={(minutes) => {
              void act(
                async ({ bookingId, token: bearer }) => {
                  await declareLate({
                    bookingId,
                    token: bearer,
                    expectedMinutes: minutes,
                    idempotencyKey: crypto.randomUUID(),
                    clientEventId: crypto.randomUUID(),
                  });
                },
                tp('lateDone', locale).replace('{count}', formatMinutes(3, numerals)),
              );
            }}
          />

          <CancelSheet
            serial={formatSerial(booking.serial, numerals)}
            refund={cancellationRefund(booking, payment)}
            disabled={mine === null || mine.status === 'cancelled'}
            onConfirm={() => {
              void act(
                async ({ bookingId, token: bearer }) => {
                  await cancelBooking({
                    bookingId,
                    token: bearer,
                    idempotencyKey: crypto.randomUUID(),
                    clientEventId: crypto.randomUUID(),
                  });
                },
                tp('cancelled', locale),
              );
            }}
          />
        </div>

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
  );
}

/**
 * The line above the number (`FR-PAT-30`).
 *
 * One sentence, and the most useful one available: an ended chamber, a break,
 * a declared delay, an arrival time, or the plain fact that the doctor is not
 * in yet. Ordered the way `liveSerialTone` orders the surface, so the words
 * and the colour never describe different situations.
 */
function statusLine(state: QueueState, called: boolean, locale: Locale): string {
  const numerals = numeralsFor(locale);
  if (called) return tp('yourTurn', locale);
  if (state.status === 'ended') return tp('sessionEnded', locale);
  if (state.pausedAt !== null) return tp('sessionPaused', locale);
  if (state.delayMinutes > 0) {
    return tp('doctorDelayed', locale).replace(
      '{minutes}',
      formatMinutes(state.delayMinutes, numerals),
    );
  }
  if (state.doctorArrivedAt === null) return tp('doctorNotArrived', locale);

  return tp('doctorArrivedAt', locale).replace(
    '{time}',
    formatClock(state.doctorArrivedAt, numerals),
  );
}

/**
 * The ETA as a sentence (`FR-QUE-13`).
 *
 * A time and a band, or nothing at all. There is deliberately no middle
 * option: an estimate the chamber cannot support is not improved by being
 * shown with a wider band, it is improved by not being shown.
 */
/** The counter's quote and what is left of it (`FR-PAT-38`). */
function CounterQuote({
  arrivedAt,
  quotedWaitMinutes,
  now,
}: {
  readonly arrivedAt: Timestamp;
  readonly quotedWaitMinutes: number;
  readonly now: Date;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const promisedAt = Date.parse(arrivedAt) + quotedWaitMinutes * 60_000;
  const left = Math.ceil((promisedAt - now.getTime()) / 60_000);

  return (
    <section
      data-testid="counter-quote"
      className="flex flex-col gap-1 rounded-md border border-line bg-surface px-4 py-3"
    >
      <p className="text-caption text-ink-muted">{tp('quoteTitle', locale)}</p>
      <p className="text-body-md">
        {tp('quoteSaid', locale)
          .replace('{minutes}', formatMinutes(quotedWaitMinutes, numerals))
          .replace('{time}', formatClock(arrivedAt, numerals))}
      </p>
      <p className="text-body-sm text-ink-secondary" data-testid="counter-quote-left">
        {left > 0
          ? tp('quoteLeft', locale).replace('{minutes}', formatMinutes(left, numerals))
          : tp('quotePassed', locale)}
      </p>
    </section>
  );
}

function etaText(eta: Eta | null, locale: Locale): string | null {
  const numerals = numeralsFor(locale);
  if (eta === null || eta.confidence === 'unknown') return null;

  return tp('etaWithBand', locale)
    .replace('{time}', formatClock(eta.etaAt, numerals))
    .replace('{band}', formatMinutes(eta.bandMinutes, numerals));
}

/**
 * `LIST-A08-QUEUE` — serving, the next few, this patient's row highlighted.
 *
 * Deliberately a window rather than the whole chamber. A person wants to know
 * where they are relative to the front, and a list of a hundred and fifty
 * strangers on a cheap phone answers that worse than six rows do. No names:
 * the other patients in a queue are not this one's business (`FR-SEC-03`).
 */
function QueuePreview({
  state,
  mine,
}: {
  readonly state: QueueState;
  readonly mine: QueueEntry | null;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const active = state.entries.filter(
    (entry) => entry.status !== 'cancelled' && entry.status !== 'no_show',
  );

  const index =
    mine === null ? -1 : active.findIndex((entry) => entry.bookingId === mine.bookingId);
  const from = index === -1 ? 0 : Math.max(0, index - PREVIEW_BEFORE);
  const window = active.slice(from, index === -1 ? PREVIEW_BEFORE : index + PREVIEW_AFTER + 1);

  if (window.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title-sm">{tp('queuePreview', locale)}</h2>

      <ul className="flex flex-col divide-y divide-line-hairline rounded-md border border-line bg-surface">
        {window.map((entry) => {
          const isMine = entry.bookingId === mine?.bookingId;

          return (
            <li
              key={entry.bookingId}
              data-testid={isMine ? 'queue-row-mine' : 'queue-row'}
              className={`flex items-center justify-between gap-3 px-4 py-3 ${
                isMine ? 'bg-brand-100' : ''
              }`}
            >
              <span className="text-body-lg tabular-nums">
                {formatSerial(entry.serial, numerals)}
              </span>
              <span className="text-body-sm text-ink-secondary">
                {/* A11Y-03: state is a word, never a colour on its own. */}
                {isMine ? tp('youMarker', locale) : rowState(entry, locale)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function rowState(entry: QueueEntry, locale: Locale): string {
  if (entry.status === 'in_chamber') return tp('inChamber', locale);
  if (entry.status === 'done') return tp('seenAlready', locale);
  if (entry.status === 'late') return tp('runningLate', locale);
  return tp('waitingHere', locale);
}

/** `MOD-A08-LATE` (`FR-PAT-33`). */
function LateSheet({
  disabled,
  onChoose,
}: {
  readonly disabled: boolean;
  readonly onChoose: (minutes: number) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [open, setOpen] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={tp('lateQuestion', locale)}
      trigger={
        disabled ? (
          <Button variant="secondary" fullWidth disabled disabledReason={tp('etaUnknown', locale)}>
            {tp('declareLate', locale)}
          </Button>
        ) : (
          <Button variant="secondary" fullWidth data-testid="declare-late">
            {tp('declareLate', locale)}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {LATE_OPTIONS.map((minutes) => (
          <Button
            key={minutes}
            variant="secondary"
            fullWidth
            data-testid={`late-${String(minutes)}`}
            onClick={() => {
              setOpen(false);
              onChoose(minutes);
            }}
          >
            {tp('lateMinutes', locale).replace('{minutes}', formatMinutes(minutes, numerals))}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * `MOD-A08-CANCEL` (`GR-01`, `FR-PAY-03`).
 *
 * The confirm names the consequence — the serial is released and somebody else
 * may get it — rather than asking "are you sure", and the safe option sits on
 * the left.
 *
 * The refund rule is stated before confirming, in taka rather than as a
 * percentage — a person deciding whether to cancel wants the number they will
 * get, not the rule that produced it.
 *
 * It is computed by `refundIfCancelledNow` from `shared/domain`, which is the
 * same function the server refunds with. That is the point: the sentence a
 * patient reads here and the amount that reaches them afterwards come from
 * one piece of code, so they cannot disagree (`FR-PAY-03`).
 *
 * Where the hospital has recorded no terms the sheet says the hospital will
 * confirm, rather than inventing a percentage (`PRD.md` §3.2) — and where
 * nothing was ever paid it says that instead, which is a different sentence
 * and a different fact.
 */
/**
 * What this booking gets back if it is cancelled right now.
 *
 * Null when nothing was ever taken, which the sheet says in its own words.
 * Everything else — including "no policy on file" — is a `RefundDecision`,
 * because `stated: false` is itself an answer the screen has to render.
 */
function cancellationRefund(
  booking: BookingDetail,
  payment: BookingView['payment'],
): RefundDecision | null {
  if (payment?.paidAt == null) return null;

  return refundIfCancelledNow(
    {
      amountPoisha: payment.amountPoisha,
      platformFeePoisha: payment.platformFeePoisha,
      refundedPoisha: payment.refundedPoisha,
      paidAt: payment.paidAt as Timestamp,
    },
    {
      now: new Date().toISOString() as Timestamp,
      sessionStart: booking.plannedStart as Timestamp,
      policy: readRefundPolicy(booking.refundPolicy),
    },
  );
}

/** The refund, as a sentence somebody deciding can act on. */
function refundSentence(refund: RefundDecision | null, locale: Locale): string {
  const numerals = numeralsFor(locale);
  if (refund === null) return tp('refundNothingPaid', locale);
  if (!refund.stated) return tp('refundPolicyUnknown', locale);
  if (refund.refundPoisha <= 0) return tp('refundNone', locale);
  return tp('refundFull', locale).replace('{amount}', formatTaka(refund.refundPoisha, numerals));
}

function CancelSheet({
  serial,
  refund,
  disabled,
  onConfirm,
}: {
  readonly serial: string;
  /** What `refundIfCancelledNow` decided, or null when nothing was paid. */
  readonly refund: RefundDecision | null;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
}): ReactNode {
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={tp('cancelQuestion', locale)}
      description={tp('cancelConsequence', locale).replace('{serial}', serial)}
      // §5.6: no dismiss-by-accident on a destructive confirmation.
      dismissible={false}
      trigger={
        disabled ? (
          <Button variant="quiet" fullWidth disabled disabledReason={tp('cancelFailed', locale)}>
            {tp('cancelBooking', locale)}
          </Button>
        ) : (
          <Button variant="quiet" fullWidth data-testid="cancel-booking">
            {tp('cancelBooking', locale)}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-body-md text-ink-secondary" data-testid="refund-rule">
          {refundSentence(refund, locale)}
        </p>

        <SheetActions destructive>
          <Button
            variant="danger-quiet"
            data-testid="cancel-confirm"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {tp('cancelConfirm', locale)}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
          >
            {tp('cancelKeep', locale)}
          </Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/**
 * `GR-03` loading: a skeleton in the shape of the final layout.
 *
 * Never a spinner over the whole screen (`FRONTEND.md` §5.9). A person opening
 * an SMS link on a 3G connection sees where the number will be before it
 * arrives, which makes the wait read as loading rather than as broken.
 */
function LiveSerialSkeleton(): ReactNode {
  const locale = useLocale();
  return (
    <main
      className="mx-auto flex max-w-[480px] flex-col gap-5 p-5"
      aria-busy="true"
      data-testid="live-serial-loading"
    >
      <div className="h-8 w-1/2 rounded-sm bg-sunken" />
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
        <div className="h-5 w-2/3 rounded-sm bg-sunken" />
        <div className="h-14 w-24 rounded-sm bg-sunken" />
        <div className="h-1.5 w-full rounded-pill bg-sunken" />
        <div className="h-5 w-1/2 rounded-sm bg-sunken" />
      </div>
      <span className="sr-only">{tp('loading', locale)}</span>
    </main>
  );
}

/**
 * `GR-03` empty and error, by cause.
 *
 * Three different sentences because they call for three different things: an
 * expired link means book again, a missing booking means the URL is wrong, and
 * a failure is worth retrying.
 */
function LiveSerialProblem({
  error,
  onRetry,
}: {
  readonly error: 'expired' | 'not-found' | 'failed';
  readonly onRetry: () => void;
}): ReactNode {
  const locale = useLocale();
  const message =
    error === 'expired'
      ? tp('linkExpired', locale)
      : error === 'not-found'
        ? tp('serialNotFound', locale)
        : tp('bookingFailed', locale);

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 p-5" data-testid="live-serial-error">
      <p className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700">{message}</p>

      {error === 'failed' ? (
        <Button onClick={onRetry} data-testid="live-serial-retry">
          {tp('tryAgain', locale)}
        </Button>
      ) : (
        <a
          href="/"
          className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-semibold text-white"
        >
          {tp('backHome', locale)}
        </a>
      )}
    </main>
  );
}
