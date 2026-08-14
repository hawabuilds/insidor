/**
 * Market state on a bonding curve.
 *
 * ONE LINE IN THIS FILE IS THE WHOLE POINT: `liquidityUsd` is null, always, and
 * nothing gates on it.
 *
 * A bonding curve has no two-sided reserve, so the market-data vendors return
 * no liquidity object for it at all — measured: 19 of 19 curve pairs and 4 of 4
 * on a second issuer, against 0 of 46 for pooled venues. The build this
 * replaces read that absence through a `|| 0` and then rejected anything at or
 * below zero, which turned a quality filter into a survivorship filter: it
 * removed essentially the entire pre-graduation population and kept only assets
 * old enough to have a pool. Four live, tradeable coins between $7k and $21k
 * market cap came back "not found".
 *
 * What backs the price here is the curve itself, and that is what `depth`
 * carries. The gates read `depth` and a quote; they never read a liquidity
 * number this venue cannot have.
 */

import type { Millis } from '@insidor/contracts';
import type { MarketState, MintTime, TransferRules } from '@insidor/contracts/asset.ts';
import type { AssetRef, VenueId } from '@insidor/contracts/ids.ts';
import { bool, num, rec } from '@insidor/vendor-kit';

/** A venue fact: the curve graduates once this much real base asset accumulates. */
export const GRADUATION_LAMPORTS = 85_000_000_000n;
/** A chain fact. */
export const LAMPORTS_PER_SOL = 1e9;

export interface ReadContext {
  readonly asset: AssetRef;
  readonly venue: VenueId;
  readonly observedAt: Millis;
  /** Price of the base asset, or null. Null renders as no USD figure, never 0. */
  readonly baseUsd: number | null;
  /** The asset's own decimals. Raw units mean nothing without it. */
  readonly tokenDecimals: number;
  /** Copied from the asset record, never derived here. */
  readonly mintedAt: MintTime;
  /** Null until the account has been read. Null means UNREAD, and gates on it. */
  readonly transferRules: TransferRules | null;
  readonly endpoint: string;
  readonly vendor: string;
}

/** Curve reserves, in raw units. Exported because the quote path needs them. */
export interface CurveReserves {
  readonly virtualBaseUnits: bigint;
  readonly virtualTokenUnits: bigint;
  readonly realBaseUnits: bigint;
  readonly complete: boolean;
}

const big = (v: unknown): bigint | null => {
  const n = num(v);
  return n === null || !Number.isFinite(n) ? null : BigInt(Math.trunc(n));
};

export function toReserves(raw: unknown): CurveReserves | null {
  const r = rec(raw);
  const virtualBase = big(r.virtual_sol_reserves);
  const virtualToken = big(r.virtual_token_reserves);
  if (virtualBase === null || virtualToken === null) return null;
  return {
    virtualBaseUnits: virtualBase,
    virtualTokenUnits: virtualToken,
    realBaseUnits: big(r.real_sol_reserves) ?? 0n,
    complete: bool(r.complete) ?? false,
  };
}

/** How far along the curve is, as a fraction. Null when the reserves are unread. */
export function curveProgress(reserves: CurveReserves | null): number | null {
  if (reserves === null) return null;
  if (reserves.complete) return 1;
  const ratio = Number(reserves.realBaseUnits) / Number(GRADUATION_LAMPORTS);
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}

export function toMarketState(raw: unknown, ctx: ReadContext): MarketState {
  const r = rec(raw);
  const reserves = toReserves(r);

  // Price from the curve's own reserves rather than a reported field: the
  // reported one lags, and on a curve the reserves ARE the price.
  const priceBase =
    reserves === null
      ? null
      : Number(reserves.virtualBaseUnits) /
        LAMPORTS_PER_SOL /
        (Number(reserves.virtualTokenUnits) / 10 ** ctx.tokenDecimals);
  const priceUsd = priceBase === null || ctx.baseUsd === null ? null : priceBase * ctx.baseUsd;

  const reportedCap = num(r.usd_market_cap);

  return {
    asset: ctx.asset,
    venue: ctx.venue,
    observedAt: ctx.observedAt,
    priceUsd,
    marketCapUsd: reportedCap,
    // The venue computes its cap over the full supply, all of which sits on the
    // curve. We record which basis it used rather than guessing one.
    marketCapBasis: reportedCap === null ? null : 'fully-diluted',

    // ★ NULL, AND FOR A REASON THIS VENUE CANNOT ESCAPE. The price above is
    // computed from the curve's CURRENT reserves; this venue publishes no
    // history, and there is nothing here to difference against. Deriving one by
    // storing a price and subtracting it later would be inventing a series
    // inside an adapter, which is exactly the sort of number nobody can replay.
    // A 0 would say the price held for a day — and a coin on a live curve is
    // usually younger than a day, so it would be a claim about a period that
    // did not exist.
    priceChange24hPct: null,

    // NOT ZERO. NOT A GUESS. This venue has no reserve concept, and a number
    // here — any number — is what re-creates the survivorship filter.
    liquidityUsd: null,

    depth:
      reserves === null
        ? null
        : {
            kind: 'bonding-curve',
            progress: curveProgress(reserves),
            // Filled by the trade port, which is the only thing that can
            // answer it. Nulls here mean "not quoted", not "no slippage".
            slippageBpsAt: { '0.1': null, '0.5': null, '1.0': null },
          },

    mintedAt: ctx.mintedAt,
    transferRules: ctx.transferRules,
    source: { vendor: ctx.vendor, endpoint: ctx.endpoint, fetchedAt: ctx.observedAt },
  };
}
