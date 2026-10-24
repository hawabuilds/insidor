/**
 * THE EARLY PICK: a post's coin taken while it is still under $20K, by the one thing the market
 * readings can say that early (the owner, 2026-10-24: "make sure I would've caught the right baldcat
 * coin early before it took off").
 *
 * Its own rule, beside `pickOneCoin` (one-coin.ts) and `runnerHandover` (runner-handover.ts), because
 * it asks a question neither can. `pickOneCoin` judges net buying on the trade feed, which hits its
 * daily credit cap every day and cuts busy coins by outage within minutes, and on readings it needs
 * the coin at `minCapUsd` and three times every rival — by then $baldcat was at $52K. The hand-over
 * judges a coin's last hour, which a coin minutes old does not have. This compares the post's launch
 * wave at one instant, on the latest market reading of each coin:
 *
 *   made     only a coin the creators made for the post: a link to it (one hop through the
 *            promotion that quotes it included) or its whole stated name. A picture or a shared
 *            name is the copycat problem itself.
 *   young    judged from `fromMs` to `withinMs` after its launch: before, every coin is at its
 *            opening cap; after, the ordinary rule has the readings it needs.
 *   band     its fresh reading's cap is in [`minCapUsd`, `maxCapUsd`): under it is noise a single
 *            buyer makes, at or over it the ordinary rule's own bar takes over.
 *   ahead    its rise over the opening cap is at least `lead` times every rival's — the post's
 *            other candidates launched in the `rivalWithinMs` before now (the launch wave). An older
 *            coin of the post is the incumbent, which the ordinary rule and the hand-over judge.
 *
 * Replayed read-only on 21-24 Oct (tools/sub20k-replay.ts, "climb 5x cap≥12K ≤30m link"): about 9
 * a day on posts that were on For You before the coin; 5 ran past $50K against 23 that died. On
 * the baldcat post it takes $baldcat at +8.8 minutes and $14.3K, where the live pick came at +6 h.
 *
 * ★ AN UNREAD RIVAL CANNOT BLOCK, AS ON THE READINGS RULE: a rival with no reading has risen
 * nothing we know of. That favours the pick; the evidence counts the rivals unread so a replay can
 * score it. A rival whose reading has no pool behind it (`minLiquidityUsd`) has a frozen quote, not a
 * cap, and rises nothing either. The picked coin's own reading must be fresh and pooled.
 *
 * What breaks if changed carelessly: dropping the `made` tie. Replayed on the same days, the bar with
 * any tie picks 22 coins a day against 13 and 68 that died against 35, for the same 5 runners: the
 * extra ones are look-alikes pushed to $15K in their first minutes, each pushed as the post's coin.
 */

import type { MatchEvidence } from './one-coin.ts';

/** One coin of the post, as the rule reads it. */
export interface EarlyCoin {
  readonly address: string;
  /** Null when unknown: such a coin is neither picked nor a rival. */
  readonly launchedAtMs: number | null;
  readonly ties: readonly MatchEvidence[];
  /** Its newest market reading, or null when it has none. */
  readonly reading: { readonly capUsd: number; readonly readAtMs: number; readonly liquidityUsd: number | null } | null;
}

export interface EarlyBars {
  readonly minCapUsd: number;
  readonly maxCapUsd: number;
  readonly lead: number;
  readonly fromMs: number;
  readonly withinMs: number;
  readonly rivalWithinMs: number;
  /** The picked coin's reading must be this recent. */
  readonly readingWithinMs: number;
  /** The cap every coin opens at (Policy.oneCoin.openingCapUsd): a rise is the cap over it. */
  readonly openingCapUsd: number;
  /** A reading on a pool under this is a frozen quote (Policy.oneCoin.minLiquidityUsd). */
  readonly minLiquidityUsd: number;
}

export interface EarlyPick {
  readonly address: string;
  readonly capUsd: number;
  readonly ageMs: number;
  readonly riseUsd: number;
  /** The highest rival rise; 0 when no rival rose (or none was read). */
  readonly rivalRiseUsd: number;
  /** The rivals in the wave, and how many of them had no reading. */
  readonly rivals: number;
  readonly rivalsUnread: number;
  readonly ties: readonly MatchEvidence[];
}

/** The ties that are the creators making the post's own coin, for this rule. */
const MADE_FOR_POST: readonly MatchEvidence[] = ['link', 'name_stated'];

const pooled = (r: EarlyCoin['reading'], bars: EarlyBars): boolean => r !== null && (r.liquidityUsd === null || r.liquidityUsd >= bars.minLiquidityUsd);

/** A coin's rise over the opening cap on its reading; 0 unread, frozen or under the opening. */
export function riseOf(c: EarlyCoin, bars: EarlyBars): number {
  return c.reading !== null && pooled(c.reading, bars) ? Math.max(0, c.reading.capUsd - bars.openingCapUsd) : 0;
}

/** The coin of the post the early rule takes now, or null: the strongest rise that qualifies. */
export function earlyPick(coins: readonly EarlyCoin[], nowMs: number, bars: EarlyBars): EarlyPick | null {
  let best: EarlyPick | null = null;
  for (const c of coins) {
    if (c.launchedAtMs === null || !c.ties.some((t) => MADE_FOR_POST.includes(t))) continue;
    const age = nowMs - c.launchedAtMs;
    if (age < bars.fromMs || age > bars.withinMs) continue;
    const r = c.reading;
    if (r === null || !pooled(r, bars) || nowMs - r.readAtMs > bars.readingWithinMs) continue;
    if (r.capUsd < bars.minCapUsd || r.capUsd >= bars.maxCapUsd) continue;
    const rise = riseOf(c, bars);
    if (rise <= 0) continue;
    const wave = coins.filter((o) => o.address !== c.address && o.launchedAtMs !== null && o.launchedAtMs <= nowMs && o.launchedAtMs >= nowMs - bars.rivalWithinMs);
    const rivalRise = Math.max(0, ...wave.map((o) => riseOf(o, bars)));
    if (rise < bars.lead * rivalRise) continue;
    const pick: EarlyPick = { address: c.address, capUsd: r.capUsd, ageMs: age, riseUsd: rise, rivalRiseUsd: rivalRise, rivals: wave.length, rivalsUnread: wave.filter((o) => o.reading === null).length, ties: c.ties };
    if (best === null || pick.riseUsd > best.riseUsd || (pick.riseUsd === best.riseUsd && pick.address < best.address)) best = pick;
  }
  return best;
}
