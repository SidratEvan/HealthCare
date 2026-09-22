/**
 * Notifications (BACKEND.md §4.1 step 11, §8; `FR-NOT-01`…`FR-NOT-07`).
 *
 * The one place that decides who is told what. A queue event happens, this
 * file turns it into messages, and nothing else in the codebase composes a
 * message or picks a channel.
 *
 * ## Two phases, and the split is the whole design
 *
 * `planFor` is pure. Given the queue state and the event, it returns the
 * messages that should exist — no I/O, no clock beyond the one it is handed.
 * `queueFor` writes those rows **inside the caller's transaction**, so a
 * rolled-back queue event leaves no message behind. `dispatch` runs **after
 * the commit**, outside the session lock, and talks to the adapters.
 *
 * That ordering is not tidiness. An SMS gateway taking four seconds must never
 * hold the session row every counter in the hospital is waiting on, and a
 * message must never go out for an event that did not happen. The
 * `notifications` table sits between the two halves as an outbox: its partial
 * index on `state = 'queued'` is exactly the query a retry worker will need
 * when one exists (build step 14 or later; `pg-boss` is not installed).
 *
 * ## Why the copy comes from the database
 *
 * `FR-NOT-05`: "templates are versioned and centrally managed, never
 * hard-coded at call sites." The shipped defaults live in
 * `@platform/i18n/templates`, the seed installs them into
 * `notification_templates`, and this file reads that table. So a hospital can
 * be given different wording without a deploy, and a message sent last month
 * can still be explained by the row that produced it.
 */

import { twoAwayBookings, waitingQueue, type QueueEvent, type QueueState } from '@platform/domain';
import {
  BED_KIND_NAMES,
  bedKindName,
  formatClock,
  formatNumber,
  formatSerial,
  render,
  tp,
  type BedKindName,
  type Locale,
  type NumeralStyle,
  type TemplateKey,
} from '@platform/i18n';

import { push } from '../adapters/push.js';
import { segmentsFor, sms } from '../adapters/sms.js';
import { logger } from '../config/logger.js';
import * as notificationRepo from '../repositories/notification.repo.js';

import type { Tx } from '../repositories/transaction.js';

/** One message, decided but not yet written. */
export interface PlannedNotification {
  readonly bookingId: string;
  readonly templateKey: TemplateKey;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Which events produce which message (BACKEND.md §8's mapping table).
 *
 * `SLOT_OFFERED` is in that table and is absent here: `offerFreedSlot` is not
 * built (`FR-QUE-30`, build step 15), so no such event is ever appended. A
 * template for a message nothing can send would be copy nobody reviews.
 */
const TEMPLATE_FOR: Partial<Record<QueueEvent['type'], TemplateKey>> = {
  DOCTOR_ARRIVED: 'queue.doctor_arrived',
  DELAY_DECLARED: 'queue.delayed',
  PATIENT_CALLED: 'queue.called',
  PATIENT_NO_SHOW: 'queue.no_show',
  BOOKING_CANCELLED: 'queue.cancelled',
  SESSION_ENDED: 'session.ended',
};

/**
 * Message namespaces that override quiet hours (`FR-NOT-07`).
 *
 * "Quiet hours for non-urgent notifications; emergency and queue events
 * override." Everything this version sends is a queue, booking or session
 * event, so nothing is suppressed today — the rule is here because the first
 * template outside these namespaces (a follow-up reminder, a medicine
 * reminder) must not wake somebody at two in the morning, and the decision
 * belongs beside the sending rather than in the branch that adds the template.
 *
 * `bed` is here too, and that is a judgement the requirement does not make
 * for us (recorded in `docs/STATUS.md`). The answer to a bed request is the
 * message a family is sitting up waiting for, and a hold is measured in
 * minutes: a "your bed is held until 11:30 PM" text deferred to seven in the
 * morning is a bed they lost while being told nothing.
 */
const ALWAYS_OVERRIDES_QUIET_HOURS = new Set(['queue', 'booking', 'session', 'emergency', 'bed']);

/** Dhaka local hours during which a non-urgent message waits. */
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 7;

/**
 * Whether this message may go out now.
 *
 * Pure, and takes the instant, so a test does not need a clock at two in the
 * morning to prove it.
 */
export function withinQuietHours(key: string, at: Date): boolean {
  const namespace = key.split('.')[0] ?? '';
  if (ALWAYS_OVERRIDES_QUIET_HOURS.has(namespace)) return false;

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      hour: '2-digit',
      hour12: false,
    }).format(at),
  );

  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/**
 * The messages one event should produce.
 *
 * Pure: state in, intentions out. Everything difficult about notifications —
 * *who* is two away, *which* patients are still waiting when a chamber closes
 * — is a question about the queue, and the queue's questions are answered by
 * the domain's own projections rather than by a second reading of the log.
 */
export function planFor(
  state: QueueState,
  event: QueueEvent,
  context: { readonly etaFor: (bookingId: string) => string | null },
): readonly PlannedNotification[] {
  const key = TEMPLATE_FOR[event.type];
  if (key === undefined) return [];

  switch (event.type) {
    // --- Addressed to one person ------------------------------------------
    case 'PATIENT_CALLED':
    case 'PATIENT_NO_SHOW':
    case 'BOOKING_CANCELLED': {
      const bookingId = String(event.payload.bookingId);
      return [{ bookingId, templateKey: key, params: {} }];
    }

    // --- Addressed to everybody still waiting ------------------------------
    //
    // `waitingQueue` rather than every entry: telling a patient who was seen
    // an hour ago that the doctor is running late is the kind of message that
    // makes people turn notifications off.
    case 'DOCTOR_ARRIVED':
    case 'DELAY_DECLARED':
    case 'SESSION_ENDED': {
      const minutes =
        event.type === 'DELAY_DECLARED'
          ? String(event.payload.minutes)
          : String(state.delayMinutes);

      return waitingQueue(state).map((entry) => ({
        bookingId: entry.bookingId,
        templateKey: key,
        params: { minutes, eta: context.etaFor(entry.bookingId) ?? '' },
      }));
    }

    // Unreachable: `TEMPLATE_FOR` has no entry for any other type, and the
    // guard above returns before we get here. Listed rather than defaulted so
    // that adding a template without deciding who receives it fails to
    // compile instead of silently notifying nobody.
    case 'SESSION_OPENED':
    case 'SESSION_PAUSED':
    case 'SESSION_RESUMED':
    case 'PATIENT_DONE':
    case 'PATIENT_LATE':
    case 'PATIENT_REINSERTED':
    case 'WALKIN_ADDED':
    case 'SLOT_OFFERED':
    case 'SLOT_ACCEPTED':
    case 'SLOT_EXPIRED':
    case 'PRIORITY_REORDERED':
    case 'ACTION_UNDONE':
      return [];
  }
}

/**
 * Messages a booking receives at most once.
 *
 * Deduped against the outbox rather than against the queue's previous state.
 * The state comparison answers "did this change in the last transaction",
 * which gets the first one wrong: before a chamber opens, the third patient
 * already satisfies "two away", so nothing ever transitions and they are never
 * told.
 */
const SEND_ONCE = new Set<TemplateKey>(['queue.two_away']);

/**
 * The "two patients away" notice (`FR-NOT-03`).
 *
 * BACKEND.md §8 schedules this as a worker running every 60 seconds. It is
 * raised from the event instead, and that is a better answer rather than a
 * cheaper one: being two away is caused by somebody in front being called or
 * finishing, so the state transition knows it exactly, while a poll can only
 * notice it up to a minute late. A minute is a long time when the message is
 * "set off now".
 *
 * `twoAwayBookings` is the domain's own projection, so the console, the
 * patient screen and this notice cannot disagree about who is next but one.
 * Whether the person has already been told is settled in `queueFor`, against
 * the outbox.
 */
export function planTwoAway(state: QueueState): readonly PlannedNotification[] {
  // Nothing to set off for. A chamber whose doctor has not arrived has no
  // meaningful "two away", and saying so would send somebody to a shut door.
  if (state.doctorArrivedAt === null || state.status === 'ended') return [];

  return twoAwayBookings(state).map((bookingId) => ({
    bookingId,
    templateKey: 'queue.two_away' as const,
    params: {},
  }));
}

/**
 * The booking confirmation (`FR-PAT-22`, `FR-GST-05`).
 *
 * Separate from `planFor` because a booking is not a queue event: it has no
 * entry in the log, and the message it produces carries something no other
 * message does — the tracking link, which for a guest with no app *is* the
 * product until they arrive.
 *
 * The link is passed in rather than looked up, because it exists exactly once,
 * at the moment the booking is made: only its hash is stored (`FR-GST-05`), so
 * this is the sole point at which the SMS can be composed at all.
 */
export function planBookingConfirmed(
  bookingId: string,
  link: string | null,
): readonly PlannedNotification[] {
  return [
    {
      bookingId,
      templateKey: 'booking.confirmed',
      params: link === null ? {} : { link },
    },
  ];
}

/** What `queueFor` hands back for the caller to dispatch after commit. */
export interface QueuedBatch {
  readonly ids: readonly string[];
  readonly messages: readonly {
    readonly id: string;
    readonly channel: 'sms' | 'push';
    readonly to: string | null;
    readonly body: string;
    readonly templateKey: string;
    readonly recipient: notificationRepo.Recipient;
  }[];
}

/** Nothing to send. Returned rather than null so a caller needs no branch. */
export const NOTHING: QueuedBatch = { ids: [], messages: [] };

/**
 * Writes the outbox rows for a plan, inside the caller's transaction.
 *
 * Every decision that could suppress a message happens here and is recorded on
 * the row: no phone number, a hospital past its SMS cap (`FR-NOT-06`), quiet
 * hours (`FR-NOT-07`). "We chose not to tell them" is a fact a hospital needs
 * when a patient says nobody called, so it is a `skipped` row with a reason
 * rather than an absence.
 */
export async function queueFor(
  trx: Tx,
  sessionId: string,
  plan: readonly PlannedNotification[],
  at: Date = new Date(),
): Promise<QueuedBatch> {
  if (plan.length === 0) return NOTHING;

  const [chamber, recipients, templates] = await Promise.all([
    notificationRepo.chamberFor(sessionId),
    notificationRepo.recipientsForSession(trx, sessionId),
    templateIndex(),
  ]);

  if (chamber === null) return NOTHING;

  const byBooking = new Map(recipients.map((recipient) => [recipient.bookingId, recipient]));

  // Drop anything this booking has already been told, for the messages that
  // are sent once. One query for the batch, and only when such a message is
  // actually in it.
  const onceOnly = plan.filter((planned) => SEND_ONCE.has(planned.templateKey));
  const alreadyTold = new Map<string, Set<string>>();
  for (const key of new Set(onceOnly.map((planned) => planned.templateKey))) {
    alreadyTold.set(key, await notificationRepo.alreadyNotified(trx, sessionId, key));
  }

  // One count per batch rather than per message: a delay in a chamber of a
  // hundred and fifty must not run a hundred and fifty aggregates.
  const smsUsed =
    chamber.smsBudgetMonthly === null
      ? 0
      : await notificationRepo.smsSentThisMonth(chamber.hospitalId);
  let smsBudgetLeft =
    chamber.smsBudgetMonthly === null
      ? Number.POSITIVE_INFINITY
      : chamber.smsBudgetMonthly - smsUsed;

  const rows: notificationRepo.QueuedNotification[] = [];
  const pending: { channel: 'sms' | 'push'; to: string | null; body: string; key: string }[] = [];

  for (const planned of plan) {
    const recipient = byBooking.get(planned.bookingId);
    if (recipient === undefined) continue;
    if (alreadyTold.get(planned.templateKey)?.has(planned.bookingId) === true) continue;

    const locale: Locale = recipient.locale === 'en' ? 'en' : 'bn';
    const params = paramsFor(planned, recipient, chamber, locale);

    // `FR-NOT-02`: app users get push + SMS, non-app users get SMS only. The
    // answer comes from whether any device is registered, which is a fact
    // rather than an assumption.
    const tokens = await notificationRepo.deviceTokensFor(recipient);
    const channels: ('sms' | 'push')[] = tokens.length > 0 ? ['push', 'sms'] : ['sms'];

    for (const channel of channels) {
      const body = templates.get(`${planned.templateKey}|${channel}|${locale}`);
      if (body === undefined) continue;

      const rendered = render(body, params);
      const skipped = suppression({
        channel,
        phone: recipient.phone,
        templateKey: planned.templateKey,
        at,
        budgetLeft: smsBudgetLeft,
      });

      if (skipped === null && channel === 'sms') smsBudgetLeft -= 1;

      rows.push({
        recipient,
        channel,
        templateKey: planned.templateKey,
        params,
        body: rendered,
        skipped,
      });
      pending.push({
        channel,
        to: channel === 'sms' ? recipient.phone : null,
        body: rendered,
        key: planned.templateKey,
      });
    }
  }

  const ids = await notificationRepo.queueAll(trx, rows);

  return {
    ids,
    messages: ids.flatMap((id, index) => {
      const row = rows[index];
      const detail = pending[index];
      if (row === undefined || detail === undefined || row.skipped !== null) return [];

      return [
        {
          id,
          channel: detail.channel,
          to: detail.to,
          body: detail.body,
          templateKey: detail.key,
          recipient: row.recipient,
        },
      ];
    }),
  };
}

/**
 * Writes the answer to a bed request into the outbox (`FR-PAT-52`, BACKEND.md
 * §8: "Bed request answered → push + SMS").
 *
 * Inside the caller's transaction, like every queue message, so a hold that
 * rolls back leaves no text behind claiming it happened. The link is the
 * family's status page for this request; it is minted by the caller because
 * only the caller has the token.
 */
export async function queueBedRequestAnswer(
  trx: Tx,
  input: {
    readonly requestId: string;
    readonly outcome: 'held' | 'declined';
    readonly holdExpiresAt: string | null;
    readonly link: string;
  },
  at: Date = new Date(),
): Promise<QueuedBatch> {
  const target = await notificationRepo.bedRequestRecipient(trx, input.requestId);
  if (target === null) return NOTHING;

  const templateKey: TemplateKey =
    input.outcome === 'held' ? 'bed.request_held' : 'bed.request_declined';
  const templates = await templateIndex();

  const { recipient } = target;
  const locale: Locale = recipient.locale === 'en' ? 'en' : 'bn';
  const numerals: NumeralStyle = locale === 'bn' ? 'bengali' : 'latin';
  const params: Record<string, string> = {
    // Correlation, not copy: which request this message answered.
    bedRequestId: input.requestId,
    hospital: locale === 'bn' ? target.hospitalNameBn : target.hospitalNameEn,
    kind: isBedKindName(target.bedKind) ? bedKindName(target.bedKind, locale) : target.bedKind,
    time: input.holdExpiresAt === null ? '' : formatClock(input.holdExpiresAt, numerals),
    link: input.link,
  };

  const budgetLeft =
    target.smsBudgetMonthly === null
      ? Number.POSITIVE_INFINITY
      : target.smsBudgetMonthly - (await notificationRepo.smsSentThisMonth(target.hospitalId));

  const tokens = await notificationRepo.deviceTokensFor(recipient);
  const channels: ('sms' | 'push')[] = tokens.length > 0 ? ['push', 'sms'] : ['sms'];

  const rows: notificationRepo.QueuedNotification[] = [];
  for (const channel of channels) {
    const body = templates.get(`${templateKey}|${channel}|${locale}`);
    if (body === undefined) continue;
    rows.push({
      recipient,
      channel,
      templateKey,
      params,
      body: render(body, params),
      skipped: suppression({ channel, phone: recipient.phone, templateKey, at, budgetLeft }),
    });
  }

  const ids = await notificationRepo.queueAll(trx, rows);

  return {
    ids,
    messages: ids.flatMap((id, index) => {
      const row = rows[index];
      if (row?.skipped !== null) return [];
      return [
        {
          id,
          channel: row.channel,
          to: row.channel === 'sms' ? recipient.phone : null,
          body: row.body,
          templateKey,
          recipient,
        },
      ];
    }),
  };
}

function isBedKindName(kind: string): kind is BedKindName {
  return Object.hasOwn(BED_KIND_NAMES, kind);
}

/**
 * Sends what was queued. **Call this after the transaction has committed.**
 *
 * Never throws. A gateway that is down must not turn a successful queue action
 * into a failed HTTP request — the console tapped *next*, the patient moved,
 * and that happened whether or not an SMS did. The failure is recorded on the
 * row instead, which is where a retry will look for it.
 */
export async function dispatch(batch: QueuedBatch): Promise<void> {
  for (const message of batch.messages) {
    try {
      if (message.channel === 'sms') {
        if (message.to === null) {
          await notificationRepo.markNotSent(message.id, 'skipped', 'no_phone_number');
          continue;
        }

        const result = await sms().send({
          to: message.to,
          body: message.body,
          notificationId: message.id,
          templateKey: message.templateKey,
        });

        if (result.ok) {
          await notificationRepo.markSent(message.id, {
            providerRef: result.providerRef,
            costPoisha: result.costPoisha,
          });
        } else {
          await notificationRepo.markNotSent(message.id, 'failed', result.error);
        }
        continue;
      }

      const tokens = await notificationRepo.deviceTokensFor(message.recipient);
      const result = await push().send({
        tokens,
        body: message.body,
        notificationId: message.id,
        templateKey: message.templateKey,
        url: null,
      });

      if (result.ok) {
        await notificationRepo.markSent(message.id, {
          providerRef: result.providerRef,
          costPoisha: null,
        });
      } else {
        // A recipient with no registered device is not a failure to retry; it
        // is a person who has not installed the app.
        await notificationRepo.markNotSent(
          message.id,
          result.error === 'no_device_token' ? 'skipped' : 'failed',
          result.error,
        );
      }
    } catch (error: unknown) {
      logger.error(
        { err: error, notificationId: message.id, templateKey: message.templateKey },
        'notification dispatch failed',
      );
      await notificationRepo
        .markNotSent(message.id, 'failed', 'dispatch_threw')
        .catch(() => undefined);
    }
  }
}

/** Why this message is not going out, or null. */
function suppression(input: {
  readonly channel: 'sms' | 'push';
  readonly phone: string | null;
  readonly templateKey: string;
  readonly at: Date;
  readonly budgetLeft: number;
}): string | null {
  if (withinQuietHours(input.templateKey, input.at)) return 'quiet_hours';

  if (input.channel === 'sms') {
    if (input.phone === null) return 'no_phone_number';
    // `FR-NOT-06`: a hospital past its monthly cap stops sending rather than
    // running up a bill nobody agreed to.
    if (input.budgetLeft <= 0) return 'sms_budget_exhausted';
  }

  return null;
}

/**
 * The parameters a template's placeholders need.
 *
 * Built for every key rather than per key: the union is small, the cost is a
 * few string formats, and a caller that forgets one produces a message with
 * `{serial}` in it — which `templates.test.ts` exists to prevent and this
 * makes structurally hard.
 */
function paramsFor(
  planned: PlannedNotification,
  recipient: notificationRepo.BookingRecipient,
  chamber: notificationRepo.ChamberRow,
  locale: Locale,
): Record<string, string> {
  // `TYP-04`: a patient surface uses Bengali numerals. An SMS is a patient
  // surface, and the locale decides.
  const numerals: NumeralStyle = locale === 'bn' ? 'bengali' : 'latin';

  // The plan carries raw values — a count of minutes, an ISO instant — because
  // deciding *what* to say is a different job from deciding how a Bangladeshi
  // patient reads it. Formatting happens here, once, where the recipient's
  // locale is known.
  const minutes = planned.params['minutes'];
  const eta = planned.params['eta'];

  return {
    // Correlation, not copy: `notifications` has no `booking_id` column
    // (DATABASE.md §2.7), and "which booking was this about" is the question
    // any delivery report starts from.
    bookingId: recipient.bookingId,

    serial: formatSerial(recipient.serial, numerals),
    doctor: locale === 'bn' ? chamber.doctorNameBn : chamber.doctorNameEn,
    hospital: locale === 'bn' ? chamber.hospitalNameBn : chamber.hospitalNameEn,
    room: chamber.room ?? (locale === 'bn' ? 'ডাক্তারের কক্ষ' : 'the chamber'),
    time: formatClock(chamber.plannedStart, numerals),
    date: chamber.sessionDate,
    minutes: minutes === undefined || minutes === '' ? '' : formatNumber(Number(minutes), numerals),
    // An estimate the chamber cannot support is not shown as a time
    // (`FR-QUE-13`) — the same refusal `<LiveSerialCard>` makes, in the same
    // words, because a patient reading both must not see them disagree.
    eta: eta === undefined || eta === '' ? tp('etaUnknown', locale) : formatClock(eta, numerals),
    link: planned.params['link'] ?? '',
  };
}

/**
 * Active templates, indexed by key, channel and locale.
 *
 * Cached for the life of the process. Templates change at the speed of a
 * deploy or a seed, and a round trip per message would put the database in
 * front of every notification a busy chamber produces.
 */
let cache: Map<string, string> | null = null;

async function templateIndex(): Promise<Map<string, string>> {
  if (cache !== null) return cache;

  const rows = await notificationRepo.activeTemplates();
  cache = new Map(rows.map((row) => [`${row.key}|${row.channel}|${row.locale}`, row.body]));
  return cache;
}

/** Drops the cache. Called by tests that change template rows. */
export function forgetTemplates(): void {
  cache = null;
}

/** What one SMS body will cost to send, for a budget report (`FR-NOT-06`). */
export function segmentsOf(body: string): number {
  return segmentsFor(body);
}
