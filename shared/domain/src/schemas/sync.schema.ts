/**
 * Request shapes for the offline sync protocol (BACKEND.md §5).
 *
 * Shared by both sides for the same reason the queue schemas are: the console
 * builds its local queue out of these types and the API validates with them,
 * so a console cannot construct a batch the server would reject — which it
 * would otherwise discover at the end of a shift, holding fifty queued actions
 * that cannot be replayed.
 */

import { z } from 'zod';

import { QUEUE_EVENT_TYPES } from '../types/enums.js';

/** A UUID as it arrives on the wire, before it is branded. */
const uuid = z.string().uuid();

/**
 * How many events one batch may carry.
 *
 * A console offline for a whole shift accumulates a few hundred at most — a
 * receptionist acts perhaps twice a minute. Five hundred is generous for that
 * and small enough that one batch cannot hold the session lock long enough to
 * block every other counter in the hospital.
 */
export const MAX_BATCH_SIZE = 500;

/**
 * One queued event, as the console recorded it.
 *
 * `clientEventId` is mandatory here, unlike in the online queue commands where
 * it is optional. An event with no key cannot be replayed safely (`SY-02`), and
 * replay is the entire purpose of this endpoint.
 */
export const syncEntry = z.object({
  clientEventId: uuid,
  type: z.enum(QUEUE_EVENT_TYPES),
  payload: z.record(z.string(), z.unknown()).default({}),
  /**
   * The console's own clock. Orders the batch within itself and nothing more
   * (`SY-01`) — it may be hours stale after an offline shift, and the server
   * clock always decides the actual sequence.
   */
  clientTs: z.string().datetime({ offset: true }).nullable().default(null),
});

/** `POST /sync/events`. */
export const syncBatchBody = z.object({
  sessionId: uuid,
  events: z.array(syncEntry).min(1).max(MAX_BATCH_SIZE),
});

/** `GET /sync/session/:id?sinceSeq=&lastSyncedAt=`. */
export const syncPullQuery = z.object({
  sinceSeq: z.coerce.number().int().nonnegative().default(0),
  /**
   * When the device last heard from the server. Optional because a console
   * that has never synced does not have one — and not having one is itself a
   * reason to force a full re-pull (`SY-06`).
   */
  lastSyncedAt: z.string().datetime({ offset: true }).optional(),
});

export const syncParams = z.object({ id: uuid });

export type SyncEntry = z.infer<typeof syncEntry>;
export type SyncBatchBody = z.infer<typeof syncBatchBody>;
export type SyncPullQuery = z.infer<typeof syncPullQuery>;
