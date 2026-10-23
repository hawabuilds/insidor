/**
 * The phone app's service worker. It exists so an installed Insidor opens like an app: at once on
 * a return visit, before the network answers. It caches the app itself, and NOTHING that carries a
 * number.
 *
 * Ported from Trador's public/sw.js, minus everything about data. What it keeps:
 *   the icons and the manifest   precached: what a home-screen launch needs before the first frame
 *   /assets/*                    cache first. Their names carry a hash of their contents, so a
 *                                kept copy can never be out of date: a new deploy has new names.
 *                                The newest ASSET_ROWS are kept. A miss is asked again with the
 *                                phone's cache bypassed, since the host keeps even a 404 for a year.
 *   the page itself (the shell)  network first, but given SHELL_WAIT_MS: on a slow connection the
 *                                kept shell opens the app, and the network's copy, when it lands,
 *                                is kept for next time.
 * The board, a story, a price — every read of a service (/api/*, the live line) — goes straight to
 * the network, untouched: a service worker that served a cached board offline would put yesterday's
 * views on screen as if they were now. (The page keeps its own last answers and always reads again
 * under them: mobile/src/shared/kept-reads.ts.)
 *
 * ★ A NEW DEPLOY ARRIVES WITHIN ONE OPEN. With the network answering in time, the open IS the new
 * deploy. When the kept shell had to stand in and the network's copy turns out to be a different
 * build, the page is told ({ type: 'insidor-new-version' }) and reloads itself the next time it
 * comes back to the foreground (mobile/src/shared/new-version.ts); a cold open after that gets the
 * new shell from the cache either way.
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
 *                              under it so back lands there. A window that refuses focus is not
 *                              trusted to have heard: the app is opened at the url as if closed
 *   closed                     a new window at `/?push=1#/…`; the page reads the mark on launch
 *   and either way             the hash is left in a small cache for a minute, for a launch that
 *                              comes up at the start page instead of the url (iPhone has done so);
 *                              whichever page takes it deletes it, so it is opened once
 *
 * Bump CACHE when the precached files change; the activate step deletes every cache but these.
 */

const CACHE = 'insidor-shell-v4';
const ASSETS = 'insidor-assets-v1';
const PRECACHE = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];
/** The page itself, kept under one key whatever the address (`/?push=1#/…` included). */
const SHELL_KEY = '/';
/** How long an open waits for the network's page before the kept one stands in. */
const SHELL_WAIT_MS = 1200;
/** The newest this many code files are kept; older builds' files go first. */
const ASSET_ROWS = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ASSETS && k !== OPEN_CACHE && k !== TAP_LOG).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

/** The build a page is: its entry script's hashed name. */
const buildOf = (html) => /\/assets\/index-[^"']+\.js/.exec(html)?.[0] ?? null;

async function shell(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (response) => {
    if (response.ok && response.type === 'basic') await cache.put(SHELL_KEY, response.clone());
    return response;
  });
  const kept = await cache.match(SHELL_KEY);
  if (kept === undefined) return network;
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), SHELL_WAIT_MS);
  });
  const first = await Promise.race([network.catch(() => null), late]);
  clearTimeout(timer);
  if (first !== null) return first;
  /* The kept page stands in; when the network's lands, the page hears if it is another build. */
  const keptBuild = buildOf(await kept.clone().text());
  event.waitUntil(
    network.then(async (response) => {
      const fresh = buildOf(await response.clone().text());
      if (fresh === null || fresh === keptBuild) return;
      const client = await self.clients.get(event.resultingClientId || event.clientId);
      client?.postMessage({ type: 'insidor-new-version' });
    }, () => undefined),
  );
  return kept;
}

async function asset(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit !== undefined) return hit;
  /* A miss is asked again past the phone's own cache: the host marks every /assets/ answer as kept
     for a year, a "not found" included, so a file asked for in the seconds a deploy is spreading
     would otherwise stay missing on that phone and the app would not open again (2026-10-23). */
  let response = await fetch(request);
  if (!response.ok) response = await fetch(new Request(request, { cache: 'reload' }));
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - ASSET_ROWS))) await cache.delete(old);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  /* Same-origin app files only. Anything cross-origin, and every /api/ read, is never touched, so
     this worker cannot serve a stale board even by accident. */
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(shell(event));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(event.request));
    return;
  }
  if (PRECACHE.includes(url.pathname)) event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});

/*
 * ★ TAP DIAGNOSTICS (2026-10-23): each push and tap writes its steps to a small log the page sends to
 * notify (mobile/src/shared/tap-log.ts says how to read and remove it). Written only while the log's
 * cache exists, which the page's switch makes or deletes, so turning it off needs no worker deploy.
 * Queued, never awaited on the way to opening the app: a note can never slow a tap down.
 */
const TAP_LOG = 'insidor-taplog';
const TAP_KEY = '/__insidor_taplog/sw';
const TAP_ROWS = 30;
let trail = Promise.resolve();
function note(step, fields) {
  const row = { ...fields, at: Date.now(), by: 'sw', step };
  trail = trail
    .then(async () => {
      if (!(await caches.has(TAP_LOG))) return;
      const cache = await caches.open(TAP_LOG);
      const hit = await cache.match(TAP_KEY);
      const rows = hit ? await hit.json() : [];
      rows.push(row);
      await cache.put(TAP_KEY, new Response(JSON.stringify(rows.slice(-TAP_ROWS)), { headers: { 'content-type': 'application/json' } }));
    })
    .catch(() => undefined);
}

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
  note('push', { url, sent: typeof data.url === 'string' ? data.url : '' });
  event.waitUntil(
    Promise.all([trail, self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: https(data.icon) ?? '/icons/icon-192.png',
      ...(image === undefined ? {} : { image }),
      badge: '/icons/icon-192.png',
      data: { url },
      tag: typeof data.tag === 'string' && data.tag !== '' ? data.tag : url,
    })]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/#/feed/notifications';
  const at = url.indexOf('#');
  const hash = at >= 0 ? url.slice(at) : '#/';
  note('click', { url, hash, data: event.notification.data != null, action: event.action || '' });
  event.waitUntil(
    (async () => {
      try {
        /* Left for a launch that lands on the start page instead (see the header). */
        try {
          const cache = await caches.open(OPEN_CACHE);
          await cache.put(OPEN_KEY, new Response(JSON.stringify({ hash, at: Date.now() }), { headers: { 'content-type': 'application/json' } }));
          note('stash', { ok: true });
        } catch (e) {
          /* No cache: the message or the mark still carries it. */
          note('stash', { ok: false, err: String(e) });
        }
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const ours = windows.filter((w) => new URL(w.url).origin === self.location.origin);
        /* The window on screen first, then a visible one: a page left behind by an earlier launch can still be listed. */
        const open = ours.find((w) => w.focused) ?? ours.find((w) => w.visibilityState === 'visible') ?? ours[0];
        note('windows', { all: windows.length, ours: ours.length, list: ours.map((w) => `${w.focused ? 'focused' : 'unfocused'} ${w.visibilityState} ${new URL(w.url).hash || '#'}`).join(' | ') });
        if (open) {
          open.postMessage({ type: 'insidor-open', hash });
          note('posted', { to: new URL(open.url).hash || '#' });
          try {
            await open.focus();
            note('focus', { ok: true });
            return;
          } catch (e) {
            /* Refused (iPhone can list a window it will not bring forward): opened afresh below. */
            note('focus', { ok: false, err: String(e) });
          }
        }
        try {
          const opened = await self.clients.openWindow(`/?push=1${hash}`);
          note('opened', { got: opened != null, at: opened?.url ? new URL(opened.url).pathname + new URL(opened.url).search + new URL(opened.url).hash : '' });
        } catch (e) {
          note('opened', { got: false, err: String(e) });
        }
      } finally {
        await trail;
      }
    })(),
  );
});
