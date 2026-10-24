/**
 * WHETHER A POST IS A PROMOTION, AND WHAT ITS COIN DOES THEN (Policy.rising.promotion; the owner,
 * 2026-10-24: a caller's post quoting someone else's viral post to sell a coin "should never be what
 * we show").
 *
 * Its own file beside coin-origin.ts because it asks a different question of the same one hop. There
 * the coin-link step asks, at a launch, which post the coin's metadata really meant; here every
 * surface that shows a post asks whether the post is only a pointer — wherever we found it, coin or
 * no coin. The project service (promotions.ts) and the launch push (services/notify launch.ts) both
 * read these, so the feed's gate and the push's exception can never disagree about a post.
 *
 * ★ A PROMOTION: the post re-shares, quotes or links another account's post (`promoPointsAt`) that
 * was seen at least as widely (`promoFollows`: the bigger post is the viral one, and a big account
 * quoting a small post made the post people saw). @Infinitidigits' "how tf did we miss this Light
 * Baby?!" (0 views) quoting @prtygal777's 69M-view post, 24 Oct, is the case that made it.
 *
 * ★ EXCEPT A POST SEEN ON ITS OWN. A post at or over `ownReach` (For You's views bar) is a post
 * people saw, whatever it quotes: on 21-24 Oct every quote at that bar was commentary that went viral
 * itself (93K-515K views), and every promotion under it had 0-28K. Dropping this would empty For You
 * of every viral quote of a bigger post.
 *
 * ★ AN ORIGINAL WE DO NOT HOLD IS NO PROMOTION. Who posted it and how widely it was seen are not
 * known; the post is left as it was rather than hidden on a guess.
 *
 * ★ THE ORIGINAL'S AGE AT THE COIN'S LAUNCH decides what the coin does (`promotionAge`): at most the
 * coin-link age (`promotionMaxAgeMs`, the larger of the credit's and the one-coin link's ages, the
 * same bound the coin-link step follows promotions within) and the coin is simply the original's;
 * older, or with either time unknown, the coin is the original's only while it runs — an unknown age
 * is never taken as young.
 *
 * What breaks if changed carelessly: the order of the tests. Testing the hop before the post's own
 * views would hide a viral commentary quote; following an original we do not hold would hide a post
 * on a guess about a post we never read.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { promoFollows, promoPointsAt, type PromoFacts } from './coin-origin.ts';

/** What we hold of the post a promotion points at. */
export interface PromotedOriginal {
  readonly itemId: string;
  readonly authorKey: string;
  /** Its newest reach reading; null when none. */
  readonly reach: number | null;
  /** When it went up (our first sighting when its own time is unknown); null when neither is known. */
  readonly postedAtMs: number | null;
}

export interface PromotionBars {
  /** A post seen this widely on its own is never a promotion (For You's views bar, scaled for the source). */
  readonly ownReach: number;
}

/** The original this post promotes, or null when it is not a promotion (the header's rule). */
export function promotionOf(p: PromoFacts, held: (itemId: string) => PromotedOriginal | undefined, bars: PromotionBars): PromotedOriginal | null {
  if (p.reach !== null && p.reach >= bars.ownReach) return null;
  const next = promoPointsAt(p);
  if (next === null) return null;
  const original = held(next.itemId);
  if (original === undefined) return null;
  return promoFollows(p, original, next.hop) ? original : null;
}

/** The oldest an original may be at its coin's launch for the coin simply to be its: the coin-link step's own bound. */
export const promotionMaxAgeMs = (policy: Policy): number => Math.max(policy.finders.coinLinks.creditMaxAgeMs, policy.oneCoin.linkMaxAgeMs);

/** `young`: the coin is the original's; `old`: only while it runs. Either time unknown is `old`. */
export function promotionAge(originalPostedAtMs: number | null, launchedAtMs: number | null, policy: Policy): 'young' | 'old' {
  if (originalPostedAtMs === null || launchedAtMs === null) return 'old';
  return launchedAtMs - originalPostedAtMs <= promotionMaxAgeMs(policy) ? 'young' : 'old';
}

/** What the running test reads of a coin's newest market reading; null is not known. */
export interface PromotedCoinHour {
  readonly volume1hUsd: number | null;
  readonly trades1h: number | null;
  readonly readAtMs: number | null;
}

/**
 * Whether an old original's coin brings it back now: launched at most `notify.launch.lateRunningMs`
 * ago, and its newest reading — no older than `market.readingFreshnessMs` — clears `notify.savedPost`'s
 * last-hour bars. A missing or stale reading is not running.
 */
export function promotionRevives(launchedAtMs: number | null, hour: PromotedCoinHour | null, nowMs: number, policy: Policy): boolean {
  if (launchedAtMs === null || nowMs - launchedAtMs > policy.notify.launch.lateRunningMs) return false;
  if (hour === null || hour.readAtMs === null || nowMs - hour.readAtMs > policy.market.readingFreshnessMs) return false;
  const bars = policy.notify.savedPost;
  return hour.volume1hUsd !== null && hour.trades1h !== null && hour.volume1hUsd >= bars.minVolume1hUsd && hour.trades1h >= bars.minTrades1h;
}
