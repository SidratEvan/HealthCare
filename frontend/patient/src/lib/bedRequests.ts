'use client';

/**
 * This phone's bed requests (`FR-PAT-52`).
 *
 * The same arrangement `lib/bookings.ts` makes for serials, for the same
 * reason: there are no accounts in this version (`CLAUDE.md` §4.1), so a
 * family's link to their request is the status token the API returned once,
 * kept on the device that asked. Nothing is sent by SMS until the hospital
 * answers — `bed.request_held` and `bed.request_declined` carry the link — so
 * without this, closing the tab before the answer would lose the request.
 *
 * `localStorage`, token included: the token is scoped to one request, expires,
 * and reaches no record. When Supabase Auth lands this becomes a read of the
 * account's requests.
 */

import type { BedKind } from '@platform/domain';

const KEY = 'patient.bed-requests';

/** A family asks for a bed and hears within hours; a week is plenty to keep one. */
const KEEP_DAYS = 7;

export interface SavedBedRequest {
  readonly requestId: string;
  readonly token: string;
  readonly hospitalNameBn: string;
  readonly bedKind: BedKind;
  readonly savedAt: string;
}

export function savedBedRequests(): readonly SavedBedRequest[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw === null || raw === undefined ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    return (parsed as SavedBedRequest[])
      .filter((entry) => typeof entry?.requestId === 'string' && typeof entry.token === 'string')
      .filter((entry) => Date.parse(entry.savedAt) > cutoff)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export function rememberBedRequest(request: SavedBedRequest): void {
  try {
    const kept = savedBedRequests().filter((entry) => entry.requestId !== request.requestId);
    globalThis.localStorage?.setItem(KEY, JSON.stringify([request, ...kept]));
  } catch {
    // A phone that cannot remember still sent the request; the ward has it,
    // and the answer's SMS carries the link.
  }
}
