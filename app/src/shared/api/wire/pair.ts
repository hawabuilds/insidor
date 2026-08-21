/**
 * A COIN THAT REACHED A MARKET — the pairs screen's row.
 *
 * ★ IT IS NOT A `Launch` WITH PRICES ADDED, AND IT IS NOT A `Coin` WITH FIELDS REMOVED.
 * A launch says a coin came into existence; a pair says somebody made a market in it. Those
 * are claims about different populations and almost nothing crosses between them — of the
 * mints this product captured, 7 in 192 ever got a pool. That ratio is the sentence this
 * screen exists to say, and it only means anything while the two are separate statements.
 *
 * ★ THERE IS NO `tradable` AND NO `priceChange24h`, AND BOTH ABSENCES ARE STRUCTURAL.
 * Tradability is a claim that a venue will quote this coin right now, decided by asking one;
 * the reader behind these numbers declares itself read-only, so a `true` is not writable and
 * a `false` carried here would be a field a later editor could talk themselves into
 * flipping. The trailing day's move is absent because most of these coins have no trailing
 * day. The consequence is the one that matters and it is the same one `Launch` buys:
 * `actionFor` takes a `CoinLink`, a `Pair` is not one, and no buy affordance can be
 * assembled from this type however the screen is later rewritten.
 *
 * There is no image URL and no social link either, for `Launch`'s reason: a mint's image URI
 * is a string typed by whoever made the coin, and rendering one is a request to an
 * attacker-chosen host for every row that scrolls past.
 *
 * ★ AND EVERY STRING HERE IS HOSTILE INPUT. `ticker` and `name` are typed by the person who
 * minted the coin: they can impersonate another token, contain markup, contain a URL, or be
 * pure control characters. The projection bounds their length and strips control and bidi
 * characters before they are stored, so what arrives here is already short and already
 * inert — and the screen still renders them as TEXT and never as markup or a link, because
 * a single door is not a door you rely on alone.
 */

import type { Instant, Measured } from '../../format/measure.ts';
import type { MarketCapBasis } from './coin.ts';

export interface Pair {
  /** The asset key, '<chain>:<address>'. Stable across frames, so it is the render key. */
  readonly pairId: string;
  /** Observed, never an identifier. Two coins may share one. */
  readonly ticker: string;
  readonly name: string;
  /** The on-chain identifier. Shown truncated. Never a link and never a label. */
  readonly address: string;
  /** Human-readable, chosen by the server. The VENUE — never where we read it from. */
  readonly venueLabel: string;

  /**
   * When the coin was MINTED.
   *
   * ★ NOT WHEN THE POOL OPENED, WHICH NOTHING IN THIS SYSTEM KNOWS. Market readings are
   * append-only and could hold the history that would date a pair; nothing has written
   * enough of them yet. So this screen is ordered by mint time and says so, rather than
   * implying a pair age it would have to invent. Read it with `mintedAtBoundS` and never
   * alone: on a socket-fed pipeline it is the centre of an interval, not a reading.
   */
  readonly mintedAt: Instant;
  /** Half-width of the mint-time bound, in SECONDS, or null when the instant is exact. */
  readonly mintedAtBoundS: number | null;

  /**
   * ★ WHEN THE READING BELOW WAS TAKEN, AND IT IS RENDERED BESIDE IT, ALWAYS.
   *
   * The board suppresses a reading older than the server's freshness window entirely,
   * because every board row carries a Buy button and a price a user is about to act on is
   * either current or a dash. This screen has no trade affordance at all — see the two
   * fields deliberately missing above — so suppressing an hour-old reading here would not
   * be caution, it would delete the only evidence the screen exists to show.
   *
   * So the figures arrive with their age attached and the age goes on screen. A stale
   * reading that says it is stale is honest; a stale reading wearing no label is the one
   * thing that is not allowed.
   */
  readonly readAt: Instant;
  readonly priceUsd: Measured;
  readonly marketCapUsd: Measured;
  /** Non-null exactly when the cap is known. The venue tells us; we never guess. */
  readonly marketCapBasis: MarketCapBasis | null;
  /**
   * ★ ABSENT ON A CURVE, AND ABSENCE IS NOT ILLIQUIDITY. A bonding curve has no two-sided
   * reserve, so the venue reports none at all and the reason is `not_reported` — a
   * different fact from `no_market`, and it stays different all the way to the tooltip.
   */
  readonly liquidityUsd: Measured;
}

/**
 * ★ WHETHER THESE ROWS MAY BE LISTED AT ALL.
 *
 * A closed union, and the `withheld` branch carries NO rows and NO counts — the same shape,
 * and the same argument, as `CoinLink`'s `unsure`. If the rows rode along under this tag
 * they would be one prop-drill away from a table, and the point of a union is that the
 * unsafe path does not exist rather than that nobody takes it.
 *
 * `withheld` arrives when the store holds no record of where each coin row came from.
 * Without that record a demo row and an observed one are indistinguishable to every query
 * behind this screen, and a heading saying a venue priced these coins would be sitting over
 * fictions. It is NOT an error and it is NOT an empty market — those are the `shown` branch
 * with a count of zero — and the screen says something different for each of the three.
 */
export type PairListing =
  | {
      readonly listing: 'shown';
      /** How many mints the window held. The denominator of the sentence on screen. */
      readonly mintsInWindow: number;
      /** How many of those a venue could price. The numerator. */
      readonly withMarket: number;
      /** How many had none. Counted by the server in the same statement as the other two. */
      readonly withoutMarket: number;
    }
  | { readonly listing: 'withheld' };

/**
 * What sits above the list: how far it reaches, and what has been heard lately.
 *
 * `lastMintHeardAt` is a fact about the world's contact with us — the newest instant inside
 * a window in which a mint was actually observed. It is not a status and it carries no
 * verdict: how long ago that was is arithmetic, and what to say about it is the screen's
 * job. Absent means nothing has ever been heard on this feed, which is a different fact
 * from "we heard nothing lately" and renders as a different sentence.
 */
export interface PairHead {
  /** How far back the list reaches, in milliseconds. The screen states it in words. */
  readonly windowMs: number;
  readonly lastMintHeardAt: Instant;
  readonly rows: PairListing;
}

/**
 * One committed frame.
 *
 * `pairs` is the order — newest MINT first, decided by the projector and never sorted here.
 * Empty whenever `head.rows.listing` is 'withheld', and the decoder does not read it on that
 * branch, so the two halves of the frame cannot disagree about whether anything is listed.
 */
export interface PairFeed {
  readonly tick: number;
  readonly head: PairHead;
  readonly pairs: readonly Pair[];
}
