'use client';

/**
 * Where the phone is, once, for emergency search (`S-A-10b`, `FR-PAT-43`).
 *
 * The browser's own prompt, and nothing more: `S-A-01`'s location flow is not
 * built, and an emergency is the wrong moment to show a screen explaining
 * permissions. If the answer is no, or does not come, the search runs without
 * a position and says so — ranked by what can treat the problem and how busy
 * each ER is, with no distance claimed (`PRD.md` §3.2).
 *
 * The position is used for one search and one alert's ETA, and is kept
 * nowhere: not in storage, not on the server.
 */

import { useCallback, useEffect, useState } from 'react';

export type PositionState =
  | { readonly kind: 'locating' }
  | { readonly kind: 'found'; readonly lat: number; readonly lng: number }
  | { readonly kind: 'unavailable' };

/** Long enough for a phone's first fix, short enough that nobody waits on it. */
const TIMEOUT_MS = 8_000;

export function usePosition(): { readonly position: PositionState; readonly retry: () => void } {
  const [position, setPosition] = useState<PositionState>({ kind: 'locating' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const geolocation = globalThis.navigator?.geolocation;
    if (geolocation === undefined) {
      setPosition({ kind: 'unavailable' });
      return undefined;
    }

    let settled = false;
    setPosition({ kind: 'locating' });

    geolocation.getCurrentPosition(
      (found) => {
        settled = true;
        setPosition({ kind: 'found', lat: found.coords.latitude, lng: found.coords.longitude });
      },
      () => {
        settled = true;
        setPosition({ kind: 'unavailable' });
      },
      // A cached fix up to two minutes old is fine for ranking hospitals
      // kilometres apart, and returns at once.
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 120_000 },
    );

    // Some browsers never call back when the prompt is ignored.
    const fallback = setTimeout(() => {
      if (!settled) setPosition({ kind: 'unavailable' });
    }, TIMEOUT_MS + 1_000);

    return () => {
      clearTimeout(fallback);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { position, retry };
}
