/**
 * Price and pool reads from a market-data aggregator.
 *
 * THE ONE RULE, and it is the most expensive line of code in the previous
 * build: a pair with no `liquidity` object has NO LIQUIDITY NUMBER — it does
 * not have zero. Measured on this vendor, 5 August 2026:
 *
 *     bonding-curve venues   23 pairs   23 with no liquidity object (100%)
 *     pooled venues          98 pairs    2 with no liquidity object
 *
 * A curve has no two-sided reserve, so the vendor has nothing to report. The
 * old code read that absence through `Number(pair.liquidity?.usd) || 0` and
 * then two call sites rejected anything at or below zero, which meant every
 * asset younger than its own graduation was invisible. It is a venue-CLASS
 * property, not a property of one issuer: a second issuer on the same chain
 * behaves identically today, and every future one will.
 *
 * So: absence maps to null, a real zero stays zero, and the two are different
 * facts forever after.
 */

import type { Millis } from '@insidor/contracts';
import type { MarketState } from '@insidor/contracts/asset.ts';
import type { AssetRef, VenueId } from '@insidor/contracts/ids.ts';
import { arr, missing, num, rec, str } from '@insidor/vendor-kit';
import type { Rec } from '@insidor/vendor-kit';

/**
 * Venue ids this vendor uses for bonding curves. Measured, and it is why the
 * absent-liquidity rule cannot be treated as one issuer's quirk.
 */
export const CURVE_DEX_IDS: ReadonlySet<string> = new Set(['pumpfun', 'meteoradbc', 'launchlab', 'boop']);

export interface PairView {
  readonly dexId: string | null;
  readonly pairAddress: string | null;
  /** null means the vendor reported no liquidity object. NOT zero. */
  readonly liquidityUsd: number | null;
  readonly priceUsd: number | null;
  readonly fdvUsd: number | null;
  readonly marketCapUsd: number | null;
  readonly pairCreatedAt: Millis | null;
  readonly isCurve: boolean;
}

export function toPairView(raw: unknown): PairView {
  const p: Rec = rec(raw);
  const dexId = str(p.dexId);

  // The whole point, in one expression: ask whether the KEY is there before
  // asking what its value is.
  const liquidityUsd = missing(p, 'liquidity') ? null : num(rec(p.liquidity).usd);

  return {
    dexId,
    pairAddress: str(p.pairAddress),
    liquidityUsd,
    priceUsd: num(p.priceUsd),
    fdvUsd: num(p.fdv),
    marketCapUsd: num(p.marketCap),
    pairCreatedAt: num(p.pairCreatedAt),
    isCurve: dexId !== null && CURVE_DEX_IDS.has(dexId),
  };
}

/**
 * Which pair to price from, when an asset trades in several.
 *
 * Depth first, and a pair with NO liquidity object is ranked last but NEVER
 * excluded — excluding it is the original bug. Ranking by 24-hour volume is
 * deliberately not done: that is what kept an established survivor ahead of a
 * fresh curve even after the liquidity gate was removed.
 */
export function pickPricePair(pairs: readonly PairView[]): PairView | null {
  if (pairs.length === 0) return null;
  const ranked = pairs.slice().sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1));
  return ranked[0] ?? null;
}

export interface MarketReadContext {
  readonly asset: AssetRef;
  readonly venue: VenueId;
  readonly observedAt: Millis;
  readonly vendor: string;
  readonly endpoint: string;
}

export function toMarketState(rawResponse: unknown, ctx: MarketReadContext): MarketState {
  const pairs = arr(rec(rawResponse).pairs).map(toPairView);
  const chosen = pickPricePair(pairs);
  const pooled = pairs.filter((p) => p.liquidityUsd !== null);

  const marketCapUsd = chosen?.marketCapUsd ?? chosen?.fdvUsd ?? null;
  const basis =
    chosen === null
      ? null
      : chosen.marketCapUsd !== null
        ? 'circulating'
        : chosen.fdvUsd !== null
          ? 'fully-diluted'
          : null;

  return {
    asset: ctx.asset,
    venue: ctx.venue,
    observedAt: ctx.observedAt,
    priceUsd: chosen?.priceUsd ?? null,
    marketCapUsd,
    // The vendor tells us which quantity it reported. We never guess: a
    // fully-diluted figure and a circulating one differ by orders of magnitude
    // on a fresh asset, and a Buy screen showing the wrong one is a lie.
    marketCapBasis: basis,

    // Null on a curve, and null wherever the vendor simply did not report it.
    // NOTHING GATES ON THIS FIELD.
    liquidityUsd: chosen?.liquidityUsd ?? null,

    depth:
      chosen === null
        ? null
        : chosen.isCurve || chosen.liquidityUsd === null
          ? // We know the market exists — we are looking at its pair — we just
            // cannot express its depth as a reserve. Progress is unavailable
            // from this vendor, so it is null rather than invented.
            { kind: 'bonding-curve', progress: null, slippageBpsAt: { '0.1': null, '0.5': null, '1.0': null } }
          : { kind: 'pool', liquidityUsd: chosen.liquidityUsd, poolCount: pooled.length },

    // This vendor's pair-creation time is NEVER the mint time. Measured against
    // the issuer's own record: median +22 minutes, tail into thousands of
    // hours, because the original curve pair is dropped after migration and the
    // earliest surviving pool is the migration pool. It is carried as a hint
    // with 'unknown' confidence, and nothing may gate on it.
    mintedAt: {
      at: chosen?.pairCreatedAt ?? null,
      source: chosen?.pairCreatedAt === undefined || chosen?.pairCreatedAt === null ? 'none' : 'vendor_field',
      confidence: 'unknown',
      boundS: null,
    },

    // This vendor cannot see token program flags at all.
    transferRules: null,
    source: { vendor: ctx.vendor, endpoint: ctx.endpoint, fetchedAt: ctx.observedAt },
  };
}
