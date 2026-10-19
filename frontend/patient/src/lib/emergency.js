'use client';

const SEARCH_KEY = 'patient.emergency.last-search';
const ALERTS_KEY = 'patient.emergency.alerts';
const KEEP_ALERT_MS = 24 * 60 * 60 * 1000;

export function lastSearch(problem) {
  try {
    const raw = globalThis.localStorage?.getItem(SEARCH_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw);
    // Only the same question's answer: a burn search's list is not an answer
    // to a stroke.
    return parsed.problem === problem && Array.isArray(parsed.results) ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberSearch(result) {
  try {
    globalThis.localStorage?.setItem(SEARCH_KEY, JSON.stringify(result));
  } catch {
    // Nothing to do: the next search is fetched either way.
  }
}

export function sentAlerts() {
  try {
    const raw = globalThis.localStorage?.getItem(ALERTS_KEY);
    const parsed = raw === null || raw === undefined ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - KEEP_ALERT_MS;
    return parsed.filter(
      (entry) => typeof entry?.token === 'string' && Date.parse(entry.sentAt) > cutoff,
    );
  } catch {
    return [];
  }
}

export function rememberAlert(alert) {
  try {
    const kept = sentAlerts().filter((entry) => entry.caseId !== alert.caseId);
    globalThis.localStorage?.setItem(ALERTS_KEY, JSON.stringify([alert, ...kept]));
  } catch {
    // The hospital was told either way; the SMS, if a number was left, carries the link.
  }
}

/** A map app's directions to a point. Opens whatever the phone uses for maps. */
export function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${String(lat)},${String(lng)}`;
}
