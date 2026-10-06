/**
 * A hospital's portal has an address (`PRD.md` `FR-BRD-07`, `FR-BRD-04`;
 * plan C2; migration 0046).
 *
 * Three questions, answered in one place:
 *
 *   - **Whose portal is this host?** `<code>.<PLATFORM_DOMAIN>` is that
 *     hospital's; a domain a platform administrator recorded for a hospital is
 *     that hospital's; anything else is the network.
 *   - **May this browser origin talk to the API?** The network's own
 *     addresses always (`config/links.ts`); a portal's address too. Asked by
 *     the CORS middleware and by the socket handshake, which must give the
 *     same answer.
 *   - **Where does a link for this hospital go**, when nobody's browser is
 *     behind the request (a counter, a worker)? To the hospital's own domain
 *     if it has one, and otherwise to the network.
 *
 * ## The recorded domains are remembered for half a minute
 *
 * The second question is asked on every request a browser makes from an
 * address that is not the network's own, before anybody is anybody. A read of
 * the database each time would make an unknown origin a way to spend the
 * pool. So the list is read at most once in thirty seconds, and at once after
 * this process changes it. A domain recorded through another instance is
 * therefore answered for within half a minute, which is long before its DNS
 * has moved.
 *
 * ## What is allowed under the platform's own domain
 *
 * Any single label that could be a hospital's code. Not "any label a hospital
 * currently has": the platform's domain is the platform's, every name under
 * it is served by this deployment, and whether there is a hospital behind one
 * is answered by `GET /config`, with a 404 a person can read.
 */

import { portalHostFor, portalHostOf } from '@platform/domain';

import { runInDbScope } from '../config/dbScope.js';
import { allowedOrigins } from '../config/links.js';
import { env, isProduction } from '../env.js';
import * as discoveryRepo from '../repositories/discovery.repo.js';

const REMEMBER_MS = 30_000;

interface Recorded {
  /** Host → the hospital whose portal it is. */
  readonly byHost: ReadonlyMap<string, { readonly code: string; readonly hospitalId: string }>;
  /** Hospital → its own domain. */
  readonly byHospital: ReadonlyMap<string, string>;
  readonly readAt: number;
}

const NOTHING: Recorded = { byHost: new Map(), byHospital: new Map(), readAt: 0 };

let recorded: Recorded = NOTHING;
let reading: Promise<Recorded> | null = null;

async function read(): Promise<Recorded> {
  // The server's own read: it decides which addresses are answered at all,
  // before the request has a principal to have a scope.
  const rows = await runInDbScope(
    { kind: 'system' },
    async () => await discoveryRepo.portalDomains(),
  );
  const byHost = new Map<string, { code: string; hospitalId: string }>();
  const byHospital = new Map<string, string>();
  for (const row of rows) {
    byHost.set(row.domain, { code: row.code, hospitalId: row.hospitalId });
    byHospital.set(row.hospitalId, row.domain);
  }
  return { byHost, byHospital, readAt: Date.now() };
}

/** The domains hospitals own, as last read; read again when that was a while ago. */
async function recordedDomains(): Promise<Recorded> {
  if (Date.now() - recorded.readAt < REMEMBER_MS) return recorded;
  reading ??= read()
    .then((fresh) => {
      recorded = fresh;
      return fresh;
    })
    .finally(() => {
      reading = null;
    });
  return await reading;
}

/** Called after this process records or removes a domain, so the next question reads again. */
export function forgetRecordedDomains(): void {
  recorded = NOTHING;
}

/** The deployment's own domain, or null when it has none. */
export function platformDomain(): string | null {
  return env.PLATFORM_DOMAIN === '' ? null : env.PLATFORM_DOMAIN;
}

/**
 * The code of the hospital whose portal a host is; null when the host is the
 * network's.
 *
 * A code under the platform's domain is given back whether or not such a
 * hospital exists: the caller asks for that hospital and gets a 404 if there
 * is none, which is the honest answer to somebody who typed an address.
 */
export async function scopeCodeOfHost(host: string): Promise<string | null> {
  const address = await addressOf(host);
  return address.kind === 'portal' ? address.code : null;
}

/** What an address is to this deployment. */
export type AddressKind =
  /** The platform's own: the whole network. */
  | { readonly kind: 'network' }
  /** A hospital's portal; whether there is such a hospital is the caller's to ask. */
  | { readonly kind: 'portal'; readonly code: string }
  /**
   * Some other name, with no hospital recorded for it: nobody's. The API does
   * not answer a browser there, so the app can do nothing at it but say so.
   */
  | { readonly kind: 'nobodys' };

/**
 * Which of the three a host is. The network's own addresses are the
 * platform's domain and whatever the deployment was configured to serve the
 * patient app at, which need not be under that domain.
 */
export async function addressOf(host: string): Promise<AddressKind> {
  const which = portalHostOf(host, platformDomain());
  if (which.kind === 'network') return { kind: 'network' };
  if (which.kind === 'code') return { kind: 'portal', code: which.code };

  const own = [env.WEB_BASE_URL, ...env.EXTRA_ALLOWED_ORIGINS].some((origin) => {
    try {
      return new URL(origin).hostname === which.host;
    } catch {
      return false;
    }
  });
  if (own) return { kind: 'network' };

  const recordedFor = (await recordedDomains()).byHost.get(which.host);
  return recordedFor === undefined
    ? { kind: 'nobodys' }
    : { kind: 'portal', code: recordedFor.code };
}

/** Whether an origin is a hospital's portal: under the platform's domain, or a recorded one. */
async function isPortalOrigin(origin: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // An origin and nothing else: no path, no credentials.
  if (url.origin !== origin) return false;
  // Over TLS, except on a developer's machine, where nothing is.
  if (url.protocol !== 'https:' && (isProduction() || url.protocol !== 'http:')) return false;

  const which = portalHostOf(url.host, platformDomain());
  if (which.kind === 'code') return true;
  if (which.kind === 'foreign') return (await recordedDomains()).byHost.has(which.host);
  return false;
}

/**
 * Whether a browser at `origin` may call the API and open a socket.
 *
 * The fixed list first, which needs no reading: the patient app's and the
 * console's own addresses, and any named in `EXTRA_ALLOWED_ORIGINS`.
 */
export async function originAllowed(origin: string): Promise<boolean> {
  if (allowedOrigins().includes(origin)) return true;
  return await isPortalOrigin(origin);
}

/**
 * The patient-app address a request came from, or null: the network's own,
 * or a hospital's portal. Never the console's, which is not a patient's.
 */
export async function patientOriginOf(origin: string | undefined): Promise<string | null> {
  if (origin === undefined || origin === '' || origin === env.CONSOLE_BASE_URL) return null;
  if (origin === env.WEB_BASE_URL || env.EXTRA_ALLOWED_ORIGINS.includes(origin)) return origin;
  return (await isPortalOrigin(origin)) ? origin : null;
}

/**
 * Where a link for this hospital goes when no patient's browser is behind the
 * request: its own domain if it has one; null for the network's address.
 */
export async function hospitalLinkOrigin(hospitalId: string): Promise<string | null> {
  const domain = (await recordedDomains()).byHospital.get(hospitalId);
  return domain === undefined ? null : `https://${domain}`;
}

/**
 * A hospital's portal addresses, for its own settings screen and the
 * platform's: the one under the platform's domain, when the deployment has a
 * domain, and its own, when one is recorded.
 */
export function portalAddresses(
  code: string | null,
  ownDomain: string | null,
): { readonly platform: string | null; readonly own: string | null } {
  const domain = platformDomain();
  // The same deployment serves the network and every portal under its domain,
  // so the scheme and the port are the network's own.
  const web = new URL(env.WEB_BASE_URL);
  const port = web.port === '' ? '' : `:${web.port}`;
  return {
    platform:
      code === null || domain === null
        ? null
        : `${web.protocol}//${portalHostFor(code, domain)}${port}`,
    own: ownDomain === null ? null : `https://${ownDomain}`,
  };
}
