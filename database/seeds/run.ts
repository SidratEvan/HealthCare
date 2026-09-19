/**
 * The seed modules in dependency order, and the function that runs them.
 *
 * ## The order is a fact about the data
 *
 * A booking needs a patient and a session; a session needs a chamber; a
 * chamber needs a department; a department needs a facility. That is the list
 * below, and it exists once — there is no second copy to keep in step.
 *
 * `seed_00_reference.sql` is not in the list because it is SQL rather than a
 * module: it is applied first, as the run's pre-flight check, and it fails
 * before a single row is written if the database is not the schema the seeds
 * were written against.
 *
 * ## Why this is not inside the CLI
 *
 * The schema tests build their fixtures from these same modules (CLAUDE.md §6:
 * every test runs against seeded demo data, never against fixtures scattered
 * through test files). A CLI that owned the sequence would force the tests to
 * reimplement it, and then there would be two descriptions of the demo.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { time, type Timestamp } from '@platform/domain';

import { createRng, DEMO_SEED } from './lib/random.js';
import {
  runModules,
  totals,
  type ModuleResult,
  type SeedModule,
  type SeedSummary,
} from './lib/runner.js';
import { writeNotificationTemplates } from './lib/templates.js';
import { seed01Hospitals } from './seed_01_hospitals.js';
import { seed02DoctorsSessions } from './seed_02_doctors_sessions.js';
import { seed03Patients } from './seed_03_patients.js';
import { seed04History } from './seed_04_history.js';
import { seed05Beds } from './seed_05_beds.js';
import { seed06Ancillary } from './seed_06_ancillary.js';
import { seed07DemoLive } from './seed_07_demo_live.js';

import type { Client } from 'pg';

export const SEED_MODULES: readonly SeedModule[] = [
  seed01Hospitals,
  seed02DoctorsSessions,
  seed03Patients,
  seed04History,
  seed05Beds,
  seed06Ancillary,
  seed07DemoLive,
];

/** `seed_00_reference.sql`, resolved from this file rather than the cwd. */
export const SEED_REFERENCE_SQL = resolve(import.meta.dirname, 'seed_00_reference.sql');

export interface SeedOptions {
  /**
   * The instant the run is anchored to. Defaults to now.
   *
   * Overridable so a test can seed a fixed moment and assert on a timestamp,
   * and so a reset's mid-queue log is reproducible on demand.
   */
  readonly now?: Timestamp;
  /** Defaults to `DEMO_SEED`; changing it changes the whole demo. */
  readonly seed?: number;
  readonly log?: (message: string) => void;
}

export interface SeedResult {
  readonly results: readonly ModuleResult[];
  readonly totals: SeedSummary;
  readonly now: Timestamp;
}

/** Applies `seed_00_reference.sql` and then every module, in order. */
export async function seedDemoData(client: Client, options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? ((): void => undefined);
  const now = options.now ?? time.fromDate(new Date());
  const rng = createRng(options.seed ?? DEMO_SEED);

  log('  + seed_00_reference.sql: schema and enum pre-flight');
  await client.query(readFileSync(SEED_REFERENCE_SQL, 'utf8'));

  // Platform reference data, not a hospital's: the message copy `FR-NOT-05`
  // requires to live in a table rather than at a call site. It runs here
  // rather than as a numbered module because it depends on no facility, no
  // doctor and no patient — only on the schema.
  const templates = await writeNotificationTemplates(client);
  log(`  + notification_templates: ${String(templates.written)} row(s) (FR-NOT-04, FR-NOT-05)`);

  const results = await runModules(SEED_MODULES, { client, now, rng, log });

  return { results, totals: totals(results), now };
}
