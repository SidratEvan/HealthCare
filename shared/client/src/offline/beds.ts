/**
 * The ward console's offline outbox (`FR-OFF-01`, FRONTEND.md §11.1).
 *
 * "Reception, ward, and emergency consoles are offline-first: full read and
 * write capability without internet, with visible offline status and
 * pending-sync count." Step 8 built that for the queue; this is the same
 * promise for beds.
 *
 * ## Why it is not the queue's outbox
 *
 * The queue's `OfflineQueue` is built around one session's log: it flushes a
 * session at a time, in one batch, to `/sync/push`, and its entries are queue
 * events. A bed action has no session and no batch endpoint — each one is its
 * own route (BACKEND.md §7.5), and each route is replay-safe on its own,
 * because `bed_events.client_event_id` is unique. So the ward's outbox sends
 * its entries one at a time, oldest first, to the route each names, and a
 * replayed admit comes back as the admit it already was (`SY-02`).
 *
 * The protocol itself — what a flush does with an accepted, a refused and an
 * unreachable action — lives in `outbox.ts`, shared with the ER console
 * (step 15), so the two consoles keep one set of rules.
 */

import type { LocalBedChange } from '@platform/domain';

import {
  Outbox,
  createMemoryOutboxStore,
  type FlushOutcome,
  type OutboxEntry,
  type OutboxStore,
  type SendOutcome,
} from './outbox.js';

/** One ward action, taken locally, waiting to reach the server. */
export interface PendingBedAction extends OutboxEntry {
  readonly bedId: string;
  /** The route, e.g. `/beds/<id>/admit`. */
  readonly path: string;
  /** The body, without the envelope — `clientEventId` and `clientTs` are added when sent. */
  readonly body: Record<string, unknown>;
  /** What the board applies before the server answers. Null for a change it cannot draw. */
  readonly change: LocalBedChange | null;
}

export type BedActionStore = OutboxStore<PendingBedAction>;
export type BedSendOutcome = SendOutcome;
export type BedSender = (action: PendingBedAction) => Promise<BedSendOutcome>;
export type BedFlushOutcome = FlushOutcome;

/** In memory, as the reception console's outbox is today. */
export function createMemoryBedStore(): BedActionStore {
  return createMemoryOutboxStore<PendingBedAction>();
}

export class BedOutbox extends Outbox<PendingBedAction> {}
