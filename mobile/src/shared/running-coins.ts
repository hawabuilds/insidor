/**
 * The running coins strip's words: a coin's market cap and its 24-hour move as the strip prints
 * them, apart from the component (shared/ui/RunningCoins.tsx) so `node --test` holds them.
 *
 * ★ THE SAME MONEY AS EVERY OTHER LIST. The cap is `compactMoney`, the app's one short form ($2.34M,
 * $43K), so a coin reads the same on the strip and on its card.
 *
 * ★ THE MOVE IS SHORT ENOUGH FOR A TAPE. A launchpad coin's day is often a few thousand percent, so
 * one decimal is kept only under ten percent ("▼0.6%"), whole numbers with a thousands comma above
 * ("▲5,308%"). Direction always ships with the glyph (tokens.css rule 2); an unmoved coin has no
 * glyph and no colour, because flat is neither up nor down.
 *
 * What breaks if changed carelessly: a move written without its glyph reads only through colour,
 * which some people cannot see.
 */

import { compactMoney } from './format/number.ts';

/** "$2.34M", "$43K". The strip only carries coins with a cap, so there is no absent case here. */
export function stripCap(usd: number): string {
  return `$${compactMoney(usd)}`;
}

/** Up to this, the move keeps one decimal. */
const ONE_DECIMAL_UNDER = 10;

export interface StripMove {
  readonly text: string;
  readonly direction: 'up' | 'down' | 'flat';
}

/** "▲980%", "▼0.6%", "0%". */
export function stripMove(pct: number): StripMove {
  const a = Math.abs(pct);
  const digits = a < ONE_DECIMAL_UNDER ? 1 : 0;
  const shown = a.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (Number(shown.replace(/,/g, '')) === 0) return { text: '0%', direction: 'flat' };
  return pct > 0 ? { text: `▲${shown}%`, direction: 'up' } : { text: `▼${shown}%`, direction: 'down' };
}
