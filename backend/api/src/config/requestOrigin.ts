/**
 * Which patient-app address a request came from (`PRD.md` `FR-BRD-04`,
 * `FR-BRD-07`; plan C2).
 *
 * A patient who books inside a hospital's portal is sent a link, and the link
 * has to open in that portal: the same app, in that hospital's name, at that
 * hospital's address. The services that issue links do not know where the
 * request came from and should not have to: this holds it for the length of
 * the request, the way `config/dbScope.ts` holds whose rows a request may
 * reach, and `config/links.ts` reads it when it builds an address.
 *
 * Only an address this deployment answers for is ever held: the network's
 * own, or a hospital's portal (`portal.service`). A request from the staff
 * console, from a worker, or from anything that is not a browser holds none,
 * and a link issued there is built from the hospital's own domain if it has
 * one, and otherwise from the network's address.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string | null>();

/** Runs `body`, and everything it awaits, as a request from `origin`. */
export function runWithPatientOrigin<T>(origin: string | null, body: () => T): T {
  return storage.run(origin, body);
}

/** The patient-app address this request came from; null when it came from none. */
export function currentPatientOrigin(): string | null {
  return storage.getStore() ?? null;
}
