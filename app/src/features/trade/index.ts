/**
 * The trade surface. Nothing outside this folder constructs a quote or an intent.
 *
 * `quote-state.ts` is exported and currently unused by the panel, deliberately. The panel
 * renders no quote flow because there is nothing to quote against (see TradePanel.tsx), but
 * the expiry state machine is the part of that flow that was hard to get right — a quote is
 * derived-expired, never stored as a boolean that can go stale — and it is kept intact so the
 * flow comes back as a rendering job rather than as a rewrite. It is not dead code awaiting
 * deletion.
 */

export { TradePanel } from './TradePanel.tsx';
export type { TradePanelProps } from './TradePanel.tsx';
export { hasExpired, settle } from './quote-state.ts';
export type { LiveQuote, QuoteState } from './quote-state.ts';
