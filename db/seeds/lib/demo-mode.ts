/**
 * The one gate both `db:seed` and `db:reset` pass through.
 *
 * `DEMO_MODE=true` is what permits seeds and resets at all (BACKEND.md's
 * environment table, `.env.example`). Every row the seeds write is visibly
 * labelled as demonstration data (`FR-DEM-07`); putting those rows into a
 * database that is not in demo mode would mix labelled demo data into
 * somewhere real, which is precisely what `FR-SEC-08` forbids in the other
 * direction.
 *
 * It is a separate module rather than a function on either CLI so that
 * importing the guard cannot start a seed run as a side effect.
 */

import { loadEnvFile } from '../../scripts/lib/env.js';

export function assertDemoMode(command: string): void {
  loadEnvFile();

  if (process.env['DEMO_MODE'] !== 'true') {
    throw new Error(
      [
        'DEMO_MODE is not true.',
        '',
        'Seeds and resets are permitted in demo mode only. Every row they',
        'write is labelled as demonstration data (FR-DEM-07), and a database',
        'that is not in demo mode is not a database to put it in (FR-SEC-08).',
        '',
        'Set DEMO_MODE=true in .env, or:',
        `  DEMO_MODE=true ${command}`,
      ].join('\n'),
    );
  }
}
