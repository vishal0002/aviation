// Caches all app assets for full offline operation on the tarmac.

const CACHE_NAME = 'aviation-lt-v4';
const ASSETS_TO_CACHE = [
  '/load-and-trim/',
  '/load-and-trim/index.html',
  '/load-and-trim/script.js',
  '/load-and-trim/style.css',
  '/load-and-trim/manifest.json',
  // Google Fonts are handled separately (network-first)
];

// ── Install: cache all static assets ──────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Aviation cache…');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      console.log('[SW] All assets cached. Ready for tarmac mode.');
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// ── Activate: clean up old caches ─────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new cache version…');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for app assets, network-first for API ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first, fall back to nothing (handled in app)
  if (url.hostname === 'api.evovhil.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Fonts: network-first with cache fallback
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell: cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Serve from cache; simultaneously update in background
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        }).catch(() => {/* silently fail background update */});
        return cachedResponse;
      }

      // Not in cache — fetch from network and cache it
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    })
  );
});
