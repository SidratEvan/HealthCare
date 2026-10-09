/**
 * The preferred hours a chamber offers (`PRD.md` `FR-PAT-28`; plan R1).
 *
 * One-hour windows across the chamber, counted from its planned start, the
 * last cut at its planned end. A preference and never a promise: nothing in
 * the queue reads these, and a serial is called in its order.
 *
 * Pure. Instants are ISO strings, as the session carries them.
 */

export interface ArrivalWindow {
  /** The window's start: what a booking keeps (`bookings.arrival_window_start`). */
  readonly start: string;
  readonly end: string;
}

const HOUR_MS = 60 * 60 * 1000;

/** At most this many: a chamber longer than this is offered its first twelve hours. */
const MAX_WINDOWS = 12;

export function arrivalWindows(plannedStart: string, plannedEnd: string): readonly ArrivalWindow[] {
  const start = Date.parse(plannedStart);
  const end = Date.parse(plannedEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const windows: ArrivalWindow[] = [];
  for (let at = start; at < end && windows.length < MAX_WINDOWS; at += HOUR_MS) {
    windows.push({
      start: new Date(at).toISOString(),
      end: new Date(Math.min(at + HOUR_MS, end)).toISOString(),
    });
  }
  return windows;
}

/** The window a chosen start names, or null when it is not one of the chamber's. */
export function arrivalWindowAt(
  plannedStart: string,
  plannedEnd: string,
  chosenStart: string,
): ArrivalWindow | null {
  const chosen = Date.parse(chosenStart);
  if (!Number.isFinite(chosen)) return null;
  return (
    arrivalWindows(plannedStart, plannedEnd).find(
      (window) => Date.parse(window.start) === chosen,
    ) ?? null
  );
}
