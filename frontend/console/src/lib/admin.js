/**
 * The admin dashboard's calls to the API (BACKEND.md §7.7, `S-B-10`).
 *
 * Kept out of the screen for the reason `lib/lab.js` is: a screen reads as a
 * sequence of decisions, and a test can hand it a fake.
 *
 * ## Read-only, and online-only
 *
 * The other consoles queue their actions in an outbox and keep working with
 * the network gone (`FR-OFF-01`), because a ward at two in the morning cannot
 * wait for a connection. A dashboard is not that: it has no actions, and an
 * aggregate computed against a stale local copy is a figure a director would
 * act on without knowing how old it is. So when the network is gone this
 * screen says so and shows what it last had, with its age ageing honestly
 * (`GR-03`, `FR-OFF-03`).
 *
 * ## The hospital is never in the request
 *
 * `/admin/dashboard` takes a date range and nothing else. The facility comes
 * off the caller's own principal, server-side, so there is no parameter here
 * to get wrong — see the header of `backend/api/src/routes/admin.routes.ts`.
 */

import { ApiClient, NetworkError } from '@platform/client';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/** The windows `S-B-10`'s date selector offers. */
export const RANGES = [
  { days: 0, key: 'adminRangeToday' },
  { days: 6, key: 'adminRange7' },
  { days: 29, key: 'adminRange30' },
  { days: 89, key: 'adminRange90' },
];

function client(token) {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => token });
}

/**
 * The Dhaka calendar date `daysAgo` before today.
 *
 * Computed here rather than sent as a duration, because "the last thirty days"
 * has to mean the same thirty days to the screen and to the server — and a
 * server in another zone counting back from its own midnight would silently
 * shift the window by a day for half of each day.
 */
export function dhakaDate(daysAgo, clock = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(clock);

  const at = new Date(`${parts}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - daysAgo);
  return at.toISOString().slice(0, 10);
}

/** Capture one clock for both inclusive bounds, including Dhaka midnight. */
export function reportRange(days, clock = new Date()) {
  return { from: dhakaDate(days, clock), to: dhakaDate(0, clock) };
}

export const adminApi = {
  async dashboard(token, days) {
    const { from, to } = reportRange(days);
    return await client(token).get(`/admin/dashboard?from=${from}&to=${to}`);
  },
  async overview(token) {
    return await client(token).get('/admin/overview');
  },
};

/**
 * Downloads one section as CSV (`FR-ADM-10`, `BTN-B10-EXPORT`).
 *
 * Fetched rather than followed as a link, because the request needs the
 * bearer token and a browser navigation carries no headers. The blob is
 * revoked immediately: a URL left alive pins the file in memory for the life
 * of the tab, and an administrator exporting eight sections in a morning
 * would pin eight.
 */
export async function downloadExport(token, view, days, range = reportRange(days)) {
  const { from, to } = range;

  const response = await fetch(`${API_BASE}/admin/export?view=${view}&from=${from}&to=${to}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) throw new Error(`export failed: ${String(response.status)}`);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${view}-${from}-to-${to}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Which of the four `GR-03` states a failure puts the screen into.
 *
 * Never reaching the server is being offline; anything the server said —
 * a refusal or a fault — is an error, and says so.
 */
export function failureOf(error) {
  return error instanceof NetworkError ? 'offline' : 'error';
}
