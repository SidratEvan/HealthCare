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

import type { BookingDetail, TrackingLinkView } from '@/lib/types';

/** How long before expiry to exchange again. */
const REFRESH_MARGIN_SECONDS = 60;

/**
 * Why the screen has nothing to show.
 *
 * Separated by cause because the three need different sentences: an expired
 * link tells a person to book again, a missing booking is a wrong URL, and a
 * failure is worth retrying (`GR-03`, BACKEND.md §9).
 */
export type TrackingLinkError = 'expired' | 'not-found' | 'failed';

export interface TrackingLink {
  readonly booking: BookingDetail | null;
  /** The first paint's queue, before the socket has said anything. */
  readonly initial: TrackingLinkView | null;
  /** The current access token, exchanged again before it expires. */
  readonly token: string | null;
  /**
   * The same token, read through a stable function.
   *
   * The socket handshake wants a getter whose identity never changes, so the
   * channel is not torn down and rebuilt on every render — and it must still
   * hand back the *current* token after a refresh, which a closure over state
   * would not.
   */
  readonly getToken: () => string | null;
  readonly loading: boolean;
  readonly error: TrackingLinkError | null;
  readonly retry: () => void;
}

export function useTrackingLink(linkToken: string | null): TrackingLink {
  const [view, setView] = useState<TrackingLinkView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TrackingLinkError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The token the socket and the action calls read. Held in a ref as well as
  // in state so `getToken` can be a stable function — see `useSessionChannel`
  // for what an unstable one costs.
  const tokenRef = useRef<string | null>(null);

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
    let timer: ReturnType<typeof setTimeout> | undefined;

    const exchange = async (isFirst: boolean): Promise<void> => {
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
