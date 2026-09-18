/**
 * The seed module contract and the runner that walks it.
 *
 * Two things earn a runner rather than an eight-line script:
 *
 * **Ordering is a fact about the data, not a convention.** A booking needs a
 * patient and a session; a session needs a chamber; a chamber needs a
 * department. The module list is that dependency order, written once.
 *
 * **Some modules cannot run yet, and must say so out loud.** `seed_05_beds`
 * writes `wards` and `beds`, which migration 0008 creates and the schema is at
 * 0006. The runner checks each module's tables before calling it and skips
 * with the migration name and the requirement that is consequently not
 * covered. That is honest degradation applied to our own tooling (`PRD.md`
 * §3.2): a demo missing its bed board should say which migration it is waiting
 * for, not quietly produce an empty ward screen.
 */

import type { Timestamp } from '@platform/domain';

import { tableExists } from './insert.js';
import { type Rng } from './random.js';

import type { Client } from 'pg';

export interface SeedContext {
  readonly client: Client;
  /**
   * One instant for the whole run. Every relative timestamp — a session's
   * planned start, a past visit's date, the freshness of a capability row — is
   * measured from this, so a reset is a coherent moment rather than a smear
   * across however long the run took.
   */
  readonly now: Timestamp;
  /** Seeded, so a reset produces a known state (`FR-DEM-06`). */
  readonly rng: Rng;
  readonly log: (message: string) => void;
}

/** Rows written, by table. Printed, and asserted on by the seed test. */
export type SeedSummary = Readonly<Record<string, number>>;

export interface SeedModule {
  /** The filename, without extension — what the log line names. */
  readonly name: string;
  /** One line, for the log. */
  readonly title: string;
  /** Requirement ids this module covers when it runs. */
  readonly requirements: readonly string[];
  /** Tables it writes. If one is absent the module is skipped, not failed. */
  readonly writes: readonly string[];
  /** The migration that will create `writes`. Required if any can be absent. */
  readonly pendingMigration?: string;
  /** Requirements that cannot be covered until that migration lands. */
  readonly deferred?: readonly string[];
  run(context: SeedContext): Promise<SeedSummary>;
}

export interface ModuleResult {
  readonly module: SeedModule;
  readonly ran: boolean;
  readonly summary: SeedSummary;
  /** Present when `ran` is false. */
  readonly skippedBecause?: string;
  readonly durationMs: number;
}

/**
 * Runs every module in order, skipping any whose tables do not exist yet.
 *
 * Not wrapped in a single transaction. A seed run writes a few thousand rows
 * over a pooled connection to a hosted database, and one long transaction
 * there means one lock held for the whole run and no way to see how far it got
 * when the connection drops. Each module is short enough to re-run after a
 * `db:reset`, which is the recovery path anyway.
 */
export async function runModules(
  modules: readonly SeedModule[],
  context: SeedContext,
): Promise<ModuleResult[]> {
  const results: ModuleResult[] = [];

  for (const module of modules) {
    const missing = await missingTables(context.client, module.writes);

    if (missing.length > 0) {
      const migration = module.pendingMigration ?? 'a later migration';
      const reason = `needs ${migration} — ${missing.join(', ')} ${missing.length === 1 ? 'does' : 'do'} not exist yet`;
      context.log(`  - ${module.name}: skipped, ${reason}`);
      if (module.deferred !== undefined && module.deferred.length > 0) {
        context.log(`      not covered in this version: ${module.deferred.join(', ')}`);
      }
      results.push({
        module,
        ran: false,
        summary: {},
        skippedBecause: reason,
        durationMs: 0,
      });
      continue;
    }

    const startedAt = process.hrtime.bigint();
    const summary = await module.run(context);
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

    context.log(`  + ${module.name}: ${describe(summary)} (${String(durationMs)} ms)`);
    if (module.deferred !== undefined && module.deferred.length > 0) {
      context.log(`      partially covered — deferred: ${module.deferred.join(', ')}`);
    }

    results.push({ module, ran: true, summary, durationMs });
  }

  return results;
}

/** Totals every module's summary into one table-keyed count. */
export function totals(results: readonly ModuleResult[]): SeedSummary {
  const combined: Record<string, number> = {};
  for (const result of results) {
    for (const [table, rows] of Object.entries(result.summary)) {
      combined[table] = (combined[table] ?? 0) + rows;
    }
  }
  return combined;
}

async function missingTables(client: Client, tables: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const table of tables) {
    if (!(await tableExists(client, table))) missing.push(table);
  }
  return missing;
}

function describe(summary: SeedSummary): string {
  const parts = Object.entries(summary)
    .filter(([, rows]) => rows > 0)
    .map(([table, rows]) => `${String(rows)} ${table}`);
  return parts.length === 0 ? 'nothing to write' : parts.join(', ');
}
