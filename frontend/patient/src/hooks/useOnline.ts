'use client';

/**
 * Whether the browser currently has a network.
 *
 * `GR-03` requires four states on every screen — loading, empty, error and
 * offline — and booking is the one flow in this app that cannot be completed
 * without a connection: it takes a serial from a shared queue and, with a
 * digital method, a payment. Showing the form as though it will work is the
 * dishonest option (`PRD.md` §3.2).
 *
 * `navigator.onLine` is the earliest signal available and is authoritative in
 * the direction that matters: when it says offline, it is. The console tracks
 * the same thing for the same reason, and separately from its socket, because
 * a dropped wifi does not close an established WebSocket.
 */

import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  // Starts optimistic so the first client render matches the server's, which
  // has no `navigator`; the effect corrects it immediately after mount.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(globalThis.navigator?.onLine ?? true);

    const goOnline = (): void => {
      setOnline(true);
    };
    const goOffline = (): void => {
      setOnline(false);
    };

    globalThis.addEventListener('online', goOnline);
    globalThis.addEventListener('offline', goOffline);
    return () => {
      globalThis.removeEventListener('online', goOnline);
      globalThis.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
