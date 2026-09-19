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
 * ## What this file deliberately does not do yet
 *
 * Step 11 of §4.1 publishes notification jobs, and step 12 writes `audit_log`.
 * Neither is built: notifications are build step 11, and `audit_log` is
 * migration 0010 against a schema that stops at 0006. Both are seams, marked
 * below — the events they would fire on are already identified by
 * `isMaterialEvent` in the domain, so wiring them in later adds a call and
 * changes no logic here.
 */

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
  canAddWalkin,
  canCallNext,
  canDeclareDelay,
  canDeclareDoctorArrived,
  canDeclareLate,
  canMarkDone,
  canMarkNoShow,
  canPause,
  canReinstate,
  canReorder,
  canResume,
  id,
  time,
  DEFAULT_QUEUE_SETTINGS,
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

import { AppError, guardFailed, notFound } from '../errors/AppError.js';
import * as emit from '../realtime/emit.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as eventRepo from '../repositories/queueEvent.repo.js';
import * as stateRepo from '../repositories/queueState.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

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

  return await withTransaction(async (trx) => {
    // --- 5. Serialise ------------------------------------------------------
    const session = await lockSession(trx, input.sessionId);

    // --- 3. Load -----------------------------------------------------------
    const before = await loadState(trx, session);

    // --- 4, 6, 7. Validate, append, reduce ---------------------------------
    const applied = await applyOne(trx, session, before, input);

    // --- 8, 9, 10. Persist, recalculate, broadcast -------------------------
    return await settle(trx, session, applied.state, [applied.event]);
  });
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

  return await withTransaction(async (trx) => {
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
        state,
        etas: computeEtas(state, nowTs()),
        seq: state.lastSeq,
        duplicate: false,
        serverTs: nowTs(),
      };
    }

    return await settle(trx, session, state, events);
  });
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
): Promise<AppendEventResult> {
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

    // --- 11. Notify --------------------------------------------------------
    //
    // Not built: notifications are build step 11. The events that would fire
    // one are already identified by the domain, so this is a call to add and
    // not a decision to make.
    void isMaterialEvent(event.type);

    // --- 12. Audit ---------------------------------------------------------
    //
    // Not built: `audit_log` is migration 0010 and the schema stops at 0006.
    // The actor is already on the event row, so the log is attributable in the
    // meantime (`FR-QUE-04`).
  }

  // --- 13. Return ----------------------------------------------------------
  return { state, etas, seq: last.seq, duplicate: false, serverTs: last.serverTs };
}

/** The stored result of an event already applied (`FR-QUE-51`, `SY-02`). */
async function findReplay(clientEventId: string | null): Promise<AppendEventResult | null> {
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
  return await withTransaction(async (trx) => {
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
        outcomes,
        state,
        etas,
        seq: state.lastSeq,
        serverTs: nowTs(),
      };
    }

    const settled = await settle(trx, session, state, applied);
    return {
      outcomes,
      state: settled.state,
      etas: settled.etas,
      seq: settled.seq,
      serverTs: settled.serverTs,
    };
  });
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
