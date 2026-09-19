/**
 * The offline sync protocol (BACKEND.md §5).
 *
 * `queue.service` owns the log — the lock, the guards, the reducer. This owns
 * the *protocol* a console speaks when it comes back from being offline: what
 * order a batch is applied in, what the response looks like, and when a device
 * is too far behind to be caught up with a delta.
 *
 * ## The console is offline more than anyone expects
 *
 * This is not an edge case to be handled gracefully. Hospital wifi in Dhaka
 * drops for minutes at a time, and a reception counter cannot stop working
 * because the network did (`FR-OFF-01`). The console keeps taking actions into
 * a local queue and replays them when the signal returns, which is why every
 * rule below is about making a replay indistinguishable from having been
 * online the whole time.
 */

import { clampConsultSeconds, id, time } from '@platform/domain';
import type { Eta, QueueActor, QueueEvent, QueueState, Timestamp } from '@platform/domain';

import { validationFailed } from '../errors/AppError.js';

import * as queueService from './queue.service.js';

import type { BatchEntry, BatchResult } from './queue.service.js';

/**
 * How far behind a device may be and still be caught up with a delta
 * (`SY-06`).
 *
 * Past a day, the events are more numerous than the state they describe and
 * half of them concern sessions that have since ended. A full re-pull is both
 * cheaper and more likely to be correct.
 */
export const MAX_OFFLINE_HOURS = 24;

export interface PushResult {
  readonly accepted: readonly { readonly clientEventId: string; readonly seq: number }[];
  readonly conflicts: readonly {
    readonly clientEventId: string;
    readonly reason: string;
    readonly code: string;
  }[];
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  readonly seq: number;
  readonly serverTs: string;
}

/**
 * `POST /sync/events` — apply a console's queued batch.
 *
 * Returns the `SY-05` shape: `{ accepted, conflicts, state, etas }`. Both
 * lists are keyed by `clientEventId`, because that is the only identifier the
 * console has for an action it took while it had no server to ask.
 */
export async function pushBatch(input: {
  readonly sessionId: string;
  readonly actor: QueueActor;
  readonly entries: readonly BatchEntry[];
}): Promise<PushResult> {
  // `SY-01`: client timestamps order the batch *within itself* and nothing
  // more. Sorting here rather than trusting the array's order means a console
  // that queued events out of order — or a retry that reassembled them — still
  // replays them in the sequence the receptionist actually acted in.
  const ordered = [...input.entries].sort(byClientTimestamp);

  assertNoDuplicateKeys(ordered);

  const result: BatchResult = await queueService.appendBatch({
    sessionId: input.sessionId,
    actor: input.actor,
    entries: ordered.map(withPlausiblePayload),
  });

  const accepted: { clientEventId: string; seq: number }[] = [];
  const conflicts: { clientEventId: string; reason: string; code: string }[] = [];

  for (const outcome of result.outcomes) {
    if (outcome.kind === 'accepted') {
      accepted.push({ clientEventId: outcome.clientEventId, seq: outcome.seq });
    } else {
      conflicts.push({
        clientEventId: outcome.clientEventId,
        reason: outcome.reason,
        code: outcome.code,
      });
    }
  }

  return {
    accepted,
    conflicts,
    state: result.state,
    etas: result.etas,
    seq: result.seq,
    serverTs: result.serverTs,
  };
}

export interface PullResult {
  /** Events after `sinceSeq`, in log order. Empty when a re-pull is forced. */
  readonly events: readonly QueueEvent[];
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  readonly seq: number;
  readonly serverTs: string;
  /**
   * True when the device was too far behind for a delta (`SY-06`) and must
   * discard its local log and start from `state`.
   */
  readonly fullResync: boolean;
}

/**
 * `GET /sync/session/:id?sinceSeq=` — what the device missed.
 *
 * `SY-04` comes for free here rather than needing its own path: a booking made
 * online while the console was offline is a row in `bookings`, and the state
 * returned below is derived from the roster plus the log. So it arrives as a
 * new entry in the queue the moment the console pulls, and cannot be dropped.
 *
 * @param lastSyncedAt when the device last heard from the server, if it knows.
 *   Absent means it does not, which is itself a reason to re-pull.
 */
export async function pullSince(input: {
  readonly sessionId: string;
  readonly sinceSeq: number;
  readonly lastSyncedAt?: string | null;
}): Promise<PullResult> {
  const state = await queueService.getState(input.sessionId);
  const etas = await queueService.getEtas(input.sessionId);
  const serverTs = new Date().toISOString();

  const fullResync = requiresFullResync(input.sinceSeq, input.lastSyncedAt ?? null, serverTs);

  return {
    // Nothing is sent when a re-pull is forced: the events would be discarded
    // anyway, and sending a day of log to a device that must ignore it is the
    // opposite of what `SY-06` is for.
    events: fullResync ? [] : await queueService.eventsSince(input.sessionId, input.sinceSeq),
    state,
    etas,
    seq: state.lastSeq,
    serverTs,
    fullResync,
  };
}

/**
 * Whether the device must start over rather than take a delta (`SY-06`).
 *
 * Two ways to qualify: it has been away longer than a day, or it has never
 * synced at all. A device with `sinceSeq = 0` is asking for the whole log,
 * which is the same thing as a re-pull and is better served by the state.
 */
export function requiresFullResync(
  sinceSeq: number,
  lastSyncedAt: string | null,
  now: string,
): boolean {
  if (sinceSeq <= 0) return true;
  if (lastSyncedAt === null) return true;

  const hours = time.differenceInHours(id<Timestamp>(now), id<Timestamp>(lastSyncedAt));
  return hours >= MAX_OFFLINE_HOURS;
}

/**
 * Brings a client-supplied payload inside the bounds the schema enforces.
 *
 * This endpoint is the one place an arbitrary payload reaches the event log:
 * the online queue routes measure a consultation server-side, while a replayed
 * batch necessarily carries what the console measured hours earlier. A console
 * left with a patient marked in-chamber overnight reports a fourteen-hour
 * consultation, and `bookings_consult_seconds_plausible` refuses it — which
 * arrived as a 500 rather than as anything a client could act on.
 *
 * Clamping rather than rejecting is deliberate. The event is a real thing that
 * really happened; only the duration is implausible, and losing the whole
 * action because a receptionist forgot to tap "done" before going home would
 * be the worse failure. `clampConsultSeconds` is the domain's own bound, so
 * the console and the server agree on what plausible means.
 */
function withPlausiblePayload(entry: BatchEntry): BatchEntry {
  const measured = entry.payload['consultSeconds'];
  if (typeof measured !== 'number') return entry;

  return {
    ...entry,
    payload: { ...entry.payload, consultSeconds: clampConsultSeconds(measured) },
  };
}

/**
 * Orders a batch by the console's own clock (`SY-01`).
 *
 * An entry with no client timestamp sorts last rather than first: the console
 * stamps everything it queues, so a missing stamp means the entry came from
 * somewhere else, and "somewhere else" should not be able to insert itself
 * ahead of a receptionist's recorded sequence.
 *
 * `clientEventId` breaks a tie, so the order is total and two identical
 * batches replay identically — which is what makes `SY-02` testable rather
 * than merely true most of the time.
 */
function byClientTimestamp(a: BatchEntry, b: BatchEntry): number {
  if (a.clientTs === b.clientTs) return a.clientEventId < b.clientEventId ? -1 : 1;
  if (a.clientTs === null) return 1;
  if (b.clientTs === null) return -1;
  return a.clientTs < b.clientTs ? -1 : 1;
}

/**
 * Refuses a batch that names the same key twice.
 *
 * Within one batch a repeated `clientEventId` is not a replay — it is a
 * console that has lost track of its own queue. Applying the first and
 * silently reporting the second as accepted would tell it everything is fine
 * while one of its actions has vanished.
 */
function assertNoDuplicateKeys(entries: readonly BatchEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.clientEventId)) {
      throw validationFailed({
        field: 'events',
        reason: `clientEventId ${entry.clientEventId} appears twice in one batch.`,
      });
    }
    seen.add(entry.clientEventId);
  }
}
