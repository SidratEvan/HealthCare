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
 */

import { probeDatabase } from '../repositories/health.repo.js';

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
    };
  } catch {
    // The reason is logged by the query logger in config/db.ts. It is not
    // returned: a probe endpoint is unauthenticated, and a Postgres error
    // message describes the schema to whoever asks (BACKEND.md §9).
    return {
      status: 'degraded',
      checks: { database: { ok: false, latencyMs: null, schemaVersion: null } },
    };
  }
}
