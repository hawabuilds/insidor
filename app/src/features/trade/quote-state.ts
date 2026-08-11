/**
 * The lifecycle of a quote, as a union.
 *
 * A quote on this chain is backed by a blockhash that dies in about a minute, so "the quote
 * you are looking at" and "a quote you may act on" are different things and must be
 * different types. `Live` is the only branch carrying a `TradeQuote`, and the confirm path
 * takes a `Live`. An expired quote therefore cannot be submitted — not because a component
 * checked, but because it is not the right shape to pass.
 *
 * Requesting is separate from empty so the panel does not flash "no quote" while one is in
 * flight, and `failed` is separate from `unquotable` because "our quote vendor is down" and
 * "this token cannot be traded" must be distinguishable in one glance. Failing to
 * distinguish those two is exactly what made an outage look like a market condition in the
 * build this replaces.
 */

import type { TradeQuote } from '../../shared/api/index.ts';

export interface LiveQuote {
  readonly kind: 'live';
  readonly quote: TradeQuote;
}

export type QuoteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'requesting' }
  | LiveQuote
  | { readonly kind: 'expired'; readonly quoteId: string }
  | { readonly kind: 'unquotable' }
  | { readonly kind: 'failed'; readonly message: string };

/** True when the quote's own expiry has passed. The clock is a parameter, as everywhere. */
export function hasExpired(quote: TradeQuote, now: number): boolean {
  if (quote.expiryReason === 'none') return false;
  /* An expiry we cannot read is treated as expired. Failing closed on a money path costs a
     re-quote; failing open costs a rejected transaction the user already approved. */
  if (!quote.expiresAt.known) return true;
  return quote.expiresAt.at <= now;
}

export function settle(state: QuoteState, now: number): QuoteState {
  if (state.kind !== 'live') return state;
  return hasExpired(state.quote, now) ? { kind: 'expired', quoteId: state.quote.quoteId } : state;
}
