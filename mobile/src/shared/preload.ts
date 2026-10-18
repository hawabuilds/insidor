/**
 * CODE FETCHED AHEAD, ONCE THE APP IS QUIET. The screens other than For You and Narratives, and
 * the chart library, are their own chunks (App.tsx, features/token/CoinChart.tsx), so the first
 * open downloads less; this fetches them in the background after the first paint, a few at a time,
 * so opening one later finds it already here. Code only: no data is read from here (data read
 * ahead is shared/prefetch.ts).
 *
 * What breaks if changed carelessly: starting before the page has loaded puts these chunks in the
 * way of the first screen's own reads on a slow connection.
 */

import { later } from './ui/later.ts';

/*
 * ★ AFTER THE FIRST SCREEN, NOT JUST AFTER THE PAGE. The page's load event comes when the app's
 * own code is in, a second or more before For You's posts and pictures are; code fetched then
 * competes with them for a slow connection. So background code waits for the first screen to say
 * it has drawn its answer (`firstScreenDrawn`, Feed.tsx), or for FIRST_SCREEN_WAIT_MS after load,
 * whichever is first.
 */
const FIRST_SCREEN_WAIT_MS = 4_000;
let drawn = false;
const afterDrawn: (() => void)[] = [];

/** The first screen has drawn its fresh answer (or said it could not read): background code may start. */
export function firstScreenDrawn(): void {
  if (drawn) return;
  drawn = true;
  for (const f of afterDrawn.splice(0)) f();
}

/** Run `f` once the first screen has drawn, or FIRST_SCREEN_WAIT_MS after the page loaded. Returns a cancel. */
export function afterFirstScreen(f: () => void): () => void {
  let done = false;
  let timer = 0;
  const once = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    f();
  };
  if (drawn) {
    once();
    return () => undefined;
  }
  afterDrawn.push(once);
  const arm = () => {
    timer = window.setTimeout(once, FIRST_SCREEN_WAIT_MS);
  };
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm, { once: true });
  return () => {
    done = true;
    window.clearTimeout(timer);
    window.removeEventListener('load', arm);
  };
}

/** At most this many chunks are fetched at once. */
const AT_ONCE = 3;
/** The longest the first chunk waits for a quiet moment after the page has loaded. */
const QUIET_WAIT_MS = 3_000;

type Load = () => Promise<unknown>;

/** The token page's chart (features/token/CoinChart.tsx draws it), with the chart library under it. */
export const PRICE_CHART = later(() => import('../features/token/PriceChart.tsx'), (m) => m.PriceChart);
const chart: Load = PRICE_CHART.load;

let started = false;

/** Fetch these chunks (and the chart library) once the page has loaded and gone quiet, once per visit. */
export function preloadWhenQuiet(loads: readonly Load[]): () => void {
  if (started) return () => undefined;
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
  let idle = 0;
  let timer = 0;
  const go = () => {
    if (started) return;
    started = true;
    /* The tabs' screens first (App.tsx orders them), then the chart, then the rest. */
    const queue = [...loads.slice(0, 3), chart, ...loads.slice(3)];
    const next = (): Promise<void> => {
      const load = queue.shift();
      return load === undefined ? Promise.resolve() : load().then(next, next);
    };
    for (let i = 0; i < AT_ONCE; i += 1) void next();
  };
  const start = () => {
    if (typeof w.requestIdleCallback === 'function') idle = w.requestIdleCallback(go, { timeout: QUIET_WAIT_MS });
    else timer = window.setTimeout(go, 500);
  };
  const cancel = afterFirstScreen(start);
  return () => {
    cancel();
    w.cancelIdleCallback?.(idle);
    window.clearTimeout(timer);
  };
}

/** The chart library alone, for a screen about to show a chart (a coin row on screen). */
export function preloadChart(): void {
  void chart().catch(() => undefined);
}
