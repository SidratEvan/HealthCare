'use client';

/**
 * Registers the service worker (FRONTEND.md §9).
 *
 * Deferred until after load. A service worker registered during the first
 * paint competes with the requests that paint actually needs, which on the
 * 3G connection this app is built for (`NFR-04`) costs more than it saves.
 *
 * Registration is best-effort and silent on failure: Safari in private
 * browsing, a browser with storage blocked and an insecure origin all throw,
 * and none of them is a reason for a patient to see an error. The app works
 * without it — what it loses is opening offline, not booking.
 */

import { useEffect } from 'react';

import type { ReactNode } from 'react';

export function ServiceWorker(): ReactNode {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = (): void => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Nothing to tell the person. See above.
      });
    };

    if (document.readyState === 'complete') {
      register();
      return undefined;
    }

    globalThis.addEventListener('load', register);
    return () => {
      globalThis.removeEventListener('load', register);
    };
  }, []);

  return null;
}
