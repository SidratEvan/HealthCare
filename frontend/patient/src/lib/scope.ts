/**
 * Which hospital this app is open for, if any (`FR-BRD-02`, `FR-PAT-19`).
 *
 * Unset, the app is the whole network. Set to a hospital's code, discovery,
 * booking and beds are that hospital's only, and the app says whose it is.
 * That is the whole of what a hospital-branded patient app is: this app, with
 * a scope. It is configuration and never a second codebase.
 *
 * ## Where a scope comes from
 *
 *   1. `NEXT_PUBLIC_HOSPITAL_SCOPE`, set when the app is built for one
 *      hospital. A build with it cannot be taken out of scope from the
 *      address bar.
 *   2. **The address itself** (`FR-BRD-07`, plan C2). Opened at
 *      `<code>.<platform domain>`, or at a domain a hospital owns and the
 *      platform has recorded, the app is that hospital's portal with no
 *      parameter, and nothing in the address bar takes it out of scope or
 *      into another hospital's. The first kind is read from the name; the
 *      second only the server can say, and `<PortalGate>` waits for it.
 *   3. `?scope=CODE` at the network's own address, kept for the rest of the
 *      visit. This is how the one build that is the network's app is shown
 *      as a hospital's: a link, not a deployment. `?scope=` on its own
 *      leaves it.
 *
 * A scope is not a permission. Everything it narrows is public already; it
 * only decides what this app shows. So it is read from the address without
 * ceremony, and the server refuses a code it does not know rather than
 * falling back to everything (`discovery.service` `scopeInfo`).
 *
 * Kept in `sessionStorage`, so that it lasts for the visit and a new tab
 * opened on the network's address is the network.
 */

import { portalHostOf } from '@platform/domain';

const KEY = 'patient.scope';
/** What the server said this address is, for the visit: `{ host, code }`. */
const HOST_KEY = 'patient.scope.host';

/** The platform's own domain, when this build was given one (`FR-BRD-07`). */
const PLATFORM_DOMAIN = (process.env['NEXT_PUBLIC_PLATFORM_DOMAIN'] ?? '').trim().toLowerCase();
const SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/;

/** The scope this build was made for, if it was made for one hospital. */
const BUILT_FOR = (process.env['NEXT_PUBLIC_HOSPITAL_SCOPE'] ?? '').trim();

function stored(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(KEY) ?? null;
  } catch {
    // A private window that refuses storage: the address still carries it.
    return null;
  }
}

function store(code: string | null): void {
  try {
    if (code === null) globalThis.sessionStorage?.removeItem(KEY);
    else globalThis.sessionStorage?.setItem(KEY, code);
  } catch {
    // Nothing to do: the scope then lasts for this page only.
  }
}

// ---------------------------------------------------------------------------
// Whose address this is
// ---------------------------------------------------------------------------

type AtAddress =
  /** The network's own address, or a name the server said is nobody's. */
  | { readonly kind: 'network' }
  /** A hospital's portal: its code is the scope, and the visitor cannot change it. */
  | { readonly kind: 'portal'; readonly code: string }
  /** A name this build cannot read. The server has not said yet whose it is. */
  | { readonly kind: 'unasked' };

/** What the server said this host is: a code, null for nobody's, undefined if not asked. */
function hostAnswer(host: string): string | null | undefined {
  try {
    const kept = globalThis.sessionStorage?.getItem(HOST_KEY);
    if (kept == null) return undefined;
    const parsed = JSON.parse(kept) as { host?: unknown; code?: unknown };
    if (parsed.host !== host) return undefined;
    if (parsed.code === null) return null;
    return typeof parsed.code === 'string' && SHAPE.test(parsed.code) ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

function atAddress(): AtAddress {
  if (typeof globalThis.location === 'undefined') return { kind: 'network' };
  const which = portalHostOf(
    globalThis.location.host,
    PLATFORM_DOMAIN === '' ? null : PLATFORM_DOMAIN,
  );
  if (which.kind === 'network') return { kind: 'network' };
  if (which.kind === 'code') return { kind: 'portal', code: which.code };

  const answer = hostAnswer(which.host);
  if (answer === undefined) return { kind: 'unasked' };
  return answer === null ? { kind: 'network' } : { kind: 'portal', code: answer };
}

const listeners = new Set<() => void>();

/** Called when the server has said whose address this is; returns the way to stop. */
export function onHostAnswer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this address is a name only the server can place, and it has not yet. */
export function hostNeedsAsking(): boolean {
  return atAddress().kind === 'unasked';
}

/** Whether the scope comes from the address, and so is not the visitor's to change. */
export function scopeIsByAddress(): boolean {
  return atAddress().kind === 'portal';
}

/**
 * Keeps what the server said this address is, for the visit: a hospital's
 * code, or null for the network.
 */
export function rememberHostAnswer(code: string | null): void {
  if (typeof globalThis.location === 'undefined') return;
  const which = portalHostOf(
    globalThis.location.host,
    PLATFORM_DOMAIN === '' ? null : PLATFORM_DOMAIN,
  );
  if (which.kind !== 'foreign') return;
  try {
    globalThis.sessionStorage?.setItem(HOST_KEY, JSON.stringify({ host: which.host, code }));
  } catch {
    // A window that refuses storage asks again on the next page.
  }
  for (const listener of listeners) listener();
}

/** The host to tell the server, so that it can say whose address this is. */
export function hostToAsk(): string | null {
  return typeof globalThis.location === 'undefined' ? null : globalThis.location.host;
}

/**
 * The scope in force, or null for the whole network.
 *
 * Reads the address first, so that the first request a page makes is already
 * scoped — a branded link must never flash the whole network before it
 * narrows. Safe to call during render on the server, where there is no
 * address: it answers with the build's own scope.
 */
export function currentScope(): string | null {
  if (SHAPE.test(BUILT_FOR)) return BUILT_FOR.toUpperCase();
  if (typeof globalThis.location === 'undefined') return null;

  // At a hospital's own address the address decides (`FR-BRD-07`): `?scope=`
  // neither makes one hospital's portal another's nor takes it out of scope.
  const at = atAddress();
  if (at.kind === 'portal') return at.code;

  const params = new URLSearchParams(globalThis.location.search);
  if (params.has('scope')) {
    const asked = (params.get('scope') ?? '').trim();
    const code = SHAPE.test(asked) ? asked.toUpperCase() : null;
    store(code);
    return code;
  }

  const kept = stored();
  return kept !== null && SHAPE.test(kept) ? kept : null;
}

/**
 * The hospital an app is scoped to, for filtering what this phone holds:
 * null for the network's app, the hospital's id once `GET /config` has
 * answered, and undefined while a scoped app is still waiting for that answer.
 */
export function scopedHospitalId(
  config: { readonly scope: { readonly hospitalId: string } | null } | null,
): string | null | undefined {
  if (currentScope() === null) return null;
  return config?.scope?.hospitalId;
}

/** Adds the scope to a query, when there is one. */
export function withScope(params: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const scope = currentScope();
  if (scope !== null) params.set('scope', scope);
  return params;
}

/** A path with its query, scoped. `path` carries no query of its own. */
export function scopedPath(path: string, params: URLSearchParams = new URLSearchParams()): string {
  const query = withScope(params).toString();
  return query === '' ? path : `${path}?${query}`;
}

// Taken as soon as the app's code loads, before any screen runs: a screen that
// rewrites its own address (the search screen keeps what is asked in it) would
// otherwise drop `?scope=` before anything had read it.
if (typeof globalThis.location !== 'undefined') currentScope();
