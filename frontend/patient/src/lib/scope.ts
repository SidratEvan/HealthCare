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
 *   2. `?scope=CODE` on any address, kept for the rest of the visit. This is
 *      how the one build that is the network's app is shown as a hospital's:
 *      a link, not a deployment. `?scope=` on its own leaves it.
 *
 * A scope is not a permission. Everything it narrows is public already; it
 * only decides what this app shows. So it is read from the address without
 * ceremony, and the server refuses a code it does not know rather than
 * falling back to everything (`discovery.service` `scopeInfo`).
 *
 * Kept in `sessionStorage`, so that it lasts for the visit and a new tab
 * opened on the network's address is the network.
 */

const KEY = 'patient.scope';
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
