/**
 * The API process's hourly jobs (BACKEND.md §8, the pilot's plain interval
 * until pg-boss is installed).
 *
 * - Chambers from schedules (`sessions.materialise`, step 22): today and the
 *   next seven days, at start-up and hourly. Switched by `SESSION_MATERIALISE`.
 * - Imported rows cleared 30 days after their batch closed (`FR-IMP-08`,
 *   step 24). Always on: it only ever removes what the requirement says must
 *   not be kept.
 * - The words of messages cleared after 90 days (DATABASE.md §8,
 *   `docs/PLATFORM_PLAN.md` 1.9). Always on, for the same reason.
 *
 * Each job fails on its own and is logged; the next hour tries again.
 */

import { logger } from '../config/logger.js';
import { env } from '../env.js';

import { purgeExpired } from './import.service.js';
import { clearExpiredBodies } from './notification.service.js';
import { MATERIALISE_INTERVAL_MS, materialise } from './sessionMaterialise.service.js';

export function startHourlyJobs(): () => void {
  const run = (): void => {
    if (env.SESSION_MATERIALISE) {
      materialise()
        .then((written) => {
          if (written > 0) logger.info({ written }, 'sessions materialised from schedules');
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'session materialisation failed; retrying next hour');
        });
    }
    purgeExpired()
      .then((batches) => {
        if (batches > 0) logger.info({ batches }, 'imported rows cleared after 30 days');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'clearing old imported rows failed; retrying next hour');
      });
    clearExpiredBodies()
      .then((messages) => {
        if (messages > 0) logger.info({ messages }, 'message text cleared after 90 days');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'clearing old message text failed; retrying next hour');
      });
  };
  run();
  const timer = setInterval(run, MATERIALISE_INTERVAL_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
