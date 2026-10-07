/**
 * Liveness and readiness (BACKEND.md §12: "health /healthz, readiness
 * /readyz").
 *
 * The distinction is not cosmetic. Render restarts a container that fails
 * liveness and takes one that fails readiness out of rotation, so conflating
 * them turns a brief database blip into a restart loop that guarantees an
 * outage instead of riding one out.
 *
 *   liveness   is this process able to answer at all
 *   readiness  should traffic be sent to it right now
 *
 * Readiness also says how the deployment is doing besides (plan I2,
 * `shared/domain` `org/deployment`): the last backup, the messages due and
 * unsent, and the work on a clock. None of it changes the answer to "should
 * traffic be sent here". What is wrong is in `signals.attention`, for a
 * monitor to read.
 */

import {
  deploymentSignals,
  timestamp,
  type BackupRun,
  type DeploymentSignals,
} from '@platform/domain';

import { runInDbScope } from '../config/dbScope.js';
import { env } from '../env.js';
import {
  deploymentFigures,
  probeDatabase,
  type BackupRunRow,
} from '../repositories/health.repo.js';

import * as heartbeat from './heartbeat.service.js';

export interface Liveness {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
}

export interface Readiness {
  readonly status: 'ready' | 'degraded';
  readonly checks: {
    readonly database: {
      readonly ok: boolean;
      readonly latencyMs: number | null;
      readonly schemaVersion: string | null;
    };
  };
  /**
   * How the deployment is doing besides; `null` when it could not be read
   * (the database is down, or behind on migrations).
   */
  readonly signals: DeploymentSignals | null;
}

const startedAt = Date.now();

export function liveness(): Liveness {
  return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) };
}

/**
 * Checks everything traffic depends on.
 *
 * A failed probe is reported, never thrown: the answer to "are you ready" is
 * "no, and here is why", which is the same honesty the product owes a patient
 * about a stale bed count (PRD.md §3.2).
 */
export async function readiness(): Promise<Readiness> {
  try {
    const probe = await probeDatabase();
    return {
      status: 'ready',
      checks: {
        database: {
          ok: probe.reachable,
          latencyMs: probe.latencyMs,
          schemaVersion: probe.schemaVersion,
        },
      },
      signals: await signals(),
    };
  } catch {
    // The reason is logged by the query logger in config/db.ts. It is not
    // returned: a probe endpoint is unauthenticated, and a Postgres error
    // message describes the schema to whoever asks (BACKEND.md §9).
    return {
      status: 'degraded',
      checks: { database: { ok: false, latencyMs: null, schemaVersion: null } },
      signals: null,
    };
  }
}

function asRun(row: BackupRunRow | null): BackupRun | null {
  return row === null
    ? null
    : {
        result: row.result,
        finishedAt: timestamp(row.finishedAt.toISOString()),
        verified: row.verified,
      };
}

/**
 * The deployment's signals. A failure to read them is logged by the query
 * logger and answered with `null`: it says nothing about whether traffic may
 * be sent here, which the database probe has already answered.
 */
async function signals(): Promise<DeploymentSignals | null> {
  try {
    const figures = await runInDbScope({ kind: 'system' }, deploymentFigures);
    return deploymentSignals({
      now: timestamp(new Date().toISOString()),
      startedAt: timestamp(new Date(startedAt).toISOString()),
      backup: {
        maxAgeHours: env.BACKUP_MAX_AGE_HOURS ?? null,
        last: asRun(figures.lastBackup),
        lastOk: asRun(figures.lastGoodBackup),
      },
      messages: {
        due: figures.messagesDue,
        oldestDueAt:
          figures.oldestDueAt === null ? null : timestamp(figures.oldestDueAt.toISOString()),
      },
      workers: heartbeat.snapshot(),
    });
  } catch {
    return null;
  }
}
