'use client';

/**
 * Registers the console's service worker (`FR-OFF-01`, FRONTEND.md §9).
 *
 * The worker keeps the console's shell so it opens with no network
 * (`public/sw.js`). Registering it is not enough on a first visit: the page
 * that registers a worker was itself loaded without one, so nothing of it is
 * cached. Once the worker has taken control this tells it what the page
 * loaded, and the worker keeps those too. When it answers, `<html>` carries
 * `data-offline-ready` — the one honest signal that a reload no longer needs
 * the network.
 *
 * Best-effort and silent on failure, like the patient app's: a browser that
 * refuses service workers loses the offline reload, not the console.
 */

import { useEffect } from 'react';

import type { ReactNode } from 'react';

export function ServiceWorker(): ReactNode {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const workers = navigator.serviceWorker;

    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      if (
        typeof data === 'object' &&
        data !== null &&
        (data as { type?: unknown }).type === 'warmed'
      ) {
        document.documentElement.dataset['offlineReady'] = 'true';
      }
    };
    workers.addEventListener('message', onMessage);

    const start = async (): Promise<void> => {
      try {
        await workers.register('/sw.js');
        const registration = await workers.ready;

        // The worker claims the page when it activates; wait for that, so what
        // it is asked to keep is fetched through it.
        if (workers.controller === null) {
          await new Promise<void>((resolve) => {
            workers.addEventListener(
              'controllerchange',
              () => {
                resolve();
              },
              { once: true },
            );
            if (workers.controller !== null) resolve();
          });
        }

        const loaded = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.startsWith(globalThis.location.origin));
        registration.active?.postMessage({
          type: 'warm',
          urls: [globalThis.location.href, ...loaded],
        });
      } catch {
        // Nothing to tell the person. See above.
      }
    };

    const onLoad = (): void => {
      void start();
    };
    if (document.readyState === 'complete') onLoad();
    else globalThis.addEventListener('load', onLoad, { once: true });

    return () => {
      globalThis.removeEventListener('load', onLoad);
      workers.removeEventListener('message', onMessage);
    };
  }, []);

  return null;
}
