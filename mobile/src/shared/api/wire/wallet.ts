/**
 * The Wallet tab's reply, as the phone app holds it (services/read/src/wallet.ts).
 *
 * ★ PROFIT IS A NUMBER ONLY WITH BUY HISTORY. `profit.kind === 'none'` carries why — no buy in
 * the history read, or the history could not be read — and the screen shows a dash with it.
 * ★ A NARRATIVE ONLY ON A CONFIDENT MATCH: the field is the narrative or null; nothing between.
 */

import type { Measured } from '../../format/measure.ts';

export type PortfolioRange = '1h' | '6h' | '24h';

export interface Holding {
  readonly coinId: string;
  readonly address: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly imageUrl: string | null;
  /** Base units, exact, with the coin's decimals. */
  readonly amount: string;
  readonly decimals: number;
  readonly valueUsd: Measured;
  /** The price move over the chosen range, in percent. */
  readonly change: Measured;
  readonly profit: { readonly kind: 'known'; readonly sol: number; readonly partial: boolean } | { readonly kind: 'none'; readonly why: 'no_buy_history' | 'history_unread' };
  /** The narrative whose page names this coin as its one coin. `story` on the wire: the word is ours. */
  readonly story: { readonly storyId: string; readonly title: string } | null;
}

export interface CreatedCoin {
  readonly coinId: string;
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly marketCapUsd: Measured;
}

export type Portfolio =
  | {
      readonly kind: 'read';
      readonly address: string;
      readonly range: PortfolioRange;
      readonly solBalance: Measured;
      readonly totalUsd: Measured;
      readonly totalSol: Measured;
      readonly holdings: readonly Holding[];
      readonly notShown: number;
      readonly unpriced: number;
      readonly historyDepth: number;
      readonly created: { readonly unclaimedFeesSol: Measured; readonly coins: readonly CreatedCoin[] };
    }
  | { readonly kind: 'unavailable' };
