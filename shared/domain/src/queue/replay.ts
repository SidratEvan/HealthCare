/**
 * `events[] => state`, and the canonical way to derive a queue.
 *
 * This is the function that settles arguments. When a patient says they were
 * skipped, or two counters disagree about who is next, or a console comes back
 * from eight hours offline, the answer is: replay the log and look
 * (FR-QUE-02, FR-QUE-05).
 *
 * `reduce` folds one event. `replay` folds all of them, and does the one thing
 * a fold cannot: it sees the whole log before consuming any of it, so an
 * `ACTION_UNDONE` at the end can suppress the event it compensates at the
 * beginning. That pre-pass is why undo is a true no-op rather than an
 * approximate inverse (GR-02: history is never deleted, only netted out).
 */

import { reduce } from './reducer.js';
import { emptyState, type QueueSeed, type QueueState } from './state.js';

import type { QueueEvent } from '../types/events.js';
import type { QueueEventId } from '../types/ids.js';

/**
 * Derives a session's queue from its seed and its complete event log.
 *
 * Events are sorted by `seq` first: the server's sequence is authoritative, and
 * a batch that arrived from an offline console in client-timestamp order must
 * not be folded in that order (SY-01).
 */
export function replay(seed: QueueSeed, events: readonly QueueEvent[]): QueueState {
  return continueReplay(emptyState(seed), events);
}

/**
 * Folds further events onto an existing state.
 *
 * The live path: `getState` reads the cached `queue_state`, then applies the
 * events after `rebuilt_from_seq` — usually none, occasionally a handful
 * (BACKEND.md §4.1 step 3, §4.2).
 *
 * The undo pre-pass runs over `events` only. An `ACTION_UNDONE` in this batch
 * that compensates an event already folded into `state` cannot be honoured
 * here, because the fold has consumed it — so it is reported by
 * `needsFullRebuild`, and the caller replays from the seed instead.
 */
export function continueReplay(state: QueueState, events: readonly QueueEvent[]): QueueState {
  const ordered = orderEvents(events);
  const undone = collectUndoneIds(ordered);

  const seeded: QueueState =
    undone.length === 0
      ? state
      : { ...state, undoneEventIds: mergeSorted(state.undoneEventIds, undone) };

  return ordered.reduce(reduce, seeded);
}

/**
 * Whether a batch contains an undo of an event the given state has already
 * folded in, which means the cache cannot be advanced and must be rebuilt.
 *
 * Called by `queue.service.getState` before it decides between applying a
 * delta and a full replay.
 */
export function needsFullRebuild(state: QueueState, events: readonly QueueEvent[]): boolean {
  const idsInBatch = new Set(events.map((event) => event.id));

  return collectUndoneIds(events).some(
    (undoneId) =>
      // In the batch: the pre-pass suppresses it before folding, so a delta is
      // still correct.
      !idsInBatch.has(undoneId) &&
      // Already known to be undone: nothing new to account for.
      !state.undoneEventIds.includes(undoneId),
    // Anything else names an event this state folded in earlier, and a fold
    // cannot un-apply. Replay from the seed.
  );
}

/**
 * Sorts by the server's sequence, with event id as a total tie-break.
 *
 * `seq` is unique per session in the database, so ties only occur in tests and
 * in hand-built batches; breaking them deterministically means a shuffled
 * input still produces one canonical state, which is what the
 * replay-determinism property asserts.
 */
export function orderEvents(events: readonly QueueEvent[]): readonly QueueEvent[] {
  return [...events].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Ids compensated by an ACTION_UNDONE anywhere in the batch. */
function collectUndoneIds(events: readonly QueueEvent[]): readonly QueueEventId[] {
  const ids: QueueEventId[] = [];
  for (const event of events) {
    if (event.type === 'ACTION_UNDONE') ids.push(event.payload.undoneEventId);
  }
  return ids;
}

function mergeSorted(
  existing: readonly QueueEventId[],
  incoming: readonly QueueEventId[],
): readonly QueueEventId[] {
  const merged = new Set([...existing, ...incoming]);
  return [...merged].sort();
}

/**
 * Applies a batch and reports what the server made of it (SY-05).
 *
 * The response an offline console needs after a reconnect: which of its queued
 * events landed, and which lost to another counter and must be rolled back on
 * the device (SY-03).
 */
export interface BatchOutcome {
  readonly state: QueueState;
  readonly accepted: readonly { readonly clientEventId: string; readonly seq: number }[];
  readonly conflicts: readonly {
    readonly clientEventId: string;
    readonly reason: string;
  }[];
}

/**
 * Folds an offline batch and separates the events that took effect from the
 * ones the log could not make sense of.
 *
 * A conflict here is not a validation failure — the server has already
 * accepted the write — it is the reducer reporting that the event referenced
 * something that no longer holds, which is exactly what the device needs to
 * know to roll that row back rather than leaving a wrong queue on screen.
 */
export function applyBatch(state: QueueState, events: readonly QueueEvent[]): BatchOutcome {
  const before = state.anomalies.length;
  const next = continueReplay(state, events);
  const newAnomalies = next.anomalies.slice(before);

  const accepted: { clientEventId: string; seq: number }[] = [];
  const conflicts: { clientEventId: string; reason: string }[] = [];

  for (const event of orderEvents(events)) {
    if (event.clientEventId === null) continue;

    const anomaly = newAnomalies.find((candidate) => candidate.eventId === event.id);
    if (anomaly === undefined) {
      accepted.push({ clientEventId: event.clientEventId, seq: event.seq });
    } else {
      conflicts.push({ clientEventId: event.clientEventId, reason: anomaly.detail });
    }
  }

  return { state: next, accepted, conflicts };
}
