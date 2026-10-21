/**
 * The newest pools on the chain, kept to coins launched on the launchpad's curve: the second way
 * chainwatch learns of a launch, for the ones the launch socket never sends.
 *
 * WHY A LISTING IS NEEDED BESIDES THE SOCKET. Measured 2026-10-19: every launch the relay's socket
 * delivered (25 of 25 sampled) was sent in a legacy or v0 transaction, and every launch it missed
 * that could be traced (16 of 16) was sent in a version-1 transaction. The relay does not decode
 * those, and on that afternoon they were about three launches in ten. Nothing on our side of the
 * socket can ask for them, so they are read here, about a minute after launch, instead of an hour
 * later by a name search.
 *
 * A POOL LIST, NOT A COIN LIST. One row is one pool; the coin is its base token. Only a pool on
 * the curve (`pump-fun`) is a launch: a graduated pool is a coin we already had, and every other
 * dex is another launchpad we have no adapter for. The coin's name comes from the included token
 * rows (asked with `include=base_token`); the ticker from the pool's "TICKER / SOL" name when the
 * token row is missing. Pure reader, tested against a recorded reply.
 *
 * ★ THE COIN IS THE BASE, AND THE OTHER SIDE IS CARRIED AS A FACT. A curve can be priced in a
 * token other than SOL (a stablecoin, a tokenised stock such as MSTRx, another coin); the pool
 * then lists the new coin as its base and that token as its quote. The launch is the base, always.
 * The quote comes back as `pairedWith` (null for SOL), with its own name and symbol when the reply
 * included it (`include=base_token,quote_token`), so chainwatch can learn which tokens launches
 * are paired against and keep them from ever being filed as launches (0121).
 *
 * What breaks if changed carelessly: the venue filter. A pool from another launchpad decoded here
 * would be filed under the curve's venue for good, because the asset row's venue is free text.
 */

import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { arr, rec, str } from '@insidor/vendor-kit';

import { readSearch } from './search.ts';

/** The vendor serves 20 pools a page on this endpoint. */
export const NEW_POOLS_PAGE = 20;

/** Wrapped SOL: a launch paired against it is an ordinary SOL launch, and carries no `pairedWith`. */
const SOL = 'So11111111111111111111111111111111111111112';

/** The token a launch's curve is priced in, when it is not SOL. */
export interface PairedToken {
  readonly address: string;
  readonly symbol: string | null;
  readonly name: string | null;
}

/** A launch on the curve: the coin (the pool's base), and what it is paired against when not SOL. */
export interface NewLaunch extends CoinSearchHit {
  readonly pairedWith: PairedToken | null;
}

/** Coins on the curve, newest pool first, each with its token's own name when the reply carried it. */
export function readNewLaunches(raw: unknown): readonly NewLaunch[] {
  const names = new Map<string, { name: string | null; symbol: string | null }>();
  for (const t of arr(rec(raw).included)) {
    const id = str(rec(t).id);
    if (id === null || !id.startsWith('solana_') || str(rec(t).type) !== 'token') continue;
    const a = rec(rec(t).attributes);
    names.set(id.slice('solana_'.length), { name: str(a.name), symbol: str(a.symbol) });
  }
  /* Each pool's quote, by the pool's address: `readSearch` keeps the pool address as `marketAddress`. */
  const quotes = new Map<string, string>();
  for (const p of arr(rec(raw).data)) {
    const rel = rec(rec(p).relationships);
    const pool = str(rec(rec(p).attributes).address);
    const quote = str(rec(rec(rel.quote_token).data).id);
    if (pool !== null && quote !== null && quote.startsWith('solana_')) quotes.set(pool, quote.slice('solana_'.length));
  }
  return readSearch(raw)
    .filter((h) => h.venue === 'curve')
    .map((h) => {
      const token = names.get(h.address);
      const quote = h.marketAddress === null ? undefined : quotes.get(h.marketAddress);
      const paired = quote === undefined || quote === SOL || quote === h.address ? null : { address: quote, symbol: names.get(quote)?.symbol ?? null, name: names.get(quote)?.name ?? null };
      return { ...h, name: token?.name ?? null, ticker: token?.symbol ?? h.ticker, pairedWith: paired };
    });
}
