/**
 * The ER console's offline outbox (`FR-OFF-01`, `S-B-07`).
 *
 * `FR-OFF-01` names the emergency console alongside reception and the ward:
 * "full read and write capability without internet". An ER whose wifi drops
 * keeps triaging, keeps registering walk-ins and keeps switching capabilities,
 * and all of it reaches the server, in order, when the connection returns.
 *
 * The protocol is `outbox.ts`, the one the ward board uses. What differs is
 * the entry: an ER action names a method as well as a route (`PATCH` for a
 * case, `PUT` for capabilities, `POST` for the rest), and what the console
 * draws before the server answers is a case (`applyLocalCase`) or, for a
 * walk-in, a provisional one with no token yet.
 *
 * ## What a replay relies on
 *
 * An ER case has no event log to deduplicate against. A walk-in's
 * `clientEventId` becomes the case's `idempotency_key`, unique in the table;
 * every other action is answered as a replay when its outcome is already the
 * case (`alreadyApplied` in `shared/domain`). Either way, sending twice is
 * safe.
 *
 * Referrals (`FR-EMG-07..09`) ride the same outbox, in the same order as
 * everything else: a referral sent from a case must not reach the server
 * before the walk-in that created the case. A send's `clientEventId` becomes
 * the referral's `idempotency_key`; every later step is a replay when its
 * outcome is already the referral's (`referralAlreadyApplied`).
 *
 * ## What cannot happen offline
 *
 * An inbound alert cannot *arrive* offline — it comes over the socket — and
 * the console says so. Reading a caller's number needs the connection too,
 * because that read is audited (`DB-P7`).
 */

import type {
  EmergencyCaseView,
  LocalEmergencyChange,
  LocalReferralChange,
  ReferralSide,
  ReferralView,
} from '@platform/domain';

import {
  Outbox,
  createMemoryOutboxStore,
  type FlushOutcome,
  type OutboxEntry,
  type OutboxStore,
  type SendOutcome,
} from './outbox.js';

/** One ER action, taken locally, waiting to reach the server. */
export interface PendingErAction extends OutboxEntry {
  readonly method: 'POST' | 'PATCH' | 'PUT';
  /** The route, e.g. `/emergency/cases/<id>`. */
  readonly path: string;
  /** The body, without the envelope — `clientEventId` and `clientTs` are added when sent. */
  readonly body: Record<string, unknown>;
  /** The case the action is about. Null for capabilities. */
  readonly caseId: string | null;
  /** What the console applies to that case before the server answers. */
  readonly change: LocalEmergencyChange | null;
  /**
   * A walk-in registered offline: the case as the console draws it until the
   * server gives it a token. Its id is the `clientEventId`.
   */
  readonly provisional: EmergencyCaseView | null;
  /** A referral step, as the console applies it before the server answers. */
  readonly referralChange: {
    readonly change: LocalReferralChange;
    readonly side: ReferralSide;
  } | null;
  /** A referral sent offline, as the console draws it until the server has it. */
  readonly provisionalReferral: ReferralView | null;
}

export type ErActionStore = OutboxStore<PendingErAction>;
export type ErSendOutcome = SendOutcome;
export type ErSender = (action: PendingErAction) => Promise<ErSendOutcome>;
export type ErFlushOutcome = FlushOutcome;

/** In memory, as the other two consoles' outboxes are today (`docs/STATUS.md`, decision 37). */
export function createMemoryErStore(): ErActionStore {
  return createMemoryOutboxStore<PendingErAction>();
}

export class ErOutbox extends Outbox<PendingErAction> {}
