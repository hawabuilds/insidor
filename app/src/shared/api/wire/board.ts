/**
 * THE BOARD ROW — the wire shape of one line on the ranked feed.
 *
 * The row shows exactly eight things: picture, title, two lines of plain English, views, a
 * small line graph, age, market cap, and one button. This interface has exactly the fields
 * those eight need and no others, because a field that exists gets rendered eventually. `id`
 * is the key, `isNew` and `momentum` are treatments of cells already counted rather than new
 * cells.
 *
 * What is NOT here, and never will be: score, confidence, heat, burst, eta, propensity,
 * policy hash, cost, and rank. Position on the board is the array index of `BoardTick.order`,
 * so the row itself does not know where it sits.
 *
 * `momentum` is the shape of the whole design. Internally momentum is a number. The server
 * projects it to a three-valued enum, one way, forever. There is nothing here to threshold.
 */

import type { Delta, Instant, Measured } from '../../format/measure.ts';
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

  /**
   * The market cap of the story's coin — and a story has a coin only when exactly one of
   * them is settled.
   *
   * ★ MARKET CAP IS A PROPERTY OF A COIN, NOT OF A STORY, so this is DERIVED from `coins`
   * and is never a number measured against the story itself. Absent for every branch of
   * `CoinLink` except `one`, with a different reason for each, and the branch that has to
   * be read twice is `several`: it is absent there DELIBERATELY. A sum across several
   * coins is a number that is true of nothing, and the largest of them is a choice
   * dressed as a fact — and picking which coin is the real one is precisely the judgement
   * the `unsure`/`several` branches exist to say we have not made.
   *
   * The decision itself lives in `projectMarketCap` in services/project/src/project.ts,
   * once, where the reasons are written out. This is only the shape it arrives in.
   */
  readonly marketCapUsd: Measured;

  /**
   * The story's coin's 24-hour price move, as a signed percentage — the GAIN column.
   *
   * ★ DERIVED FROM `coins` EXACTLY LIKE THE CAP ABOVE, and absent for every branch but
   * `one` for the same reasons, which are worth restating because the temptations are
   * different here. Across `several`, the AVERAGE of three rival tokens' moves
   * describes a portfolio nobody holds, and the biggest riser is a choice about which
   * coin is the real one wearing a percentage sign. This is the column a user is most
   * likely to trade on, so it is the worst place in the product to make either.
   *
   * The other filling that must never happen is reach: it is right there on the row and
   * it moves. Reach growth is how many more people saw a story; this is what a coin's
   * price did. Labelling the first as the second, under a head that says GAIN, is the
   * most expensive lie this board could tell.
   *
   * `Delta` and not `Measured`: it is the one field allowed to carry colour, by sign.
   */
  readonly priceChange24h: Delta;

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
/**
 * WHERE THE STORIES ON THIS FRAME CAME FROM.
 *
 * ★ THE BUG THIS CLOSES. `pnpm db:seed` writes six hand-written stories. The board
 * rendered them under a heading reading **Trending**, with a live pip and a market cap
 * column, and nothing on the screen said they were invented. "Everything is just a
 * placeholder" was the correct reading of that screen, and there was no way to reach it
 * except by knowing.
 *
 * ★ THE SERVER DECIDES, THIS TYPE ONLY CARRIES IT. Which is the point: the app cannot
 * look at a row and work out whether it is real, because `origin` is not on the row and
 * never will be. The judgement is made once, by the projector, against the frame it is
 * committing — so the notice cannot be switched off here, and it switches ITSELF off the
 * moment a story assembled from real posts reaches the board.
 */
export type BoardProvenance =
  /** Every story on the frame came from observed posts. There is nothing to announce. */
  | { readonly kind: 'observed' }
  | {
      /** At least one story on the frame was written by the seed. */
      readonly kind: 'seeded';
      readonly seededStories: number;
      readonly totalStories: number;
      /** The post source that costs nothing to connect, in the words the nav's pips use. */
      readonly connectSourceLabel: string;
    }
  /**
   * The frame did not say. A server too old to send the field, or one whose projection
   * predates it.
   *
   * ★ IT IS NOT FOLDED INTO `observed`, and that is the whole reason it exists. `observed`
   * means "we checked, and these are real" — the one answer that must never be reachable
   * by an absence. A missing field means we do not know, and the honest render of not
   * knowing is a line of text saying so, not a silently trustworthy board.
   */
  | { readonly kind: 'unstated' };

export interface BoardTick {
  readonly tick: number;
  readonly order: readonly string[];
  readonly rows: readonly BoardRow[];
  /**
   * ★ ON THE FRAME, WITH THE ROWS IT DESCRIBES. A board of six seeded stories and a board
   * of six real ones are the same array of six rows; this is the only field between them.
   * Travelling with the rows is what stops this frame's stories being shown under the
   * previous frame's provenance.
   */
  readonly provenance: BoardProvenance;
}

/**
 * The fields a live patch is allowed to move. Order is not one of them.
 *
 * `marketCapUsd` and `priceChange24h` are here because both move with the market between
 * frames and re-sending the whole row to change one number is how a live channel becomes a
 * refetch loop. Both are derived from `coins`, so a patch that moves `coins` has to move
 * them too or the row will show the previous coin's figures beside the new coin — the
 * server sends them together, and the decoder below cannot enforce that because a patch
 * carrying only one of them is a legitimate frame when only that one changed.
 */
export type PatchableField =
  | 'title'
  | 'summary'
  | 'thumbUrl'
  | 'reach'
  | 'spark'
  | 'momentum'
  | 'marketCapUsd'
  | 'priceChange24h'
  | 'coins';

export interface RowPatch {
  readonly id: string;
  readonly fields: Partial<Pick<BoardRow, PatchableField>>;
}
