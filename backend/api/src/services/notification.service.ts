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
 *
 * ## What is sent and what is kept are two texts
 *
 * Some messages carry a link that is a credential: a booking's tracking link
 * opens that booking's queue, its signed record and its reports
 * (`FR-GST-05`). The link goes into the message that is sent and into nothing
 * that is kept — the row holds the same words with `{link}` still standing
 * where the link went (`forTheRecord`). Every row is written through one
 * function, `writeOutbox`, so no kind of message can forget this; migration
 * 0035 has PostgreSQL refuse a stored link besides.
 *
 * And the words themselves are kept for ninety days (DATABASE.md §8), after
 * which a row says which message it was and what became of it and no more
 * (`clearExpiredBodies`).
 */

import {
  earlierThanTold,
  endOfQuietHours,
  inQuietHours,
  twoAwayBookings,
  waitingQueue,
  type BookingId,
  type Eta,
  type QueueEvent,
  type QueueState,
  type Timestamp,
} from '@platform/domain';
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

import { segmentsFor, sms } from '../adapters/sms.js';
import { runInDbScope } from '../config/dbScope.js';
import * as notificationRepo from '../repositories/notification.repo.js';

import { LINK_PARAMS, originOf, type LinkKind } from './messageLink.service.js';
import * as sender from './notificationSender.service.js';

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
 * `SLOT_OFFERED` is in that table and is still absent here, now for a
 * different reason. `offerFreedSlot` exists as of step 19 and the message is
 * real — but a standby patient has no booking, and every recipient this map
 * produces is resolved through one. It is sent by `queueSlotOffer` instead,
 * from the phone number on the standby row.
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

/**
 * Whether a message written at `at` waits for the end of quiet hours
 * (`FR-NOT-07`). The hours are the domain's (`messaging/sending`), in Dhaka;
 * what is exempt is decided above.
 */
export function withinQuietHours(key: string, at: Date): boolean {
  const namespace = key.split('.')[0] ?? '';
  if (ALWAYS_OVERRIDES_QUIET_HOURS.has(namespace)) return false;
  return inQuietHours(at.toISOString() as Timestamp);
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
    //
    // `PATIENT_ARRIVED` among them: a check-in's quote is said across the
    // counter and shown in the app (`FR-PAT-38`), and an SMS to somebody
    // standing at the desk would cost money to tell them what they were just
    // told.
    case 'SESSION_OPENED':
    case 'SESSION_PAUSED':
    case 'SESSION_RESUMED':
    case 'PATIENT_DONE':
    case 'PATIENT_LATE':
    case 'PATIENT_REINSERTED':
    case 'PATIENT_ARRIVED':
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

/** The messages whose words give a patient a time to expect their turn. */
const TELLS_A_TIME = new Set<TemplateKey>([
  'queue.doctor_arrived',
  'queue.delayed',
  'queue.earlier',
]);

/**
 * What a plan tells each booking about when (`FR-QUE-15`): the time in the
 * last message of it that names one. The caller records these as told.
 */
export function timesTold(
  plan: readonly PlannedNotification[],
): readonly { readonly bookingId: string; readonly etaAt: string }[] {
  const told = new Map<string, string>();
  for (const planned of plan) {
    const eta = planned.params['eta'];
    if (TELLS_A_TIME.has(planned.templateKey) && eta !== undefined && eta !== '') {
      told.set(planned.bookingId, eta);
    }
  }
  return [...told].map(([bookingId, etaAt]) => ({ bookingId, etaAt }));
}

/**
 * "Your turn may come sooner" (`FR-QUE-15`, plan F2c).
 *
 * For each waiting patient whose estimate is now earlier than the time they
 * were last told by more than its band (`earlierThanTold`, the domain's own
 * answer). Raised from the queue write that moved the estimate and written
 * in its transaction, so no screen is shown the earlier time before the
 * message exists: the broadcast goes out after the commit.
 *
 * Nobody is told twice by one write: a booking this plan already gives a
 * time to (the doctor arrived, a delay was declared) has just been told.
 * And nobody is told again for the same move, because what they were told
 * becomes the new time.
 */
export function planEarlier(
  state: QueueState,
  etas: readonly Eta[],
  told: ReadonlyMap<string, Date>,
  plannedStart: Timestamp,
  alreadyInPlan: readonly PlannedNotification[],
): readonly PlannedNotification[] {
  const justTold = new Set(timesTold(alreadyInPlan).map((entry) => entry.bookingId));
  const toldAt = new Map<BookingId, Timestamp>(
    [...told].map(([bookingId, at]) => [bookingId as BookingId, at.toISOString() as Timestamp]),
  );

  return earlierThanTold(state, etas, toldAt, plannedStart)
    .filter((eta) => !justTold.has(eta.bookingId))
    .map((eta) => ({
      bookingId: eta.bookingId,
      templateKey: 'queue.earlier' as const,
      params: { eta: eta.etaAt },
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
      // What the link is for, so that one can be issued again for a
      // confirmation sent from the stored row (`messageLink.service`).
      params: link === null ? {} : { link, [LINK_PARAMS.kind]: 'booking' satisfies LinkKind },
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
 * Two batches written in one transaction, dispatched as one.
 *
 * `offerFreedSlot` produces both kinds at once: whatever the event itself
 * implies, plus the offer text to a standby patient who has no booking. They
 * have to leave the building together — one `dispatch` after one commit — or
 * a failure between the two sends half the messages an action caused.
 */
export function merge(...batches: readonly QueuedBatch[]): QueuedBatch {
  return {
    ids: batches.flatMap((batch) => batch.ids),
    messages: batches.flatMap((batch) => batch.messages),
  };
}

/**
 * Placeholders whose value is a credential.
 *
 * A link here is not an address anybody may know: whoever holds it reads that
 * booking, that standby place, that bed request or that emergency alert
 * without signing in. Only its hash is meant to exist in the database
 * (`guest_links.token_hash`).
 */
const CREDENTIAL_PARAMS: ReadonlySet<string> = new Set(['link']);

/**
 * What is kept of a message: its parameters without any credential, and its
 * words with each credential left as the template's own placeholder.
 *
 * So the row still answers "what did we tell them" — the serial, the doctor,
 * the time, the sentence — and cannot be used to open anything.
 *
 * A credential that was empty is rendered as empty, exactly as it was sent.
 * An account holder's confirmation has no tracking link, and its record must
 * not read as though one had been taken out of it.
 */
export function forTheRecord(
  template: string,
  params: Readonly<Record<string, string>>,
): { readonly params: Record<string, string>; readonly body: string } {
  const kept: Record<string, string> = {};
  const shown: Record<string, string> = {};

  for (const [name, value] of Object.entries(params)) {
    if (!CREDENTIAL_PARAMS.has(name)) {
      kept[name] = value;
      shown[name] = value;
    } else if (value === '') {
      shown[name] = value;
    }
  }

  // `render` leaves a placeholder it has no value for as it stands.
  return { params: kept, body: render(template, shown) };
}

/**
 * Notes, beside a link, the origin it is in: a hospital's own portal, or the
 * network's app (`FR-BRD-04`). The link itself is not kept; a successor
 * issued for the stored row goes to the same place.
 */
function withLinkOrigin(
  params: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const link = params['link'];
  if (link === undefined || link === '') return params;
  const origin = originOf(link);
  return origin === null ? params : { ...params, [LINK_PARAMS.base]: origin };
}

/** One message decided on — who, how, in which words — and not yet written. */
interface Draft {
  readonly recipient: notificationRepo.Recipient;
  readonly channel: 'sms' | 'push';
  readonly templateKey: string;
  /** The template's own text, placeholders unfilled. */
  readonly template: string;
  readonly params: Readonly<Record<string, string>>;
  /** Why it is not going out, or null. */
  readonly skipped: string | null;
  /**
   * Held for quiet hours until this moment, or null (`FR-NOT-07`). A held
   * message is queued, not skipped: the sender sends it when it is due.
   */
  readonly heldUntil?: Date | null;
}

/**
 * Writes the outbox rows for a set of drafts, inside the caller's transaction,
 * and returns what is to be sent once it commits.
 *
 * **The only caller of `notificationRepo.queueAll`.** Each draft is composed
 * twice here: once in full, for the adapter, held in memory until `dispatch`;
 * once for the row, through `forTheRecord`. A new kind of message that goes
 * through this function cannot store a link, and there is no other way in.
 */
async function writeOutbox(trx: Tx, drafts: readonly Draft[]): Promise<QueuedBatch> {
  const ids = await notificationRepo.queueAll(
    trx,
    drafts.map((draft) => ({
      recipient: draft.recipient,
      channel: draft.channel,
      templateKey: draft.templateKey,
      ...forTheRecord(draft.template, withLinkOrigin(draft.params)),
      skipped: draft.skipped,
      heldUntil: draft.skipped === null ? (draft.heldUntil ?? null) : null,
    })),
  );

  return {
    ids,
    messages: ids.flatMap((id, index) => {
      const draft = drafts[index];
      if (draft?.skipped !== null) return [];
      // One held until morning is sent from its row when it is due: its words
      // are not kept in memory overnight.
      if (draft.heldUntil !== undefined && draft.heldUntil !== null) return [];

      return [
        {
          id,
          channel: draft.channel,
          to: draft.channel === 'sms' ? draft.recipient.phone : null,
          body: render(draft.template, draft.params),
          templateKey: draft.templateKey,
          recipient: draft.recipient,
        },
      ];
    }),
  };
}

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

  // Every read here goes through `trx`. This runs inside the queue's locked
  // transaction, on its one connection; asking the pool for another from in
  // here is how a busy chamber stalled itself (see `chamberFor`). In order,
  // not together: one connection carries one query at a time.
  const chamber = await notificationRepo.chamberFor(sessionId, trx);
  const recipients = await notificationRepo.recipientsForSession(trx, sessionId);
  const templates = await templateIndex(trx);

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
      : await notificationRepo.smsSentThisMonth(chamber.hospitalId, trx);
  let smsBudgetLeft =
    chamber.smsBudgetMonthly === null
      ? Number.POSITIVE_INFINITY
      : chamber.smsBudgetMonthly - smsUsed;

  const drafts: Draft[] = [];

  for (const planned of plan) {
    const recipient = byBooking.get(planned.bookingId);
    if (recipient === undefined) continue;
    if (alreadyTold.get(planned.templateKey)?.has(planned.bookingId) === true) continue;

    const locale: Locale = recipient.locale === 'en' ? 'en' : 'bn';
    const params = paramsFor(planned, recipient, chamber, locale);

    // `FR-NOT-02`: app users get push + SMS, non-app users get SMS only. The
    // answer comes from whether any device is registered, which is a fact
    // rather than an assumption.
    const tokens = await notificationRepo.deviceTokensFor(recipient, trx);
    const channels: ('sms' | 'push')[] = tokens.length > 0 ? ['push', 'sms'] : ['sms'];

    for (const channel of channels) {
      const template = templates.get(`${planned.templateKey}|${channel}|${locale}`);
      if (template === undefined) continue;

      const decided = suppression({
        channel,
        phone: recipient.phone,
        templateKey: planned.templateKey,
        at,
        budgetLeft: smsBudgetLeft,
      });

      if (decided.skipped === null && channel === 'sms') smsBudgetLeft -= 1;

      drafts.push({
        recipient,
        channel,
        templateKey: planned.templateKey,
        template,
        params,
        ...decided,
      });
    }
  }

  return await writeOutbox(trx, drafts);
}

/**
 * Tells a standby patient a chair has opened (`FR-QUE-30`, `FR-GST-06`).
 *
 * BACKEND.md §8 maps `SLOT_OFFERED` to a message, and this is it. It is here
 * rather than in `planFor` for one reason that decides the shape of the whole
 * thing: **a standby patient has no booking**. That is what standby means.
 * `queueFor` resolves every recipient through `recipientsForSession`, keyed on
 * a booking id, so a slot offer routed through it would find nobody and be
 * dropped in silence — the worst possible failure for the one message in this
 * product that expires.
 *
 * So the recipient comes from `standby_list.contact_phone`, which is the
 * number the person gave when they asked to be told. Same outbox, same
 * suppression rules, same transaction as the event.
 *
 * ## Quiet hours do not apply
 *
 * `FR-NOT-07` exempts queue events, and this is one. It also deserves the
 * exemption on its own terms: the offer is alive for ten minutes, and a text
 * held until seven the next morning is a chair the hospital left empty and a
 * patient who was never really asked. The same reasoning as `bed`.
 */
export async function queueSlotOffer(
  trx: Tx,
  input: {
    readonly sessionId: string;
    readonly patientId: string;
    readonly phone: string;
    readonly expiresAt: string;
    /**
     * The standby status link, for somebody who joined from the app
     * (`FR-PAT-27`): they answer on their phone. Null for somebody reception
     * put on the list, who is told to ring the counter.
     */
    readonly link?: string | null;
    /** The place the link opens, so that one can be issued again (`messageLink.service`). */
    readonly standby?: { readonly id: string; readonly subject: string };
  },
  at: Date = new Date(),
): Promise<QueuedBatch> {
  const link = input.link ?? null;
  return await queueStandbyMessage(
    trx,
    {
      sessionId: input.sessionId,
      patientId: input.patientId,
      phone: input.phone,
      templateKey: link === null ? 'queue.slot_offered' : 'queue.slot_offered_link',
      params: (numerals) => ({
        time: formatClock(input.expiresAt, numerals),
        ...(link === null ? {} : { link, ...standbyLinkParams(input.standby) }),
      }),
    },
    at,
  );
}

/**
 * Tells a prepaid standby patient the chair is theirs (`FR-PAT-26`).
 *
 * Nobody asked them: they paid to be seated on sight, so the message says it
 * is done, names the serial, and links to where they can watch it.
 */
export async function queueSlotSeated(
  trx: Tx,
  input: {
    readonly sessionId: string;
    readonly patientId: string;
    readonly phone: string;
    readonly serial: number;
    readonly link: string;
    /** The place the link opens, so that one can be issued again (`messageLink.service`). */
    readonly standby: { readonly id: string; readonly subject: string };
  },
  at: Date = new Date(),
): Promise<QueuedBatch> {
  return await queueStandbyMessage(
    trx,
    {
      sessionId: input.sessionId,
      patientId: input.patientId,
      phone: input.phone,
      templateKey: 'queue.slot_seated',
      params: (numerals) => ({
        serial: formatSerial(input.serial, numerals),
        link: input.link,
        ...standbyLinkParams(input.standby),
      }),
    },
    at,
  );
}

/** What a standby link is for, as the row keeps it. Empty where the caller did not say. */
function standbyLinkParams(
  standby: { readonly id: string; readonly subject: string } | undefined,
): Record<string, string> {
  if (standby === undefined) return {};
  return {
    [LINK_PARAMS.kind]: 'standby' satisfies LinkKind,
    [LINK_PARAMS.standbyId]: standby.id,
    [LINK_PARAMS.subject]: standby.subject,
  };
}

/**
 * The outbox rows for a message to somebody on a standby list.
 *
 * Its own path rather than part of `planFor`: a standby patient may have no
 * booking yet, and every recipient that map produces is resolved through one.
 */
async function queueStandbyMessage(
  trx: Tx,
  input: {
    readonly sessionId: string;
    readonly patientId: string;
    readonly phone: string;
    readonly templateKey: TemplateKey;
    readonly params: (numerals: NumeralStyle) => Record<string, string>;
  },
  at: Date,
): Promise<QueuedBatch> {
  // Through `trx`, one after the other: see `queueFor`.
  const chamber = await notificationRepo.chamberFor(input.sessionId, trx);
  const templates = await templateIndex(trx);
  if (chamber === null) return NOTHING;

  // Built here rather than read back: a standby row carries the phone and the
  // patient, which is everything the outbox needs, and a lookup would only be
  // a second chance to get it wrong.
  const recipient: notificationRepo.Recipient = {
    patientId: input.patientId,
    guestId: null,
    userId: null,
    phone: input.phone,
    locale: 'bn',
  };

  const locale: Locale = 'bn';
  const numerals: NumeralStyle = 'bengali';
  const params: Record<string, string> = {
    doctor: chamber.doctorNameBn,
    hospital: chamber.hospitalNameBn,
    ...input.params(numerals),
  };

  const budgetLeft =
    chamber.smsBudgetMonthly === null
      ? Number.POSITIVE_INFINITY
      : chamber.smsBudgetMonthly -
        (await notificationRepo.smsSentThisMonth(chamber.hospitalId, trx));

  const templateKey = input.templateKey;
  const tokens = await notificationRepo.deviceTokensFor(recipient, trx);
  const channels: ('sms' | 'push')[] = tokens.length > 0 ? ['push', 'sms'] : ['sms'];

  const drafts: Draft[] = [];
  for (const channel of channels) {
    const template = templates.get(`${templateKey}|${channel}|${locale}`);
    if (template === undefined) continue;
    drafts.push({
      recipient,
      channel,
      templateKey,
      template,
      params,
      ...suppression({ channel, phone: recipient.phone, templateKey, at, budgetLeft }),
    });
  }

  return await writeOutbox(trx, drafts);
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
    /** Whose request it is: the status token is theirs (`bedRequestLink.ts`). */
    readonly subject: string;
  },
  at: Date = new Date(),
): Promise<QueuedBatch> {
  const target = await notificationRepo.bedRequestRecipient(trx, input.requestId);
  if (target === null) return NOTHING;

  const templateKey: TemplateKey =
    input.outcome === 'held' ? 'bed.request_held' : 'bed.request_declined';
  const templates = await templateIndex(trx);

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
    [LINK_PARAMS.kind]: 'bed_request' satisfies LinkKind,
    [LINK_PARAMS.subject]: input.subject,
  };

  const budgetLeft =
    target.smsBudgetMonthly === null
      ? Number.POSITIVE_INFINITY
      : target.smsBudgetMonthly - (await notificationRepo.smsSentThisMonth(target.hospitalId, trx));

  const tokens = await notificationRepo.deviceTokensFor(recipient, trx);
  const channels: ('sms' | 'push')[] = tokens.length > 0 ? ['push', 'sms'] : ['sms'];

  const drafts: Draft[] = [];
  for (const channel of channels) {
    const template = templates.get(`${templateKey}|${channel}|${locale}`);
    if (template === undefined) continue;
    drafts.push({
      recipient,
      channel,
      templateKey,
      template,
      params,
      ...suppression({ channel, phone: recipient.phone, templateKey, at, budgetLeft }),
    });
  }

  return await writeOutbox(trx, drafts);
}

/**
 * Writes the ER's answer to an inbound alert into the outbox (`APP_FLOW.md`
 * D2: "Emergency acknowledged → `S-A-10c`").
 *
 * Only when somebody left a number — nothing about an emergency requires one
 * (`FR-GST-03`), and a case with no number writes a `skipped` row saying so,
 * which is the honest record of "we could not tell them".
 *
 * **Not subject to the monthly SMS cap.** `FR-NOT-06`'s cap is a cost control,
 * and "this hospital cannot take you" is not a message to save thirty-five
 * poisha on; `FR-NOT-07` already puts emergencies above quiet hours for the
 * same reason. Recorded in `docs/STATUS.md` as awaiting the owner's word.
 */
export async function queueEmergencyAnswer(
  trx: Tx,
  input: {
    readonly caseId: string;
    readonly outcome: 'acknowledged' | 'declined';
    readonly link: string;
  },
  at: Date = new Date(),
): Promise<QueuedBatch> {
  const target = await notificationRepo.emergencyRecipient(trx, input.caseId);
  if (target === null) return NOTHING;

  const templateKey: TemplateKey =
    input.outcome === 'acknowledged' ? 'emergency.acknowledged' : 'emergency.declined';
  const templates = await templateIndex(trx);

  const { recipient } = target;
  const locale: Locale = recipient.locale === 'en' ? 'en' : 'bn';
  const params: Record<string, string> = {
    // Correlation, not copy: which case this message answered.
    emergencyCaseId: input.caseId,
    hospital: locale === 'bn' ? target.hospitalNameBn : target.hospitalNameEn,
    link: input.link,
    [LINK_PARAMS.kind]: 'emergency_case' satisfies LinkKind,
  };

  const tokens = await notificationRepo.deviceTokensFor(recipient, trx);
  const channels: ('sms' | 'push')[] = tokens.length > 0 ? ['push', 'sms'] : ['sms'];

  const drafts: Draft[] = [];
  for (const channel of channels) {
    const template = templates.get(`${templateKey}|${channel}|${locale}`);
    if (template === undefined) continue;
    drafts.push({
      recipient,
      channel,
      templateKey,
      template,
      params,
      ...suppression({
        channel,
        phone: recipient.phone,
        templateKey,
        at,
        budgetLeft: Number.POSITIVE_INFINITY,
      }),
    });
  }

  return await writeOutbox(trx, drafts);
}

/**
 * Writes the report-ready notice into the outbox (`FR-LAB-03`, `FR-NOT-02`,
 * `FR-NOT-03`, `FR-GST-06`; BACKEND.md §8; plan F2).
 *
 * **By SMS, and by push to a phone that has the app's token**, like every
 * other material event. It was push only, and since no screen asks for
 * notification permission every one was skipped with `no_device_token`: the
 * report reached the wallet and nobody was told it had.
 *
 * It is not urgent, so it waits out quiet hours (`FR-NOT-07`): a report
 * uploaded at night is queued, due at seven in the morning, and the sender
 * sends it then (plan H1). Until that branch it was recorded as skipped and
 * never sent.
 * It counts against the hospital's monthly SMS cap like any other
 * (`FR-NOT-06`).
 *
 * The notice names the test and the hospital and nothing else. A result on a
 * lock screen is read by whoever is holding the phone (`DB-P7`).
 */
export async function queueReportReady(
  trx: Tx,
  input: {
    readonly testOrderId: string;
    /** Where the report is read: the patient app's Records page. No token in it. */
    readonly link: string;
  },
  at: Date = new Date(),
): Promise<QueuedBatch> {
  const target = await notificationRepo.reportRecipient(trx, input.testOrderId);
  if (target === null) return NOTHING;

  const templateKey: TemplateKey = 'lab.report_ready';
  const templates = await templateIndex(trx);

  const { recipient } = target;
  const locale: Locale = recipient.locale === 'en' ? 'en' : 'bn';
  const params: Record<string, string> = {
    // Correlation, not copy: which order this message announced.
    testOrderId: input.testOrderId,
    test: target.testName,
    hospital: locale === 'bn' ? target.hospitalNameBn : target.hospitalNameEn,
    link: input.link,
    [LINK_PARAMS.kind]: 'records' satisfies LinkKind,
  };

  const budgetLeft =
    target.smsBudgetMonthly === null
      ? Number.POSITIVE_INFINITY
      : target.smsBudgetMonthly - (await notificationRepo.smsSentThisMonth(target.hospitalId, trx));

  // `FR-NOT-02`: push and SMS to a phone with the app, SMS alone to one without.
  const tokens = await notificationRepo.deviceTokensFor(recipient, trx);
  const channels: ('sms' | 'push')[] = tokens.length > 0 ? ['push', 'sms'] : ['sms'];

  const drafts: Draft[] = [];
  for (const channel of channels) {
    const template = templates.get(`${templateKey}|${channel}|${locale}`);
    if (template === undefined) continue;
    drafts.push({
      recipient,
      channel,
      templateKey,
      template,
      params,
      ...suppression({ channel, phone: recipient.phone, templateKey, at, budgetLeft }),
    });
  }

  return await writeOutbox(trx, drafts);
}

function isBedKindName(kind: string): kind is BedKindName {
  return Object.hasOwn(BED_KIND_NAMES, kind);
}

/**
 * Hands what was queued to the sender. **Call this after the transaction has
 * committed.**
 *
 * Returns at once: nothing a request does waits for a gateway (plan H1). The
 * console tapped *next*, the patient moved, and that happened whether or not
 * an SMS did, so the request answers and the sender sends
 * (`notificationSender.service`), tries again when a gateway fails, and
 * records on the row what became of each message.
 *
 * Never throws, and is `async` only because every caller awaits it.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- awaited by every caller; see above
export async function dispatch(batch: QueuedBatch): Promise<void> {
  sender.hand(batch.messages);
}

/**
 * Resolves when what has been handed over has been tried.
 *
 * For a test that reads what a call caused, and for a shutdown. A message due
 * later (a retry, a morning) is not waited for.
 */
export async function settled(): Promise<void> {
  await sender.idle();
}

/** Whether a delivery receipt is the aggregator's. An adapter that cannot check one believes none. */
export function verifyReceiptSignature(rawBody: string, signature: string | undefined): boolean {
  return sms().verifyReceipt?.(rawBody, signature) ?? false;
}

/** The longest reason kept from a receipt. An aggregator's free text is not ours to trust for length. */
const RECEIPT_REASON_MAX = 80;

/**
 * A delivery receipt (`POST /webhooks/sms-dlr`; `FR-NOT-06`, plan H2).
 *
 * The signature is checked before this is called; by here the receipt is
 * known to be the aggregator's. What remains is to read it in the adapter's
 * own vocabulary and record it, once: an aggregator sends the same receipt
 * again when it is not answered, and a second one changes nothing.
 *
 * A message reported undelivered is `failed`, with the aggregator's reason
 * after `undelivered:`. It is not tried again: the aggregator took it, was
 * paid for it, and has said it will not arrive; a second SMS is a second
 * charge for the same answer.
 *
 * @returns `recognised` false for a body the adapter cannot read; `applied`
 *   true when a row changed.
 */
export async function applyDeliveryReceipt(
  body: unknown,
): Promise<{ readonly recognised: boolean; readonly applied: boolean }> {
  const receipt = sms().readReceipt?.(body) ?? null;
  if (receipt === null) return { recognised: false, applied: false };
  if (receipt.outcome === 'pending') return { recognised: true, applied: false };

  const reason = (receipt.reason ?? 'no_reason_given')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, RECEIPT_REASON_MAX);
  const { providerRef, outcome } = receipt;
  // The aggregator's word, once its signature has checked out: the server's
  // own work, since the request is nobody's and nobody reads a message
  // (migration 0056).
  const applied = await runInDbScope(
    { kind: 'system' },
    async () =>
      await notificationRepo.applyReceipt(
        providerRef,
        outcome,
        `undelivered:${reason === '' ? 'no_reason_given' : reason}`,
      ),
  );
  return { recognised: true, applied };
}

/**
 * A hospital's SMS this month, for its own administrator (`FR-NOT-06`: "budget
 * caps and delivery reporting").
 *
 * `reportsDelivery` says whether "delivered" means anything here: with a
 * provider that sends no receipts it is unknown, not nought, and the screen
 * says that and shows no count (`PRD.md` §3.2).
 */
export async function monthOfMessages(hospitalId: string): Promise<
  notificationRepo.MonthOfMessages & {
    readonly reportsDelivery: boolean;
    readonly asOf: string;
  }
> {
  return {
    ...(await notificationRepo.monthOfMessages(hospitalId)),
    reportsDelivery: sms().reportsDelivery === true,
    asOf: new Date().toISOString(),
  };
}

/** How long a message's words are kept (DATABASE.md §8). */
export const BODY_RETENTION_DAYS = 90;

/**
 * The parameters that say what a message was about rather than what it said.
 *
 * Ids, not content: the booking, bed request, emergency case or test order a
 * message answered. A delivery report still starts from them after the words
 * are gone.
 */
const CORRELATION_PARAMS = ['bookingId', 'bedRequestId', 'emergencyCaseId', 'testOrderId'] as const;

/** Rows cleared per statement, so no one purge holds the table for long. */
const PURGE_BATCH = 2_000;

/**
 * Clears the words of every message older than ninety days (DATABASE.md §8:
 * "`notifications` bodies — 90 days — metadata kept").
 *
 * What goes: the rendered text and everything that filled it — a serial, a
 * doctor's name, a test's name. What stays: which message it was, to which
 * number, when, what became of it, what it cost, and the ids in
 * `CORRELATION_PARAMS`.
 *
 * Run hourly (`jobs.service`). Safe to run twice and from two processes: a
 * cleared row no longer matches. Returns how many rows it cleared.
 */
export async function clearExpiredBodies(): Promise<number> {
  let cleared = 0;

  for (;;) {
    const batch = await notificationRepo.clearBodiesOlderThan(
      BODY_RETENTION_DAYS,
      CORRELATION_PARAMS,
      PURGE_BATCH,
    );
    cleared += batch;
    if (batch < PURGE_BATCH) return cleared;
  }
}

/**
 * Whether a message goes now, waits for the morning, or is not sent, and why.
 *
 * Not sent is a decision this system made and will not revisit: there is no
 * number, or the hospital is past its monthly cap (`FR-NOT-06`), and the row
 * says which. **Held is not that.** A message that is not urgent and falls in
 * quiet hours (`FR-NOT-07`) is queued and due when they end; the sender sends
 * it then. It used to be written as skipped, and nothing ever sent it.
 *
 * The cap is asked when the message is written, held or not. One held
 * overnight is counted against the month it is sent in, so a hospital at its
 * cap can go past it by what it held; the cap is a cost control and that is a
 * handful of messages, not a bill.
 */
function suppression(input: {
  readonly channel: 'sms' | 'push';
  readonly phone: string | null;
  readonly templateKey: string;
  readonly at: Date;
  readonly budgetLeft: number;
}): { readonly skipped: string | null; readonly heldUntil: Date | null } {
  if (input.channel === 'sms') {
    if (input.phone === null) return { skipped: 'no_phone_number', heldUntil: null };
    // `FR-NOT-06`: a hospital past its monthly cap stops sending rather than
    // running up a bill nobody agreed to.
    if (input.budgetLeft <= 0) return { skipped: 'sms_budget_exhausted', heldUntil: null };
  }

  if (withinQuietHours(input.templateKey, input.at)) {
    return {
      skipped: null,
      heldUntil: new Date(endOfQuietHours(input.at.toISOString() as Timestamp)),
    };
  }

  return { skipped: null, heldUntil: null };
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
    ...(planned.params[LINK_PARAMS.kind] === undefined
      ? {}
      : { [LINK_PARAMS.kind]: planned.params[LINK_PARAMS.kind] ?? '' }),
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

async function templateIndex(trx?: Tx): Promise<Map<string, string>> {
  if (cache !== null) return cache;

  const rows = await notificationRepo.activeTemplates(trx);
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
