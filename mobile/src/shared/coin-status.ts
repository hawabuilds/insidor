/**
 * THE ONE LINE AND THE ONE BUTTON A STORY GETS, from its coin link and nothing else.
 *
 * Shared by the feed, the Narratives list and the narrative page, so the rule is stated once.
 * It is the desktop app's `row-action.ts` rule (app/src/features/feed/row-action.ts) in the
 * phone app's words:
 *
 *   none     → "No coin yet"            + Create coin
 *   pending  → "—" (not searched yet)    and NO BUTTON
 *   one      → "1 coin"                 + Buy $TICKER, if the server says it can be traded
 *   several  → "13 coins on pump.fun"   + View coins
 *   unsure   → a line saying we cannot tell which coin is from this, and NO BUTTON
 *
 * ★ `unsure` HAS NO BUTTON, NOT A DISABLED ONE. A disabled button says "this exists but you
 * may not have it" and invites waiting. The honest render of "we do not know which coin this
 * is" is an absent affordance and a sentence. The type makes the mistake unwritable: `unsure`
 * carries no coin on the wire, so there is nothing a Buy button could be built from.
 *
 * ★ A COIN THE SERVER CANNOT QUOTE GETS NO BUTTON EITHER. `tradable` is the server's call,
 * made by asking for a quote, and this only obeys it.
 */

import type { Coin, CoinLink } from './api/index.ts';
import { formatUsd } from './format/number.ts';

export type CoinAction =
  | { readonly kind: 'create' }
  | { readonly kind: 'buy'; readonly coin: Coin }
  | { readonly kind: 'view'; readonly count: number };

export interface CoinStatus {
  readonly line: string;
  readonly action: CoinAction | null;
}

export function coinStatus(coins: CoinLink): CoinStatus {
  switch (coins.kind) {
    case 'none':
      return { line: 'No coin yet', action: { kind: 'create' } };
    case 'pending':
      return { line: '— still checking for a coin', action: null };
    case 'unsure':
      return {
        line: coins.claimCount === 1
          ? "A coin uses this name. We can't tell if it came from here."
          : `${coins.claimCount} coins use this name. We can't tell which one came from here.`,
        action: null,
      };
    case 'one':
      return coins.coin.tradable
        ? { line: '1 coin', action: { kind: 'buy', coin: coins.coin } }
        : { line: "1 coin, can't be traded yet", action: null };
    case 'several': {
      const venues = new Set(coins.coins.map((c) => c.venueLabel));
      const venue = venues.size === 1 ? ` on ${coins.coins[0].venueLabel}` : '';
      return { line: `${coins.coins.length} coins${venue}`, action: { kind: 'view', count: coins.coins.length } };
    }
  }
}

/**
 * The line a single post's card shows for its one confident coin: the ticker, the market cap
 * when it has been read (an unread cap is left out, never "$0"), and whether it can be traded.
 */
export function oneCoinLine(coin: Coin): string {
  const cap = formatUsd(coin.marketCapUsd);
  return `$${coin.ticker}${cap.kind === 'value' ? `, ${cap.text} market cap` : ''}${coin.tradable ? '' : ", can't be traded yet"}`;
}

/** Every coin a story has settled on, in the server's order. `unsure` has none to give. */
export function settledCoins(coins: CoinLink): readonly Coin[] {
  switch (coins.kind) {
    case 'one':
      return [coins.coin];
    case 'several':
      return coins.coins;
    default:
      return [];
  }
}
