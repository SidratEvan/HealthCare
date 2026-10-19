'use client';

/**
 * `useSessionChannel(sessionId)` (FRONTEND.md §11.2).
 *
 * "Subscribes, handles reconnect with exponential backoff, replays missed
 * events by sequence number on reconnect, and exposes `{ state, lastServerTs,
 * isStale }`. `isStale` drives every `<FreshnessLine>`."
 *
 * All of that already exists, framework-free, in `@platform/client` —
 * `openSessionChannel` owns the socket lifetime, the resume handshake and the
 * staleness rule, and is tested in plain Node. This hook is the React wrapper
 * over it, and the console's `useSessionQueue` wraps the same object for the
 * same reason: there is one definition of how a client talks to a session, and
 * neither side gets its own.
 *
 * ## What this hook does *not* do
 *
 * No optimistic reducer. The console has one because a receptionist taps
 * `next` forty times an hour and must not wait for a server (`NFR-02`); a
 * patient's two actions are rare, deliberate and consequential, and showing
 * one as done before the hospital has heard it would be a lie a person acts
 * on. So `S-A-08` waits for the server and says it is waiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { openSessionChannel } from '@platform/client';

export function useSessionChannel(options) {
  const { sessionId, socketUrl } = options;

  /**
   * The token getter lives in a ref, never in a dependency array.
   *
   * A caller writing `getToken={() => token}` inline — the natural way —
   * creates a new function every render. With that in the effect's
   * dependencies the socket tears down and reopens on each one and never
   * finishes its handshake, which the console learned the expensive way
   * (`useSessionQueue`).
   */
  const getTokenRef = useRef(options.getToken);
  getTokenRef.current = options.getToken;
  const getToken = useCallback(() => getTokenRef.current(), []);

  const [snapshot, setSnapshot] = useState({
    state: null,
    etas: [],
    lastServerTs: null,
    lastSeq: 0,
    connected: false,
  });
  const [error, setError] = useState(null);

  /**
   * What the browser itself says about the network.
   *
   * Tracked separately from the socket because the socket finds out far too
   * late: a dropped connection does not close an established WebSocket, and
   * Socket.IO only notices when its ping times out. A patient's screen that
   * claimed to be live for a minute after the signal died would be telling
   * them something false at the moment it matters most.
   */
  const [browserOnline, setBrowserOnline] = useState(true);

  useEffect(() => {
    if (sessionId === '') return undefined;

    const channel = openSessionChannel({
      url: socketUrl,
      sessionId,
      getToken,
      onSnapshot: setSnapshot,
      onError: (code) => {
        setError(code);
      },
    });

    return () => {
      channel.close();
    };
  }, [sessionId, socketUrl, getToken]);

  useEffect(() => {
    setBrowserOnline(globalThis.navigator?.onLine ?? true);

    const goOnline = () => {
      setBrowserOnline(true);
    };
    const goOffline = () => {
      setBrowserOnline(false);
    };

    globalThis.addEventListener('online', goOnline);
    globalThis.addEventListener('offline', goOffline);
    return () => {
      globalThis.removeEventListener('online', goOnline);
      globalThis.removeEventListener('offline', goOffline);
    };
  }, []);

  const connected = snapshot.connected && browserOnline;

  return {
    ...snapshot,
    connected,
    isStale: !connected || snapshot.lastServerTs === null,
    error,
  };
}
