const STORAGE_KEY = 'console.demo-session';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/**
 * Takes a principal for a facility and role from the demo endpoint.
 *
 * The picker and the rail both open consoles, and both do it through this, so
 * the two cannot drift into asking for a token differently. A null hospital is
 * the national console: naming a facility for a government viewer is refused
 * (`demoTokenBody`, migration 0024).
 */
export async function mintDemoToken(hospitalId, role, signal) {
  const response = await fetch(`${API}/demo/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(hospitalId === null ? { role } : { hospitalId, role }),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) throw new Error(String(response.status));

  const body = await response.json();
  return body.data;
}

/**
 * Reads the session this browser last selected.
 *
 * `sessionStorage` rather than `localStorage`: a demo token should not outlive
 * the tab it was minted in, and a counter machine is shared.
 */
export function readDemoSession() {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch {
    // Private windows and locked-down browsers both throw here. A console that
    // cannot remember the selection still works; it just asks again.
    return null;
  }
}

/** Forgets the session — signing out, or a refresh the server refused. */
export function clearDemoSession() {
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage refused (a private window): there is nothing stored to forget.
  }
}

export function writeDemoSession(session) {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Not remembering is survivable; crashing the console is not.
  }
}
