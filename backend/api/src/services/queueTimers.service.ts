/**
 * What a queue does on the clock, with nobody tapping (`PRD.md` `FR-QUE-30`;
 * `BACKEND.md` §8 `offers.expire`; plan H1b).
 *
 * A freed chair is offered to somebody on the standby list for ten minutes.
 * When those are up the offer has lapsed in fact: the guard refuses it on the
 * clock (`canAcceptSlot`), so the chair is never given twice. But it lapsed
 * *in the log* only when somebody next read the chamber's standby list, and
 * until then reception's card went on showing the chair as on offer and the
 * patient's page went on showing an offer they could no longer take. A
 * chamber nobody was looking at kept a dead offer for the evening.
 *
 * This is the timer that was missing: every thirty seconds it finds the
 * chambers with an offer past its window and records the lapse, exactly as
 * the read does (`queue.service` `expireLapsedOffers`, which both now call).
 * Recording it is an event like any other, so the consoles and the patient's
 * page hear of it at once.
 *
 * It does not offer the chair on. A declined offer passes to the next person
 * by itself; a lapsed one returns the chair to reception, who offer it again.
 * That is how this version was built and tested, and whether a lapse should
 * pass on by itself too is the owner's to say (`docs/STATUS.md`, question 14).
 *
 * Runs as the server's own work (`system`), in this process: two processes
 * recording one lapse write one event, because the key is derived from the
 * offer (`expiryKey`).
 */

import { runInDbScope } from '../config/dbScope.js';
import { logger } from '../config/logger.js';
import * as standbyRepo from '../repositories/standby.repo.js';

import * as queueService from './queue.service.js';

/** How often lapsed offers are looked for (`BACKEND.md` §8: every 30 s). */
export const OFFER_TICK_MS = 30_000;

/**
 * Records every offer whose window has closed and that nothing has recorded
 * as ended. Returns how many it recorded.
 *
 * One chamber failing does not stop the rest: the next tick tries it again.
 */
export async function lapseDueOffers(): Promise<number> {
  const sessions = await standbyRepo.sessionsWithOverdueOffers(new Date());

  let lapsed = 0;
  for (const sessionId of sessions) {
    try {
      lapsed += await queueService.expireLapsedOffers(sessionId, {
        kind: 'system',
        job: 'offers_expire',
      });
    } catch (error: unknown) {
      logger.warn({ sessionId, err: error }, 'could not lapse offers; the next tick tries again');
    }
  }
  return lapsed;
}

/** Looks on an interval. Returns what stops it. */
export function startQueueTimers(): () => void {
  const run = (): void => {
    runInDbScope({ kind: 'system' }, lapseDueOffers)
      .then((lapsed) => {
        if (lapsed > 0) logger.info({ lapsed }, 'slot offers lapsed');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'looking for lapsed offers failed; the next tick tries again');
      });
  };
  const timer = setInterval(run, OFFER_TICK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
