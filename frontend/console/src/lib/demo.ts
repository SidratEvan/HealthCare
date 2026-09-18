/**
 * How the console gets a principal under `DEMO_MODE` (CLAUDE.md §4.1).
 *
 * "Under `DEMO_MODE=true`, the console picks a hospital and a role without a
 * password… That is the correct implementation for a pitch version, not a
 * shortcut to apologise for."
 *
 * So there is no login screen. The console asks the API which sessions are
 * running, the operator picks one, and the token comes from a demo endpoint
 * rather than from a password. When Supabase Auth arrives, `getToken` is the
 * one function that changes.
 */

/** Where the token comes from today. Replaced wholesale by Supabase Auth. */
export interface DemoSession {
  readonly token: string;
  readonly hospitalId: string;
  readonly staffName: string;
}

const STORAGE_KEY = 'console.demo-session';

/**
 * Reads the session this browser last selected.
 *
 * `sessionStorage` rather than `localStorage`: a demo token should not outlive
 * the tab it was minted in, and a counter machine is shared.
 */
export function readDemoSession(): DemoSession | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    return raw === null || raw === undefined ? null : (JSON.parse(raw) as DemoSession);
  } catch {
    // Private windows and locked-down browsers both throw here. A console that
    // cannot remember the selection still works; it just asks again.
    return null;
  }
}

export function writeDemoSession(session: DemoSession): void {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Not remembering is survivable; crashing the console is not.
  }
}
