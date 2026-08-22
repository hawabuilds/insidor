/**
 * WHICH OF THE SOURCES WE INGEST FROM ARE ANSWERING — the indicator in the corner of the
 * nav, and the fact behind every empty state downstream of it.
 *
 * ★ THE PROBLEM THIS SHAPE EXISTS TO SOLVE. A board fed by three sources and a board fed by
 * one look identical: same layout, same rows, fewer stories. Nothing on the screen
 * distinguishes "the world is quiet" from "two thirds of what feeds us is dark", and the
 * second changes the meaning of every other number on the page. It is the same failure
 * `FeedSource` was added to close on the launches rail, arriving on the surface that had no
 * defence against it at all.
 *
 * ★ WHY THIS IS AN ENUM AND `FeedSource.live` IS A BOOLEAN. The mint transport has two
 * states we can tell apart — heard from recently, or not. A source we buy has three, and two
 * of them are both "dark" while asking for opposite responses from a person:
 *
 *   live      it is answering.
 *   dormant   nobody turned it on. THIS IS NOT A FAULT. Dressing it as one puts a permanent
 *             alarm over a product that is working exactly as configured, and an alarm that
 *             is always on is an alarm nobody reads.
 *   failing   it is turned on and it is not answering. THIS IS A FAULT. "You are paying for
 *             this and it is broken" is a different sentence from "you have not turned this
 *             on", and a surface that spells them the same way is a surface on which a paid
 *             outage is invisible for as long as it lasts.
 *
 * ★ THE CALL ARRIVES MADE, exactly like `FeedSource.live` and for the same reason. There is
 * no bar here to compare against, no failure count, no attempt count, no HTTP status and no
 * vendor message — a client holding the bar could re-derive the call and disagree with the
 * server about it, and a client holding a vendor's error text would be rendering somebody
 * else's 500 body to a user. What crosses is a word, and an instant, which is a fact about
 * the world's contact with us.
 *
 * ★ AND WHAT A FAILURE IS ALLOWED TO SAY IS "NOT RESPONDING". Not who we buy it from — the
 * reseller behind a platform is on FORBIDDEN_SUBSTRINGS in both directions, matched against
 * VALUES as well as keys, so `assertNoInternalVocabulary` throws on one at this boundary
 * rather than letting it reach a tooltip.
 */

import type { Instant } from '../../format/measure.ts';

/**
 * The three states, as a closed union.
 *
 * ★ AN UNRECOGNISED WORD IS A SHAPE ERROR AND NOT A FOURTH MEMBER. `decodeSourceFeed`
 * refuses rather than picking a default, and the refusal is deliberate in both directions: a
 * default of `live` would light a green pip over a state we cannot read, and a default of
 * `failing` would raise an alarm the server never asked for. A frame we cannot read is a
 * frame we do not show, and the surface already has an honest sentence for that.
 */
export type SourceState = 'live' | 'dormant' | 'failing';

/**
 * One source, as the corner of the nav reads it.
 *
 * ★ `label` IS CHOSEN BY THE SERVER AND THIS APP NEVER DERIVES ONE — the rule
 * `Story.sourceLabel` already states. The app does not map an internal source id to a
 * display name, because that mapping is exactly where a newly added platform silently
 * renders as its raw id in front of a user. `sourceId` is here as a render key and for
 * nothing else; it is never displayed.
 *
 * ★ AND `label` IS HOSTILE INPUT UNTIL PROVEN OTHERWISE, like `Launch.ticker`. It is chosen
 * from a map on the server and bounded there, and the indicator bounds it again and renders
 * it as TEXT — never as markup, never as an `href`, never as a `src`. A single door is not
 * a door you rely on alone, and this one sits in the nav, on every route, above everything.
 */
export interface SourceHealth {
  /** Stable across frames, so React keeps the DOM node. Never rendered. */
  readonly sourceId: string;
  /** Human-readable, chosen by the server. The PLATFORM — never who we buy it from. */
  readonly label: string;
  /** The already-made call. The indicator renders it; it never re-derives it. */
  readonly state: SourceState;
  /**
   * When this source last answered us.
   *
   * ★ UNKNOWN AND OLD ARE DIFFERENT AND STAY DIFFERENT, exactly as on `FeedSource`. The
   * absent branch means this source has NEVER answered — a credential that has never worked,
   * or one added five minutes ago — which is not the same sentence as "it answered three
   * hours ago and has not since". `formatAge` renders the two differently with no new
   * formatter, so the indicator gets the distinction for free as long as nothing here
   * collapses it.
   *
   * It is carried on the dormant branch too: a source switched off this morning has a real
   * last-answered instant, and hiding it would make "we turned this off" and "this never
   * worked" identical again one level down.
   */
  readonly lastHeardAt: Instant;
}

/**
 * One committed frame of the indicator.
 *
 * ★ AN EMPTY `sources` ARRAY IS A REAL ANSWER AND MEANS SOMETHING PRECISE: nothing is
 * ingesting at all. It is not a loading state and it is not a failure, and nothing
 * downstream may treat it as one — it is the answer that turns an empty board from a
 * statement about the world into a statement about us.
 *
 * The array IS the order, and it is stable across frames by construction on the server: the
 * order does not move when a state moves, so a reader learns the positions once and
 * afterwards reads the shapes rather than the words.
 */
export interface SourceFeed {
  readonly tick: number;
  readonly sources: readonly SourceHealth[];
}
