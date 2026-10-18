/**
 * DATA READ AHEAD OF THE TAP (the owner, 2026-10-18: "load the likely next screen before it's
 * tapped"). Three things, all GETs into the kept reads (shared/kept-reads.ts) under the very keys
 * the screens read, so the screen finds its answer already there and only reads again underneath:
 *
 *   the other tabs   once For You has drawn: the Narratives list this phone last chose
 *   a post sheet     for each For You card that comes near the screen: GET /post/:id/sheet
 *   a coin page      for each coin row that comes on screen: its facts, its chart's first view,
 *                    its venue, and the chart library's code
 *
 * ★ READS ONLY. Opening a post sheet also asks the alert service for a fresh view reading
 * (POST /post/:id/reading, which can cost a paid read); that is the sheet's own doing when it is
 * really opened and is never done from here. Nothing here writes, signs or sends.
 *
 * ★ BOUNDED. Reads ahead go through one queue: AT_ONCE at a time, each started in an idle moment,
 * a key already kept and younger than FRESH_ENOUGH_MS skipped, and at most PER_VISIT per visit,
 * so a long scroll never turns into a flood. What breaks if changed carelessly: a key here that
 * differs from the screen's own (Feed.tsx, PostSheet.tsx, TokenView.tsx) reads twice for nothing.
 */

import { fetchCoinAbout, fetchCoinMarket, fetchPostSheet, fetchTradeVenue } from './api/index.ts';
import type { Instant } from './format/measure.ts';
import { readAhead } from './kept-reads.ts';
import { afterFirstScreen, preloadChart } from './preload.ts';
import { defaultTimeframe } from '../features/token/chart-data.ts';
import { firstPageKey, readFirstPage } from '../features/narratives/first-page.ts';
import { listOf, loadChoice } from '../features/narratives/narrative-order.ts';

/** Reads ahead running at once. */
const AT_ONCE = 2;
/** A kept answer younger than this is not read again ahead of time. */
const FRESH_ENOUGH_MS = 60_000;
/** At most this many reads ahead per visit. */
const PER_VISIT = 60;
/** How far outside the screen a card counts as about to be seen. */
const NEAR_PX = 300;

type Task = () => Promise<void>;
const queue: Task[] = [];
const asked = new Set<string>();
let running = 0;
let spent = 0;

const whenIdle = (f: () => void): void => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(f, { timeout: 1_000 });
  else window.setTimeout(f, 50);
};

function pump(): void {
  while (running < AT_ONCE && queue.length > 0) {
    const task = queue.shift();
    if (task === undefined) return;
    running += 1;
    whenIdle(() => {
      void task().finally(() => {
        running -= 1;
        pump();
      });
    });
  }
}

/** Read `key` ahead once per visit (unless a young answer is kept already). */
function ahead<T>(key: string, load: (signal: AbortSignal) => Promise<T>, phone: boolean): void {
  if (asked.has(key) || spent >= PER_VISIT) return;
  asked.add(key);
  spent += 1;
  queue.push(() => readAhead(key, load, phone, FRESH_ENOUGH_MS));
  pump();
}

/** The other tabs' first screens, once For You has drawn its own. */
export function readTabsAhead(): () => void {
  return afterFirstScreen(() => {
    let choice;
    try {
      choice = loadChoice(window.localStorage);
    } catch {
      choice = loadChoice(null);
    }
    const sort = listOf(choice);
    const on = choice.site === 'all' ? null : choice.site;
    ahead(firstPageKey(sort, on, choice.noCoin), readFirstPage(sort, on, choice.noCoin), true);
  });
}

/** A post's sheet, as PostSheet.tsx reads it (never its view reading). */
export function readPostAhead(postId: string): void {
  ahead(`post-sheet:${postId}`, (signal) => fetchPostSheet(postId, signal), true);
}

/** A coin's page, as TokenView.tsx and TradeBar.tsx read it, and the chart's code. */
export function readCoinAhead(coin: { readonly coinId: string; readonly address: string; readonly launchedAt: Instant }): void {
  const tf = defaultTimeframe({ onCurve: false, launchedAt: coin.launchedAt.known ? coin.launchedAt.at : null, now: Date.now() });
  preloadChart();
  ahead(`about:${coin.coinId}`, (signal) => fetchCoinAbout(coin.coinId, signal), true);
  ahead(`market:${coin.coinId}:${tf}`, (signal) => fetchCoinMarket(coin.coinId, tf, signal), false);
  ahead(`venue:${coin.address}`, (signal) => fetchTradeVenue(coin.address, signal), false);
}

/* One watcher for every element that asks to be read ahead when it nears the screen. */
const onSeen = new Map<Element, () => void>();
let watcher: IntersectionObserver | null = null;
function watch(el: Element, f: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  watcher ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const run = onSeen.get(e.target);
        onSeen.delete(e.target);
        watcher?.unobserve(e.target);
        run?.();
      }
    },
    { rootMargin: `${NEAR_PX}px 0px` },
  );
  onSeen.set(el, f);
  watcher.observe(el);
  return () => {
    onSeen.delete(el);
    watcher?.unobserve(el);
  };
}

/**
 * A ref for an element whose screen should be read ahead once it nears the screen. Cached by `id`,
 * so a redraw does not re-observe; `also` is another ref the same element must reach (the owner's
 * timing, features/owner/useSeen.ts).
 */
const refs = new Map<string, { readonly ref: (el: Element | null) => void; also: ((el: Element | null) => void) | undefined }>();
export function aheadRef(id: string, read: () => void, also?: (el: Element | null) => void): (el: Element | null) => void {
  let r = refs.get(id);
  if (r === undefined) {
    let stop: (() => void) | null = null;
    const entry = {
      also,
      ref: (el: Element | null) => {
        stop?.();
        stop = el === null ? null : watch(el, read);
        entry.also?.(el);
      },
    };
    r = entry;
    refs.set(id, entry);
    if (refs.size > 500) refs.delete(refs.keys().next().value ?? '');
  }
  r.also = also;
  return r.ref;
}
