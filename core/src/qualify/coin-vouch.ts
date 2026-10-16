/**
 * Whether a coin naming a post stands in for the post's views on For You (`rising.coinLinked`).
 *
 * Its own file beside `reach-bar.ts` because it is a second way past the same gate, not a change to
 * the view bars: the projector asks `clearsReachBar(...) || coinVouches(...)`, and the instant judge
 * in the runner asks this alone to pick which coin-named posts are worth judging at once. One pure
 * rule, so the two can never disagree about which posts the coin path is for.
 *
 * The rule: the first observed coin whose metadata names the post launched no earlier than
 * `origin.launchAllowanceMs` before the post (a coin cannot name a post that did not exist; the
 * allowance is clock skew) and at most `maxPostAgeAtLaunchMs` after it, and the post had at least
 * `minApprovals` approvals at its newest read. Somebody paid to launch a coin on a young post that
 * thousands of people had already approved: that is a fact about the world, as a view count is.
 *
 * ★ AN UNKNOWN IS NOT A PASS. No post time, no coin launch time, or no approvals reading: the coin
 * vouches for nothing, and the post is held to the view bars as before.
 *
 * What breaks if changed carelessly: this only ever opens the view bar. The judge's yes, the kind
 * question, the not-a-meme hold and For You's six hours are applied by their own code after it;
 * reading a coin as "a meme" here would put every copycat's favourite post on the feed.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

export interface CoinVouchFacts {
  readonly postedAtMs: number | null;
  /** The launch of the first observed coin whose metadata names the post; null when none. */
  readonly firstCoinAtMs: number | null;
  /** The post's approvals at its newest read; null when never read. */
  readonly approvals: number | null;
}

export function coinVouches(f: CoinVouchFacts, p: Policy): boolean {
  const c = p.rising.coinLinked;
  if (!c.on || f.postedAtMs === null || f.firstCoinAtMs === null || f.approvals === null) return false;
  const after = f.firstCoinAtMs - f.postedAtMs;
  return after >= -p.origin.launchAllowanceMs && after <= c.maxPostAgeAtLaunchMs && f.approvals >= c.minApprovals;
}
