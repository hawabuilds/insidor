/**
 * The Search tab's reply, as the phone app holds it (services/read/src/search.ts).
 *
 * ★ A SEARCHED POST HAS NO NARRATIVE AND NO COIN. The type has no field to put either in, so no
 * screen can draw a narrative link or a Buy button on one: search is a list, never a link. A
 * coin carries `matched` only when the narrative's own page already names it.
 */

import type { CoinEvidence } from './coin.ts';
import type { Instant, Measured } from '../../format/measure.ts';

/** Why a past narrative shows no origin post. Each is said in words; none is a blank. */
export type OriginGap = 'not_searched_yet' | 'origin_not_found' | 'possibly_deleted' | 'tiktok_not_searchable';

export interface SearchNarrative {
  /** Null for a past narrative: it was never on the board, so it has no page to open. */
  readonly storyId: string | null;
  readonly title: string;
  readonly thumbUrl: string | null;
  /** On the board now, or a narrative from before. */
  readonly live: boolean;
  readonly firstPostAt: Instant;
  readonly firstCoinAt: Instant;
  readonly peakMarketCapUsd: Measured;
  /** A past narrative's origin post, or why there is none. Both null for a live one. */
  readonly originPost: { readonly authorLabel: string; readonly permalink: string | null; readonly postedAt: Instant; readonly afterLaunch: boolean } | null;
  readonly originGap: OriginGap | null;
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
  readonly matched: { readonly storyId: string | null; readonly title: string } | null;
}

/**
 * The coins an unsure feed post shares its name with (`GET /post/:id/coins`): each as Search
 * shows it, `matched` always null. `more` says the post's search found more coins than it kept,
 * so this list is the newest of them; `sourcesMissing` that a market could not be read, so a
 * coin's market may be a dash for that reason.
 */
export interface SameNameCoins {
  readonly more: boolean;
  readonly sourcesMissing: number;
  /** In the server's order: strongest evidence against the post first, then the earliest launch. */
  readonly items: readonly SameNameCoin[];
}

/** A same-named coin, with what is known about it against the post; null when nothing was weighed. */
export type SameNameCoin = SearchCoin & { readonly evidence: CoinEvidence | null };

/** Whether a ticker is in use: by how many coins, free (every source answered), or not known. */
export type TickerUse = { readonly kind: 'free' } | { readonly kind: 'taken'; readonly count: number; readonly more: boolean } | { readonly kind: 'unknown' };

/** A name and ticker idea for a coin made from a post, with whether the ticker is in use. */
export interface NameIdea {
  readonly name: string;
  readonly ticker: string;
  readonly use: TickerUse;
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
