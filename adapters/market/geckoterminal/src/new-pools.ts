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
 * What breaks if changed carelessly: the venue filter. A pool from another launchpad decoded here
 * would be filed under the curve's venue for good, because the asset row's venue is free text.
 */

import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { arr, rec, str } from '@insidor/vendor-kit';

import { readSearch } from './search.ts';

/** The vendor serves 20 pools a page on this endpoint. */
export const NEW_POOLS_PAGE = 20;

/** Coins on the curve, newest pool first, each with its token's own name when the reply carried it. */
export function readNewLaunches(raw: unknown): readonly CoinSearchHit[] {
  const names = new Map<string, { name: string | null; symbol: string | null }>();
  for (const t of arr(rec(raw).included)) {
    const id = str(rec(t).id);
    if (id === null || !id.startsWith('solana_') || str(rec(t).type) !== 'token') continue;
    const a = rec(rec(t).attributes);
    names.set(id.slice('solana_'.length), { name: str(a.name), symbol: str(a.symbol) });
  }
  return readSearch(raw)
    .filter((h) => h.venue === 'curve')
    .map((h) => {
      const token = names.get(h.address);
      return { ...h, name: token?.name ?? null, ticker: token?.symbol ?? h.ticker };
    });
}
