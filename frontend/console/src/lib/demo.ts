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
  /**
   * Null for the national console (`S-B-13`): a government viewer works for
   * no facility (`FR-ROLE-01`, migration 0024).
   */
  readonly hospitalId: string | null;
  readonly staffName: string;
  /**
   * Which console to open.
   *
   * `S-B-01` has always offered a role — `FR-ROLE-01` scopes every one of them
   * to a hospital — but the choice was thrown away and everybody landed on
   * reception. The doctor console (`S-B-05`) is a different screen for the same
   * chamber, so the role has to survive the picker.
   */
  readonly role: string;
  /** The facility, as the rail names it. Absent for the national console. */
  readonly hospitalNameBn?: string;
  /**
   * The same, in English, for a console switched to English (`SEG-B00-LANG`).
   * Optional as well because a session stored before it existed lacks it;
   * `localName` then falls back to the Bangla.
   */
  readonly hospitalNameEn?: string;
  /**
   * The chamber a reception or doctor console was opened on, as the picker
   * listed it — so the console's header can say whose chamber it is.
   */
  readonly chamber?: {
    readonly doctorNameBn: string;
    readonly doctorNameEn?: string;
    readonly departmentNameBn: string;
    readonly departmentNameEn?: string;
    readonly room: string | null;
  };
  /**
   * The consoles the facility offers, as the picker listed them, so the rail
   * can open the others (`APP_FLOW.md` B1.1) and say which it lacks. Absent
   * from a session stored before the rail went anywhere.
   */
  readonly roles?: readonly string[];
  /**
   * The chamber this tab last opened, kept when the rail moves to a facility
   * console so that its সিরিয়াল item can come back to the same queue.
   */
  readonly chamberSessionId?: string;
}

const STORAGE_KEY = 'console.demo-session';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/** What `POST /demo/token` hands back. */
export interface DemoToken {
  readonly token: string;
  readonly staffName: string;
  readonly hospitalId: string | null;
}

/**
 * Takes a principal for a facility and role from the demo endpoint.
 *
 * The picker and the rail both open consoles, and both do it through this, so
 * the two cannot drift into asking for a token differently. A null hospital is
 * the national console: naming a facility for a government viewer is refused
 * (`demoTokenBody`, migration 0024).
 */
export async function mintDemoToken(
  hospitalId: string | null,
  role: string,
  signal?: AbortSignal,
): Promise<DemoToken> {
  const response = await fetch(`${API}/demo/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(hospitalId === null ? { role } : { hospitalId, role }),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) throw new Error(String(response.status));

  const body = (await response.json()) as { data: DemoToken };
  return body.data;
}

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
