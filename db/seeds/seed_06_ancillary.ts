/**
 * `FR-DEM-05` — eight ambulances, thirty blood donors, fifty pharmacy items.
 *
 * **This module cannot run yet, and says so rather than pretending.**
 *
 * `ambulances`, `ambulance_requests`, `blood_donors`, `blood_requests` and
 * `pharmacy_stock` are created by migration `0011_ancillary.sql`, and
 * `pharmacy_stock.medicine_id` points at `medicines`, which is `0007`
 * (DATABASE.md §7). The schema is at 0006, so the runner finds the tables
 * absent, skips this module, and prints which migration it is waiting for.
 * The screens that read these rows are build step 17 (`feat/lab-pharmacy`)
 * and the emergency work in step 15.
 *
 * Two of the three are also blocked on more than a table. A blood donor is a
 * real person's phone number and blood group, which is exactly the category
 * `FR-SEC-08` forbids inventing carelessly — the demo donors will come from
 * the synthetic phone block (`lib/demo.ts`, the `donor` kind, already
 * allocated) and carry the `FR-DEM-07` label, like every other person here. A
 * pharmacy item is a medicine, and the formulary is clinical content that
 * arrives with `0007` and the e-prescription autocomplete that needs it
 * (`FR-DOC-05`), not before (CLAUDE.md §8).
 */

import type { SeedModule, SeedSummary } from './lib/runner.js';

export const seed06Ancillary: SeedModule = {
  name: 'seed_06_ancillary',
  title: 'ambulances, blood donors and pharmacy stock',
  requirements: ['FR-DEM-05'],
  writes: ['ambulances', 'blood_donors', 'pharmacy_stock'],
  pendingMigration: '0011_ancillary.sql',
  deferred: ['FR-DEM-05'],

  run(): Promise<SeedSummary> {
    // Unreachable while the tables are absent; see `seed_05_beds` for why this
    // throws rather than returning an empty summary.
    throw new Error(
      'seed_06_ancillary needs migration 0011_ancillary.sql (and 0007 for medicines).',
    );
  },
};
