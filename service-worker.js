// Caches the app shell so Playthruu opens instantly and works offline.
// Game data itself always comes from the network (Supabase) — this
// only speeds up/offlines the app's own files, never your live data.
// Bumped to a new name (not just a version number) on the rename — this
// also has the side effect of dropping every old "questlog-*" cache on
// people's phones, which is exactly right: those held Questlog-branded
// assets that no longer exist.
const CACHE_VERSION = 'playthruu-v17';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/supabase-client.js',
  './js/state.js',
  './js/router.js',
  './js/api.js',
  './js/auth.js',
  './js/utils.js',
  './js/components.js',
  './js/views/auth-view.js',
  './js/views/feed-view.js',
  './js/views/search-view.js',
  './js/views/discover-view.js',
  './js/views/game-view.js',
  './js/views/studio-view.js',
  './js/views/profile-view.js',
  './js/views/connections-view.js',
  './js/views/activity-view.js',
  './js/views/log-list-view.js',
  './js/views/lists-view.js',
  './js/views/settings-view.js',
  './js/views/notifications-view.js',
  './js/views/stories.js',
  './js/views/log-modal.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only manage same-origin app-shell files. Supabase API calls, the
  // Supabase JS CDN import, and web fonts always go straight to the
  // network so data and third-party assets stay fresh.
  if (url.origin !== self.location.origin) return;

  // Network-first: always try to get the latest file first (so edits
  // during development show up immediately), and only fall back to the
  // cached copy if there's no network at all. { cache: 'no-store' } is
  // load-bearing here, not decoration — without it this is still a
  // plain fetch() underneath, which happily answers from the browser's
  // own HTTP cache (GitHub Pages sends Cache-Control: max-age=600 on
  // everything) instead of touching the network at all. That silently
  // defeated "network-first" for up to 10 minutes per file, regardless
  // of whether the service worker itself had updated.
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});


// ------------------------------------------------------------
// Web push
// ------------------------------------------------------------
// Only fires once a VAPID key pair exists and something server-side is
// actually signing and sending (see VAPID_PUBLIC_KEY in js/config.js).
// Until then this is inert - which is why the Settings toggle is honest
// about only covering "while Playthruu is open" in that state.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Playthruu';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      // Collapses a run of notifications from the same source into one
      // entry in the tray instead of stacking five of them.
      tag: payload.tag || 'playthruu',
      renotify: !!payload.tag,
      // The Sound switch in Settings is the one part of the tone the app
      // decides; the tone itself is the phone's own, deliberately.
      silent: payload.silent === true,
      // `route` is what supabase/functions/send-push sends; `url` is the
      // older name, kept so a notification already queued by a previous
      // version of that function still lands somewhere sensible.
      data: { url: payload.route || payload.url || '#/notifications' },
    })
  );
});

// Focus an already-open Playthruu rather than opening a second copy of
// it, and take that tab to whatever the notification was about.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '#/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(client.url.split('#')[0] + target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow('./' + target);
    })
  );
});
