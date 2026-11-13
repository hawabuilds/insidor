/**
 * A TOKEN PAGE'S POOL, FOUND ON THE KEYLESS PAIR SOURCE (DexScreener's token-pairs), so the market
 * source's small free minute goes to candles and trades alone (the owner, 2026-11-13: 364's chart
 * failed on GeckoTerminal's 429 for exactly this lookup). The pair source allows 300 requests a
 * minute against the market source's 25, and both name a pool by its on-chain address, so the pool
 * found here is the one the market source's candle request reads (checked 2026-11-13 on Ground: all
 * three pools, same addresses, same dexes).
 *
 * Why its own file: the pool must come back in the market source's words — its dex ids (`pump-fun` is
 * a curve, which decides "on curve" and curve progress in market.ts) and its rule for which pool is
 * the coin's (`primaryPool`) — and that translation is the one thing that can go wrong here.
 *
 * What breaks if changed carelessly: the dex ids. A curve not named `pump-fun` reads as a listed pool
 * with no liquidity, and the page loses its curve progress. An id not in `DEXES` passes through as
 * the pair source spells it, named by nothing, which only costs the dex its display name.
 */

import type { Pool, PoolToken } from '@insidor/market-geckoterminal';
import { primaryPool } from '@insidor/market-geckoterminal';

/** The pair source's dex id (and label, where one id covers several pool kinds), as the market source's id and name. */
const DEXES: Readonly<Record<string, { readonly dex: string; readonly name: string }>> = {
  pumpfun: { dex: 'pump-fun', name: 'Pump.fun' },
  pumpswap: { dex: 'pumpswap', name: 'PumpSwap' },
  'meteora:DLMM': { dex: 'meteora', name: 'Meteora' },
  'meteora:DYN2': { dex: 'meteora-damm-v2', name: 'Meteora DAMM v2' },
  'meteora:DYN': { dex: 'meteora-damm', name: 'Meteora DAMM' },
  meteoradbc: { dex: 'meteora-dbc', name: 'Meteora DBC' },
  raydium: { dex: 'raydium', name: 'Raydium' },
  'raydium:CLMM': { dex: 'raydium-clmm', name: 'Raydium CLMM' },
  'raydium:CPMM': { dex: 'raydium-cp', name: 'Raydium CPMM' },
  launchlab: { dex: 'raydium-launchlab', name: 'Raydium LaunchLab' },
  orca: { dex: 'orca', name: 'Orca' },
};

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function token(raw: unknown, imageUrl: string | null): PoolToken | null {
  const t = rec(raw);
  const address = str(t['address']);
  return address === null ? null : { address, symbol: str(t['symbol']), name: str(t['name']), imageUrl };
}

/** The pair source's pairs for one coin, as the market source's pools. Pure. */
export function poolsFromPairs(raw: unknown): Pool[] {
  const pairs = Array.isArray(raw) ? raw : Array.isArray(rec(raw)['pairs']) ? (rec(raw)['pairs'] as unknown[]) : [];
  return pairs.flatMap((p): Pool[] => {
    const pair = rec(p);
    const address = str(pair['pairAddress']);
    const id = str(pair['dexId']);
    if (address === null || id === null) return [];
    const labels = Array.isArray(pair['labels']) ? (pair['labels'] as unknown[]).flatMap((l) => (typeof l === 'string' ? [l] : [])) : [];
    const known = labels.map((l) => DEXES[`${id}:${l}`]).find((d) => d !== undefined) ?? DEXES[id] ?? null;
    const image = str(rec(pair['info'])['imageUrl']);
    return [{
      address,
      dex: known?.dex ?? id,
      dexName: known?.name ?? null,
      /* A curve reports no liquidity; the market source's rule reads a curve's reserve as no pool's liquidity anyway. */
      reserveUsd: num(rec(pair['liquidity'])['usd']),
      volume24hUsd: num(rec(pair['volume'])['h24']),
      base: token(pair['baseToken'], image !== null && image.startsWith('https://') ? image : null),
      quote: token(pair['quoteToken'], null),
    }];
  });
}

/** The coin's pool from the pair source, by the market source's own rule; null when it lists none. */
export function dexPool(pairsForToken: (chain: string, address: string) => Promise<unknown>): (mint: string) => Promise<Pool | null> {
  return async (mint) => primaryPool(poolsFromPairs(await pairsForToken('solana', mint)));
}
