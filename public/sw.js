/* MRC Barbershop service worker.
   - App pages and API: always network (booking data must stay fresh).
   - Map tiles (Esri satellite + labels): cache-first on the device, so the
     map opens instantly on repeat visits, even on a weak connection. */

const TILE_CACHE = 'mrc-tiles-v1';
const MAX_TILES = 300; // bound on-device storage; oldest tiles evicted first

function isTileRequest(url) {
  return (
    url.hostname === 'server.arcgisonline.com' &&
    url.pathname.indexOf('/tile/') !== -1
  );
}

async function trimTileCache() {
  try {
    const cache = await caches.open(TILE_CACHE);
    let keys = await cache.keys();
    if (keys.length > MAX_TILES + 20) {
      await Promise.all(keys.slice(0, 20).map((k) => cache.delete(k)));
      keys = await cache.keys();
    }
    while (keys.length > MAX_TILES) {
      await cache.delete(keys.shift());
      keys = await cache.keys();
    }
  } catch (_) {
    // Storage pressure or private mode: map still works from network.
  }
}

async function cacheFirstTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // Opaque cross-origin tile responses are fine to cache.
  if (res && (res.ok || res.type === 'opaque')) {
    try {
      await cache.put(request, res.clone());
    } catch (_) {
      // Quota or private mode: ignore, still serve the network response.
    }
    trimTileCache();
  }
  return res;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.indexOf('mrc-tiles-') === 0 && n !== TILE_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  // Same-origin (pages, API, assets): default network behavior, never cached here.
  if (url.origin === self.location.origin) return;
  if (isTileRequest(url)) {
    event.respondWith(cacheFirstTile(request));
  }
});

/* ---------- Web push notifications ---------- */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}
  const title = data.title || 'MRC Barbershop';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = '/';
  try {
    url = (event.notification.data && event.notification.data.url) || '/';
  } catch (_) {}
  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin).pathname;
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        try {
          if (new URL(w.url).pathname === target) {
            await w.focus();
            return;
          }
        } catch (_) {}
      }
      await clients.openWindow(url);
    })()
  );
});
