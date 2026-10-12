/**
 * The Search tab's reply, as the phone app holds it (services/read/src/search.ts).
 *
 * ★ A SEARCHED POST HAS NO NARRATIVE AND NO COIN. The type has no field to put either in, so no
 * screen can draw a narrative link or a Buy button on one: search is a list, never a link. A
 * coin carries `matched` only when the narrative's own page already names it.
 */

import type { Instant, Measured } from '../../format/measure.ts';

export interface SearchNarrative {
  readonly storyId: string;
  readonly title: string;
  readonly thumbUrl: string | null;
  /** On the board now, or a narrative from before. */
  readonly live: boolean;
  readonly firstPostAt: Instant;
  readonly firstCoinAt: Instant;
  readonly peakMarketCapUsd: Measured;
}

export interface SearchPost {
  readonly id: string;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  readonly permalink: string | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  readonly postedAt: Instant;
  readonly live: boolean;
}

export interface SearchCoin {
  readonly coinId: string;
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  readonly marketCapUsd: Measured;
  readonly launchedAt: Instant;
  /** Still on the launchpad curve, bonded to a pool, or not listed by any market yet. */
  readonly venue: 'curve' | 'pool' | null;
  /** 0..1 along the curve; null when it is not on one. */
  readonly curveProgress: Measured | null;
  /** The narrative whose own page names this coin. Null for every other coin of the same name. */
  readonly matched: { readonly storyId: string; readonly title: string } | null;
}

export type SearchCoins =
  | { readonly kind: 'read'; readonly capped: boolean; readonly sourcesMissing: number; readonly items: readonly SearchCoin[] }
  | { readonly kind: 'unavailable' };

export interface SearchResults {
  readonly term: string;
  readonly narratives: { readonly capped: boolean; readonly items: readonly SearchNarrative[] };
  readonly posts: { readonly capped: boolean; readonly items: readonly SearchPost[] };
  readonly coins: SearchCoins;
}

/** A coin opened from search: what the search said about it, or what chainwatch recorded. */
export interface SearchedCoin {
  readonly coinId: string;
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  readonly marketCapUsd: Measured;
  readonly launchedAt: Instant;
  readonly venue: 'curve' | 'pool' | null;
}
