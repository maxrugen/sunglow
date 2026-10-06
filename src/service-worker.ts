/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// `version` changes on every deploy, so a new build gets a fresh cache and the
// old one (with chunk names that no longer exist) is dropped on activate.
const CACHE = `sunglow-${version}`;
const ASSETS = new Set([...build, ...files]);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...ASSETS]))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  // Build output and static files are immutable per version: cache-first.
  if (ASSETS.has(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
    return;
  }

  // Pages: always try the network so content is fresh; keep the plain shell for offline use.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok && url.pathname === '/' && !url.search) {
            const cache = await caches.open(CACHE);
            await cache.put('/', res.clone());
          }
          return res;
        } catch {
          return (await caches.match('/')) ?? Response.error();
        }
      })()
    );
  }
  // Everything else (API calls) goes straight to the network.
});

// --- Web Push ---

type PushData = { title?: string; body?: string; url?: string; tag?: string };

sw.addEventListener('push', (event) => {
  let data: PushData = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Sunglow', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    sw.registration.showNotification(data.title || 'Sunglow', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'sunglow',
      // `renotify` is missing from TS's NotificationOptions but supported by browsers.
      ...({ renotify: true } as NotificationOptions),
      data: { url: data.url || '/' },
    })
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        try {
          await client.navigate(url);
        } catch {
          // ignore navigation errors
        }
        return client.focus();
      }
      return sw.clients.openWindow(url);
    })()
  );
});
