/**
 * THE MISSED RUNNER'S POST: of the posts we hold from before a coin launched, the one it came from —
 * for a coin that ran big while no post's or narrative's pick held it.
 *
 * Its own file because it runs backwards from the matcher (one-coin.ts `launchMatches`): that one
 * starts from a launch in its first minutes and asks which recent posts it could be; this starts from
 * a coin that already ran, hours later, and asks which post of the two days before it was the origin.
 * The question is different, so the ranking is: the strongest tie first, then the BIGGEST post, then
 * the earliest. 23 Oct, "You Missed Coin" ($BITCHES): two 21-view promos stated its name as well as
 * the origin did; the origin (@TocRadio, 84.5k reach) is the post people saw.
 *
 * The ties, strongest first (the three names are one tier):
 *   name_stated  the coin carries the post's whole stated name and ticker (stated-name.ts)
 *   name_judge / name_guess  its name or ticker is exactly one of the judge's or the namer's names
 *   name_text    the post's own words, or their English translation, carry it (one-coin.ts
 *                `namedInText`: never the ticker alone)
 *   picture      the coin's picture is the post's, where both were embedded (the caller's similarity)
 * A post with no tie is never the coin's. A picture alone ranks under every name.
 *
 * What breaks if changed carelessly: ranking by the tie alone. Every coin that runs draws promos
 * that repeat its name exactly, posted minutes before or after the launch; ranked on ties and time
 * they would be its origin every time.
 */

import { nameMatch } from './post-coin.ts';
import { namedInText, statedNamesOf, type MatchEvidence, type MatchPost } from './one-coin.ts';
import { statesName, type StatedBars } from './stated-name.ts';

/** A post we hold, as the net reads it. */
export interface RunnerPost extends MatchPost {
  /** Its words in English, when it was translated; null otherwise. */
  readonly textEn: string | null;
  /** Its most reach read; null when never read. */
  readonly reach: number | null;
  /** The coin's picture similarity to the post's, where both were embedded; null otherwise. */
  readonly pictureSimilarity: number | null;
}

export interface RunnerCoin {
  readonly name: string | null;
  readonly ticker: string | null;
}

export interface RunnerBars extends StatedBars {
  readonly minSimilarity: number;
  /** Of the strongest tier, the earliest post with at least this share of the biggest one's reach is the origin. */
  readonly originShareOfTop: number;
}

export interface RunnerMatch {
  readonly itemId: string;
  readonly ties: readonly MatchEvidence[];
  readonly reach: number | null;
}

/** The ties between a running coin and one post we hold; empty when none. */
export function runnerTies(p: RunnerPost, coin: RunnerCoin, bars: RunnerBars): readonly MatchEvidence[] {
  const ties: MatchEvidence[] = [];
  const words = [p.text, p.textEn].filter((t): t is string => t !== null && t !== undefined && t !== '').join('\n');
  const post: MatchPost = { ...p, text: words === '' ? null : words };
  if (statesName(statedNamesOf(post), coin, bars)) ties.push('name_stated');
  if (p.judgeNames.length > 0 && nameMatch(p.judgeNames, coin, bars) === 'exact') ties.push('name_judge');
  if (p.guessNames.length > 0 && nameMatch(p.guessNames, coin, bars) === 'exact') ties.push('name_guess');
  if (!ties.includes('name_judge') && !ties.includes('name_guess') && namedInText(post, coin, bars)) ties.push('name_text');
  if (p.pictureSimilarity !== null && p.pictureSimilarity >= bars.minSimilarity) ties.push('picture');
  return ties;
}

/**
 * The strength of a post's best tie: a name (stated, the judge's or the namer's: one tier, so a small
 * promo repeating the name never outranks the big post by its tie), then its words, then the picture.
 */
function strength(ties: readonly MatchEvidence[]): number {
  if (ties.some((t) => t === 'name_stated' || t === 'name_judge' || t === 'name_guess')) return 2;
  return ties.includes('name_text') ? 1 : 0;
}

/**
 * The posts tied to the coin, best first: the strongest tie, then the most reach (unread last), then
 * the earliest post — except that the first is the ORIGIN: of the strongest tier, the earliest post
 * with at least `originShareOfTop` of the biggest one's reach. A retelling read later has had longer
 * to grow: on $BITCHES, @LauraLoomer's post (19:31 UTC, 111.7k views when last read) out-read
 * @TocRadio's (18:04, 84.5k read once, when found), which it retold; at a half, the origin is first.
 */
export function rankRunnerPosts(posts: readonly RunnerPost[], coin: RunnerCoin, bars: RunnerBars): readonly RunnerMatch[] {
  const tied = posts.flatMap((p) => {
    const ties = runnerTies(p, coin, bars);
    return ties.length === 0 ? [] : [{ p, ties, s: strength(ties) }];
  });
  const reach = (v: number | null): number => (v === null ? Number.NEGATIVE_INFINITY : v);
  const ranked = tied.sort((a, b) => b.s - a.s || reach(b.p.reach) - reach(a.p.reach) || a.p.postedAtMs - b.p.postedAtMs || a.p.itemId.localeCompare(b.p.itemId));
  const top = ranked[0];
  if (top !== undefined && top.p.reach !== null) {
    const bar = bars.originShareOfTop * top.p.reach;
    const origin = ranked.filter((x) => x.s === top.s && x.p.reach !== null && x.p.reach >= bar).sort((a, b) => a.p.postedAtMs - b.p.postedAtMs || a.p.itemId.localeCompare(b.p.itemId))[0];
    if (origin !== undefined && origin !== top) ranked.splice(ranked.indexOf(origin), 1), ranked.unshift(origin);
  }
  return ranked.map(({ p, ties }) => ({ itemId: p.itemId, ties, reach: p.reach }));
}
