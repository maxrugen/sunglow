const CACHE_NAME = 'sunglow-v1';
const ASSETS = [
  '/',
  '/manifest.webmanifest',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Cache-first for same-origin static assets
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match('/')))
    );
    return;
  }
});


