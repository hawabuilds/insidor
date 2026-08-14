/**
 * Coins, and the link between a story and its coins.
 *
 * One meme can spawn hundreds of tokens. Working out which of them is the real one is the
 * product, and it is a judgement the server has already made by the time anything reaches
 * this file. `CoinLink` is that judgement as a closed union, so the client has nothing left
 * to decide and — more importantly — nothing left to re-derive. The old board did
 * `gain >= 150000 ? 'up' : 'down'` in a component; a client that can only switch on a union
 * tag cannot invent a threshold.
 *
 * The union is also the reason the unsure case is safe. `unsure` carries no coin, so no
 * amount of prop-drilling can produce a buy panel from it: there is nothing to buy with.
 */

import type { Instant, Measured } from '../../format/measure.ts';

/** What the market says the cap is measured against. The venue tells us; we never guess. */
export type MarketCapBasis = 'fully-diluted' | 'circulating';

export interface Coin {
  readonly coinId: string;
  readonly ticker: string;
  readonly name: string;
  /** The on-chain identifier. Needed by the trade path; shown truncated, never as a label. */
  readonly address: string;
  /** Human-readable, chosen by the server — never assembled from an id in a component. */
  readonly venueLabel: string;
  readonly imageUrl: string | null;

  /**
   * Unknown is normal and stays unknown. Mint time is the axis every ordering claim hangs
   * on, and a confidently wrong one is worse than none: it can make a post that came AFTER
   * the mint look like it came before.
   */
  readonly mintedAt: Instant;

  readonly priceUsd: Measured;
  readonly marketCapUsd: Measured;
  readonly marketCapBasis: MarketCapBasis | null;
  /** Absent on a bonding curve. Absence is not illiquidity, which is why it is Measured. */
  readonly liquidityUsd: Measured;

  /**
   * Whether a quote can actually be got for this coin right now. The server decides it by
   * quoting, not by comparing liquidity to a number, and the client only obeys. A coin that
   * is not tradable renders its market numbers and no buy affordance.
   */
  readonly tradable: boolean;
}

/**
 * How many coins we will stand behind for a story — the ONLY input to the row's button.
 *
 * Four branches, and `unsure` is the one that matters. When the match is not confident there
 * is no button at all, not a disabled one: a disabled button says "this exists but you may
 * not have it", which invites a user to wait for it to enable. The honest render of "we do
 * not know which coin this is" is an absence of the affordance and a line of text saying so.
 */
export type CoinLink =
  /** Nothing minted from this story yet. The user can be the one to mint it. */
  | { readonly kind: 'none' }
  /**
   * Coins claiming this story exist; none of them is confidently the one. NO coin is
   * exposed here, and the number is a fact rather than our arithmetic: it counts coins
   * that named themselves after this story, which is true whether or not we looked.
   * The pipeline's own word for one of them is not on this wire and must not appear here.
   */
  | { readonly kind: 'unsure'; readonly claimCount: number }
  | { readonly kind: 'one'; readonly coin: Coin }
  /** At least two, ordered by the server. The tuple type makes "several" mean several. */
  | { readonly kind: 'several'; readonly coins: readonly [Coin, Coin, ...Coin[]] };
