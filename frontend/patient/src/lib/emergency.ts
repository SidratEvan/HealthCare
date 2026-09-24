'use client';

/**
 * What this phone keeps about an emergency (`S-A-10b`, `S-A-10c`).
 *
 * Two things, both in `localStorage` and both wrapped so a phone that cannot
 * store still works:
 *
 *   **The last search.** `FR-OFF-02`: "cached last-known state plus an explicit
 *   staleness banner". A family that loses signal in a moving car still sees
 *   the hospitals and their numbers from the last search, with its age, and is
 *   told to call rather than trust them. The service worker never caches an
 *   API answer (`FR-OFF-03`); this is the screen keeping its own last look,
 *   saying how old it is.
 *
 *   **The alerts sent.** Like a bed request's status link: there are no
 *   accounts (`CLAUDE.md` §4.1), so the link to "is the hospital ready" is the
 *   token the API returned once. A day is plenty — the token lives a day.
 *
 * Nothing here records where anybody was.
 */

import type { EmergencyProblem } from '@platform/domain';

import type { EmergencySearchResult } from '@/lib/types';

const SEARCH_KEY = 'patient.emergency.last-search';
const ALERTS_KEY = 'patient.emergency.alerts';
const KEEP_ALERT_MS = 24 * 60 * 60 * 1000;

export function lastSearch(problem: EmergencyProblem | null): EmergencySearchResult | null {
  try {
    const raw = globalThis.localStorage?.getItem(SEARCH_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw) as EmergencySearchResult;
    // Only the same question's answer: a burn search's list is not an answer
    // to a stroke.
    return parsed.problem === problem && Array.isArray(parsed.results) ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberSearch(result: EmergencySearchResult): void {
  try {
    globalThis.localStorage?.setItem(SEARCH_KEY, JSON.stringify(result));
  } catch {
    // Nothing to do: the next search is fetched either way.
  }
}

export interface SentAlert {
  readonly caseId: string;
  readonly token: string;
  readonly hospitalNameBn: string;
  /**
   * English names, for the language switch (`SEG-A00-LANG`). Optional because
   * a record saved on this phone before they existed does not have them, and
   * `localName` falls back to the Bangla.
   */
  readonly hospitalNameEn?: string;
  readonly problem: EmergencyProblem;
  readonly sentAt: string;
}

export function sentAlerts(): readonly SentAlert[] {
  try {
    const raw = globalThis.localStorage?.getItem(ALERTS_KEY);
    const parsed: unknown = raw === null || raw === undefined ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - KEEP_ALERT_MS;
    return (parsed as SentAlert[]).filter(
      (entry) => typeof entry?.token === 'string' && Date.parse(entry.sentAt) > cutoff,
    );
  } catch {
    return [];
  }
}

export function rememberAlert(alert: SentAlert): void {
  try {
    const kept = sentAlerts().filter((entry) => entry.caseId !== alert.caseId);
    globalThis.localStorage?.setItem(ALERTS_KEY, JSON.stringify([alert, ...kept]));
  } catch {
    // The hospital was told either way; the SMS, if a number was left, carries the link.
  }
}

/** A map app's directions to a point. Opens whatever the phone uses for maps. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${String(lat)},${String(lng)}`;
}
