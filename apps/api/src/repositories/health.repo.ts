/**
 * The only place SQL lives (CLAUDE.md §7, BACKEND.md §3).
 *
 * A readiness probe that does not touch the database is not a readiness probe:
 * the process can be listening and answering while the pool is exhausted or
 * the database is failing over, and a load balancer that only checks the port
 * will keep sending a receptionist's taps into a black hole.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

export interface DatabaseProbe {
  readonly reachable: boolean;
  readonly latencyMs: number;
  /** The migration the database is on, for the readiness payload. */
  readonly schemaVersion: string | null;
}

/**
 * Pings the database and reads the applied migration version.
 *
 * `SELECT 1` proves a connection can be had. The version comes from the same
 * round trip because a process running against a database that is behind on
 * migrations is a deployment mistake worth seeing in a probe response, and the
 * rollout rule depends on noticing it (BACKEND.md §12: migration, then API,
 * then clients — never reversed).
 */
export async function probeDatabase(): Promise<DatabaseProbe> {
  const startedAt = process.hrtime.bigint();

  const result = await sql<{ version: string | null }>`
    SELECT (SELECT max(version) FROM schema_migrations) AS version
  `.execute(db);

  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  return {
    reachable: true,
    latencyMs: Math.round(latencyMs),
    schemaVersion: result.rows[0]?.version ?? null,
  };
}
