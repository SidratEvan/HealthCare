'use client';

/**
 * A clock that ticks, for the things on `S-A-08` that age on their own.
 *
 * Two of them do. The countdown is "recalculated locally each minute,
 * corrected by server events" (`APP_FLOW.md` A5), and `<FreshnessLine>` counts
 * the minutes since the last update — which means that without a tick, a
 * screen left open says "হালনাগাদ ২ মিনিট আগে" an hour later. That is exactly
 * the dishonesty the freshness line exists to prevent (`FR-OFF-03`).
 *
 * The first value is fixed rather than `new Date()`, because the server render
 * has a different clock from the browser's and React treats the difference as
 * a hydration error. The effect replaces it on mount, which is one frame later
 * and invisible.
 */

import { useEffect, useState } from 'react';

/** Once a minute: the resolution every figure on this screen is shown at. */
export const MINUTE_MS = 60_000;

export function useNow(intervalMs: number = MINUTE_MS): Date {
  const [now, setNow] = useState<Date>(() => new Date(0));

  useEffect(() => {
    setNow(new Date());

    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
