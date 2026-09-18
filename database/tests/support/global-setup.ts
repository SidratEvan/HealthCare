/**
 * Builds the schema suite's database once per `pnpm test` run.
 *
 * The public schema is dropped and every migration applied from scratch, which
 * is the claim step 1 has to prove: the schema applies clean on a *fresh*
 * database, not merely on the one that happens to be on this machine. The demo
 * seed follows, because every test runs against seeded demo data (CLAUDE.md §6).
 *
 * Individual tests then isolate themselves in a transaction they roll back
 * (see `withRollback`), which is the only workable cleanup for an append-only
 * table: rows in `queue_events` cannot be deleted by design.
 *
 * The API suite builds its own database; see `build.ts` for why.
 */

import { resolveTestDatabaseUrl } from '../../scripts/lib/env.js';

import { buildTestDatabase } from './build.js';

export default async function setup(): Promise<void> {
  await buildTestDatabase(resolveTestDatabaseUrl(), 'schema test');
}
