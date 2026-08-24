// Caches the app shell so Playthruu opens instantly and works offline.
// Game data itself always comes from the network (Supabase) — this
// only speeds up/offlines the app's own files, never your live data.
// Bumped to a new name (not just a version number) on the rename — this
// also has the side effect of dropping every old "questlog-*" cache on
// people's phones, which is exactly right: those held Questlog-branded
// assets that no longer exist.
const CACHE_VERSION = 'playthruu-v1';
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
  // cached copy if there's no network at all.
  event.respondWith(
    fetch(request)
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
