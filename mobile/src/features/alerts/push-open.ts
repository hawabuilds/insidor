/**
 * A TAPPED NOTIFICATION OPENS ITS SCREEN, WITH FOR YOU UNDER IT (the owner, 2026-10-14: a post
 * notification opens the post's sheet over For You, a coin notification opens the coin's page;
 * "works whether the app was closed, in the background or open. Back or close returns to FYP").
 *
 * The service worker (public/sw.js) hands over the screen as a hash, three ways:
 *
 *   closed      the app is launched at `/?push=1#/…`: `settleLaunch` (main.tsx, before the first
 *               frame) takes the mark off and puts For You under the screen in history
 *   background  the open window is sent { type: 'insidor-open', hash } and focused
 *   or open     (the same message)
 *   fallback    the hash left in the `insidor-open` cache for a minute, for a launch that came up at
 *               the start page instead (iPhone has done so); read on launch and when the app comes
 *               back to the front, deleted by whoever takes it, so it opens once
 *
 * A post's screen (`#/post/<id>`) needs nothing under it: For You itself takes the address, puts it
 * back to For You and opens the sheet over it (features/feed/Feed.tsx). Any other screen gets a For
 * You entry under it, so its Back button (history.back) lands on For You.
 *
 * Its own file because three entry points (launch, message, return to front) must do the same
 * thing; and the rule "For You under it" is pure and tested (`launchSteps`).
 */

import { entryState, pushEntry } from '../../shared/nav.ts';
import { parseRoute } from '../../shared/route.ts';

const OPEN_CACHE = 'insidor-open';
const OPEN_KEY = '/__insidor_open';
/** A pending open older than this is a tap from long ago, not the one that launched us. */
const PENDING_MS = 60_000;
const FYP = '#/';
/** Set when the launch carried the mark: the pending open is that same tap, already taken. */
let launchedFromPush = false;

/** The history a launch from a notification should leave: For You first unless the screen is For You's own. */
export function launchSteps(hash: string): readonly string[] {
  const r = parseRoute(hash);
  return r.screen === 'feed' || r.screen === 'post' ? [hash] : [FYP, hash];
}

/** Called once before the first frame: a launch at `/?push=1#/…` becomes the screen with For You under it. */
export function settleLaunch(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('push') !== '1') return;
  launchedFromPush = true;
  const steps = launchSteps(window.location.hash || FYP);
  /* Numbered (shared/nav.ts) so the screen's Back knows For You is under it. */
  history.replaceState(entryState(0), '', `/${steps[0] ?? FYP}`);
  steps.slice(1).forEach((step, i) => history.pushState(entryState(i + 1), '', `/${step}`));
  void dropPending();
}

/** Go to a notification's screen from wherever the open app is, with For You under anything but a post. */
export function openFromPush(hash: string): void {
  const target = parseRoute(hash);
  if (target.screen !== 'post' && target.screen !== 'feed' && parseRoute(window.location.hash).screen !== 'feed') pushEntry(FYP);
  if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = hash;
}

async function dropPending(): Promise<void> {
  try {
    await (await caches.open(OPEN_CACHE)).delete(OPEN_KEY);
  } catch {
    /* No cache storage: nothing was left. */
  }
}

/** A pending open the service worker left, if fresh; taken (deleted) as it is read. */
async function takePending(): Promise<string | null> {
  try {
    const cache = await caches.open(OPEN_CACHE);
    const hit = await cache.match(OPEN_KEY);
    if (hit === undefined) return null;
    await cache.delete(OPEN_KEY);
    const v = (await hit.json()) as { hash?: unknown; at?: unknown };
    return typeof v.hash === 'string' && typeof v.at === 'number' && Date.now() - v.at < PENDING_MS ? v.hash : null;
  } catch {
    return null;
  }
}

/** Listen for taps while the app is alive, and pick up one that launched it at the wrong page. */
export function listenForOpens(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: unknown; hash?: unknown } | null;
    if (d?.type !== 'insidor-open' || typeof d.hash !== 'string') return;
    void dropPending();
    openFromPush(d.hash);
  });
  const pending = () =>
    void takePending().then((hash) => {
      if (hash !== null) openFromPush(hash);
    });
  if (launchedFromPush) void dropPending();
  else pending();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pending();
  });
}
