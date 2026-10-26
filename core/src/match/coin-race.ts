/**
 * THE RACE: two (or `size`) coins the creators made for one post, broken away from the rest
 * together, shown together — "See 2 coins" on the card — instead of trusting whichever leads.
 *
 * Its own rule, beside `pickOneCoin` (one-coin.ts), because it answers a different question at a
 * different time. The pick names ONE coin and waits `judgeFromMs` after a launch to do it; the race
 * says, from a coin's first reading, "these are the coins people are actually buying for this post",
 * which is a fact about the world even while the pick cannot honestly choose. 25 Oct 2026, $Marvin:
 * from 02:04 two coins linking the post stood at $53k and $22k over thirty under $15k; the leader
 * was dumped at 02:20 and the second ran to $657k. Nothing in the first twenty minutes of trades
 * told them apart — more buyers, more volume and a higher cap on the wrong one, no creator sale on
 * either — so the honest early card is both.
 *
 *   made for the post   a link, the picture or the whole stated name (`madeForPost` in one-coin.ts):
 *                       a coin that only shares a name is the copycat problem and never races
 *   standing            not out: its creator has not sold and its cap is not under `rugShareOfPeak`
 *                       of its own peak
 *   young               every racer launched within `windowMs` of now: a race is the opening minutes
 *   broke away          each racer at least `minCapUsd`, and the last racer at least `gapRatio`
 *                       times the next standing coin made for the post (none: it broke away)
 *
 * Caps are the trades' newest USD cap when the coin is watched, else its newest market reading.
 *
 * What breaks if changed carelessly: the field it ranks in. Ranking every candidate, name-only coins
 * included, lets a $12k older coin of the name into a Marvin race and pushes the real coin out.
 */

import type { Contender, MatchEvidence } from './one-coin.ts';

export interface RaceBars {
  readonly windowMs: number;
  readonly minCapUsd: number;
  readonly gapRatio: number;
  readonly size: number;
  readonly rugShareOfPeak: number;
}

const MADE: readonly MatchEvidence[] = ['link', 'picture', 'name_stated', 'missed_runner'];

/** A contender's newest cap and peak in USD, and whether its creator sold; null when unread. */
function capOf(c: Contender): { readonly cap: number; readonly peak: number; readonly creatorSold: boolean } | null {
  const t = c.trades;
  if (t !== null && t !== 'quiet' && t.capUsd !== null) {
    const ratio = t.cap !== null && t.peakCap !== null && t.cap > 0 ? t.peakCap / t.cap : 1;
    return { cap: t.capUsd, peak: t.capUsd * ratio, creatorSold: t.creatorSold };
  }
  const m = c.market;
  if (m === null) return null;
  return { cap: m.capUsd, peak: m.peakCapUsd, creatorSold: t !== null && t !== 'quiet' && t.creatorSold };
}

/** The racing coins now, highest cap first; empty when there is no race. */
export function racingCoins(contenders: readonly Contender[], nowMs: number, bars: RaceBars): readonly string[] {
  if (bars.size <= 1) return [];
  const field = contenders
    .filter((c) => c.evidence.some((e) => MADE.includes(e)))
    .map((c) => ({ c, f: capOf(c) }))
    .filter((x): x is { c: Contender; f: { cap: number; peak: number; creatorSold: boolean } } => x.f !== null)
    .filter((x) => !x.f.creatorSold && !(x.f.peak > 0 && x.f.cap < bars.rugShareOfPeak * x.f.peak))
    .sort((a, b) => b.f.cap - a.f.cap || a.c.address.localeCompare(b.c.address));
  const racers = field.slice(0, bars.size);
  if (racers.length < bars.size) return [];
  if (racers.some((r) => r.f.cap < bars.minCapUsd || r.c.launchedAtMs === null || nowMs - r.c.launchedAtMs > bars.windowMs)) return [];
  const last = racers[racers.length - 1]!.f.cap;
  const next = field[bars.size]?.f.cap ?? 0;
  if (last < bars.gapRatio * next) return [];
  return racers.map((r) => r.c.address);
}
