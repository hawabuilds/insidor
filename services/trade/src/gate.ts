/**
 * WHO MAY TRADE, AND HOW MUCH: the allowlist, the per-trade cap and the slippage bounds, checked
 * on the quote and again on the build.
 *
 * Pure, so every refusal is tested. Checked twice because the quote travels through the browser
 * between the two calls: a build trusts nothing the browser sent back, and re-reads the amounts
 * from the quote's own body — for a pool quote, from the router's reply itself, which is what
 * the build will execute.
 *
 * What breaks if changed carelessly: the cap is on what a BUY spends at worst (the amount plus
 * its slippage), not on what the quote expects. A cap on the expected amount lets slippage
 * carry a buy past it.
 */

import type { TradePolicy } from '@insidor/contracts/policy.ts';

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

export function capLamports(p: TradePolicy): bigint {
  return BigInt(Math.round(p.maxSolPerTrade * Number(LAMPORTS_PER_SOL)));
}

export function checkRequest(r: { readonly wallet: string; readonly side: Side; readonly amount: string; readonly slippageBps: number }, allowlist: ReadonlySet<string>, p: TradePolicy): Refusal | null {
  if (!allowlist.has(r.wallet)) return 'not_allowed';
  if (!/^\d+$/.test(r.amount) || BigInt(r.amount) === 0n) return 'bad_amount';
  if (!Number.isInteger(r.slippageBps) || r.slippageBps < 1 || r.slippageBps > p.maxSlippageBps) return 'bad_slippage';
  if (r.side === 'buy' && worstSpend(BigInt(r.amount), r.slippageBps) > capLamports(p)) return 'over_cap';
  return null;
}

/** The most a buy can spend: its amount plus its slippage. */
export function worstSpend(lamports: bigint, slippageBps: number): bigint {
  return lamports + (lamports * BigInt(slippageBps)) / 10_000n;
}
