/**
 * `FR-DEM-04` — bed inventory across wards with live occupancy.
 *
 * **This module cannot run yet, and says so rather than pretending.**
 *
 * `wards`, `beds`, `bed_events` and `admissions` are created by migration
 * `0008_beds_emergency.sql` (DATABASE.md §7). The schema is at 0006, so the
 * runner finds the tables absent, skips this module, and prints which
 * migration it is waiting for and which requirement is consequently not
 * covered. The bed board is build step 14 (`feat/beds`), and the inventory
 * lands in that branch alongside the screen that renders it — which is also
 * what CLAUDE.md §5.3 asks for: no feature ships with an empty screen.
 *
 * The file exists now because DATABASE.md §7 names it, and because the shape
 * of the inventory is already decided and worth recording where the seed will
 * read it: `DemoFacility.hasIcu` in `data/hospitals.ts` marks the three
 * facilities with an ICU, and `DemoFacility.capabilities` marks the two with a
 * burn unit. Both halves of `FR-DEM-04` are therefore already declared in one
 * place; step 14 turns them into rows.
 *
 * What it does **not** contain is a guess at the columns of a table no
 * migration has created. Writing `beds (ward_id, label, kind, state, …)`
 * against DATABASE.md §2.4 today would be code that compiles, never runs, and
 * has to be rewritten the moment 0008 is actually written.
 */

import type { SeedModule, SeedSummary } from './lib/runner.js';

export const seed05Beds: SeedModule = {
  name: 'seed_05_beds',
  title: 'wards, beds and live occupancy',
  requirements: ['FR-DEM-04'],
  writes: ['wards', 'beds', 'bed_events'],
  pendingMigration: '0008_beds_emergency.sql',
  deferred: ['FR-DEM-04'],

  run(): Promise<SeedSummary> {
    // Unreachable: `runModules` checks `writes` before calling `run`, and these
    // tables do not exist until 0008. If this ever throws, the runner's gate
    // has broken — which is worth a loud failure rather than a silent no-op.
    throw new Error(
      'seed_05_beds needs migration 0008_beds_emergency.sql (build step 14, feat/beds).',
    );
  },
};
