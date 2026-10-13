/**
 * What the card and the list say about an older coin trading since a post, apart from the screen
 * so `node --test` can hold it.
 *
 * An older coin is NEVER the post's coin (it was launched before the post), so the words never
 * say it is: "An older coin, $KARL, is trading more since this post". The facts under it are its
 * market's, in dollars: the busiest hour since, that hour against the usual one before the post,
 * how the price moved, and how long its market has been open. A price that fell is said as
 * falling: the line is about trading, not about a coin going up.
 *
 * What breaks if changed carelessly: the multiple is rounded DOWN ("8x" for 8.4). Rounding up
 * would say more trading than there was; an unknown or zero usual hour says "No trades the day
 * before" rather than a multiple of nothing.
 */

import type { Millis } from '../../shared/format/measure.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact } from '../../shared/format/number.ts';
import type { OlderCoin } from '../../shared/api/index.ts';

/** How a coin is named in a sentence: its ticker, else its name. */
export function olderCoinLabel(c: Pick<OlderCoin, 'ticker' | 'name'>): string {
  if (c.ticker !== null) return `$${c.ticker}`;
  return c.name ?? 'an unnamed coin';
}

/** The card's line, or null when no older coin is running. */
export function olderLine(coins: readonly OlderCoin[]): string | null {
  const first = coins[0];
  if (first === undefined) return null;
  if (coins.length === 1) return `An older coin, ${olderCoinLabel(first)}, is trading more since this post`;
  return `${coins.length} older coins with this name are trading more since this post`;
}

/** The facts under one coin, in the order a trader reads them. */
export function olderFacts(c: OlderCoin, now: Millis): readonly string[] {
  const out: string[] = [];
  if (c.peakHourUsd.known) out.push(`$${compact(c.peakHourUsd.amount)} in its busiest hour since`);
  if (c.peakHourUsd.known && c.hourBeforeUsd.known) {
    if (c.hourBeforeUsd.amount > 0) out.push(`${Math.floor(c.peakHourUsd.amount / c.hourBeforeUsd.amount)}x its usual hour`);
    else out.push('No trades the day before');
  }
  if (c.priceChangeSincePost !== null) {
    const pct = Math.round(Math.abs(c.priceChangeSincePost) * 100);
    out.push(pct === 0 ? 'Price unchanged since' : c.priceChangeSincePost > 0 ? `Price up ${pct}% since` : `Price down ${pct}% since`);
  }
  const age = formatAge(c.launchedAt, now);
  if (age.kind === 'value') out.push(`Market open ${age.text}`);
  return out;
}

/** The token page's id for an older coin: the address, on the one chain the app trades. */
export function olderCoinId(c: Pick<OlderCoin, 'address'>): string {
  return `solana:${c.address}`;
}
