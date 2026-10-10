/**
 * The phone app's service worker. It exists so an installed Insidor opens like an app, and it
 * does almost nothing else, on purpose.
 *
 * Ported from Trador's public/sw.js, minus everything about data. It caches the icons and the
 * manifest — the things a home-screen launch needs before the first frame — and NOTHING that
 * carries a number. The board, a story, a price: all of it is stale within a tick, and a
 * service worker that served a cached board offline would put yesterday's views on screen as
 * if they were now. So every other request goes straight to the network, and an offline app
 * says it could not read rather than showing an old answer.
 *
 * There is no push handler. Notifications come later, as services/notify, and nothing here
 * subscribes to anything.
 *
 * Bump CACHE when the precached files change; the activate step deletes every other cache.
 */

const CACHE = 'insidor-shell-v1';
const PRECACHE = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  /* Same-origin static shell files only. Anything cross-origin — the read service — is never
     touched, so this worker cannot serve a stale board even by accident. */
  if (url.origin !== self.location.origin) return;
  if (!PRECACHE.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});
