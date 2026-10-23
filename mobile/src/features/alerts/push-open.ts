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
 *               the start page instead (iPhone has done so); deleted by whoever takes it, so it opens once
 *
 * ★ THE FALLBACK IS LOOKED FOR OVER A FEW SECONDS, NOT ONCE. An installed iPhone app launched by a
 * tap comes up at the start page and the service worker hears the tap in the same moment, so the
 * page's first look can come before the worker has left the hash; with no window to message yet,
 * the tap was lost and the app sat on For You (the owner, 2026-10-23: neither a post nor a coin
 * notification opened its screen). So the page looks on launch and again at `LOOK_AFTER_MS`, and
 * the same each time it comes back to the front. One tap heard twice (the message and the cache, in
 * the same moment) is opened once (`isRepeat`).
 *
 * ★ THE PENDING OPEN IS DELETED ONLY AFTER ITS SCREEN IS OPENED, and a newer build's reload waits while
 * a tap is in hand (`tapInHand`, main.tsx hands it to shared/new-version.ts). A tap brings the app to
 * the front, and the front is exactly when a newer build reloads the page: read-and-delete first, the
 * reload landing between the two lost the tap for good (the reloaded page found nothing), and a
 * post's sheet, whose address For You puts back to `#/` at once, did not survive the reload either.
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
/** After a launch or a return to the front, when to look for a pending open again: the worker may still be writing it. */
const LOOK_AFTER_MS: readonly number[] = [0, 300, 800, 1_500, 3_000, 5_000];
/** The same screen asked for again within this is the same tap heard two ways, not a second tap. */
const REPEAT_MS = 5_000;
/** Set when the launch carried the mark: the pending open is that same tap, already taken. */
let launchedFromPush = false;
/** The last screen opened from a tap, and when. */
let lastOpen: { readonly hash: string; readonly at: number } | null = null;

/** A pending open as the service worker left it, if it is fresh: its hash, else null. */
export function freshOpen(v: unknown, nowMs: number): string | null {
  const o = v as { hash?: unknown; at?: unknown } | null;
  if (typeof o?.hash !== 'string' || !o.hash.startsWith('#/') || typeof o.at !== 'number') return null;
  return nowMs - o.at >= 0 && nowMs - o.at < PENDING_MS ? o.hash : null;
}

/** Whether a tap's screen was just opened (the message and the cache carrying the one tap). */
export function isRepeat(last: { readonly hash: string; readonly at: number } | null, hash: string, nowMs: number): boolean {
  return last !== null && last.hash === hash && nowMs - last.at < REPEAT_MS;
}

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
  lastOpen = { hash: window.location.hash || FYP, at: Date.now() };
  const steps = launchSteps(window.location.hash || FYP);
  /* Numbered (shared/nav.ts) so the screen's Back knows For You is under it. */
  history.replaceState(entryState(0), '', `/${steps[0] ?? FYP}`);
  steps.slice(1).forEach((step, i) => history.pushState(entryState(i + 1), '', `/${step}`));
  void dropPending();
}

/** Go to a notification's screen from wherever the open app is, with For You under anything but a post. */
export function openFromPush(hash: string): void {
  if (isRepeat(lastOpen, hash, Date.now())) return;
  lastOpen = { hash, at: Date.now() };
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

/** A pending open the service worker left, if fresh. Read, not taken: it is deleted once its screen is open. */
async function readPending(): Promise<string | null> {
  try {
    const hit = await (await caches.open(OPEN_CACHE)).match(OPEN_KEY);
    return hit === undefined ? null : freshOpen(await hit.json(), Date.now());
  } catch {
    return null;
  }
}

/** Whether a tap is being opened now: one opened in the last few seconds, or one the worker left that no page has opened yet. */
export function inHand(last: { readonly hash: string; readonly at: number } | null, pending: string | null, nowMs: number): boolean {
  return pending !== null || (last !== null && nowMs - last.at >= 0 && nowMs - last.at < REPEAT_MS);
}

/** `inHand` for this page: what shared/new-version.ts asks before reloading for a newer build. */
export async function tapInHand(): Promise<boolean> {
  return inHand(lastOpen, await readPending(), Date.now());
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
  /* Messages that came while the page was starting are handed over now, not at the end of parsing. */
  navigator.serviceWorker.startMessages();
  const pending = () =>
    void readPending().then((hash) => {
      if (hash === null) return;
      openFromPush(hash);
      void dropPending();
    });
  /* Each look is cheap (one cache read); the timers of an earlier look are dropped, never doubled. */
  let looks: ReturnType<typeof setTimeout>[] = [];
  const lookAWhile = () => {
    looks.forEach(clearTimeout);
    looks = LOOK_AFTER_MS.map((ms) => setTimeout(pending, ms));
  };
  if (launchedFromPush) void dropPending();
  else lookAWhile();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lookAWhile();
  });
  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if (e.persisted) lookAWhile();
  });
}
