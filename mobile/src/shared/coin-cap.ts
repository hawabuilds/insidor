/**
 * A COIN'S MARKET CAP, ONE RULE FOR EVERY SCREEN: the token page's header and Info tab, the post
 * sheet, Choose coin and the For You card all ask this file what a coin is worth, so one coin
 * never shows two caps at once.
 *
 * ★ THE RULE. A launchpad coin has a fixed supply of one billion, so its cap is its price times a
 * billion — the curve's price while it is on the curve, the pool's after it bonds (the market read,
 * GET /coin/:id/market, already gives whichever is current). The newest price any screen has read
 * is kept here by address; while it is fresh (`LIVE_KEEP_MS`) every screen derives the cap from it.
 * Without a fresh price, a screen applies the same rule to the price its own reply carried, and
 * only without either shows the cap the server sent.
 *
 * ★ ONLY FOR A COIN WHOSE SUPPLY WE KNOW. "Price × a billion" is true for the launchpad's coins
 * (on its curve, or carrying its address suffix) and false for any other token, whose cap stays
 * the server's. Guessing a supply would print a number that is not a fact about the coin.
 *
 * Separate from the hook (useCoinCap.ts) so the rule and the store are tested under `node --test`
 * without React or the network.
 *
 * What breaks if changed carelessly: a price of zero or below is not a price (an unreadable trade),
 * and must never become a "$0" cap; and the keep time must stay short — a price read minutes ago
 * shown as live is exactly the stale number this file exists to stop.
 */

import type { CoinMarket } from './api/wire/market.ts';
import type { Measured } from './format/measure.ts';

/** Every coin the launchpad makes has exactly this many tokens, on the curve and after it. */
export const LAUNCHPAD_SUPPLY = 1_000_000_000;
/** How often an open screen reads a coin's price again. The server keeps a read for ~12s, so this is the fastest that shows anything new. */
export const LIVE_POLL_MS = 4_000;
/** A price read longer ago than this is not shown as live; the screen falls back to its own reply. */
export const LIVE_KEEP_MS = 90_000;

/** The launchpad's mints carry this suffix; a coin on its curve is one regardless. */
const LAUNCHPAD_SUFFIX = /pump$/;

export interface LivePrice {
  readonly priceUsd: number;
  /** When this app read it (the reader's clock), for freshness. */
  readonly readAt: number;
}

/** Whether "price × a billion" is this coin's cap. */
export function knownSupply(address: string, venue: 'curve' | 'pool' | null = null): boolean {
  return venue === 'curve' || LAUNCHPAD_SUFFIX.test(address);
}

/** The cap at a price, for a coin of the launchpad's supply. */
export function capAtPrice(priceUsd: number): number {
  return priceUsd * LAUNCHPAD_SUPPLY;
}

/** The current price a market read gives: the newest trade's, else the last candle's close; null when neither. */
export function marketPrice(market: CoinMarket | null): number | null {
  if (market?.kind !== 'read') return null;
  const trade = market.trades?.find((t) => t.priceUsd.known && t.priceUsd.amount > 0);
  if (trade !== undefined && trade.priceUsd.known) return trade.priceUsd.amount;
  const last = market.candles?.[market.candles.length - 1];
  return last !== undefined && last.c > 0 ? last.c : null;
}

/**
 * The cap a screen shows, best first:
 *   1. the fresh live price × the supply (the store only holds launchpad coins' prices, `noteMarket`);
 *   2. the price the screen's own reply carried × the supply, for a launchpad coin — so a card that
 *      has read nothing live still follows the same rule, not a source's own cap (which counts a
 *      smaller "circulating" supply and runs about a tenth lower);
 *   3. the server's cap as sent (`served`), absence and reason included.
 */
export function capOf(served: Measured, live: LivePrice | undefined, now: number, address = '', servedPrice: Measured | null = null): Measured {
  if (live !== undefined && live.priceUsd > 0 && now - live.readAt <= LIVE_KEEP_MS) return { known: true, amount: capAtPrice(live.priceUsd) };
  if (servedPrice?.known === true && servedPrice.amount > 0 && knownSupply(address)) return { known: true, amount: capAtPrice(servedPrice.amount) };
  return served;
}

/* ── the shared store: the newest price read for each coin, by address ── */

const prices = new Map<string, LivePrice>();
const listeners = new Set<() => void>();
let version = 0;

/** Keep a price just read for a coin; every screen showing that coin redraws. */
function notePrice(address: string, priceUsd: number | null, readAt: number): void {
  if (priceUsd === null || !(priceUsd > 0) || !Number.isFinite(priceUsd)) return;
  const had = prices.get(address);
  if (had !== undefined && had.readAt > readAt) return;
  prices.set(address, { priceUsd, readAt });
  version += 1;
  for (const l of listeners) l();
}

/** Record what a market read says, against the coin it was read for. */
export function noteMarket(address: string, market: CoinMarket | null, readAt: number): void {
  if (market?.kind !== 'read' || !knownSupply(address, market.venue)) return;
  notePrice(address, marketPrice(market), readAt);
}

export function livePrice(address: string): LivePrice | undefined {
  return prices.get(address);
}

export const priceStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: (): number => version,
};
