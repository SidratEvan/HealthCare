/**
 * Staff sign-in for the console (pilot step 21, `S-B-00`, BACKEND.md §7.1).
 *
 * A sign-in becomes the same stored session the demo picker writes
 * (`lib/demo.ts`), marked `authKind: 'staff'`, so every console reads its token
 * exactly as it always has. Two things differ from the demo:
 *
 * - The access token lasts fifteen minutes. `keepSessionFresh` refreshes it a
 *   couple of minutes before it runs out, and every caller already reads the
 *   token at request time (`readToken`, `getToken`), so nothing else changes.
 *   A refresh the server refuses ends the session and returns to `S-B-00`.
 * - The token already carries every role the person holds, so moving between
 *   consoles changes the stored role and nothing on the server.
 */

import { clearDemoSession, readDemoSession, writeDemoSession, type DemoSession } from './demo';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/** What `POST /staff/login`, `/staff/refresh` and `/staff/password` return. */
export interface StaffSessionPayload {
  readonly access: string;
  readonly accessExpiresAt: string;
  readonly refresh: string;
  readonly staff: { readonly id: string; readonly fullName: string; readonly email: string };
  readonly hospital: {
    readonly id: string;
    readonly code: string | null;
    readonly nameBn: string;
    readonly nameEn: string;
  } | null;
  readonly roles: readonly string[];
  readonly mustChangePassword: boolean;
}

export type SignInOutcome =
  | { readonly ok: true; readonly session: StaffSessionPayload }
  | {
      readonly ok: false;
      readonly reason:
        'invalid' | 'locked' | 'hospital_required' | 'no_roles' | 'offline' | 'failed';
      readonly until?: string;
    };

interface ErrorBody {
  readonly error?: { readonly code?: string; readonly details?: Record<string, unknown> };
}

/** A function, not an inline check, so a check before an await is asked again after it. */
function isOffline(): boolean {
  return globalThis.navigator?.onLine === false;
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

async function errorOf(
  response: Response,
): Promise<{ code: string; details: Record<string, unknown> }> {
  try {
    const body = (await response.json()) as ErrorBody;
    return { code: body.error?.code ?? '', details: body.error?.details ?? {} };
  } catch {
    return { code: '', details: {} };
  }
}

/** `POST /staff/login`. */
export async function signIn(input: {
  readonly email: string;
  readonly password: string;
  readonly hospitalCode?: string;
}): Promise<SignInOutcome> {
  if (isOffline()) return { ok: false, reason: 'offline' };
  let response: Response;
  try {
    response = await post('/staff/login', {
      email: input.email.trim(),
      password: input.password,
      ...(input.hospitalCode === undefined || input.hospitalCode.trim() === ''
        ? {}
        : { hospitalCode: input.hospitalCode.trim() }),
    });
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' };
  }

  if (response.ok) {
    const body = (await response.json()) as { data: StaffSessionPayload };
    return { ok: true, session: body.data };
  }

  const { code, details } = await errorOf(response);
  if (code === 'AUTH_INVALID_CREDENTIALS' || response.status === 400)
    return { ok: false, reason: 'invalid' };
  if (code === 'AUTH_LOCKED') {
    return {
      ok: false,
      reason: 'locked',
      ...(typeof details['until'] === 'string' ? { until: details['until'] } : {}),
    };
  }
  if (code === 'AUTH_HOSPITAL_REQUIRED') return { ok: false, reason: 'hospital_required' };
  if (code === 'AUTH_FORBIDDEN_SCOPE') return { ok: false, reason: 'no_roles' };
  return { ok: false, reason: 'failed' };
}

/** The role a sign-in opens first: the only one, or the first in console order. */
const ROLE_ORDER = [
  'receptionist',
  'doctor',
  'ward',
  'emergency',
  'lab',
  'pharmacy',
  'hospital_admin',
  'gov_viewer',
];

/** Stores a sign-in as the console's session. */
export function adoptStaffSession(
  payload: StaffSessionPayload,
  previous: DemoSession | null = null,
): DemoSession {
  const role =
    previous?.role !== undefined && payload.roles.includes(previous.role)
      ? previous.role
      : (ROLE_ORDER.find((candidate) => payload.roles.includes(candidate)) ??
        payload.roles[0] ??
        '');
  const session: DemoSession = {
    ...(previous ?? {}),
    token: payload.access,
    hospitalId: payload.hospital?.id ?? null,
    staffName: payload.staff.fullName,
    role,
    roles: payload.roles,
    ...(payload.hospital === null
      ? {}
      : { hospitalNameBn: payload.hospital.nameBn, hospitalNameEn: payload.hospital.nameEn }),
    authKind: 'staff',
    refresh: payload.refresh,
    accessExpiresAt: payload.accessExpiresAt,
    mustChangePassword: payload.mustChangePassword,
  };
  writeDemoSession(session);
  return session;
}

/** True for a session from `S-B-00`, false for one the demo picker minted. */
export function isStaffSession(session: DemoSession | null): boolean {
  return session?.authKind === 'staff';
}

/**
 * `POST /staff/refresh`. Returns false when the server refused the refresh
 * token — the session is over and has been forgotten. A network failure keeps
 * the session: the next attempt may reach the server.
 */
export async function refreshStaffSession(): Promise<boolean> {
  const session = readDemoSession();
  if (session?.authKind !== 'staff' || session.refresh === undefined) return false;
  let response: Response;
  try {
    response = await post('/staff/refresh', { refresh: session.refresh });
  } catch {
    return true;
  }
  if (response.ok) {
    const body = (await response.json()) as { data: StaffSessionPayload };
    adoptStaffSession(body.data, session);
    return true;
  }
  if (response.status === 401 || response.status === 400 || response.status === 403) {
    clearDemoSession();
    return false;
  }
  return true;
}

/** How long before expiry the token is renewed. */
const RENEW_BEFORE_MS = 2 * 60_000;

/**
 * Keeps a staff session's access token fresh while the console is open.
 * Returns the function that stops it. `onEnded` is called when the server
 * refuses the refresh — the console then shows `S-B-00`.
 */
export function keepSessionFresh(onEnded: () => void): () => void {
  let running = false;
  const tick = async (): Promise<void> => {
    const session = readDemoSession();
    if (running || session?.authKind !== 'staff' || session.accessExpiresAt === undefined) return;
    if (Date.parse(session.accessExpiresAt) - Date.now() > RENEW_BEFORE_MS) return;
    running = true;
    try {
      if (!(await refreshStaffSession())) onEnded();
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = globalThis.setInterval(() => void tick(), 30_000);
  const onFocus = (): void => void tick();
  globalThis.addEventListener?.('focus', onFocus);
  return () => {
    globalThis.clearInterval(timer);
    globalThis.removeEventListener?.('focus', onFocus);
  };
}

/** `POST /staff/logout`, then forget the session whatever the answer. */
export async function signOut(): Promise<void> {
  const session = readDemoSession();
  clearDemoSession();
  if (session?.authKind !== 'staff' || session.refresh === undefined) return;
  try {
    await post('/staff/logout', { refresh: session.refresh });
  } catch {
    // The server did not hear it; the refresh token still expires on its own,
    // and this browser has already forgotten it.
  }
}

export type PasswordOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'wrong' | 'short' | 'unchanged' | 'locked' | 'offline' | 'failed';
    };

/** `POST /staff/password`. A success replaces the session with a fresh one. */
export async function changePassword(current: string, next: string): Promise<PasswordOutcome> {
  const session = readDemoSession();
  if (session === null) return { ok: false, reason: 'failed' };
  if (isOffline()) return { ok: false, reason: 'offline' };
  let response: Response;
  try {
    response = await post('/staff/password', { current, next }, session.token);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (response.ok) {
    const body = (await response.json()) as { data: StaffSessionPayload };
    adoptStaffSession(body.data, session);
    return { ok: true };
  }
  const { code, details } = await errorOf(response);
  if (code === 'AUTH_INVALID_CREDENTIALS') return { ok: false, reason: 'wrong' };
  if (code === 'AUTH_LOCKED') return { ok: false, reason: 'locked' };
  if (code === 'AUTH_PASSWORD_WEAK') {
    return { ok: false, reason: details['reason'] === 'unchanged' ? 'unchanged' : 'short' };
  }
  return { ok: false, reason: 'failed' };
}

/** `GET /demo/status`: whether this deployment offers the password-less picker. */
async function fetchDemoModeOnce(timeoutMs: number): Promise<boolean | null> {
  try {
    const response = await fetch(`${API}/demo/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = (await response.json()) as { data: { demoMode: boolean } };
    return body.data.demoMode;
  } catch {
    return null;
  }
}

/** Per attempt, and how many — the same budget the demo picker gives `/demo/consoles`. */
const STATUS_ATTEMPT_MS = 12_000;
const STATUS_ATTEMPTS = 4;

/**
 * Whether this deployment is a demonstration, asked until it answers.
 *
 * An API that has been asleep (the demo's free tier takes about thirty seconds
 * to wake) does not answer the first request in time, and treating that
 * silence as "not a demo" put the sign-in screen in front of a demo that needs
 * none. So the question is asked again, `onWaking` says so after the first
 * miss, and null — never false — comes back only when every attempt failed.
 * False means the server said so.
 */
export async function askDemoMode(onWaking: () => void): Promise<boolean | null> {
  for (let attempt = 1; attempt <= STATUS_ATTEMPTS; attempt += 1) {
    if (attempt > 1) onWaking();
    const answer = await fetchDemoModeOnce(STATUS_ATTEMPT_MS);
    if (answer !== null) return answer;
  }
  return null;
}

/** A chamber as `GET /staff/chambers` lists it — the picker's card shape. */
export interface StaffChamber {
  readonly id: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly room: string | null;
  readonly status: string;
  readonly waiting: number;
  readonly total: number;
}

/** `GET /staff/chambers`. Null when the server could not be asked. */
export async function fetchStaffChambers(): Promise<readonly StaffChamber[] | null> {
  const session = readDemoSession();
  if (session === null) return null;
  try {
    const response = await fetch(`${API}/staff/chambers`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data: { chambers: StaffChamber[] } };
    return body.data.chambers;
  } catch {
    return null;
  }
}
