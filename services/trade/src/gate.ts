/**
 * WHO MAY TRADE, AND HOW MUCH: the allowlist, the per-trade cap and the slippage bounds, checked
 * on the quote and again on the build.
 *
 * Pure, so every refusal is tested. Checked twice because the quote travels through the browser
 * between the two calls: a build trusts nothing the browser sent back, and re-reads the amounts
 * from the quote's own body — for a pool quote, from the router's reply itself, which is what
 * the build will execute.
 *
 * ★ NO CAP IS NULL, NOT A BIG NUMBER. Since 2026-10-15 policy sets no per-trade or dev-buy cap
 * (the owner's decision); `capLamports` then answers null and no buy is refused for its size. A
 * buy the wallet cannot pay for still fails its simulation, so nothing unaffordable is signable.
 *
 * What breaks if changed carelessly: the cap, when there is one, is on what a BUY spends at
 * worst (the amount plus its slippage), not on what the quote expects. A cap on the expected
 * amount lets slippage carry a buy past it.
 */

import type { TradePolicy } from '@insidor/contracts/policy.ts';

import { isAllowed, type Allowlist } from './config.ts';

export type Side = 'buy' | 'sell';

export type Refusal =
  | 'trading_off'
  | 'not_allowed'
  | 'over_cap'
  | 'bad_slippage'
  | 'bad_amount'
  | 'quote_tampered';

export const REFUSAL_TEXT: Record<Refusal, string> = {
  trading_off: 'Trading is off.',
  not_allowed: 'This wallet is not allowed to trade yet.',
  over_cap: 'That is more than one trade may spend.',
  bad_slippage: 'That slippage is outside what is allowed.',
  bad_amount: 'The amount must be a positive whole number of base units.',
  quote_tampered: 'This quote was changed after it was given. Get a new one.',
};

const LAMPORTS_PER_SOL = 1_000_000_000n;

const toLamports = (sol: number | null): bigint | null => (sol === null ? null : BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL))));

/** The most one buy may spend at worst, in lamports; null when policy sets no cap. */
export function capLamports(p: TradePolicy): bigint | null {
  return toLamports(p.maxSolPerTrade);
}

/** The most a creator may buy of their own coin at launch, in lamports; null when policy sets no cap. */
export function devBuyCapLamports(p: TradePolicy): bigint | null {
  return toLamports(p.maxDevBuySol);
}

export function checkRequest(r: { readonly wallet: string; readonly side: Side; readonly amount: string; readonly slippageBps: number }, allowlist: Allowlist, p: TradePolicy): Refusal | null {
  if (!isAllowed(allowlist, r.wallet)) return 'not_allowed';
  if (!/^\d+$/.test(r.amount) || BigInt(r.amount) === 0n) return 'bad_amount';
  if (!Number.isInteger(r.slippageBps) || r.slippageBps < 1 || r.slippageBps > p.maxSlippageBps) return 'bad_slippage';
  const cap = capLamports(p);
  if (r.side === 'buy' && cap !== null && worstSpend(BigInt(r.amount), r.slippageBps) > cap) return 'over_cap';
  return null;
}

/** The most a buy can spend: its amount plus its slippage. */
export function worstSpend(lamports: bigint, slippageBps: number): bigint {
  return lamports + (lamports * BigInt(slippageBps)) / 10_000n;
}
