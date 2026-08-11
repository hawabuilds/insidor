/**
 * THE BOARD ROW — the wire shape of one line on the ranked feed.
 *
 * The row shows exactly seven things: picture, title, two lines of plain English, views, a
 * small line graph, age, and one button. This interface has exactly the fields those seven
 * need and no others, because a field that exists gets rendered eventually. `id` is the key,
 * `isNew` and `momentum` are treatments of cells already counted rather than new cells.
 *
 * What is NOT here, and never will be: score, confidence, heat, burst, eta, propensity,
 * policy hash, cost, and rank. Position on the board is the array index of `BoardTick.order`,
 * so the row itself does not know where it sits.
 *
 * `momentum` is the shape of the whole design. Internally momentum is a number. The server
 * projects it to a three-valued enum, one way, forever. There is nothing here to threshold.
 */

import type { Instant, Measured } from '../../format/measure.ts';
import type { CoinLink } from './coin.ts';

/** A judgement, already made. Not re-derivable from anything else on the row. */
export type Tone = 'rising' | 'steady' | 'cooling';

/**
 * One point on the small line graph.
 *
 * `value: null` is a censored reading — the counter was quantized and the change fell below
 * the rounding step, so nothing was learned and nothing is claimed. It is NOT a zero. The
 * sparkline breaks its line at a null rather than dropping to the floor, because a drop to
 * the floor reads as collapse and the item may in fact be accelerating.
 */
export interface SparkPoint {
  readonly atMs: number;
  readonly value: number | null;
}

export interface Spark {
  readonly points: readonly SparkPoint[];
  /** The window the points cover, so a graph with two points is not drawn as a full window. */
  readonly windowMs: number;
}

export interface BoardRow {
  readonly id: string;

  /** Plain English, written by the server. */
  readonly title: string;
  /**
   * Exactly two lines. A tuple rather than a string array, so "two lines of plain English"
   * is a shape the compiler checks instead of a paragraph someone lets grow to five.
   */
  readonly summary: readonly [string, string];
  readonly thumbUrl: string | null;

  /**
   * How many people saw it. Measured rather than a number because a source may have no such
   * concept at all — and the honest render of that is a dash, not a zero that sorts last.
   */
  readonly reach: Measured;
  readonly spark: Spark;
  readonly momentum: Tone | null;

  /** When the story began, so the row can show its age. Unknown stays unknown. */
  readonly firstSeenAt: Instant;

  readonly coins: CoinLink;

  /** A brand-new entrant, flagged by the server so the board can treat it as an arrival. */
  readonly isNew: boolean;
}

/**
 * One committed frame of the board.
 *
 * The server commits `(tick, order)` and the client NEVER sorts. That is the ranking design's
 * decision and the frontend's only job is to honour it — which is also why there is no
 * sortable-table library in this package: importing one invites back the thing that was
 * banned.
 */
export interface BoardTick {
  readonly tick: number;
  readonly order: readonly string[];
  readonly rows: readonly BoardRow[];
}

/** The fields a live patch is allowed to move. Order is not one of them. */
export type PatchableField = 'title' | 'summary' | 'thumbUrl' | 'reach' | 'spark' | 'momentum' | 'coins';

export interface RowPatch {
  readonly id: string;
  readonly fields: Partial<Pick<BoardRow, PatchableField>>;
}
