/**
 * A serial held for its payment, on the clock (plan H3; `PRD.md` `FR-PAY-08`,
 * `FR-PAY-10`; BACKEND.md §8).
 *
 * Every thirty seconds: each booking whose online payment's hold has run out
 * is dealt with (`payment.service` `expireHolds`): the provider is asked once
 * more, then the serial is turned to the counter or released. And attempts
 * that ran out within the last day are asked about again, each at most every
 * fifteen minutes, because a provider can complete after the patient has gone.
 *
 * Runs as the server's own work (`system`), in this process, and reports to
 * the heartbeat so `/readyz` says when it has stopped going through (plan I2).
 * Two processes dealing with one booking write one outcome: the work is done
 * under the booking's payment rows' locks and the release's key is the
 * booking's.
 */

import { logger } from '../config/logger.js';

import * as heartbeat from './heartbeat.service.js';
import { askAgainAfterExpiry, expireHolds } from './payment.service.js';

export const PAYMENT_TICK_MS = 30_000;

/** Looks on an interval. Returns what stops it. */
export function startPaymentTimers(): () => void {
  heartbeat.register('payments', PAYMENT_TICK_MS);
  const run = (): void => {
    const now = new Date();
    Promise.all([expireHolds(now), askAgainAfterExpiry(now)])
      .then(([expired, asked]) => {
        heartbeat.beat('payments', true);
        if (expired > 0 || asked > 0) logger.info({ expired, asked }, 'payment holds looked at');
      })
      .catch((error: unknown) => {
        heartbeat.beat('payments', false);
        logger.error({ err: error }, 'payment holds failed; the next tick tries again');
      });
  };
  const timer = setInterval(run, PAYMENT_TICK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
