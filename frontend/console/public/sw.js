/**
 * The staff console's service worker (`FR-OFF-01`, FRONTEND.md §9).
 *
 * "Reception, ward, and emergency consoles are offline-first: full read and
 * write capability without internet." Until this existed the console could
 * keep working through an outage only while its tab stayed open: with no
 * network, a reload was the browser's error page, and a counter that had been
 * queueing actions for twenty minutes had nothing to queue them in.
 *
 * Hand-written and small, like the patient app's (`frontend/patient/public/
 * sw.js`), and for the same reason: what is needed is narrow and the rules are
 * strict.
 *
 * ## What is cached, and what never is
 *
 * The shell — the page, its scripts, its styles, its fonts — so the console
 * opens. **Never the API and never the socket.** A queue answered from an HTTP
 * cache is a number with no age (`FR-OFF-03`, PRD.md §3.2). What the console
 * shows after an offline reload is the last state it was *told*, kept by the
 * console itself with the server's timestamp beside it, and drawn with its age
 * (`useSessionQueue`); this file has no part in that.
 */

const SHELL = 'console-shell-v1';

/** The one page there is: the console is a single route that reads its query. */
const PRECACHE = ['/'];

/** Paths that are never kept and never answered from the cache. */
function isLive(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(async (cache) => {
        await Promise.all(PRECACHE.map((path) => cache.add(path).catch(() => undefined)));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        await Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The API and the socket live on another origin, and are never cached.
  if (url.origin !== self.location.origin) return;
  if (isLive(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);

      // Network first, so a new build is picked up rather than pinned. The
      // cache is for a counter with no signal, not the source.
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          void cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        // A development build stamps its scripts with a query that changes on
        // every load; the file behind it is the same one.
        const cached =
          (await cache.match(request)) ?? (await cache.match(request, { ignoreSearch: true }));
        if (cached !== undefined) return cached;

        // `/?session=…` for a chamber this device has not opened before is
        // still the same page: the query is read in the browser.
        if (request.mode === 'navigate') {
          const shell = await cache.match('/');
          if (shell !== undefined) return shell;
        }

        throw error;
      }
    })(),
  );
});

/**
 * "Keep what this page is made of."
 *
 * A service worker only sees the requests made after it took control, so on a
 * first visit the page that registered it was loaded without it and nothing
 * of that page is in the cache — a reload during an outage would still fail,
 * on exactly the shift the console was first opened. So the page says what it
 * loaded (`ServiceWorker.tsx`), and this fetches each of those once more and
 * keeps it. It answers when it is done, which is how the page knows — and how
 * a test knows — that a reload no longer needs the network.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === null || typeof data !== 'object' || data.type !== 'warm') return;
  if (!Array.isArray(data.urls)) return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);

      await Promise.all(
        data.urls.map(async (raw) => {
          try {
            const url = new URL(String(raw), self.location.origin);
            if (url.origin !== self.location.origin || isLive(url)) return;

            const response = await fetch(url.href);
            if (response.ok && response.type === 'basic') await cache.put(url.href, response);
          } catch {
            // One file that could not be fetched does not stop the others.
          }
        }),
      );

      if (event.source !== null) event.source.postMessage({ type: 'warmed' });
    })(),
  );
});
