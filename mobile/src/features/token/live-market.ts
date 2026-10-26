/**
 * THE TOKEN PAGE'S MARKET, MOVED BY EVERY TRADE AS IT LANDS (the owner, 2026-10-26: "on token chart
 * page will we see this reflective?"). The page reads the coin's candles and trades every few
 * seconds from the market source, which runs half a minute to a minute behind the chain; between
 * reads, each trade from the live line (shared/live-coins.ts) is laid over the last read here: the
 * last candle's high, low and close move with it, a new candle opens when a trade crosses into the
 * next period, and the trade goes to the top of the Trades list.
 *
 * ★ THE READ STAYS THE RECORD. Only trades newer than the read's newest trade are laid on, and a
 * fresh read replaces what was laid on (the hook keeps the live trades and re-applies the ones still
 * newer), so a fill the market source also has is never shown twice and a candle the source closed
 * is never redrawn from our trades.
 *
 * Pure (`withLiveTrades`) apart from the hook, so `node --test` holds the candle arithmetic.
 */

import { useEffect, useMemo, useState } from 'react';

import type { CoinMarket, MarketTimeframe, MarketTrade } from '../../shared/api/index.ts';
import { followCoin, onCoinTrade, type LiveTrade } from '../../shared/live-coins.ts';
import { TIMEFRAME_MS } from './chart-data.ts';

/** The most live trades kept on the page between reads. */
const KEEP = 200;

/** The read with the live trades newer than it laid over: candles extended, trades on top. Pure. */
export function withLiveTrades(market: CoinMarket | null, live: readonly LiveTrade[], tf: MarketTimeframe): CoinMarket | null {
  if (market === null || market.kind !== 'read' || live.length === 0) return market;
  const newestRead = Math.max(0, ...(market.trades ?? []).flatMap((t) => (t.at.known ? [t.at.at] : [])));
  const seenTx = new Set((market.trades ?? []).flatMap((t) => (t.tx === null ? [] : [t.tx])));
  const fresh = live.filter((t) => t.t > newestRead && !seenTx.has(t.x) && t.p !== null && t.p > 0).sort((a, b) => a.t - b.t);
  if (fresh.length === 0) return market;
  const period = TIMEFRAME_MS[tf];
  let candles = market.candles === null ? null : [...market.candles];
  if (candles !== null) {
    for (const t of fresh) {
      const price = t.p as number;
      const bucket = Math.floor(t.t / period) * period;
      const last = candles[candles.length - 1];
      if (last === undefined) candles.push({ t: bucket, o: price, h: price, l: price, c: price });
      else if (bucket === last.t) candles[candles.length - 1] = { ...last, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price };
      else if (bucket > last.t) candles.push({ t: bucket, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price });
    }
  }
  const asTrades: MarketTrade[] = fresh.map((t) => ({
    tx: t.x,
    side: t.s === 'b' ? 'buy' : 'sell',
    tokenAmount: { known: true, amount: t.k },
    usd: { known: true, amount: (t.p as number) * t.k },
    priceUsd: { known: true, amount: t.p as number },
    at: { known: true, at: t.t },
    maker: t.w,
  }) as MarketTrade).reverse();
  return { ...market, candles, trades: [...asTrades, ...(market.trades ?? [])] };
}

/** The page's market with every live trade since its last read laid over it. */
export function useLiveMarket(address: string, market: CoinMarket | null, tf: MarketTimeframe, active: boolean): CoinMarket | null {
  const [live, setLive] = useState<readonly LiveTrade[]>([]);
  useEffect(() => {
    if (!active) return undefined;
    const unfollow = followCoin(address);
    const stop = onCoinTrade(address, (t) => setLive((kept) => [...kept.slice(-(KEEP - 1)), t]));
    return () => {
      stop();
      unfollow();
    };
  }, [address, active]);
  return useMemo(() => withLiveTrades(market, live, tf), [market, live, tf]);
}
