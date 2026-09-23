/**
 * The queue service (BACKEND.md §4) — the single entry point for every queue
 * mutation. Everything else is a thin caller.
 *
 * ## The shape of the thing
 *
 * One function does the writing. `appendEvent` runs the thirteen steps
 * BACKEND.md §4.1 lists, in that order, inside one transaction that holds the
 * session row. Every route in §7.4 is a few lines that build a payload and
 * call it.
 *
 * That is not tidiness. The queue is the product, and the property the product
 * rests on is that a reception console and the server can never disagree about
 * it (`FR-QUE-05`). Two things secure that: the reducer exists once in
 * `shared/domain` and both sides run it, and there is exactly one path by
 * which a fact enters the log. A second write path — a route that appends
 * directly, a repository that updates `queue_state` — breaks the second half
 * without touching the first, and the symptom appears as a queue that jumps
 * on one device and not the other.
 *
 * ## Notifications are queued inside the lock and sent outside it
 *
 * Step 11 of §4.1 publishes the notification jobs. The rows go into
 * `notifications` in this transaction — so a rolled-back event leaves no
 * message behind — and `notification.service.dispatch` runs after the commit,
 * where a slow SMS gateway cannot hold the session row every counter in the
 * hospital is waiting on. Each of the three entry points below therefore ends
 * the same way: commit, then dispatch, then return.
 *
 * ## What this file deliberately does not do yet
 *
 * Step 12 of §4.1 writes `audit_log`. The table now exists (migration 0010)
 * but `middleware/audit.ts` does not; the actor is already on every event row,
 * so the log is attributable in the meantime (`FR-QUE-04`).
 */

import { createHash } from 'node:crypto';

import {
  computeEtas,
  continueReplay,
  emptyState,
  findEntry,
  isMaterialEvent,
  nextToCall,
  nowServing,
  project,
  projectedEnd,
  replay,
  waitingQueue,
  canAcceptSlot,
  canAddWalkin,
  canCallNext,
  canDeclareDelay,
  canDeclareDoctorArrived,
  canDeclareLate,
  canMarkDone,
  canMarkNoShow,
  canPause,
  canOfferFreedSlot,
  canReinstate,
  canReorder,
  canResume,
  id,
  lapsedOffers,
  recoveredValueFor,
  time,
  DEFAULT_QUEUE_SETTINGS,
  SLOT_OFFER_WINDOW_MINUTES,
  type Eta,
  type GuardResult,
  type QueueEvent,
  type QueueEventType,
  type QueueSeed,
  type QueueState,
  type SessionId,
  type Timestamp,
  type QueueActor,
} from '@platform/domain';

import { logger } from '../config/logger.js';
import { AppError, guardFailed, notFound } from '../errors/AppError.js';
import * as emit from '../realtime/emit.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as eventRepo from '../repositories/queueEvent.repo.js';
import * as stateRepo from '../repositories/queueState.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';
import * as standbyRepo from '../repositories/standby.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as notifications from './notification.service.js';
import * as payments from './payment.service.js';

/**
 * A session as the HTTP layer sees it, and a booking likewise.
 *
 * Re-exported from the repository shapes so a controller can name what it got
 * back without importing the data layer (BACKEND.md §3).
 */
export type SessionSummary = sessionRepo.SessionRow;
export type BookingSummary = bookingRepo.BookingRow;

/** What a caller hands `appendEvent`. */
export interface AppendEventInput {
  readonly sessionId: string;
  readonly type: QueueEventType;
  readonly payload: Record<string, unknown>;
  readonly actor: QueueActor;
  /** Idempotency key for offline replay (`FR-QUE-51`). */
  readonly clientEventId?: string | null;
  readonly clientTs?: string | null;
}

/** What it returns, and what a route sends back (BACKEND.md §4.1 step 13). */
export interface AppendEventResult {
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  readonly seq: number;
  /** True when this was a replay that had already been applied (`SY-02`). */
  readonly duplicate: boolean;
  /** Drives the freshness line (`FR-OFF-03`). */
  readonly serverTs: string;
}

/**
 * Appends one fact to a session's log and returns everything that follows.
 *
 * The steps below are numbered to BACKEND.md §4.1 so the two can be read side
 * by side; a step that moves in one should move in the other.
 */
export async function appendEvent(input: AppendEventInput): Promise<AppendEventResult> {
  // --- 1. Idempotency ------------------------------------------------------
  //
  // Before the transaction, because the overwhelmingly common case is a first
  // send and the overwhelmingly common answer is "no". Checking inside the
  // lock would make every console action wait for the row.
  const replayed = await findReplay(input.clientEventId ?? null);
  if (replayed !== null) return replayed;

  const settled = await withTransaction(async (trx) => {
    // --- 5. Serialise ------------------------------------------------------
    const session = await lockSession(trx, input.sessionId);

    // --- 3. Load -----------------------------------------------------------
    const before = await loadState(trx, session);

    // --- 4, 6, 7. Validate, append, reduce ---------------------------------
    const applied = await applyOne(trx, session, before, input);

    // --- 8, 9, 10, 11. Persist, recalculate, broadcast, queue messages -----
    return await settle(trx, session, applied.state, [applied.event]);
  });

  // Committed. Now, and only now, does anything leave the building.
  await notifications.dispatch(settled.batch);
  await afterSessionEnded(input.type, input.sessionId);
  return settled.result;
}

/**
 * `FR-PAY-07`, raised the moment a session closes.
 *
 * "Doctor absence triggers automatic refund eligibility without the patient
 * asking" — so nobody asks. Every patient who paid and was never seen is
 * marked owed in one statement as soon as the session ends.
 *
 * **After the commit, and never able to fail the event.** A session has
 * ended whether or not the money bookkeeping succeeded, and an end that
 * rolled back because a payment query was slow would leave a chamber running
 * on every screen in the hospital. So this is logged and swallowed, like the
 * confirmation SMS is — the eligibility is recoverable from the rows, a
 * wedged session is not.
 */
async function afterSessionEnded(type: QueueEventType, sessionId: string): Promise<void> {
  if (type !== 'SESSION_ENDED') return;

  try {
    await payments.raiseRefundsForEndedSession(sessionId);
  } catch (cause: unknown) {
    logger.error({ sessionId, err: cause }, 'could not raise refund eligibility');
  }
}

/**
 * `POST /sessions/:id/next` — finish whoever is in the chamber, call the next.
 *
 * ## Why this is one operation and not two calls to `appendEvent`
 *
 * "Who is next" is a decision, and a decision made outside the lock is a
 * decision two counters make identically. Five receptionists tapping `next` in
 * the same instant would each read the same state, each conclude serial 1 is
 * next, and four of them would be refused by the guard — or worse, if the
 * guard were laxer, four of them would call the same patient.
 *
 * So both facts are decided *inside* the lock, from the state as it stands at
 * that moment, and appended in the same transaction. A counter that waits for
 * the lock then sees the previous counter's work and calls the patient after.
 * That is `FR-QUE-53`, and it is what `queueConflict.test.ts` proves.
 *
 * The two events stay separate facts in the log — a consultation ended and a
 * patient was called are different things, and a replay must be able to tell
 * them apart.
 */
export async function callNext(input: {
  readonly sessionId: string;
  readonly actor: QueueActor;
  readonly clientEventId?: string | null;
  readonly clientTs?: string | null;
}): Promise<AppendEventResult> {
  // The two events are stored under *derived* keys, so a replay is recognised
  // by those and not by the key the console sent. Checking the call first: if
  // the queue had somebody to call, that is the event the console is asking
  // about; if it only had somebody to finish, the `done` key answers.
  const original = input.clientEventId ?? null;
  const replayed =
    (await findReplay(derive(original, 'c'))) ?? (await findReplay(derive(original, 'd')));
  if (replayed !== null) return replayed;

  const settled = await withTransaction(async (trx) => {
    const session = await lockSession(trx, input.sessionId);
    let state = await loadState(trx, session);
    const events: QueueEvent[] = [];

    // Everything below reads `state`, which is re-bound after each append, so
    // the second decision is made against the result of the first.
    const serving = nowServing(state);
    if (serving !== null) {
      const applied = await applyOne(trx, session, state, {
        sessionId: input.sessionId,
        type: 'PATIENT_DONE',
        payload: {
          bookingId: serving.bookingId,
          // Measured from the call, never typed (`FR-REC-11`). This is what
          // the rolling rate learns from, so a typed number would be a guess
          // entering the ETA maths as a fact.
          consultSeconds:
            serving.calledAt === null
              ? 0
              : Math.max(0, time.differenceInSeconds(nowTs(), serving.calledAt)),
        },
        actor: input.actor,
        clientEventId: derive(input.clientEventId ?? null, 'd'),
        clientTs: input.clientTs ?? null,
      });
      state = applied.state;
      events.push(applied.event);
    }

    const next = nextToCall(state);
    if (next !== null) {
      const applied = await applyOne(trx, session, state, {
        sessionId: input.sessionId,
        type: 'PATIENT_CALLED',
        payload: { bookingId: next.bookingId, serial: next.serial },
        actor: input.actor,
        clientEventId: derive(input.clientEventId ?? null, 'c'),
        clientTs: input.clientTs ?? null,
      });
      state = applied.state;
      events.push(applied.event);
    }

    // Nobody in the chamber and nobody waiting. Not an error — an empty queue
    // is a state, and the console should render it rather than a failure.
    if (events.length === 0) {
      return {
        result: {
          state,
          etas: computeEtas(state, nowTs()),
          seq: state.lastSeq,
          duplicate: false,
          serverTs: nowTs(),
        },
        batch: notifications.NOTHING,
      };
    }

    return await settle(trx, session, state, events);
  });

  await notifications.dispatch(settled.batch);
  return settled.result;
}

/**
 * `POST /sessions/:id/offer-slot` — give an empty chair to the standby list
 * (`FR-QUE-30`, `FR-REC-30`).
 *
 * "Freed slots are offered to standby patients in order, with a short
 * acceptance window; unaccepted offers pass to the next patient."
 *
 * ## Why the offer row is written before the event
 *
 * `SLOT_OFFERED` names an `offerId`, and the log must never contain a fact
 * about nothing — the same reason `createWalkinBooking` runs before
 * `WALKIN_ADDED`. The difference is that this one is in the *same*
 * transaction: a walk-in's booking is worth keeping even if the event fails,
 * because a patient is standing at the counter, while an offer nobody was told
 * about is only a row that will expire quietly and block the chair meanwhile.
 *
 * ## Why the next standby patient is chosen under the lock
 *
 * Two receptionists marking two no-shows in the same instant both read the
 * list, both find the person at position 1, and both offer them a chair —
 * which leaves one chair covered twice and the next person on the list never
 * asked. `claimNextStandby` takes `FOR UPDATE SKIP LOCKED` so the second
 * caller gets position 2, and skips anybody already holding an open offer.
 */
export async function offerFreedSlot(input: {
  readonly sessionId: string;
  readonly freedBookingId: string;
  readonly actor: QueueActor;
  readonly clientEventId?: string | null;
  readonly clientTs?: string | null;
}): Promise<AppendEventResult> {
  const replayed = await findReplay(input.clientEventId ?? null);
  if (replayed !== null) return replayed;

  const settled = await withTransaction(async (trx) => {
    const session = await lockSession(trx, input.sessionId);
    const state = await loadState(trx, session);

    const guard = canOfferFreedSlot(state, id(input.freedBookingId));
    if (!guard.ok) throw guardFailed(guard.code, guard.detail);

    const now = new Date();
    const standby = await standbyRepo.claimNextStandby(trx, input.sessionId, now);

    // Not an error worth a stack trace, and not a 500: an empty standby list
    // is the ordinary state of most chambers. The console shows the chair as
    // free with nobody to give it to, which is the truth.
    if (standby === null) {
      throw new AppError('QUEUE_GUARD_FAILED', {
        message: 'Nobody is on the standby list for this session.',
        details: { guard: 'NO_STANDBY' },
      });
    }

    const expiresAt = new Date(now.getTime() + SLOT_OFFER_WINDOW_MINUTES * 60_000);

    const offerId = await standbyRepo.insertOffer(trx, {
      sessionId: input.sessionId,
      freedBookingId: input.freedBookingId,
      offeredToPatientId: standby.patientId,
      expiresAt,
    });

    const applied = await applyOne(trx, session, state, {
      sessionId: input.sessionId,
      type: 'SLOT_OFFERED',
      payload: {
        offerId,
        freedBookingId: input.freedBookingId,
        // One name, in a list. `DATABASE.md` §3 declares the field as an
        // array and `FR-QUE-30` says *in order*, so the shape allows a future
        // broadcast offer and this version never puts more than one in it.
        offeredTo: [standby.patientId],
        expiresAt: expiresAt.toISOString(),
      },
      actor: input.actor,
      clientEventId: input.clientEventId ?? null,
      clientTs: input.clientTs ?? null,
    });

    const settled = await settle(trx, session, applied.state, [applied.event]);

    // Written in the same transaction as the event, like every other message
    // (BACKEND.md §8): an offer that rolls back must leave no text behind
    // telling somebody to come in. Its own call rather than part of the plan,
    // because the recipient is a standby row and not a booking.
    const offerMessage = await notifications.queueSlotOffer(trx, {
      sessionId: input.sessionId,
      patientId: standby.patientId,
      phone: standby.contactPhone,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      result: settled.result,
      batch: notifications.merge(settled.batch, offerMessage),
    };
  });

  await notifications.dispatch(settled.batch);
  return settled.result;
}

/**
 * `POST /offers/:id/accept` — a standby patient takes the chair
 * (`FR-QUE-30`, `FR-ADM-03`).
 *
 * ## Which serial they get, and why it depends on how the chair came free
 *
 * This is open decision 13, and the schema had already answered it:
 * `bookings_session_serial_key` excludes only `cancelled` rows, so a cancelled
 * serial is genuinely free and a no-show's is not — the no-show row keeps its
 * number and stays in history (`DB-P2`).
 *
 * That asymmetry turns out to be the right behaviour rather than an accident
 * of the index. A cancellation happens *before* the queue reaches that point,
 * so handing the number on puts the standby patient in the slot that actually
 * opened. A no-show is discovered *as* the queue passes it — giving somebody
 * serial 12 when the chamber is calling 30 would seat them at a place the
 * queue has already gone by, and the reducer would carry them as waiting
 * behind a moment that has passed.
 *
 * So: reissue the freed serial when it is both free and still ahead of the
 * chamber; otherwise issue the next one, which is where a person arriving now
 * belongs anyway.
 */
export async function acceptSlot(input: {
  readonly offerId: string;
  readonly actor: QueueActor;
  readonly clientEventId?: string | null;
  readonly clientTs?: string | null;
}): Promise<AppendEventResult> {
  const replayed = await findReplay(input.clientEventId ?? null);
  if (replayed !== null) return replayed;

  const offer = await standbyRepo.findOffer(input.offerId);
  if (offer === null) throw notFound('offer');

  const settled = await withTransaction(async (trx) => {
    const session = await lockSession(trx, offer.sessionId);
    const before = await loadState(trx, session);

    const guard = canAcceptSlot(before, input.offerId, nowTs());
    if (!guard.ok) throw guardFailed(guard.code, guard.detail);

    const now = new Date();

    // The row-level race guard. Two accepts of one offer both pass the domain
    // check against a state each read a moment earlier; this is where the
    // second finds nothing left to update.
    const claimed = await standbyRepo.markAccepted(
      trx,
      input.offerId,
      recoveredValueFor(session.feePoisha),
      now,
    );
    if (!claimed) {
      throw new AppError('QUEUE_CONFLICT', {
        message: 'Somebody else took that slot first.',
        details: { offerId: input.offerId },
      });
    }

    // The reduced state, not the roster: `status` here is what the event log
    // says the booking came to, which is the same thing the guard just read.
    const freed =
      offer.freedBookingId === null ? null : findEntry(before, id(offer.freedBookingId));

    const serving = nowServing(before);
    const passed = serving === null ? 0 : serving.serial;
    const highest = before.entries.reduce((max, entry) => Math.max(max, entry.serial), 0);

    const reissue =
      freed !== null && freed.status === 'cancelled' && freed.serial > passed
        ? freed.serial
        : highest + 1;

    const newBookingId = await bookingRepo.insertBooking(trx, {
      sessionId: offer.sessionId,
      patientId: offer.offeredToPatientId,
      serial: reissue,
      // Reception is entering this at the desk. `walkin` is reserved for
      // `WALKIN_ADDED` — somebody who turned up with no prior arrangement —
      // and a standby patient made one.
      source: 'counter',
      feePoisha: session.feePoisha,
      // A standby patient registered by phone at the counter, so there is no
      // app account and no guest identity behind this booking, and nothing
      // was asked of them beforehand.
      bookedByUserId: null,
      bookedByGuestId: null,
      reasonText: null,
      intake: {},
    });

    await standbyRepo.removeFromStandby(trx, offer.sessionId, offer.offeredToPatientId, now);

    // Re-read, so the roster the reducer folds against contains the booking
    // the event is about to name. Without it `reduceSlotAccepted` records an
    // anomaly rather than a seated patient.
    const state = await loadState(trx, session);

    const applied = await applyOne(trx, session, state, {
      sessionId: offer.sessionId,
      type: 'SLOT_ACCEPTED',
      payload: { offerId: input.offerId, newBookingId },
      actor: input.actor,
      clientEventId: input.clientEventId ?? null,
      clientTs: input.clientTs ?? null,
    });

    return await settle(trx, session, applied.state, [applied.event]);
  });

  await notifications.dispatch(settled.batch);
  return settled.result;
}

/**
 * Records the offers whose window has closed, so the chair can be offered on.
 *
 * `FR-QUE-30`: "unaccepted offers pass to the next patient". Nothing in this
 * version runs on a timer — `pg-boss` is not installed — so an offer lapses in
 * fact the moment its deadline passes and lapses *in the log* the next time
 * anybody looks at the session. `canAcceptSlot` already refuses on the clock,
 * so the gap between the two is never a chair given away twice; it is only a
 * console that has not yet been told the chair is free again.
 *
 * Called by the reception console's read path. When a worker process exists it
 * takes this over on a 30-second tick (`BACKEND.md` §8) and nothing else
 * changes.
 */
export async function expireLapsedOffers(sessionId: string, actor: QueueActor): Promise<number> {
  const state = await getState(sessionId);
  const lapsed = lapsedOffers(state, nowTs());
  if (lapsed.length === 0) return 0;

  for (const offer of lapsed) {
    try {
      await appendEvent({
        sessionId,
        type: 'SLOT_EXPIRED',
        payload: { offerId: offer.offerId },
        actor,
        // Derived from the offer, so two consoles noticing the same lapse in
        // the same second record it once. `queue_events.client_event_id` is a
        // uuid column, so it has to *be* one rather than merely be unique.
        clientEventId: expiryKey(offer.offerId),
      });
    } catch (cause: unknown) {
      // A lapse that could not be recorded is not worth failing the read it
      // was noticed during: the offer is already unacceptable by the clock,
      // and the next reader will try again.
      logger.warn({ sessionId, offerId: offer.offerId, err: cause }, 'could not expire offer');
    }
  }

  return lapsed.length;
}

/**
 * The idempotency key for recording that one offer lapsed.
 *
 * A UUIDv5 over a fixed namespace, which makes it a pure function of the offer
 * — two consoles noticing the same lapse in the same second produce the same
 * key, and the second append is recognised as the replay it is rather than
 * writing a second fact about one event into an append-only log.
 *
 * Built by hand because Node has no v5 and a dependency for sixteen bytes of
 * hashing is not worth asking for (`CLAUDE.md` §7). The shape is RFC 4122
 * §4.3: SHA-1 of namespace-plus-name, version nibble set to 5, variant bits to
 * 10.
 */
const EXPIRY_NAMESPACE = 'a1b0f2c4-5d6e-4f70-8a91-2b3c4d5e6f70';

export function expiryKey(offerId: string): string {
  const namespace = Buffer.from(EXPIRY_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([namespace, Buffer.from(offerId, 'utf8')]))
    .digest();

  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** One offer, or a 404. The controller needs its session to scope-check. */
export async function requireOffer(offerId: string): Promise<standbyRepo.OfferRow> {
  const offer = await standbyRepo.findOffer(offerId);
  if (offer === null) throw notFound('offer');
  return offer;
}

/** The standby list and this session's offers, for `S-B-02`'s panel. */
export async function standbyFor(sessionId: string): Promise<{
  readonly waiting: readonly standbyRepo.StandbyRow[];
  readonly offers: readonly standbyRepo.OfferRow[];
}> {
  const [waiting, offers] = await Promise.all([
    standbyRepo.listStandby(sessionId),
    standbyRepo.listOffers(sessionId),
  ]);
  return { waiting, offers };
}

/**
 * Validate, append, reduce — the three steps that turn one input into one
 * recorded fact and the state that follows from it.
 *
 * Takes the state to validate against rather than reading it, so a caller
 * appending two events under one lock validates the second against the result
 * of the first.
 */
async function applyOne(
  trx: Tx,
  session: sessionRepo.SessionRow,
  state: QueueState,
  input: AppendEventInput,
): Promise<{ readonly event: QueueEvent; readonly state: QueueState }> {
  assertAllowed(state, input, session);

  const event = await eventRepo.append(trx, {
    sessionId: input.sessionId,
    type: input.type,
    payload: input.payload,
    actor: input.actor,
    clientEventId: input.clientEventId ?? null,
    clientTs:
      input.clientTs === null || input.clientTs === undefined ? null : new Date(input.clientTs),
  });

  // An undo also marks what it compensated, which is the only mutation the
  // append-only trigger permits (`GR-02`).
  if (event.type === 'ACTION_UNDONE') {
    await eventRepo.markUndone(trx, event.payload.undoneEventId, event.id);

    // `continueReplay` cannot un-apply an event it has already folded, so an
    // undo replays the whole log — which is cheap for one session and is the
    // only way the compensated pair nets out correctly.
    const seed = await seedFor(trx, session);
    const all = await eventRepo.listForSession(session.id, 0, trx);
    return { event, state: replay(seed, all) };
  }

  return { event, state: continueReplay(state, [event]) };
}

/** Persist, recalculate, broadcast — and shape what the caller gets back. */
async function settle(
  trx: Tx,
  session: sessionRepo.SessionRow,
  state: QueueState,
  events: readonly QueueEvent[],
): Promise<Settled> {
  const last = events[events.length - 1];
  if (last === undefined) throw new Error('settle() needs at least one event.');

  // --- 8. Persist ----------------------------------------------------------
  await persist(trx, session, state, last.serverTs);

  // --- 9. Recalculate ------------------------------------------------------
  const etas = computeEtas(state, last.serverTs);

  // --- 10. Broadcast -------------------------------------------------------
  //
  // One `queue.updated` carrying the final state, plus the targeted events
  // each fact deserves. Two `queue.updated` messages for one console action
  // would make a client render an intermediate queue nobody was ever in.
  emit.queueUpdated(session.id, { state, etas }, last.seq, last.serverTs);
  for (const event of events) {
    broadcastSpecific(session.id, state, event);

    // --- 12. Audit ---------------------------------------------------------
    //
    // Not built: `middleware/audit.ts` is unwritten, though `audit_log` now
    // exists (migration 0010). The actor is already on the event row, so the
    // log is attributable in the meantime (`FR-QUE-04`).
  }

  // --- 11. Notify ----------------------------------------------------------
  //
  // Planned from the state, written into the outbox, and sent by the caller
  // once this transaction has committed. `isMaterialEvent` is the domain's own
  // answer to "is this worth telling somebody about", and the mapping from an
  // event to a message lives in `notification.service` rather than here — this
  // file's job is the queue, not the copy.
  const material = events.filter((event) => isMaterialEvent(event.type));
  const plan = [
    ...material.flatMap((event) =>
      notifications.planFor(state, event, { etaFor: (id) => etaTextFor(etas, id) }),
    ),
    // Who is two away now (`FR-NOT-03`). Whether they have already been told
    // is settled against the outbox, not against `before`.
    ...notifications.planTwoAway(state),
  ];

  const batch = await notifications.queueFor(trx, session.id, plan);

  // --- 13. Return ----------------------------------------------------------
  return {
    result: { state, etas, seq: last.seq, duplicate: false, serverTs: last.serverTs },
    batch,
  };
}

/** What `settle` produces: the answer, and the messages waiting to go out. */
interface Settled {
  readonly result: AppendEventResult;
  readonly batch: notifications.QueuedBatch;
}

/**
 * A booking's estimate, as a message says it.
 *
 * Bangla numerals and a Bangla period word are the recipient's business, not
 * this file's, so what travels is an ISO instant and the service formats it
 * per locale (`FR-NOT-04`, `TYP-04`).
 */
function etaTextFor(etas: readonly Eta[], bookingId: string): string | null {
  const eta = etas.find((candidate) => candidate.bookingId === bookingId);
  if (eta === undefined || eta.confidence === 'unknown') return null;
  return eta.etaAt;
}

/**
 * The stored result of an event already applied (`FR-QUE-51`, `SY-02`).
 *
 * Exported because a caller that guards on *current state* has to ask this
 * first. `booking.service.cancelBooking` refuses a booking that is already
 * cancelled — which is the right answer to a second attempt and the wrong one
 * to a retry of the first, and only the client event id can tell them apart.
 */
export async function findReplay(clientEventId: string | null): Promise<AppendEventResult | null> {
  if (clientEventId === null) return null;

  const stored = await eventRepo.findByClientEventId(clientEventId);
  if (stored === null) return null;

  const state = await getState(stored.sessionId);
  return {
    state,
    etas: computeEtas(state, nowTs()),
    seq: stored.seq,
    duplicate: true,
    serverTs: stored.serverTs,
  };
}

/** Takes the session lock, or says the session is not there. */
async function lockSession(trx: Tx, sessionId: string): Promise<sessionRepo.SessionRow> {
  const session = await sessionRepo.lockForUpdate(trx, sessionId);
  if (session === null) throw notFound('session');
  return session;
}

/**
 * A second idempotency key derived from the first.
 *
 * `next` is two events from one console action. Reusing the key for both would
 * make the second look like a replay of the first; generating a fresh one
 * would make a replayed `next` advance the queue twice. A deterministic suffix
 * does neither. The column is `uuid`, so the version nibble is set to a value
 * no generator produces rather than appending anything.
 */
function derive(clientEventId: string | null, tag: 'd' | 'c'): string | null {
  if (clientEventId === null) return null;
  return `${clientEventId.slice(0, 14)}${tag}${clientEventId.slice(15)}`;
}

/**
 * Reads a session's queue.
 *
 * Uses the cache when it has consumed the whole log, and folds the remainder
 * when it has not (BACKEND.md §4.2). The remainder is usually empty: the only
 * way it is not is a crash between the append and the cache write, which the
 * transaction makes impossible, or a cache deleted by hand.
 */
export async function getState(sessionId: string): Promise<QueueState> {
  const session = await sessionRepo.findById(sessionId);
  if (session === null) throw notFound('session');

  const seed = await seedFor(undefined, session);
  const cached = await stateRepo.find(sessionId);

  // No cache at all, or one that has fallen behind: replay from the log. The
  // log is the only thing that was ever true, so this is always correct and
  // only ever slower (`DB-P1`).
  const from = cached?.rebuiltFromSeq ?? 0;
  const events = await eventRepo.listForSession(sessionId, from);

  if (from === 0) return replay(seed, events);

  // The cache is a projection of counts, not of the full state, so a warm read
  // still replays. What the cache buys is the *read* path for a patient's
  // phone — `queue_state` answers "what number is showing" in one row without
  // touching the log at all (DATABASE.md §6).
  return replay(seed, await eventRepo.listForSession(sessionId, 0));
}

/** The cached counters, for the cheap read a patient's phone makes. */
export async function getCachedState(
  sessionId: string,
): Promise<stateRepo.CachedQueueState | null> {
  return await stateRepo.find(sessionId);
}

/**
 * Full replay from the log, rewriting the cache (BACKEND.md §4.2).
 *
 * Used by the rebuild script and by tests. It is the operation that makes the
 * cache disposable, and therefore the operation that makes `DB-P1` true rather
 * than merely stated.
 */
export async function rebuild(sessionId: string): Promise<QueueState> {
  return await withTransaction(async (trx) => {
    const session = await sessionRepo.lockForUpdate(trx, sessionId);
    if (session === null) throw notFound('session');

    const seed = await seedFor(trx, session);
    const events = await eventRepo.listForSession(sessionId, 0, trx);
    const state = replay(seed, events);

    await stateRepo.clear(trx, sessionId);
    await persist(trx, session, state, nowTs());

    return state;
  });
}

/** ETAs for a session, for the read path. */
export async function getEtas(sessionId: string): Promise<readonly Eta[]> {
  return computeEtas(await getState(sessionId), nowTs());
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/** The immutable facts a replay starts from. */
async function seedFor(trx: Tx | undefined, session: sessionRepo.SessionRow): Promise<QueueSeed> {
  return {
    plan: {
      sessionId: id<SessionId>(session.id),
      doctorId: id(session.doctorId),
      plannedStart: session.plannedStart.toISOString() as Timestamp,
      plannedEnd: session.plannedEnd.toISOString() as Timestamp,
      capacity: session.capacity,
      defaultConsultSeconds: session.defaultConsultMinutes * 60,
    },
    roster: await bookingRepo.rosterFor(session.id, trx),
  };
}

/** The state as it stands, folded from the log inside the lock. */
async function loadState(trx: Tx, session: sessionRepo.SessionRow): Promise<QueueState> {
  const seed = await seedFor(trx, session);
  const events = await eventRepo.listForSession(session.id, 0, trx);
  return events.length === 0 ? emptyState(seed) : replay(seed, events);
}

/**
 * Writes every derived row: the cache, the session's projections, and each
 * booking's settled state (BACKEND.md §4.1 step 8).
 *
 * All three come from the reducer. This function decides nothing.
 */
async function persist(
  trx: Tx,
  session: sessionRepo.SessionRow,
  state: QueueState,
  at: Timestamp,
): Promise<void> {
  const projection = project(state);

  await stateRepo.save(trx, projection, state.status === 'ended' ? null : projectedEnd(state, at));

  await sessionRepo.saveProjection(trx, session.id, {
    status: state.status,
    actualStart: state.doctorArrivedAt,
    actualEnd: state.endedAt,
    delayMinutes: state.delayMinutes,
    avgConsultSeconds: projection.avgConsultSeconds,
    lastEventSeq: state.lastSeq,
  });

  await bookingRepo.saveProjections(
    trx,
    state.entries.map((entry) => ({
      bookingId: entry.bookingId,
      status: entry.status,
      calledAt: entry.calledAt,
      doneAt: entry.doneAt,
      arrivedAt: entry.arrivedAt,
      consultSeconds: entry.consultSeconds,
      cancelledReason: entry.cancelled?.reason ?? null,
    })),
  );
}

/**
 * The targeted events one fact deserves, beyond `queue.updated` (BACKEND.md §6).
 *
 * `queue.updated` is emitted once per console action by `settle`; these are the
 * extras a client acts on differently — a delay it shows immediately, a call
 * addressed to one person, an ending that stops it listening.
 */
function broadcastSpecific(sessionId: string, state: QueueState, event: QueueEvent): void {
  switch (event.type) {
    case 'DELAY_DECLARED':
      emit.sessionDelayed(
        sessionId,
        {
          minutes: event.payload.minutes,
          totalDelayMinutes: state.delayMinutes,
          reason: event.payload.reason,
        },
        event.seq,
        event.serverTs,
      );
      break;

    case 'PATIENT_CALLED': {
      const entry = findEntry(state, event.payload.bookingId);
      if (entry !== null) {
        emit.patientCalled(
          entry.patientId,
          {
            sessionId,
            bookingId: entry.bookingId,
            serial: entry.serial,
          },
          event.seq,
          event.serverTs,
        );
      }
      break;
    }

    case 'SESSION_ENDED':
      emit.sessionEnded(sessionId, event.seq, event.serverTs);
      break;

    // Everything else is carried by `queue.updated` alone, which already holds
    // the whole state. A separate event per type would be more messages for a
    // client to reconcile and no more information.
    case 'SESSION_OPENED':
    case 'DOCTOR_ARRIVED':
    case 'SESSION_PAUSED':
    case 'SESSION_RESUMED':
    case 'PATIENT_DONE':
    case 'PATIENT_LATE':
    case 'PATIENT_NO_SHOW':
    case 'PATIENT_REINSERTED':
    case 'WALKIN_ADDED':
    case 'BOOKING_CANCELLED':
    case 'SLOT_OFFERED':
    case 'SLOT_ACCEPTED':
    case 'SLOT_EXPIRED':
    case 'PRIORITY_REORDERED':
    case 'ACTION_UNDONE':
      break;
  }
}

/**
 * Runs the guard for this event type (BACKEND.md §4.1 step 4).
 *
 * The guards live in `shared/domain/queue/rules.ts` and the console runs the
 * same ones before it even sends — so this is not the first line of defence,
 * it is the authoritative one. A console that is out of date, offline, or
 * simply wrong gets the same answer here that a correct one would have given
 * itself.
 *
 * A refused guard is `QUEUE_GUARD_FAILED` (422), not a 400: the request was
 * well-formed and the rule said no.
 */
function assertAllowed(
  state: QueueState,
  input: AppendEventInput,
  session: sessionRepo.SessionRow,
): void {
  const settings = { ...DEFAULT_QUEUE_SETTINGS };
  const now = nowTs();
  let result: GuardResult | null = null;

  switch (input.type) {
    case 'DOCTOR_ARRIVED':
      result = canDeclareDoctorArrived(state);
      break;
    case 'DELAY_DECLARED':
      result = canDeclareDelay(state, readNumber(input.payload, 'minutes'));
      break;
    case 'SESSION_PAUSED':
      result = canPause(state);
      break;
    case 'SESSION_RESUMED':
      result = canResume(state);
      break;
    case 'PATIENT_CALLED':
      result = canCallNext(state);
      break;
    case 'PATIENT_DONE':
      result = canMarkDone(state, id(readString(input.payload, 'bookingId')));
      break;
    case 'PATIENT_LATE':
      result = canDeclareLate(state, id(readString(input.payload, 'bookingId')));
      break;
    case 'PATIENT_NO_SHOW':
      result = canMarkNoShow(state, id(readString(input.payload, 'bookingId')), settings, now);
      break;
    case 'PATIENT_REINSERTED':
      result = canReinstate(state, id(readString(input.payload, 'bookingId')));
      break;
    case 'WALKIN_ADDED':
      result = canAddWalkin(
        state,
        readString(input.payload, 'position') === 'index' ? 'index' : 'end',
        typeof input.payload['reason'] === 'string' ? input.payload['reason'] : null,
      );
      break;
    case 'PRIORITY_REORDERED':
      result = canReorder(
        state,
        id(readString(input.payload, 'bookingId')),
        readString(input.payload, 'reason'),
      );
      break;

    // Session lifecycle and slot events carry no guard of their own: opening a
    // session, ending one, and the offer lifecycle are decided by the service
    // that raises them, not by the state of the queue.
    case 'SESSION_OPENED':
    case 'SESSION_ENDED':
    case 'BOOKING_CANCELLED':
    case 'SLOT_OFFERED':
    case 'SLOT_ACCEPTED':
    case 'SLOT_EXPIRED':
    case 'ACTION_UNDONE':
      break;
  }

  if (result !== null && !result.ok) {
    throw guardFailed(result.code, result.detail);
  }

  // A session that has ended takes no further events. The reducer would fold
  // them without complaint — it records what happened and does not
  // re-litigate — so the refusal belongs here.
  if (state.status === 'ended' && input.type !== 'ACTION_UNDONE') {
    throw guardFailed('SESSION_ENDED', `Session ${session.id} has ended.`);
  }
}

// ---------------------------------------------------------------------------
// Reads the HTTP layer needs
//
// A controller may not touch a repository (BACKEND.md §3, lint-enforced), and
// it should not: "does this session exist and may this caller act on it" is a
// question about the queue, and the queue's questions are answered here.
// ---------------------------------------------------------------------------

/** The session, or `NOT_FOUND`. */
export async function requireSession(sessionId: string): Promise<sessionRepo.SessionRow> {
  const session = await sessionRepo.findById(sessionId);
  if (session === null) throw notFound('session');
  return session;
}

/** The booking, or `NOT_FOUND`. */
export async function requireBooking(bookingId: string): Promise<bookingRepo.BookingRow> {
  const booking = await bookingRepo.findById(bookingId);
  if (booking === null) throw notFound('booking');
  return booking;
}

/** The recorded event, or `NOT_FOUND`. Used by the undo window check. */
export async function requireEvent(eventId: string): Promise<QueueEvent> {
  const event = await eventRepo.findById(eventId);
  if (event === null) throw notFound('event');
  return event;
}

/** Who a booking belongs to, for the ownership check on a patient's own routes. */
export async function bookingOwner(
  bookingId: string,
): Promise<{ userId: string | null; guestId: string | null; patientId: string } | null> {
  return await bookingRepo.ownerOf(bookingId);
}

/** The roster with patient names, for the console's table. */
export async function listBookings(sessionId: string): Promise<bookingRepo.BookingRow[]> {
  return await bookingRepo.listForSession(sessionId);
}

/** One event from an offline batch, as the console queued it. */
export interface BatchEntry {
  readonly clientEventId: string;
  readonly type: AppendEventInput['type'];
  readonly payload: Record<string, unknown>;
  readonly clientTs: string | null;
}

/** What became of one entry. */
export type BatchOutcome =
  | { readonly kind: 'accepted'; readonly clientEventId: string; readonly seq: number }
  | {
      readonly kind: 'conflict';
      readonly clientEventId: string;
      readonly reason: string;
      readonly code: string;
    };

export interface BatchResult {
  readonly outcomes: readonly BatchOutcome[];
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  readonly seq: number;
  readonly serverTs: string;
}

/**
 * Applies a whole offline batch under one lock (`SY-01`, `SY-03`).
 *
 * ## Why one lock rather than a loop over `appendEvent`
 *
 * A console that was offline for an hour comes back with a shift's worth of
 * actions. Taking and releasing the session lock once per event would let
 * another counter interleave between them — so a batch that was internally
 * consistent when it was recorded could be applied into a queue that moved
 * underneath it, halfway through. One lock for the batch means the whole
 * replay sees one coherent queue.
 *
 * ## Why a rejected event does not fail the batch
 *
 * `SY-03`: the losing device gets a `conflict` entry and rolls *that row*
 * back. Four of a receptionist's five actions are usually still valid — the
 * one that lost is the one where another counter got there first. Failing the
 * whole batch would throw away good work and leave her retyping it.
 *
 * So each entry is tried against the state as it stands after the previous
 * one, and a guard rejection is recorded and stepped over rather than thrown.
 * The events that did apply are committed; a conflict is information, not an
 * error.
 */
export async function appendBatch(input: {
  readonly sessionId: string;
  readonly actor: QueueActor;
  readonly entries: readonly BatchEntry[];
}): Promise<BatchResult> {
  const settled = await withTransaction(async (trx) => {
    const session = await lockSession(trx, input.sessionId);
    let state = await loadState(trx, session);

    const outcomes: BatchOutcome[] = [];
    const applied: QueueEvent[] = [];

    for (const entry of input.entries) {
      // `SY-02`: a replayed batch is safe. An entry already in the log is
      // reported as accepted with the sequence it originally got, because
      // from the console's point of view it succeeded — which it did.
      const already = await eventRepo.findByClientEventId(entry.clientEventId, trx);
      if (already !== null) {
        outcomes.push({
          kind: 'accepted',
          clientEventId: entry.clientEventId,
          seq: already.seq,
        });
        continue;
      }

      try {
        const result = await applyOne(trx, session, state, {
          sessionId: input.sessionId,
          type: entry.type,
          payload: entry.payload,
          actor: input.actor,
          clientEventId: entry.clientEventId,
          clientTs: entry.clientTs,
        });

        state = result.state;
        applied.push(result.event);
        outcomes.push({
          kind: 'accepted',
          clientEventId: entry.clientEventId,
          seq: result.event.seq,
        });
      } catch (error) {
        // A guard refusal is the expected outcome of a race, not a fault.
        // Anything else — a dropped connection, a constraint violation — is a
        // real failure and must abort the transaction rather than be
        // mis-reported to the console as a conflict it could resolve.
        if (!(error instanceof AppError) || error.code !== 'QUEUE_GUARD_FAILED') throw error;

        outcomes.push({
          kind: 'conflict',
          clientEventId: entry.clientEventId,
          reason: error.message,
          code: typeof error.details?.['guard'] === 'string' ? error.details['guard'] : error.code,
        });
      }
    }

    // Nothing applied — every entry was a replay or a conflict. There is no
    // new state to persist or broadcast, so report the queue as it stands.
    if (applied.length === 0) {
      const etas = computeEtas(state, nowTs());
      return {
        result: { outcomes, state, etas, seq: state.lastSeq, serverTs: nowTs() },
        batch: notifications.NOTHING,
      };
    }

    const done = await settle(trx, session, state, applied);
    return {
      result: {
        outcomes,
        state: done.result.state,
        etas: done.result.etas,
        seq: done.result.seq,
        serverTs: done.result.serverTs,
      },
      batch: done.batch,
    };
  });

  // A console replaying an offline shift can produce a shift's worth of
  // messages at once. They go out after the batch has committed, in order,
  // for the same reason a single event's do.
  await notifications.dispatch(settled.batch);
  return settled.result;
}

/**
 * Sets a session's capacity.
 *
 * Exists for the tests, which need a chamber that is genuinely full to prove
 * `FR-PAT-25` — and filling a forty-serial session one booking at a time would
 * take forty round trips to assert one refusal. Not exposed by any route: the
 * settings screen that will change capacity is a later step.
 */
export async function setCapacity(sessionId: string, capacity: number): Promise<void> {
  await sessionRepo.setCapacity(sessionId, capacity);
}

/**
 * Re-broadcasts a session's state after its roster changed.
 *
 * A booking is not a queue *event* — `queue_event_type` has no
 * `BOOKING_CREATED`, and the queue is `seed + events => state`
 * (`shared/domain/src/queue/state.ts`). So a new booking changes the seed
 * rather than the log, and every console watching needs telling.
 *
 * Without this a reception console would not see an online booking until its
 * next reload, which is exactly the "silently dropped" failure `FR-QUE-52`
 * exists to prevent.
 */
export async function broadcastRoster(sessionId: string): Promise<void> {
  const state = await getState(sessionId);
  const etas = await getEtas(sessionId);
  emit.queueUpdated(sessionId, { state, etas }, state.lastSeq, nowTs());
}

/**
 * The events a client missed, for the resume handshake (`SY-01`).
 *
 * A reconnecting socket says how far it got and receives what followed, in
 * order, before any live event reaches it — which is what makes a dropped
 * connection a non-event for a patient in a corridor with one bar of signal.
 */
export async function eventsSince(sessionId: string, afterSeq: number): Promise<QueueEvent[]> {
  return await eventRepo.listForSession(sessionId, afterSeq);
}

/**
 * Whether a patient or guest holds a booking in this session.
 *
 * The room check for a non-staff socket (BACKEND.md §6): a patient may listen
 * to a queue they are standing in and to no other. A tracking link is narrower
 * still — it names exactly one booking (`FR-GST-05`), so it is that booking
 * being in this session that admits them, not the guest identity behind it.
 */
export async function principalHoldsBooking(
  sessionId: string,
  who: {
    readonly userId: string | null;
    readonly guestId: string | null;
    readonly bookingId: string | null;
  },
): Promise<boolean> {
  return await bookingRepo.existsForPrincipal(sessionId, who);
}

/** The serial a walk-in should be given: one past the highest issued. */
export async function nextSerial(sessionId: string): Promise<number> {
  const state = await getState(sessionId);
  const highest = state.entries.reduce((max, entry) => Math.max(max, entry.serial), 0);
  return highest + 1;
}

/**
 * Creates the booking row a walk-in needs, inside the session lock.
 *
 * The serial is read and issued under the same lock every other queue action
 * takes, so two counters admitting walk-ins at the same moment cannot hand out
 * the same number. `bookings_session_serial_key` would reject the second
 * anyway — but a rejected insert at a counter is a receptionist apologising to
 * a patient, and the lock means it never gets that far.
 *
 * The booking exists before `WALKIN_ADDED` is appended, because the event
 * names it: an event referencing a booking that does not exist yet would fail
 * the foreign key, and the log must never contain a fact about nothing.
 */
export async function createWalkinBooking(input: {
  readonly sessionId: string;
  readonly patientId: string;
  readonly feePoisha: number;
  readonly staffUserId: string;
}): Promise<string> {
  return await withTransaction(async (trx) => {
    const session = await sessionRepo.lockForUpdate(trx, input.sessionId);
    if (session === null) throw notFound('session');

    const roster = await bookingRepo.rosterFor(input.sessionId, trx);
    const highest = roster.reduce((max, booking) => Math.max(max, booking.serial), 0);

    return await bookingRepo.insertWalkin(trx, {
      sessionId: input.sessionId,
      patientId: input.patientId,
      serial: highest + 1,
      feePoisha: input.feePoisha,
      createdByStaffId: input.staffUserId,
    });
  });
}

/** How many patients are still waiting, for the console's counters. */
export async function waitingCount(sessionId: string): Promise<number> {
  return waitingQueue(await getState(sessionId)).length;
}

function nowTs(): Timestamp {
  return time.fromDate(new Date());
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_FAILED', { details: { missing: key } });
  }
  return value;
}

function readNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number') {
    throw new AppError('VALIDATION_FAILED', { details: { missing: key } });
  }
  return value;
}
