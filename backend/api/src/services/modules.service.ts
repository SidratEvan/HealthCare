/**
 * The modules a hospital runs (`PRD.md` `FR-BRD-11`, `FR-SUP-03`; plan C4;
 * migration 0047).
 *
 * Three callers ask the same question, "does this hospital run that?":
 *
 *   - the gate on every staff request (`middleware/modules.ts`), which
 *     refuses a console of a module that is off;
 *   - the services behind what the public writes with no account (a booking,
 *     a bed request, an alert that somebody is on the way), which refuse to
 *     take one for a hospital that does not run it;
 *   - the consoles, which are told what is off so that they offer nothing
 *     that would be refused.
 *
 * What a hospital *publishes* is not asked here but in the query that reads
 * it (`fn_module_on`), so that a list cannot be read first and filtered
 * second.
 *
 * ## Remembered for half a minute
 *
 * The gate asks on every staff request. What a hospital has off changes a
 * few times in its life, so it is read at most once in thirty seconds for
 * each hospital, and at once after this process changes it. Switched off
 * through another instance, a module is refused here within half a minute.
 */

import { isHospitalModule, type HospitalModule } from '@platform/domain';

import { AppError } from '../errors/AppError.js';
import * as settingsRepo from '../repositories/hospitalSettings.repo.js';

const REMEMBER_MS = 30_000;

const remembered = new Map<
  string,
  { readonly off: readonly HospitalModule[]; readonly at: number }
>();

/** The modules a hospital has switched off; empty when everything is on. */
export async function modulesOff(hospitalId: string): Promise<readonly HospitalModule[]> {
  const kept = remembered.get(hospitalId);
  if (kept !== undefined && Date.now() - kept.at < REMEMBER_MS) return kept.off;

  const off = (await settingsRepo.modulesOff(hospitalId)).filter(isHospitalModule);
  remembered.set(hospitalId, { off, at: Date.now() });
  return off;
}

/** Called after this process changes a hospital's modules, so the next question reads again. */
export function forgetModules(hospitalId?: string): void {
  if (hospitalId === undefined) remembered.clear();
  else remembered.delete(hospitalId);
}

/** The first of `needed` this hospital has off, or null when it runs them all. */
export async function firstOff(
  hospitalId: string,
  needed: readonly HospitalModule[],
): Promise<HospitalModule | null> {
  if (needed.length === 0) return null;
  const off = await modulesOff(hospitalId);
  return needed.find((module) => off.includes(module)) ?? null;
}

/**
 * Refuses when the hospital does not run the module.
 *
 * `MODULE_OFF` (403), naming the module: for a console it is "this is not
 * part of your hospital's setup", and for a patient "this hospital does not
 * take that here". Never a 404: the hospital is there, and saying so is how
 * a person learns to go elsewhere.
 */
export async function requireOn(hospitalId: string, module: HospitalModule): Promise<void> {
  if ((await firstOff(hospitalId, [module])) !== null) {
    throw new AppError('MODULE_OFF', { details: { module } });
  }
}
