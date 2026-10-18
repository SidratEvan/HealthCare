/**
 * The demonstration's phone rule (`FR-DEM-08`, owner, 12 October 2026).
 *
 * Installed into the shared schemas once, by `createApp`, so every request
 * body or query that carries a person's phone is held to it during
 * validation: before any handler runs, so before anything is written. Read at
 * the moment of each check, so a setting changed by a test is the one used.
 *
 * Off a demonstration it admits everything; the schemas' format checks are
 * then the only rule, as they always were.
 */

import { DEMO_PERSON_PHONES, setPersonPhoneAdmission } from '@platform/domain';

import { env } from '../env.js';

/** Whether a normalised phone may be taken from a person here. */
export function demoPhoneAdmitted(phone: string): boolean {
  if (!env.DEMO_MODE) return true;
  const allowed = env.DEMO_PHONES ?? DEMO_PERSON_PHONES;
  return allowed === 'any' || allowed.includes(phone);
}

export function installDemoPhoneRule(): void {
  setPersonPhoneAdmission(demoPhoneAdmitted);
}
