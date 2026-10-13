/**
 * THE MARKET CAP A SCREEN SHOWS FOR A COIN, kept live: the hook every surface that prints a cap
 * calls (the token page, the post sheet, Choose coin, the For You card), over the one rule and
 * store in coin-cap.ts.
 *
 * ★ ONE READER PER COIN, HOWEVER MANY SCREENS WATCH IT. A surface that asks for `poll` joins a
 * shared reader that reads that coin's market every LIVE_POLL_MS while anything is watching it,
 * and puts the price in the store; every screen showing the coin redraws from the same price. The
 * token page reads the market itself for its chart and notes each read, so it polls nothing extra.
 *
 * ★ THE FEED DOES NOT POLL. A For You page has dozens of coins; reading each one's market every
 * few seconds would cost the market source more calls than it allows. A card shows the live cap
 * when a price is fresh in the store (its sheet or token page was just open), else the server's.
 * `MAX_POLLED` bounds a long Choose coin list the same way: the first coins on it are read live.
 *
 * What breaks if changed carelessly: a coin must leave the reader when its last watcher unmounts,
 * or a closed sheet keeps polling for the life of the tab.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { fetchCoinMarket } from './api/index.ts';
import { capOf, livePrice, LIVE_POLL_MS, noteMarket, priceStore } from './coin-cap.ts';
import type { Measured } from './format/measure.ts';
import { useNow } from './hooks.ts';

/** At most this many coins are read live at once; the rest show the server's cap. */
const MAX_POLLED = 8;

const watchers = new Map<string, number>();
const inFlight = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;

function readOnce(address: string): void {
  if (inFlight.has(address)) return;
  inFlight.add(address);
  fetchCoinMarket(`solana:${address}`, '1m').then(
    (market) => noteMarket(address, market, Date.now()),
    () => undefined,
  ).finally(() => inFlight.delete(address));
}

function tick(): void {
  [...watchers.keys()].slice(0, MAX_POLLED).forEach(readOnce);
}

function watch(address: string): () => void {
  const first = !watchers.has(address);
  watchers.set(address, (watchers.get(address) ?? 0) + 1);
  if (first && [...watchers.keys()].indexOf(address) < MAX_POLLED) readOnce(address);
  if (timer === null) timer = setInterval(tick, LIVE_POLL_MS);
  return () => {
    const n = (watchers.get(address) ?? 1) - 1;
    if (n > 0) watchers.set(address, n);
    else watchers.delete(address);
    if (watchers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * The cap to show for one coin (coin-cap.ts `capOf`): live from the newest price when fresh, else
 * from `servedPrice` (the price the screen's own reply carried, when it carries one), else `served`
 * (the cap that reply carried, absence and reason included). `poll`: read this coin's price live
 * while the calling screen is open.
 */
export function useCoinCap(address: string, served: Measured, poll = false, servedPrice: Measured | null = null): Measured {
  useSyncExternalStore(priceStore.subscribe, priceStore.version, priceStore.version);
  /* Redraw on a slow beat so a price that goes stale falls back to the server's figure. */
  useNow(LIVE_POLL_MS * 4);
  useEffect(() => (poll ? watch(address) : undefined), [address, poll]);
  return capOf(served, livePrice(address), Date.now(), address, servedPrice);
}
