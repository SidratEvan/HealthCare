/**
 * `S-B-11` hospital settings — the console's calls (pilot step 22,
 * BACKEND.md §7.7 `/hospital/*`, `FR-SUP-01`, `FR-ADM-11`).
 *
 * Kept out of the screen for the reason `lib/admin.js` is: the screen reads as
 * a sequence of decisions, and a test can hand it a fake.
 *
 * ## Online only
 *
 * Settings are not queued offline the way a queue action is. A fee or a
 * staff account changed from a stale copy could undo somebody else's change
 * without either person knowing, and none of this is urgent the way calling
 * the next patient is. So with the network gone the screen keeps what it
 * last read, says how old it is, and disables every save with the reason.
 *
 * ## The facility is never in the request
 *
 * Every path is `/hospital/...`: the API takes the facility off the
 * administrator's own principal (`FR-ROLE-01`).
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';

import { readDemoSession } from '@/lib/demo';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

function client() {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => readDemoSession()?.token ?? null });
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function failureOf(error) {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (error instanceof ApiError) {
    const details = error.details ?? {};
    if (error.code === 'SETTINGS_DUPLICATE') {
      const labels = Array.isArray(details['labels']) ? details['labels'].map(String) : undefined;
      return {
        kind: 'duplicate',
        field: textOf(details['field']),
        ...(labels === undefined ? {} : { labels }),
      };
    }
    if (error.code === 'SETTINGS_NOT_ALLOWED') {
      return { kind: 'notAllowed', reason: textOf(details['reason']) };
    }
    if (error.code === 'VALIDATION_FAILED') return { kind: 'invalid' };
  }
  return { kind: 'failed' };
}

async function save(call) {
  try {
    return { ok: true, value: await call(client(), crypto.randomUUID()) };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

/**
 * The signed-in account's id, from the access token's `sub` — only to mark
 * "you" on the staff list and hide the actions the API refuses on oneself.
 * Read, not verified: the server checks every one of those itself.
 */
export function signedInStaffId() {
  const token = readDemoSession()?.token;
  const payload = token?.split('.')[1];
  if (payload === undefined) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = JSON.parse(json).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/**
 * The hospital's own logo as an address this page can show, or null.
 *
 * Read with the administrator's token and turned into a blob address, because
 * the public address answers for a live hospital only and an `<img>` cannot
 * send a token. The caller revokes the address when it is done with it.
 */
export async function loadOwnLogo() {
  const token = readDemoSession()?.token;
  if (token === undefined) return null;
  try {
    const response = await fetch(`${API_BASE}/hospital/logo`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

export async function loadMonthOfMessages() {
  try {
    return await client().get('/hospital/messages');
  } catch (error) {
    return error instanceof NetworkError ? 'offline' : 'error';
  }
}

/** `GET /hospital/desks`, for the settings screen and the picker. */
export async function loadDesks() {
  try {
    return (await client().get('/hospital/desks')).desks;
  } catch (error) {
    return error instanceof NetworkError ? 'offline' : 'error';
  }
}

/** Loading: `'offline'` when the request never reached the server. */
export async function loadSetup() {
  try {
    return await client().get('/hospital/setup');
  } catch (error) {
    return error instanceof NetworkError ? 'offline' : 'error';
  }
}

export const settingsApi = {
  profile: (body) => save((api, key) => api.patch('/hospital/profile', body, key)),
  /** The hospital's colours, or null for the platform's own (`FR-BRD-06`). */
  brand: (theme) => save((api, key) => api.put('/hospital/brand', { theme }, key)),
  /** Which live figures the hospital keeps to itself (`FR-NET-04`). */
  publishing: (unpublished) =>
    save((api, key) => api.put('/hospital/publishing', { unpublished }, key)),
  logo: (body) => save((api, key) => api.put('/hospital/logo', body, key)),
  removeLogo: () => save((api, key) => api.delete('/hospital/logo', key)),
  rules: (body) => save((api, key) => api.patch('/hospital/rules', body, key)),
  addDepartment: (body) => save((api, key) => api.post('/hospital/departments', body, key)),
  updateDepartment: (departmentId, body) =>
    save((api, key) => api.patch(`/hospital/departments/${departmentId}`, body, key)),
  /** One nobody sits in (plan D2); refused, with why, while a doctor is listed under it. */
  removeDepartment: (departmentId) =>
    save((api, key) => api.delete(`/hospital/departments/${departmentId}`, key)),
  addDoctor: (body) => save((api, key) => api.post('/hospital/doctors', body, key)),
  updateDoctor: (doctorHospitalId, body) =>
    save((api, key) => api.patch(`/hospital/doctors/${doctorHospitalId}`, body, key)),
  addSchedule: (body) => save((api, key) => api.post('/hospital/templates', body, key)),
  removeSchedule: (templateId) =>
    save((api, key) => api.delete(`/hospital/templates/${templateId}`, key)),
  addWard: (body) => save((api, key) => api.post('/hospital/wards', body, key)),
  updateWard: (wardId, body) =>
    save((api, key) => api.patch(`/hospital/wards/${wardId}`, body, key)),
  /** One that holds no bed (plan D2). */
  removeWard: (wardId) => save((api, key) => api.delete(`/hospital/wards/${wardId}`, key)),
  addBeds: (body) => save((api, key) => api.post('/hospital/beds', body, key)),
  updateBed: (bedId, body) => save((api, key) => api.patch(`/hospital/beds/${bedId}`, body, key)),
  /** One the ward never brought into service (plan D2). */
  removeBed: (bedId) => save((api, key) => api.delete(`/hospital/beds/${bedId}`, key)),
  /** Reception desks (`FR-REC-32`, plan R4). */
  addDesk: (body) => save((api, key) => api.post('/hospital/desks', body, key)),
  updateDesk: (deskId, body) =>
    save((api, key) => api.patch(`/hospital/desks/${deskId}`, body, key)),
  removeDesk: (deskId) => save((api, key) => api.delete(`/hospital/desks/${deskId}`, key)),
  addStaff: (body) => save((api, key) => api.post('/hospital/staff', body, key)),
  updateStaff: (staffId, body) =>
    save((api, key) => api.patch(`/hospital/staff/${staffId}`, body, key)),
  resetPassword: (staffId) =>
    save((api, key) => api.post(`/hospital/staff/${staffId}/reset-password`, {}, key)),
  /** A lost phone (pilot step 28): the second factor off, every session ended. */
  resetTwoFactor: (staffId) =>
    save((api, key) => api.post(`/hospital/staff/${staffId}/reset-2fa`, {}, key)),
  capabilities: (kinds) => save((api, key) => api.put('/hospital/capabilities', { kinds }, key)),
  /**
   * `FR-ONB-04`: asks the platform to review the workspace. Publishes
   * nothing; a platform administrator approves it or sends it back.
   */
  requestReview: () => save((api, key) => api.post('/hospital/request-review', {}, key)),
};

/**
 * Bed labels as an administrator types them: `301-320`, `ICU-1, ICU-2`, or
 * one per line. A range expands with the width of its first number kept
 * (`01-12` gives `01`…`12`), and a prefix before the range repeats
 * (`ICU-1-8` gives `ICU-1`…`ICU-8`). Returns null for anything it cannot
 * read, and never more than two hundred.
 */
export function expandBedLabels(input) {
  const labels = [];
  for (const raw of input.split(/[,\n]/)) {
    const part = raw.trim();
    if (part === '') continue;
    const range = /^(.*?)(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range !== null) {
      const [, prefix = '', fromText = '', toText = ''] = range;
      const from = Number(fromText);
      const to = Number(toText);
      if (to < from || to - from >= 200) return null;
      for (let n = from; n <= to; n += 1)
        labels.push(`${prefix}${String(n).padStart(fromText.length, '0')}`);
    } else {
      labels.push(part);
    }
  }
  if (labels.length === 0 || labels.length > 200) return null;
  if (labels.some((label) => label.length > 20)) return null;
  return labels;
}

/** Taka as typed (`800`, `800.50`) to integer poisha (`DB-P5`); null when it is not money. */
export function takaToPoisha(input) {
  const match = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (match === null) return null;
  const taka = Number(match[1]);
  const paisa = Number((match[2] ?? '').padEnd(2, '0'));
  return taka * 100 + paisa;
}
