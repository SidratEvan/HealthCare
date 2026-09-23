/**
 * `(state, event) => state`. The core function of the product.
 *
 * This is the one definition of what a queue event *means*. The API imports it
 * to derive state after an append; the console imports the same code to apply
 * an action optimistically before the server has answered (FRONTEND.md §11.1).
 * Because both run this exact function over the same log, they cannot disagree
 * about the queue — which is the whole of FR-QUE-05 and the reason this file
 * may never be reimplemented in SQL, in a route, or in a client (CLAUDE.md §7).
 *
 * Three properties are non-negotiable, and all three are tested:
 *
 *   Pure. No clock, no randomness, no I/O — lint forbids all three in this
 *   directory. Every instant comes from the event's own `serverTs`, so the
 *   same log replayed a year later produces the same state.
 *
 *   Total. Every one of the 19 event types is handled. The switch is checked
 *   for exhaustiveness, so a new type cannot be added without a decision being
 *   made here about what it does.
 *
 *   Non-throwing. A log that references an unknown booking records an anomaly
 *   and carries on. A receptionist with a full waiting room cannot use a
 *   console that refuses to load a session, and a queue that is visibly wrong
 *   is far safer than one that is invisibly wrong (PRD.md §3.2).
 *
 * Guards live in `rules.ts` and are the caller's business, not the reducer's.
 * The reducer records what happened; it does not re-litigate whether it should
 * have. An event already in the log is a fact, and a fact that a guard would
 * now refuse still has to fold into the state the same way it did at the time.
 */

import { differenceInSeconds } from '../util/time.js';

import { observeConsult } from './rate.js';
import {
  findEntry,
  nowServing,
  type QueueAnomaly,
  type QueueEntry,
  type QueueState,
  type SlotOfferState,
} from './state.js';

import type { BookingStatus } from '../types/enums.js';
import type { QueueEvent } from '../types/events.js';
import type { BookingId, QueueEventId, Timestamp } from '../types/ids.js';

/**
 * Folds one event into the state.
 *
 * Applying events one at a time is correct for everything except undo: a fold
 * cannot un-apply an event it has already consumed. `ACTION_UNDONE` therefore
 * only records the compensated id here, and `replay()` — which sees the whole
 * log before folding any of it — is what actually nets the pair out. The
 * console applies `reduce` optimistically and rebuilds through `replay` after
 * an undo, which is cheap for a session's worth of events.
 */
export function reduce(state: QueueState, event: QueueEvent): QueueState {
  // Already accounted for. `seq` is a database sequence with a unique
  // (session_id, seq) index, so within a session it strictly increases with
  // insertion: an event at or below the cursor is one this state has seen, not
  // a new fact arriving late.
  //
  // Skipping it is what makes the fold idempotent, and idempotence is not a
  // nicety here. A console applies an action optimistically and then receives
  // the server's echo of the same event on the session channel; a reconnecting
  // socket replays from a sequence number and may overlap; an offline batch is
  // re-sent after a dropped response. Without this, each of those doubles a
  // declared delay or moves a reordered patient twice (FR-QUE-51, SY-02).
  if (state.lastSeq > 0 && event.seq <= state.lastSeq) {
    return state;
  }

  // An event compensated by a later ACTION_UNDONE never happened (GR-02).
  if (state.undoneEventIds.includes(event.id)) {
    return advance(state, event);
  }

  switch (event.type) {
    case 'SESSION_OPENED':
      return advance(
        {
          ...state,
          openedAt: state.openedAt ?? event.serverTs,
          status: state.status === 'scheduled' ? 'scheduled' : state.status,
        },
        event,
      );

    case 'DOCTOR_ARRIVED':
      return advance(
        {
          ...state,
          doctorArrivedAt: event.payload.arrivedAt,
          // The session is only "running" once someone is actually in the
          // chamber to run it (sessions_running_has_started).
          status: state.status === 'scheduled' ? 'running' : state.status,
        },
        event,
      );

    case 'DELAY_DECLARED':
      return advance(
        { ...state, delayMinutes: state.delayMinutes + Math.max(0, event.payload.minutes) },
        event,
      );

    case 'SESSION_PAUSED':
      return advance({ ...state, status: 'paused', pausedAt: event.serverTs }, event);

    case 'SESSION_RESUMED': {
      const paused = state.pausedAt;
      return advance(
        {
          ...state,
          status: state.doctorArrivedAt === null ? 'scheduled' : 'running',
          pausedAt: null,
          pausedSeconds:
            paused === null
              ? state.pausedSeconds
              : state.pausedSeconds + Math.max(0, differenceInSeconds(event.serverTs, paused)),
        },
        event,
      );
    }

    case 'PATIENT_CALLED':
      return reduceCalled(state, event);

    case 'PATIENT_DONE':
      return reduceDone(state, event);

    case 'PATIENT_LATE':
      return reduceLate(state, event);

    case 'PATIENT_NO_SHOW':
      return reduceNoShow(state, event);

    case 'PATIENT_REINSERTED':
      return reduceReinserted(state, event);

    case 'PATIENT_ARRIVED':
      return reduceArrived(state, event);

    case 'WALKIN_ADDED':
      return reduceWalkin(state, event);

    case 'BOOKING_CANCELLED':
      return reduceCancelled(state, event);

    case 'SLOT_OFFERED':
      return advance(
        {
          ...state,
          offers: [
            ...state.offers,
            {
              offerId: event.payload.offerId,
              freedBookingId: event.payload.freedBookingId,
              offeredTo: event.payload.offeredTo,
              offeredAt: event.serverTs,
              expiresAt: event.payload.expiresAt,
              outcome: 'pending',
              acceptedBookingId: null,
            },
          ],
        },
        event,
      );

    case 'SLOT_ACCEPTED':
      return reduceSlotAccepted(state, event);

    case 'SLOT_EXPIRED':
      return reduceSlotOutcome(state, event, event.payload.offerId, 'expired', null);

    case 'PRIORITY_REORDERED':
      return reduceReordered(state, event);

    case 'SESSION_ENDED':
      return advance({ ...state, status: 'ended', endedAt: event.serverTs, pausedAt: null }, event);

    case 'ACTION_UNDONE':
      return advance(
        {
          ...state,
          undoneEventIds: insertSorted(state.undoneEventIds, event.payload.undoneEventId),
        },
        event,
      );
  }
}

// ---------------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------------

function reduceCalled(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'PATIENT_CALLED' }>,
): QueueState {
  const { bookingId } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  // FR-QUE-53: the server serialises calls so only one patient is "now
  // serving". If the log says otherwise, the earlier occupant is recorded as
  // having left the chamber and the anomaly is surfaced — the alternative is a
  // state with two people in one room, which no console can render honestly.
  const serving = nowServing(state);
  const displaced =
    serving !== null && serving.bookingId !== bookingId
      ? withAnomaly(
          state,
          event,
          'DUPLICATE_CALL',
          serving.bookingId,
          `Serial ${String(serving.serial)} was still in the chamber when serial ${String(entry.serial)} was called.`,
        )
      : state;

  return advance(
    mapEntries(displaced, (current) => {
      if (current.bookingId === bookingId) {
        return { ...current, status: 'in_chamber', calledAt: event.serverTs };
      }
      if (current.status === 'in_chamber') {
        return { ...current, status: 'waiting' };
      }
      return current;
    }),
    event,
  );
}

function reduceDone(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'PATIENT_DONE' }>,
): QueueState {
  const { bookingId, consultSeconds } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  const next = mapEntries(state, (current) =>
    current.bookingId === bookingId
      ? {
          ...current,
          status: 'done' satisfies BookingStatus,
          doneAt: event.serverTs,
          consultSeconds,
          late: null,
        }
      : current,
  );

  // The measured duration is what moves every downstream ETA (FR-QUE-12).
  return advance({ ...next, rate: observeConsult(state.rate, consultSeconds) }, event);
}

function reduceLate(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'PATIENT_LATE' }>,
): QueueState {
  const { bookingId, expectedMinutes, reinsertAfter } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  const marked = mapEntries(state, (current) =>
    current.bookingId === bookingId
      ? {
          ...current,
          status: 'late' satisfies BookingStatus,
          late: { declaredAt: event.serverTs, expectedMinutes, reinsertAfter },
        }
      : current,
  );

  // FR-QUE-21: re-inserted after k patients, never dropped. The move happens
  // here rather than in a later event, because a late patient who stayed at
  // the front of the queue would block the patients behind them.
  return advance(moveAfterActivePatients(marked, bookingId, reinsertAfter), event);
}

function reduceNoShow(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'PATIENT_NO_SHOW' }>,
): QueueState {
  const { bookingId, graceUsedMinutes } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  return advance(
    mapEntries(state, (current) =>
      current.bookingId === bookingId
        ? {
            ...current,
            status: 'no_show' satisfies BookingStatus,
            noShow: { markedAt: event.serverTs, graceUsedMinutes },
            late: null,
          }
        : current,
    ),
    event,
  );
}

function reduceReinserted(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'PATIENT_REINSERTED' }>,
): QueueState {
  const { bookingId, newPosition } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  const restored = mapEntries(state, (current) =>
    current.bookingId === bookingId
      ? { ...current, status: 'waiting' satisfies BookingStatus, noShow: null, late: null }
      : current,
  );

  return advance(moveToActiveIndex(restored, bookingId, newPosition), event);
}

/**
 * The patient is at the counter (`FR-REC-18`).
 *
 * A booked or late patient becomes `waiting` — present, in the queue — and a
 * late one keeps the place the lateness moved them to: arriving does not jump
 * anybody. Nothing else about the order changes, because a check-in is a fact
 * about where somebody is, not a claim on a turn.
 *
 * The first arrival stands. Two consoles checking one patient in, one of them
 * offline, would otherwise move the recorded arrival to whichever synced last,
 * and `FR-ADM-01` measures the wait from it.
 */
function reduceArrived(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'PATIENT_ARRIVED' }>,
): QueueState {
  const { bookingId, quotedWaitMinutes } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  return advance(
    mapEntries(state, (current) => {
      if (current.bookingId !== bookingId || current.arrivedAt !== null) return current;

      const present = current.status === 'booked' || current.status === 'late';
      return {
        ...current,
        status: present ? ('waiting' satisfies BookingStatus) : current.status,
        late: present ? null : current.late,
        arrivedAt: event.serverTs,
        quotedWaitMinutes,
      };
    }),
    event,
  );
}

function reduceWalkin(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'WALKIN_ADDED' }>,
): QueueState {
  const { bookingId, position, index } = event.payload;
  const entry = findEntry(state, bookingId);

  // The booking row is created in the same transaction as this event, so a
  // seed read afterwards always contains it. A seed read a moment earlier will
  // not, and that is a stale snapshot rather than a corrupt log — say so, and
  // let the caller reload (FR-QUE-52).
  if (entry === null) {
    return withAnomaly(
      state,
      event,
      'UNKNOWN_BOOKING',
      bookingId,
      'A walk-in was added that is not in this roster. Reload the session.',
    );
  }

  const admitted = mapEntries(state, (current) =>
    current.bookingId === bookingId
      ? { ...current, status: 'waiting' satisfies BookingStatus, arrivedAt: event.serverTs }
      : current,
  );

  if (position === 'end' || index === null) {
    return advance(moveToEnd(admitted, bookingId), event);
  }
  return advance(moveToActiveIndex(admitted, bookingId, index), event);
}

function reduceCancelled(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'BOOKING_CANCELLED' }>,
): QueueState {
  const { bookingId, reason } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  return advance(
    mapEntries(state, (current) =>
      current.bookingId === bookingId
        ? {
            ...current,
            status: 'cancelled' satisfies BookingStatus,
            late: null,
            // Kept on the entry, not only on the event: the booking row is
            // written from this state and `cancelled_reason` is NOT NULL for a
            // cancelled row (DATABASE.md §2.3).
            cancelled: { cancelledAt: event.serverTs, reason },
          }
        : current,
    ),
    event,
  );
}

function reduceSlotAccepted(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'SLOT_ACCEPTED' }>,
): QueueState {
  const { offerId, newBookingId } = event.payload;

  const withOutcome = reduceSlotOutcome(state, event, offerId, 'accepted', newBookingId);

  // The accepting patient's booking arrives through the roster, like any other.
  const entry = findEntry(withOutcome, newBookingId);
  if (entry === null) {
    return withAnomaly(
      withOutcome,
      event,
      'UNKNOWN_BOOKING',
      newBookingId,
      'A slot was accepted by a booking that is not in this roster. Reload the session.',
      false,
    );
  }

  return mapEntries(withOutcome, (current) =>
    current.bookingId === newBookingId
      ? { ...current, status: 'waiting' satisfies BookingStatus }
      : current,
  );
}

function reduceSlotOutcome(
  state: QueueState,
  event: QueueEvent,
  offerId: SlotOfferState['offerId'],
  outcome: SlotOfferState['outcome'],
  acceptedBookingId: BookingId | null,
): QueueState {
  const known = state.offers.some((offer) => offer.offerId === offerId);
  const base = known
    ? state
    : withAnomaly(
        state,
        event,
        'UNKNOWN_OFFER',
        null,
        `Offer ${String(offerId)} was resolved but never made.`,
        false,
      );

  return advance(
    {
      ...base,
      offers: base.offers.map((offer) =>
        // Only a pending offer can be resolved; an already-answered offer is
        // left alone so a late expiry cannot overwrite an acceptance.
        offer.offerId === offerId && offer.outcome === 'pending'
          ? { ...offer, outcome, acceptedBookingId }
          : offer,
      ),
    },
    event,
  );
}

function reduceReordered(
  state: QueueState,
  event: Extract<QueueEvent, { type: 'PRIORITY_REORDERED' }>,
): QueueState {
  const { bookingId, toIndex, reason } = event.payload;
  const entry = findEntry(state, bookingId);
  if (entry === null) return withAnomaly(state, event, 'UNKNOWN_BOOKING', bookingId);

  const marked = mapEntries(state, (current) =>
    current.bookingId === bookingId
      ? { ...current, priority: { movedAt: event.serverTs, reason } }
      : current,
  );

  return advance(moveToActiveIndex(marked, bookingId, toIndex), event);
}

// ---------------------------------------------------------------------------
// Ordering helpers
//
// `entries` holds settled rows as well as waiting ones, because the console
// shows the whole session (APP_FLOW.md B1.4). Positions quoted by events are
// positions in the *active* queue — what a person means by "third in line" —
// so these helpers translate between the two.
// ---------------------------------------------------------------------------

function isActive(entry: QueueEntry): boolean {
  return (
    entry.status === 'booked' ||
    entry.status === 'waiting' ||
    entry.status === 'in_chamber' ||
    entry.status === 'late'
  );
}

/** Moves an entry to a position counted in active-queue terms. */
function moveToActiveIndex(
  state: QueueState,
  bookingId: BookingId,
  activeIndex: number,
): QueueState {
  const from = state.entries.findIndex((entry) => entry.bookingId === bookingId);
  if (from === -1) return state;

  const moving = state.entries[from];
  if (moving === undefined) return state;

  const without = [...state.entries.slice(0, from), ...state.entries.slice(from + 1)];
  const target = Math.max(0, Math.min(activeIndex, countActive(without)));

  let active = 0;
  let insertAt = without.length;
  for (let index = 0; index < without.length; index += 1) {
    const candidate = without[index];
    if (candidate !== undefined && isActive(candidate)) {
      if (active === target) {
        insertAt = index;
        break;
      }
      active += 1;
    }
  }

  return {
    ...state,
    entries: [...without.slice(0, insertAt), moving, ...without.slice(insertAt)],
  };
}

/**
 * Moves an entry to sit after `count` more active patients (FR-QUE-21).
 *
 * Counted from where the entry currently is, so a patient who declares
 * lateness from the front of the queue is seen after the next three patients
 * — not three from the back of a forty-person session.
 */
function moveAfterActivePatients(
  state: QueueState,
  bookingId: BookingId,
  count: number,
): QueueState {
  const activeEntries = state.entries.filter(isActive);
  const currentActiveIndex = activeEntries.findIndex((entry) => entry.bookingId === bookingId);
  const from = currentActiveIndex === -1 ? 0 : currentActiveIndex;
  return moveToActiveIndex(state, bookingId, from + Math.max(1, count));
}

function moveToEnd(state: QueueState, bookingId: BookingId): QueueState {
  return moveToActiveIndex(state, bookingId, Number.MAX_SAFE_INTEGER);
}

function countActive(entries: readonly QueueEntry[]): number {
  return entries.filter(isActive).length;
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

function mapEntries(state: QueueState, map: (entry: QueueEntry) => QueueEntry): QueueState {
  return { ...state, entries: state.entries.map(map) };
}

/**
 * Records that the state now includes this event.
 *
 * The cursor only moves forward. Events reach this point in ascending `seq`
 * order — `replay` sorts, and anything at or below the cursor was skipped
 * before the switch — so this is a step, not a max.
 */
function advance(state: QueueState, event: QueueEvent): QueueState {
  return {
    ...state,
    lastSeq: Math.max(state.lastSeq, event.seq),
    lastEventAt: laterOf(state.lastEventAt, event.serverTs),
  };
}

function laterOf(current: Timestamp | null, candidate: Timestamp): Timestamp {
  if (current === null) return candidate;
  return candidate > current ? candidate : current;
}

function withAnomaly(
  state: QueueState,
  event: QueueEvent,
  code: QueueAnomaly['code'],
  bookingId: BookingId | null,
  detail?: string,
  thenAdvance = true,
): QueueState {
  const anomaly: QueueAnomaly = {
    code,
    eventId: event.id,
    seq: event.seq,
    detail:
      detail ??
      `${event.type} referenced booking ${String(bookingId)}, which is not in this session's roster.`,
  };

  const next: QueueState = { ...state, anomalies: [...state.anomalies, anomaly] };
  return thenAdvance ? advance(next, event) : next;
}

/** Keeps the undone-id list sorted, so two equal states compare equal. */
function insertSorted(ids: readonly QueueEventId[], id: QueueEventId): readonly QueueEventId[] {
  if (ids.includes(id)) return ids;
  return [...ids, id].sort();
}
