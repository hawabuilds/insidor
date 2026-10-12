/**
 * Search by name or ticker, kept to launchpad coins: a pool on the pump.fun curve (`pump-fun`)
 * or its graduated pool (`pumpswap`). Pure reader, tested against a recorded reply.
 *
 * The vendor's search lists pools, named "TICKER / SOL"; the ticker is read from that name and
 * the coin from the pool's base token. A pool on any other venue is not a launchpad coin and is
 * dropped.
 */

import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { arr, num, rec, str } from '@insidor/vendor-kit';

const LAUNCHPAD: Record<string, 'curve' | 'pool'> = { 'pump-fun': 'curve', pumpswap: 'pool' };
/** The vendor's search returns one page; a full page means there may be more. */
export const SEARCH_PAGE = 20;

export function readSearch(raw: unknown): readonly CoinSearchHit[] {
  return arr(rec(raw).data).flatMap((p) => {
    const a = rec(rec(p).attributes);
    const rel = rec(rec(p).relationships);
    const venue = LAUNCHPAD[str(rec(rec(rel.dex).data).id) ?? ''];
    const base = str(rec(rec(rel.base_token).data).id);
    if (venue === undefined || base === null || !base.startsWith('solana_')) return [];
    const created = str(a.pool_created_at);
    const pair = str(a.name) ?? '';
    const ticker = pair.split(' / ')[0]?.replace(/^\$/, '').trim() || null;
    return [{
      address: base.slice('solana_'.length),
      name: null,
      ticker,
      venue,
      createdAt: created === null ? null : Date.parse(created),
      marketCapUsd: num(a.market_cap_usd) ?? num(a.fdv_usd),
      imageUrl: null,
      source: 'geckoterminal',
    }];
  });
}
