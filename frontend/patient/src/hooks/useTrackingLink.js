'use client';

/**
 * Opens an SMS tracking link and keeps its access token current (`FR-GST-05`).
 *
 * The link in the SMS carries an opaque token that lasts until the chamber
 * closes plus a day. Exchanging it gives a booking, a queue, and an access
 * token that lasts fifteen minutes — so the one thing this hook has to get
 * right is exchanging again *before* that expires, or the socket drops
 * mid-session and the screen quietly stops being live.
 *
 * ## Why it refreshes early
 *
 * A minute of margin. Refreshing exactly on the boundary means the socket
 * reconnects during the second the server no longer accepts the old token,
 * and the failure looks like a network problem rather than a clock one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@platform/client';

import { openTrackingLink } from '@/lib/api';

/** How long before expiry to exchange again. */
const REFRESH_MARGIN_SECONDS = 60;

export function useTrackingLink(linkToken) {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  // The token the socket and the action calls read. Held in a ref as well as
  // in state so `getToken` can be a stable function — see `useSessionChannel`
  // for what an unstable one costs.
  const tokenRef = useRef(null);

  const retry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (linkToken === null || linkToken === '') {
      setLoading(false);
      setError('not-found');
      return undefined;
    }

    let cancelled = false;
    let timer;

    const exchange = async (isFirst) => {
      try {
        const next = await openTrackingLink(linkToken);
        if (cancelled) return;

        tokenRef.current = next.token;
        setView(next);
        setError(null);
        setLoading(false);

        // Round-trip again before this token dies, for as long as the screen
        // is open. A patient waits an hour; the token lasts fifteen minutes.
        timer = setTimeout(
          () => {
            void exchange(false);
          },
          Math.max(30, next.expiresInSeconds - REFRESH_MARGIN_SECONDS) * 1000,
        );
      } catch (thrown) {
        if (cancelled) return;
        setLoading(false);

        // A refresh that fails leaves the screen showing what it has, with the
        // freshness line saying how old it is. Only the first load has nothing
        // to fall back on (`FR-OFF-02`).
        if (!isFirst) {
          timer = setTimeout(() => {
            void exchange(false);
          }, 30_000);
          return;
        }

        if (thrown instanceof ApiError && thrown.code === 'GUEST_LINK_EXPIRED') {
          setError('expired');
        } else if (thrown instanceof ApiError && thrown.status === 404) {
          setError('not-found');
        } else {
          setError('failed');
        }
      }
    };

    setLoading(true);
    void exchange(true);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [linkToken, attempt]);

  const getToken = useCallback(() => tokenRef.current, []);

  return {
    booking: view?.booking ?? null,
    initial: view,
    token: view?.token ?? null,
    getToken,
    loading,
    error,
    retry,
  };
}
