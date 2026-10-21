/**
 * WHAT THE TOKEN PAGE'S TOP HALF SAYS ABOUT THE POOL ITS CHART IS DRAWN FROM: the token the coin is
 * paired with (MSTRx for Laura, with a "Stock" tag for a tokenised stock), where that pool is, and
 * its liquidity. Pure, so the choices below are tested without a screen.
 *
 * Why it exists (the owner, 2026-10-21: "for stock-paired tokens it should show the stock it's
 * paired with in the token chart page and show the liquidity"). The page used to print "SOL" and
 * "pump.fun" for every coin, which was false for a coin trading against a stock token.
 *
 * ★ A SOL-PAIRED COIN ON THE LAUNCHPAD LOOKS EXACTLY AS IT DID: "SOL" and the launchpad's label. The
 * pool's own dex name shows only when it says something new: a coin paired with another token, or
 * a pool off the launchpad (Meteora, Raydium).
 *
 * The coin's own name follows the same pool: `shownName` puts the market's listing over our index's.
 *
 * What breaks if changed carelessly: before the first market read the page cannot know the pair,
 * so `pair` is `'unread'` and the chip holds its place without a claim. Showing "SOL" there would
 * print a false fact for Laura for the moment it takes to read.
 */

import type { CoinMarket, MarketPair } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';

/** Wrapped SOL: the launchpad's own quote. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** The chip after the coin's name: what it is priced in. */
export type PairChip =
  | { readonly kind: 'unread' }
  | { readonly kind: 'sol' }
  | { readonly kind: 'token'; readonly address: string; readonly ticker: string; readonly imageUrl: string | null; readonly stock: boolean };

/** The pool from the latest market read; `'unread'` until one has been read, null when it trades nowhere we see. */
export type PairRead = MarketPair | null | 'unread';

/** The pair the latest read named, kept across timeframes: a new timeframe's read does not unknow it. */
export function pairFrom(market: CoinMarket | null, kept: PairRead): PairRead {
  return market?.kind === 'read' ? market.pair : kept;
}

export function pairChip(pair: PairRead): PairChip {
  if (pair === 'unread') return { kind: 'unread' };
  const t = pair?.token ?? null;
  /* Nothing named (no pool seen, or a source that did not say): the launchpad's own quote, as before. */
  if (t === null || t.address === SOL_MINT) return { kind: 'sol' };
  return { kind: 'token', address: t.address, ticker: t.ticker ?? t.name ?? `${t.address.slice(0, 4)}…`, imageUrl: t.imageUrl, stock: t.stock };
}

/** The venue chip: the launchpad's label and page, unless the pool is elsewhere or paired with another token. */
export function venueChip(pair: PairRead, launchpadLabel: string, address: string): { readonly label: string; readonly url: string } {
  const launchpad = { label: launchpadLabel, url: `https://pump.fun/coin/${address}` };
  if (pair === 'unread' || pair === null) return launchpad;
  if (pair.venue.launchpad && pairChip(pair).kind === 'sol') return launchpad;
  return { label: pair.venue.name ?? launchpadLabel, url: pair.venue.url ?? launchpad.url };
}

/**
 * The page's liquidity: the chart's pool when its depth was read, else what the page already had
 * (the coin's own read, then the market profile's). Never a zero for a pool that did not say.
 */
export function poolLiquidity(pair: PairRead, otherwise: Measured | 'loading'): Measured | 'loading' {
  if (pair !== 'unread' && pair !== null && pair.liquidityUsd.known) return pair.liquidityUsd;
  return otherwise;
}

/** The coin's own ticker and name as its market lists them. */
export type CoinListing = { readonly ticker: string | null; readonly name: string | null };

/**
 * The coin's ticker and name on the page: the market's listing over what the page was opened with,
 * field by field, whenever the market gave one. What the page was opened with can come from our name
 * index (public.coin_name), which keeps a coin's first sighting forever and holds some tokens under
 * another launch's name: MSTRx is in it as "Junior USD*".
 */
export function shownName(listed: CoinListing | null, ticker: string | null, name: string | null): CoinListing {
  return { ticker: listed?.ticker ?? ticker, name: listed?.name ?? name };
}
