/**
 * The bonding curve, and what a trade on it actually costs.
 *
 * A curve has no two-sided reserve, so there is no liquidity number to read and
 * nothing that answers "is there a market here?" the way a pool's reserves do.
 * The answer on a curve is a QUOTE: can we buy a probe amount and what would it
 * cost all-in. That is why this file exists and why `liquidityUsd` is null in
 * everything this venue emits.
 *
 * All amounts are bigint. The smallest unit here is a lamport and a token with
 * 18 decimals exceeds 2^53 — a float divide of raw units is exact at 1e9 and
 * silently lossy at 1e18, which is the kind of bug that is cheaper to prevent
 * than to find in a money path.
 */

import type { TradeCost } from '@insidor/contracts/asset.ts';

/** Vendor facts, not tuning knobs: this venue's published trade fee. */
export const VENUE_FEE_BPS = 100;
/** A chain fact: the transaction nonce stops being accepted after roughly this long. */
export const NONCE_VALID_MS = 68_000;
/** A chain fact: the rent-exempt minimum for a token account, refundable. */
export const ATA_RENT_LAMPORTS = 2_039_280n;

const BPS = 10_000n;

/**
 * Constant product against the VIRTUAL reserves the curve publishes.
 * out = y − k/(x + in), with floor division to match the on-chain integer math
 * rather than approximating it in floating point.
 */
export function buyOut(virtualBaseUnits: bigint, virtualTokenReserves: bigint, baseIn: bigint): bigint {
  if (baseIn <= 0n) throw new RangeError('curve: input amount must be positive');
  if (virtualBaseUnits <= 0n || virtualTokenReserves <= 0n) {
    throw new RangeError('curve: reserves must be positive');
  }
  const k = virtualBaseUnits * virtualTokenReserves;
  const nextBase = virtualBaseUnits + baseIn;
  return virtualTokenReserves - k / nextBase;
}

/** The floor a trade may not fall below, from a slippage tolerance in bps. */
export function withSlippage(out: bigint, slippageBps: number): bigint {
  if (slippageBps < 0) throw new RangeError('curve: slippage must not be negative');
  return (out * (BPS - BigInt(Math.round(slippageBps)))) / BPS;
}

/**
 * How much worse the executed price is than the spot price, in bps. On a curve
 * this grows with size and it is a real cost to the trader, so it is itemised
 * like any other rather than hidden inside "slippage".
 */
export function priceImpactBps(
  virtualBaseUnits: bigint,
  virtualTokenReserves: bigint,
  baseIn: bigint,
  out: bigint,
): number {
  // Spot: tokens per lamport at the current reserves, scaled to keep integer math.
  const spotOut = (baseIn * virtualTokenReserves) / virtualBaseUnits;
  if (spotOut === 0n) return 0;
  const lost = spotOut > out ? spotOut - out : 0n;
  return Number((lost * BPS) / spotOut);
}

export interface CostInputs {
  readonly baseIn: bigint;
  readonly priceImpactBps: number;
  /** Network base fee for the transaction, in base-asset units. */
  readonly networkLamports: bigint;
  /** Priority fee actually attached, in lamports. Not a guess. */
  readonly priorityLamports: bigint;
  /** True when the buyer has no token account yet and must fund one. */
  readonly needsTokenAccount: boolean;
  /** OUR fee. A product number: it arrives from policy, never from this file. */
  readonly platformFeeBps: number;
  /** For the USD column. Null when we have no price — never a placeholder. */
  readonly baseUsd: number | null;
}

const bpsOf = (part: bigint, whole: bigint): number => (whole === 0n ? 0 : Number((part * BPS) / whole));

const usdOf = (lamports: bigint, baseUsd: number | null): number | null =>
  baseUsd === null ? null : (Number(lamports) / 1e9) * baseUsd;

/**
 * The itemised cost of a trade. The confirm sheet renders THIS ARRAY, which is
 * what stops it rendering a hardcoded fee line: measured all-in cost ranged
 * 1.60% to 22.72% across three same-age mints, so any fixed percentage on a
 * confirm screen is a false statement about the trade in front of the user.
 */
export function itemiseCosts(input: CostInputs): readonly TradeCost[] {
  const costs: TradeCost[] = [
    {
      code: 'network',
      label: 'Network fee',
      amountUsd: usdOf(input.networkLamports, input.baseUsd),
      bps: bpsOf(input.networkLamports, input.baseIn),
      refundable: false,
    },
    {
      code: 'priority',
      label: 'Priority fee',
      amountUsd: usdOf(input.priorityLamports, input.baseUsd),
      bps: bpsOf(input.priorityLamports, input.baseIn),
      refundable: false,
    },
    {
      code: 'venue',
      label: 'Venue fee',
      amountUsd: usdOf((input.baseIn * BigInt(VENUE_FEE_BPS)) / BPS, input.baseUsd),
      bps: VENUE_FEE_BPS,
      refundable: false,
    },
    {
      code: 'price-impact',
      label: 'Price impact',
      amountUsd: usdOf((input.baseIn * BigInt(Math.round(input.priceImpactBps))) / BPS, input.baseUsd),
      bps: input.priceImpactBps,
      refundable: false,
    },
    {
      code: 'platform',
      label: 'Our fee',
      amountUsd: usdOf((input.baseIn * BigInt(Math.round(input.platformFeeBps))) / BPS, input.baseUsd),
      bps: input.platformFeeBps,
      refundable: false,
    },
  ];

  if (input.needsTokenAccount) {
    costs.push({
      code: 'rent',
      label: 'Token account rent',
      amountUsd: usdOf(ATA_RENT_LAMPORTS, input.baseUsd),
      bps: bpsOf(ATA_RENT_LAMPORTS, input.baseIn),
      // Refundable per cost, not per quote: this one comes back when the
      // account is closed, and nothing on some other chain would.
      refundable: true,
    });
  }

  return costs;
}

/** The single number a gate compares against. Refundable costs still count. */
export function allInBps(costs: readonly TradeCost[]): number {
  return costs.reduce((sum, c) => sum + (c.bps ?? 0), 0);
}
