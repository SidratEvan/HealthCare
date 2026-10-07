/**
 * When a message is tried again, when it is given up on, and when one held
 * overnight goes (`PRD.md` `FR-NOT-06`, `FR-NOT-07`; `BACKEND.md` §8; plan H1).
 *
 * Sending used to happen inside the request that caused the message: a queue
 * tap waited for a gateway, a gateway that refused once was never asked
 * again, and a report held back at night for quiet hours was never sent in
 * the morning. The sender that replaces that asks these three questions of
 * every message, and the answers are here, pure, so that they can be read and
 * tested without a database or a clock.
 *
 * ## Tried five times over about twenty minutes, then given up on, visibly
 *
 * A gateway that is down for a minute is the ordinary failure, and the second
 * try a quarter of a minute later catches it. One that is down for an evening
 * is not fixed by trying for an evening: a message about a queue is worth
 * nothing an hour late, and a patient told "your serial is called" at
 * midnight has been told a lie. So the tries stop, the row says `failed` with
 * what the gateway last said and how often it was asked, and the platform's
 * health view counts it (`FR-SUP-06`). Nothing is retried silently for ever.
 *
 * ## A held message goes at seven
 *
 * `FR-NOT-07`: "Quiet hours for non-urgent notifications." A message that is
 * not urgent and falls in quiet hours waits for their end, in Dhaka, and is
 * then sent like any other. It used to be recorded as skipped and never sent.
 */

import { toEpochMs, fromEpochMs } from '../util/time.js';

import type { Timestamp } from '../types/ids.js';

/** How often a message is tried before it is given up on. */
export const SEND_MAX_ATTEMPTS = 5;

/**
 * The wait before each further try, in seconds: after the first failure a
 * quarter of a minute, then one minute, five, fifteen.
 */
export const SEND_RETRY_SECONDS: readonly number[] = [15, 60, 300, 900];

/**
 * How long a try is given before the message is offered again.
 *
 * A sender that dies between taking a message and recording what became of
 * it leaves it claimed. After this long it is anybody's again. Longer than
 * any gateway call is allowed to take; short enough that a restart delays a
 * message by minutes, not an evening.
 */
export const SEND_CLAIM_SECONDS = 120;

/** Dhaka local hours during which a message that is not urgent waits (`FR-NOT-07`). */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;

/** Dhaka is UTC+6 the year round: no daylight saving to account for. */
const DHAKA_OFFSET_MS = 6 * 3_600_000;

export type AfterFailure =
  { readonly kind: 'retry'; readonly at: Timestamp } | { readonly kind: 'give_up' };

/**
 * What happens after a try that failed.
 *
 * @param attempts how many tries there have been, this one included.
 * @param retryable false where trying again cannot help: the gateway said the
 *   number does not exist, or there was nothing to send to.
 */
export function afterFailedSend(input: {
  readonly attempts: number;
  readonly now: Timestamp;
  readonly retryable: boolean;
}): AfterFailure {
  if (!input.retryable || input.attempts >= SEND_MAX_ATTEMPTS) return { kind: 'give_up' };

  const wait =
    SEND_RETRY_SECONDS[Math.max(0, input.attempts - 1)] ??
    SEND_RETRY_SECONDS[SEND_RETRY_SECONDS.length - 1] ??
    0;
  return { kind: 'retry', at: fromEpochMs(toEpochMs(input.now) + wait * 1_000) };
}

/** The hour of the day in Dhaka, 0 to 23. */
export function dhakaHour(at: Timestamp): number {
  return new Date(toEpochMs(at) + DHAKA_OFFSET_MS).getUTCHours();
}

/** Whether a moment falls in quiet hours, in Dhaka. */
export function inQuietHours(at: Timestamp): boolean {
  const hour = dhakaHour(at);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/**
 * When a message held for quiet hours goes: the next seven in the morning in
 * Dhaka. A moment outside quiet hours is its own answer.
 */
export function endOfQuietHours(at: Timestamp): Timestamp {
  if (!inQuietHours(at)) return at;

  const local = new Date(toEpochMs(at) + DHAKA_OFFSET_MS);
  const morning = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    // Before midnight the morning is tomorrow's; after it, today's.
    local.getUTCDate() + (local.getUTCHours() >= QUIET_FROM_HOUR ? 1 : 0),
    QUIET_UNTIL_HOUR,
  );
  return fromEpochMs(morning - DHAKA_OFFSET_MS);
}
