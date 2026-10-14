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
 * ★ PUSH: SHOWN AND OPENED, NOTHING ELSE. services/notify sends { title, body, url, image?, icon?,
 * tag? }; this shows it — the post's picture or video frame as the big image and the poster's face
 * or the coin's logo as the icon, where the platform draws them (an iPhone draws neither: it shows
 * the app's own icon and the words) — and a tap opens the app at the url. The url must be an
 * in-app path; anything else opens the feed. The tag makes a repeat replace the first on the
 * device rather than stack. Subscribing happens in the page (features/alerts/push.ts), never here.
 *
 * ★ A TAP OPENS THE RIGHT SCREEN WHETHER THE APP IS CLOSED, IN THE BACKGROUND OR OPEN.
 *   open or in the background  the window is sent { type: 'insidor-open', hash } and focused; the
 *                              page goes there itself (features/alerts/push-open.ts), with For You
 *                              under it so back lands there
 *   closed                     a new window at `/?push=1#/…`; the page reads the mark on launch
 *   and either way             the hash is left in a small cache for a minute, for a launch that
 *                              comes up at the start page instead of the url (iPhone has done so);
 *                              whichever page takes it deletes it, so it is opened once
 *
 * Bump CACHE when the precached files change; the activate step deletes every other cache.
 */

const CACHE = 'insidor-shell-v3';
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

const OPEN_CACHE = 'insidor-open';
const OPEN_KEY = '/__insidor_open';
const https = (v) => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) ? v : undefined);

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title !== '' ? data.title : 'Insidor';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/#/feed/notifications';
  const image = https(data.image);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: https(data.icon) ?? '/icons/icon-192.png',
      ...(image === undefined ? {} : { image }),
      badge: '/icons/icon-192.png',
      data: { url },
      tag: typeof data.tag === 'string' && data.tag !== '' ? data.tag : url,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/#/feed/notifications';
  const at = url.indexOf('#');
  const hash = at >= 0 ? url.slice(at) : '#/';
  event.waitUntil(
    (async () => {
      /* Left for a launch that lands on the start page instead (see the header). */
      try {
        const cache = await caches.open(OPEN_CACHE);
        await cache.put(OPEN_KEY, new Response(JSON.stringify({ hash, at: Date.now() }), { headers: { 'content-type': 'application/json' } }));
      } catch {
        /* No cache: the message or the mark still carries it. */
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        open.postMessage({ type: 'insidor-open', hash });
        try {
          await open.focus();
        } catch {
          /* Some platforms refuse focus from here; the page still moved. */
        }
        return;
      }
      await self.clients.openWindow(`/?push=1${hash}`);
    })(),
  );
});
