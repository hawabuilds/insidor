/**
 * Quoting, which is this venue's answer to "is there a market here?".
 *
 * A quote is the only test that works identically on a curve and on a pool, and
 * it is what replaces the liquidity check that removed the entire
 * pre-graduation population. It is also the most expensive gate we have — a
 * paid, rate-limited call — which is why the gate order runs it last.
 *
 * `unquotable` and `unavailable` are different answers and both are returned
 * rather than thrown: the first means this asset genuinely cannot be traded at
 * this size, the second means WE failed. Collapsing them makes an outage look
 * like a market full of untradeable assets, and failing open during one makes
 * every candidate pass.
 *
 * The quote is shared across chains; the executor is not. Execution differs in
 * kind — one chain has an expiring nonce, another a separate approval step —
 * and a shared executor would have to invent each concept for the chain that
 * lacks it. So: two executors, one quote type.
 */

import type { Millis } from '@insidor/contracts';
import type { TradeQuote } from '@insidor/contracts/asset.ts';
import type { VenueId } from '@insidor/contracts/ids.ts';
import type { QuoteRequest, QuoteResult, Signer, TradeReceipt } from '@insidor/contracts/ports/venue.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { allInBps, buyOut, itemiseCosts, NONCE_VALID_MS, priceImpactBps, withSlippage } from './curve.ts';
import type { CurveReserves } from './read.ts';

export interface QuoteContext {
  readonly venue: VenueId;
  readonly reserves: CurveReserves;
  readonly tokenDecimals: number;
  readonly baseDecimals: number;
  readonly observedAt: Millis;
  readonly networkLamports: bigint;
  readonly priorityLamports: bigint;
  readonly needsTokenAccount: boolean;
  /** OUR fee, from policy. This file never names a number of its own. */
  readonly platformFeeBps: number;
  readonly baseUsd: number | null;
}

/**
 * Priced locally off the curve's published reserves — no aggregator, no round
 * trip. The reserves came from a read that WAS metered; pricing them is
 * arithmetic, and arithmetic is free.
 */
export function quoteBuy(request: QuoteRequest, ctx: QuoteContext): QuoteResult {
  if (request.side !== 'buy') {
    // Selling on a curve is the inverse function and it is genuinely unwritten.
    // Reported as OUR gap, not as an untradeable asset.
    return { kind: 'unavailable', detail: 'the sell side of the curve is not implemented' };
  }
  if (ctx.reserves.complete) {
    // The curve is finished; this asset has moved to a pooled venue and the
    // route would send the trade somewhere it no longer lives.
    return { kind: 'unquotable', detail: 'the curve has graduated; quote at the pooled venue' };
  }

  const out = buyOut(ctx.reserves.virtualBaseUnits, ctx.reserves.virtualTokenUnits, request.inAmount);
  if (out <= 0n) return { kind: 'unquotable', detail: 'the curve cannot fill this size' };

  const impact = priceImpactBps(
    ctx.reserves.virtualBaseUnits,
    ctx.reserves.virtualTokenUnits,
    request.inAmount,
    out,
  );

  const costs = itemiseCosts({
    baseIn: request.inAmount,
    priceImpactBps: impact,
    networkLamports: ctx.networkLamports,
    priorityLamports: ctx.priorityLamports,
    needsTokenAccount: ctx.needsTokenAccount,
    platformFeeBps: ctx.platformFeeBps,
    baseUsd: ctx.baseUsd,
  });

  const quote: TradeQuote = {
    asset: request.asset,
    venue: ctx.venue,
    side: 'buy',
    inAmount: request.inAmount,
    outExpected: out,
    outMinimum: withSlippage(out, request.slippageBps),
    inDecimals: ctx.baseDecimals,
    outDecimals: ctx.tokenDecimals,
    slippageBps: request.slippageBps,
    costs,
    allInBps: allInBps(costs),

    // The nonce expires. The confirm sheet must be able to say when this quote
    // stops being true, because a stale quote executed at a worse price is a
    // promise we broke.
    expiresAt: ctx.observedAt + NONCE_VALID_MS,
    expiryReason: 'chain-nonce',

    // NEVER cached: the route changes the moment the curve graduates, and a
    // cached route sends the trade to a venue the asset has already left.
    route: [{ label: 'bonding curve' }],
  };

  return { kind: 'quoted', quote };
}

/**
 * Building and sending the transaction. Deliberately separate from the quote,
 * and deliberately last: nothing in this rebuild needs it before the matcher's
 * abstain rate has been stable for a month.
 */
export async function execute(_quote: TradeQuote, _signer: Signer): Promise<TradeReceipt> {
  // POST {rpcUrl} sendTransaction — after building the venue's buy instruction,
  // a token-account creation when needed, and a compute-budget instruction
  // carrying the priority fee the quote itemised. The signer is an opaque
  // handle: no key, seed or wallet ever reaches this package.
  throw new NotImplemented('POST rpc sendTransaction');
}
