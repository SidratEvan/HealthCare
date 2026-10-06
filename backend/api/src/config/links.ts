/**
 * The addresses this API puts in front of a patient, and the browser origins
 * it answers (`PRD.md` `FR-BRD-04`).
 *
 * Both were single values read where they were used: every link to the patient
 * app was `${env.WEB_BASE_URL}/…` in six files, and the allowed origins were
 * the same two-item array written twice. That is right for one patient app at
 * one address and wrong the day a hospital's portal lives at
 * `code.platform-domain` or a hospital-branded app has an origin of its own.
 *
 * So each is built here, once. Today the answers are what they were. What has
 * changed is that there is one function to teach about hospitals, instead of
 * six call sites and two lists.
 */

import { env } from '../env.js';

/**
 * A link into the patient app.
 *
 * `hospitalCode` is accepted and not yet used: it is where a hospital's own
 * address will be chosen once hospitals have them. Callers that know the
 * hospital may pass it now, so that switching it on is a change to this
 * function and to nothing that calls it.
 */
export function patientLink(
  path: string,
  query: Readonly<Record<string, string>> = {},
  _scope: { readonly hospitalCode?: string | undefined } = {},
): string {
  const url = new URL(path, env.WEB_BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The browser origins this API answers, for CORS and for the socket handshake.
 *
 * An allowlist, never a wildcard: with credentials allowed, `*` would let any
 * page on the internet use a stolen token against a hospital's session. The
 * patient app and the console are always in it; `EXTRA_ALLOWED_ORIGINS` adds
 * exact origins for a deployment that serves more than those two — a
 * hospital's portal at its own name, a branded app's web origin.
 */
export function allowedOrigins(): readonly string[] {
  return [...new Set([env.WEB_BASE_URL, env.CONSOLE_BASE_URL, ...env.EXTRA_ALLOWED_ORIGINS])];
}
