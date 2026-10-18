/**
 * The Portfolio tab's reply, as the phone app holds it (services/read/src/wallet.ts).
 *
 * ★ A GAIN IS A NUMBER ONLY WHERE INSIDOR MADE THE BUY. Cost basis is the SOL paid by this
 * wallet's landed buys in Insidor (our trade record); `profit.kind === 'none'` carries why — never
 * bought here, or the record could not be read — and the screen shows a dash with it. A known gain
 * is in SOL, with its share of what was paid and today's dollar equivalent (pending without a SOL
 * price).
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
  readonly priceUsd: Measured;
  readonly valueUsd: Measured;
  /** The price move over the chosen range, in percent. */
  readonly change: Measured;
  readonly profit: Gain;
  /** The narrative whose page names this coin as its one coin. `story` on the wire: the word is ours. */
  readonly story: { readonly storyId: string; readonly title: string } | null;
}

/** A holding's gain against what was paid for it in Insidor (services/read wallet.ts profitWire). */
export type Gain =
  | {
      readonly kind: 'known';
      /** Worth in SOL now minus SOL paid, for the part bought here. */
      readonly sol: number;
      /** SOL paid for that part, at average cost. */
      readonly costSol: number;
      /** `sol` as a share of `costSol`, in percent. */
      readonly pct: number;
      /** `sol` at today's SOL price. */
      readonly usd: Measured;
      /** True when more is held than was bought here: only the part bought here is measured. */
      readonly partial: boolean;
    }
  | { readonly kind: 'none'; readonly why: 'not_bought_here' | 'history_unread' };

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
      readonly created: { readonly unclaimedFeesSol: Measured; readonly coins: readonly CreatedCoin[] };
    }
  | { readonly kind: 'unavailable' };
