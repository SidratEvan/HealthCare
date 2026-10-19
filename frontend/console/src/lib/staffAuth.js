/**
 * Staff sign-in for the console (pilot step 21, `S-B-00`, BACKEND.md §7.1).
 *
 * A sign-in becomes the same stored session the demo picker writes
 * (`lib/demo.js`), marked `authKind: 'staff'`, so every console reads its token
 * exactly as it always has. Two things differ from the demo:
 *
 * - The access token lasts fifteen minutes. `keepSessionFresh` refreshes it a
 *   couple of minutes before it runs out, and every caller already reads the
 *   token at request time (`readToken`, `getToken`), so nothing else changes.
 *   A refresh the server refuses ends the session and returns to `S-B-00`.
 * - The token already carries every role the person holds, so moving between
 *   consoles changes the stored role and nothing on the server.
 *
 * The second factor (pilot step 28, `FR-SEC-10`): a right password for an
 * account with one on is answered with a challenge, not a session, and
 * `verifySecondFactor` exchanges it and the code for one (`S-B-00b`). An
 * administrator without one gets a session that opens only `S-B-00d`.
 */

import { ownerOfToken } from '@platform/client';

import { clearDemoSession, readDemoSession, writeDemoSession } from './demo';
import { rememberDemonstration } from './deployment';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/** A function, not an inline check, so a check before an await is asked again after it. */
function isOffline() {
  return globalThis.navigator?.onLine === false;
}

async function post(path, body, token) {
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

async function errorOf(response) {
  try {
    const body = await response.json();
    return { code: body.error?.code ?? '', details: body.error?.details ?? {} };
  } catch {
    return { code: '', details: {} };
  }
}

/** `POST /staff/login`. */
export async function signIn(input) {
  if (isOffline()) return { ok: false, reason: 'offline' };
  let response;
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
    const body = await response.json();
    if (body.data.requires2fa) {
      return {
        ok: true,
        challenge: { token: body.data.challenge, expiresAt: body.data.challengeExpiresAt },
      };
    }
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
  if (response.status === 429) return { ok: false, reason: 'rate_limited' };
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
export function adoptStaffSession(payload, previous = null) {
  // Never carry another account/hospital's chosen chamber into a new session.
  const retained =
    previous !== null &&
    previous.hospitalId === (payload.hospital?.id ?? null) &&
    ownerOfToken(previous.token) === payload.staff.id
      ? previous
      : null;
  const role =
    retained?.role !== undefined && payload.roles.includes(retained.role)
      ? retained.role
      : (ROLE_ORDER.find((candidate) => payload.roles.includes(candidate)) ??
        payload.roles[0] ??
        '');
  const session = {
    ...(retained ?? {}),
    token: payload.access,
    hospitalId: payload.hospital?.id ?? null,
    staffName: payload.staff.fullName,
    staffId: payload.staff.id,
    role,
    roles: payload.roles,
    ...(payload.hospital === null
      ? {}
      : { hospitalNameBn: payload.hospital.nameBn, hospitalNameEn: payload.hospital.nameEn }),
    authKind: 'staff',
    refresh: payload.refresh,
    accessExpiresAt: payload.accessExpiresAt,
    mustChangePassword: payload.mustChangePassword,
    twoFactor: payload.twoFactor,
  };
  writeDemoSession(session);
  return session;
}

/** True for a session from `S-B-00`, false for one the demo picker minted. */
export function isStaffSession(session) {
  return session?.authKind === 'staff';
}

/** The renewal in flight, which every caller waits on instead of starting its own. */
let renewing = null;

/**
 * `POST /staff/refresh`. Returns false when the server refused the refresh
 * token — the session is over and has been forgotten. A network failure keeps
 * the session: the next attempt may reach the server.
 *
 * One at a time. The background renewal and the workspace check both reach
 * here on the same focus event, and a refresh token works once: a second
 * request with it reads as two parties holding it, and the server signs the
 * account out everywhere, taking an open doctor's unsaved notes with the
 * screen (FR-DOC-08, FR-SEC-06).
 */
export async function refreshStaffSession() {
  renewing ??= renewStaffSession().finally(() => {
    renewing = null;
  });
  return await renewing;
}

async function renewStaffSession() {
  const session = readDemoSession();
  if (session?.authKind !== 'staff' || session.refresh === undefined) return false;
  let response;
  try {
    response = await post('/staff/refresh', { refresh: session.refresh });
  } catch {
    return true;
  }
  if (response.ok) {
    const body = await response.json();
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
export function keepSessionFresh(onEnded, onChanged) {
  let running = false;
  const tick = async () => {
    const session = readDemoSession();
    if (running || session?.authKind !== 'staff' || session.accessExpiresAt === undefined) return;
    if (Date.parse(session.accessExpiresAt) - Date.now() > RENEW_BEFORE_MS) return;
    running = true;
    try {
      if (!(await refreshStaffSession())) onEnded();
      else if (readDemoSession()?.token !== session.token) onChanged?.();
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = globalThis.setInterval(() => void tick(), 30_000);
  const onFocus = () => void tick();
  globalThis.addEventListener?.('focus', onFocus);
  return () => {
    globalThis.clearInterval(timer);
    globalThis.removeEventListener?.('focus', onFocus);
  };
}

/** `POST /staff/logout`, then forget the session whatever the answer. */
export async function signOut() {
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

/** `POST /staff/password`. A success replaces the session with a fresh one. */
export async function changePassword(current, next) {
  const session = readDemoSession();
  if (session === null) return { ok: false, reason: 'failed' };
  if (isOffline()) return { ok: false, reason: 'offline' };
  let response;
  try {
    response = await post('/staff/password', { current, next }, session.token);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (response.ok) {
    const body = await response.json();
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

/**
 * `POST /staff/2fa` (`S-B-00b`). A code from the app or a recovery code; the
 * server tells them apart. `expired` means the challenge ran out or was
 * withdrawn — the password is asked for again.
 */
export async function verifySecondFactor(challenge, code) {
  if (isOffline()) return { ok: false, reason: 'offline' };
  let response;
  try {
    response = await post('/staff/2fa', { challenge, code: code.trim() });
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' };
  }
  if (response.ok) {
    const body = await response.json();
    return { ok: true, session: body.data };
  }
  const { code: errorCode, details } = await errorOf(response);
  if (errorCode === 'AUTH_2FA_INVALID' || response.status === 400) {
    return { ok: false, reason: 'invalid' };
  }
  if (errorCode === 'AUTH_LOCKED') {
    return {
      ok: false,
      reason: 'locked',
      ...(typeof details['until'] === 'string' ? { until: details['until'] } : {}),
    };
  }
  if (errorCode === 'AUTH_TOKEN_INVALID') return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'failed' };
}

/** `POST /staff/2fa/setup` (`S-B-00d`): a new secret for the app, shown once. */
export async function startTwoFactorSetup() {
  const session = readDemoSession();
  if (session === null) return { ok: false, reason: 'failed' };
  if (isOffline()) return { ok: false, reason: 'offline' };
  let response;
  try {
    response = await post('/staff/2fa/setup', {}, session.token);
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' };
  }
  if (response.ok) {
    const body = await response.json();
    return { ok: true, secret: body.data.secret, otpauthUri: body.data.otpauthUri };
  }
  const { code } = await errorOf(response);
  return { ok: false, reason: code === 'AUTH_2FA_ALREADY_ON' ? 'on' : 'failed' };
}

/**
 * `POST /staff/2fa/enable`. A success replaces the session at once: the
 * server ended every earlier one, this tab's included, so the old refresh
 * token is already dead.
 */
export async function enableTwoFactor(code) {
  const session = readDemoSession();
  if (session === null) return { ok: false, reason: 'failed' };
  if (isOffline()) return { ok: false, reason: 'offline' };
  let response;
  try {
    response = await post('/staff/2fa/enable', { code }, session.token);
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' };
  }
  if (response.ok) {
    const body = await response.json();
    adoptStaffSession(body.data.session, session);
    return { ok: true, recoveryCodes: body.data.recoveryCodes };
  }
  const { code: errorCode } = await errorOf(response);
  if (errorCode === 'AUTH_2FA_INVALID' || response.status === 400) {
    return { ok: false, reason: 'invalid' };
  }
  if (errorCode === 'AUTH_2FA_ALREADY_ON') return { ok: false, reason: 'on' };
  return { ok: false, reason: 'failed' };
}

/** `GET /demo/status`: whether this deployment offers the password-less picker. */
async function fetchDemoModeOnce(timeoutMs) {
  try {
    const response = await fetch(`${API}/demo/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = await response.json();
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
 *
 * The answer is also what every screen's demonstration line follows
 * (`lib/deployment.js`): it is told here, once, by the one question the page
 * asks.
 */
export async function askDemoMode(onWaking) {
  for (let attempt = 1; attempt <= STATUS_ATTEMPTS; attempt += 1) {
    if (attempt > 1) onWaking();
    const answer = await fetchDemoModeOnce(STATUS_ATTEMPT_MS);
    if (answer !== null) {
      rememberDemonstration(answer);
      return answer;
    }
  }
  return null;
}

/** Validate an explicit existing queue URL through its unchanged read guard.
 * This preserves permitted ended/historical reads without using remembered
 * selections as authority or patient values as landing metadata.
 */
export async function checkStaffQueueRead(sessionId) {
  const session = readDemoSession();
  if (session?.authKind !== 'staff') return false;
  try {
    const response = await fetch(`${API}/sessions/${encodeURIComponent(sessionId)}/queue`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel();
    return response.ok && readDemoSession()?.token === session.token;
  } catch {
    return false;
  }
}
export async function loadStaffWorkspaceContext(options = {}) {
  let session = readDemoSession();
  if (session?.authKind !== 'staff') return { kind: 'ended' };
  if (isOffline()) return { kind: 'offline' };
  try {
    const get = (path, token) =>
      fetch(`${API}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
    let response = await get('/staff/me', session.token);
    if (readDemoSession()?.token !== session.token) return { kind: 'failed' };
    if (response.status === 401 && session.refresh !== undefined) {
      if (!(await refreshStaffSession())) return { kind: 'ended' };
      session = readDemoSession();
      if (session?.authKind !== 'staff') return { kind: 'ended' };
      response = await get('/staff/me', session.token);
    }
    if (readDemoSession()?.token !== session.token) return { kind: 'failed' };
    if (response.status === 401 || response.status === 403) {
      clearDemoSession();
      return { kind: 'ended' };
    }
    if (!response.ok) return { kind: 'failed' };
    const { data: profile } = await response.json();
    if (readDemoSession()?.token !== session.token) return { kind: 'failed' }; // stale response after another sign-in/refresh
    // Preserve a workspace selected while the identity read was in flight.
    const latestSession = readDemoSession();
    if (latestSession === null) return { kind: 'ended' };
    session = latestSession;
    const sameHospital = session.hospitalId === (profile.hospital?.id ?? null);
    writeDemoSession({
      ...(sameHospital
        ? session
        : {
            token: session.token,
            staffName: session.staffName,
            hospitalId: session.hospitalId,
            role: session.role,
            authKind: 'staff',
            ...(session.refresh === undefined ? {} : { refresh: session.refresh }),
            ...(session.accessExpiresAt === undefined
              ? {}
              : { accessExpiresAt: session.accessExpiresAt }),
          }),
      hospitalId: profile.hospital?.id ?? null,
      staffId: profile.staff.id,
      staffName: profile.staff.fullName,
      roles: profile.roles,
      ...(profile.hospital === null
        ? {}
        : { hospitalNameBn: profile.hospital.nameBn, hospitalNameEn: profile.hospital.nameEn }),
      mustChangePassword: profile.mustChangePassword,
      twoFactor: profile.twoFactor,
    });
    if (profile.mustChangePassword || (profile.twoFactor.required && !profile.twoFactor.enabled))
      return { kind: 'restricted' };
    if (profile.hospital === null)
      return { kind: 'ready', context: { profile, chambers: [], desks: [], modulesOff: [] } };
    const roster = await get(
      options.includeEnded ? '/staff/chambers?includeEnded=1' : '/staff/chambers',
      session.token,
    );
    if (readDemoSession()?.token !== session.token) return { kind: 'failed' };
    if (roster.status === 401 || roster.status === 403) {
      clearDemoSession();
      return { kind: 'ended' };
    }
    if (!roster.ok) return { kind: 'failed' };
    const { data } = await roster.json();
    let desks = [];
    if (profile.roles.includes('receptionist')) {
      const deskRead = await get('/hospital/desks', session.token);
      if (readDemoSession()?.token !== session.token) return { kind: 'failed' };
      if (deskRead.status === 401 || deskRead.status === 403) {
        clearDemoSession();
        return { kind: 'ended' };
      }
      if (!deskRead.ok) return { kind: 'failed' };
      desks = (await deskRead.json()).data.desks;
    }
    if (readDemoSession()?.token !== session.token) return { kind: 'failed' };
    return {
      kind: 'ready',
      context: {
        profile,
        chambers: data.chambers.filter((chamber) => chamber.hospitalId === profile.hospital?.id),
        desks,
        modulesOff: data.modulesOff,
      },
    };
  } catch {
    return { kind: isOffline() ? 'offline' : 'failed' };
  }
}

/** `GET /staff/chambers`. Null when the server could not be asked. */
/**
 * The modules the signed-in member's hospital does not run (`FR-BRD-11`);
 * empty when it runs them all, and when it cannot be asked: the server
 * refuses what is off either way.
 */
export async function fetchStaffModulesOff() {
  const session = readDemoSession();
  if (session === null) return [];
  try {
    const response = await fetch(`${API}/staff/chambers`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return [];
    const body = await response.json();
    return body.data.modulesOff ?? [];
  } catch {
    return [];
  }
}

export async function fetchStaffChambers(includeEnded = false) {
  const session = readDemoSession();
  if (session === null) return null;
  try {
    const response = await fetch(`${API}/staff/chambers${includeEnded ? '?includeEnded=1' : ''}`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.data.chambers;
  } catch {
    return null;
  }
}
