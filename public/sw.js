/* Campus Conveyance service worker.
 *
 * Two jobs:
 *  1) Web Push for booking-lifecycle alerts (show + focus/open on click).
 *  2) Speed: cache the app's static assets so repeat opens (especially inside
 *     the native app, which reloads the remote site each launch) paint instantly
 *     instead of re-downloading every chunk over the network.
 *
 * Caching rules (deliberately conservative so it never serves stale app logic):
 *   - `/_next/static/*` is content-hashed & immutable → cache-first, forever.
 *   - other same-origin static files (icons, images, fonts) → stale-while-
 *     revalidate (instant from cache, refreshed in the background).
 *   - HTML documents and API/auth requests are NEVER cached — always network,
 *     so pages, sessions and data are always live. */

const CACHE = 'cc-static-v2';

self.addEventListener('install', () => {
  // Activate immediately so a freshly-registered worker can receive pushes and
  // start caching without waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older SW versions so we never serve outdated assets.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const STATIC_FILE = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Only touch our own origin, and only static assets — never HTML or API/auth.
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || req.destination === 'document') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  const isImmutable = url.pathname.startsWith('/_next/static/');
  const isStatic = isImmutable || STATIC_FILE.test(url.pathname);
  if (!isStatic) return;

  if (isImmutable) {
    // Cache-first: hashed filenames change on every deploy, so this is safe.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Stale-while-revalidate for non-hashed static files.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Campus Conveyance', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Campus Conveyance';
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: data.url || '/' },
    // Coalesce rapid updates for the same booking flow into one visible alert.
    tag: 'campus-conveyance',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab if one is open; otherwise open a new one.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
