/* Campus Conveyance service worker — Web Push for booking-lifecycle alerts.
 *
 * Kept deliberately tiny: it only shows notifications the server pushes and
 * focuses/opens the app when one is clicked. No offline/caching behaviour, so
 * it never interferes with the app's own network requests. */

self.addEventListener('install', () => {
  // Activate immediately so a freshly-registered worker can receive pushes
  // without waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
