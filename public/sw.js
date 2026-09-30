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
 *     so pages, sessions and data are always live.
 *   - caches are versioned (CACHE_VERSION); old ones are deleted on activate,
 *     and each cache is capped (LRU-ish trim) so it can't grow without bound. */

// Versioned cache names. Bump CACHE_VERSION when caching rules change; the
// activate handler deletes every cache that isn't in the current set, so old
// versions never linger on the device.
const CACHE_VERSION = 'v3';
const IMMUTABLE_CACHE = `cc-immutable-${CACHE_VERSION}`; // /_next/static (hashed)
const RUNTIME_CACHE = `cc-runtime-${CACHE_VERSION}`; // icons, images, fonts
const CURRENT_CACHES = [IMMUTABLE_CACHE, RUNTIME_CACHE];

// Entry caps. Hashed chunks change on every deploy, so without a cap the
// immutable cache grows by a full build's worth of chunks per release. Cache
// keys are kept in insertion order, and a hit is re-inserted (see touch()), so
// deleting from the front trims the least-recently-used entries.
const MAX_ENTRIES = {
  [IMMUTABLE_CACHE]: 250,
  [RUNTIME_CACHE]: 80,
};

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
      await Promise.all(
        keys
          .filter((k) => k.startsWith('cc-') && !CURRENT_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      );
      await Promise.all(CURRENT_CACHES.map((name) => trimCache(name)));
      await self.clients.claim();
    })(),
  );
});

// Delete the oldest entries until the cache is within its cap.
async function trimCache(name) {
  const max = MAX_ENTRIES[name];
  if (!max) return;
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    const excess = keys.length - max;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch {
    /* best-effort */
  }
}

// Store a response and trim. Trimming is cheap (a keys() listing), and doing
// it on write keeps the cache bounded between SW updates.
async function putAndTrim(name, cache, req, res) {
  try {
    await cache.put(req, res);
    await trimCache(name);
  } catch {
    /* quota errors etc. — caching is best-effort */
  }
}

// Move a hit to the back of the insertion order so trimming evicts the
// least-recently-USED entries, not just the oldest-inserted ones.
async function touch(cache, req, hit) {
  try {
    await cache.delete(req);
    await cache.put(req, hit);
  } catch {
    /* best-effort */
  }
}

const STATIC_FILE = /.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/;

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
      caches.open(IMMUTABLE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) {
          touch(cache, req, hit.clone()); // fire-and-forget
          return hit;
        }
        const res = await fetch(req);
        if (res && res.status === 200) {
          putAndTrim(IMMUTABLE_CACHE, cache, req, res.clone());
        }
        return res;
      }),
    );
    return;
  }

  // Stale-while-revalidate for non-hashed static files.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            // Re-put moves it to the back, so this doubles as the LRU touch.
            // Not event.waitUntil: this can run after respondWith has settled.
            putAndTrim(RUNTIME_CACHE, cache, req, res.clone());
          }
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
    // The server sends a per-booking tag, so updates to ONE booking coalesce
    // while two children's bookings show as separate notifications. Fall back
    // to a unique tag (never a shared one) for older payloads.
    tag: data.tag || 'cc-' + Date.now(),
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
