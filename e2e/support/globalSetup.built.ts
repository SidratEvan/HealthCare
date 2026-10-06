/**
 * Global setup for the specs that run against the console as built
 * (`playwright.built.config.ts`).
 *
 * The same demo data as the development suite, by the same route. No routes
 * are warmed: there is no compiler behind a built app to wait for, and the
 * patient app is not started for these specs at all.
 */

import { prepareApiRole, prepareDatabase } from './globalSetup.js';

export default async function globalSetupBuilt(): Promise<void> {
  prepareDatabase();
  await prepareApiRole();
}
