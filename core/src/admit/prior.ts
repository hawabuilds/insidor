/**
 * The author prior — our own standing for an account, in [0,1].
 *
 * WHY ours and never theirs: every source publishes some prominence signal, and
 * every one of them is the source's to game and the account's to buy. A prior we
 * compute from our own history of that account — did their items reach stories, did
 * those stories go anywhere — is expensive to manufacture, because manufacturing it
 * means actually producing things other people copy.
 *
 * WHY it is a prior and not a gate: the roster is the strongest single term in the
 * admission score and it must never be the only thing consulted, or the system
 * becomes a follower of accounts it already knows and stops finding anything. The
 * corpus-relative carrier term exists precisely to admit unknown accounts, and it is
 * available at zero engagement, which is where lead time actually comes from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THIS IS THE FEATURE MOST WORTH FARMING IN THE SYSTEM, so what an attacker does
 * against it and what it costs them is written down here rather than discovered later.
 *
 * THE ATTACK. Stand up accounts. Post items shaped to clear ADMIT. Get those items
 * joined into stories, get the stories qualified, and — the valuable one — get a story
 * to resolve against an asset. Then ride the resulting roster tier: it is worth 0.3 of
 * the admission score, the largest single weight there is, and it is the one term that
 * is available before anybody has reacted to a post.
 *
 * WHAT EACH STEP ACTUALLY COSTS, which is the part that decides whether the attack is
 * worth running:
 *
 *   · `itemsAdmitted` is OUR count of admissions, and the bar is a QUANTILE of the
 *     day's real arrivals. So the cost of one unit of the denominator scales with real
 *     traffic rather than sitting at a fixed number an attacker can price once.
 *   · `itemsJoinedStory` requires OTHER accounts to carry the same carriers. An
 *     attacker can supply those accounts, but GROUP weights a carrier by its
 *     persistence across days and its breadth across authors, so a carrier only a farm
 *     uses is weighted toward nothing. Manufacturing this term means manufacturing
 *     apparent breadth, which is the expensive kind.
 *   · `storiesResolved` is the highest-weighted and the genuinely cheap one to fake:
 *     an attacker who issues their own asset for their own story can produce a
 *     confident match. NAMING IT IS THE POINT — this is the soft spot, it is weighted
 *     0.5, and it is the term to watch when the roster starts behaving oddly.
 *
 * WHAT BOUNDS THE PAYOFF, and there are three, which is why the attack is not worth
 * much even though the last step is cheap:
 *
 *   1. THE SHRINKAGE BOUNDS THE RAMP. `n/(n+k)` at k = 10 means the first ten admitted
 *      items buy at most half the distance from the population mean. There is no burst
 *      of activity that produces a top-tier account quickly.
 *   2. THE DECAY BOUNDS THE HOLD. The weight halves every `halfLifeDays`, so a farmed
 *      tier is not an asset, it is a subscription. Stopping means sliding back to the
 *      population mean, and a campaign that ran two years ago is worth nothing today.
 *   3. THE ARITHMETIC BOUNDS THE PRIZE. A perfect roster tier contributes 0.3 to a
 *      score whose bar is a high quantile of the day's arrivals. It cannot admit
 *      anything on its own. That is what "a prior and not a gate" means as a number
 *      rather than as a principle, and it is why the weight can afford to be the
 *      largest one.
 *
 * ★ AND THE DECAY IS TOWARD THE POPULATION MEAN, NEVER TOWARD ZERO. Forgetting an
 * account must return it to "we do not know", not move it to "we think they are bad".
 * Decaying toward zero would mean an account that was good two years ago and has been
 * quiet since scores BELOW an account we have never seen, which is a claim we have no
 * evidence for and would be a second, stranger thing for an attacker to exploit.
 */

import type { AuthorKey } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { MS_PER_DAY, clamp01 } from '../math.ts';

/**
 * The account's own history, as counts. No source fields, no follower number: those
 * are theirs. These are ours, and they are outcomes we observed.
 */
export interface AuthorHistory {
  readonly authorKey: AuthorKey;
  readonly observedFrom: Millis;
  /**
   * The end of the window these counts cover — normally the nightly job's own cutoff.
   *
   * ★ WHY IT WAS ADDED. The counts carry no per-item timestamps, so a decay needs SOME
   * instant to measure the evidence's age from, and `observedFrom` alone is the wrong
   * one: it is the age of the OLDEST evidence, so a continuously active account of
   * three years' standing would be decayed as though everything it ever did happened
   * three years ago. With both ends the midpoint is available, and the midpoint is the
   * best unbiased estimate of the evidence's age that counts-without-timestamps can
   * support. It is genuinely an estimate — an account that was busy early and quiet
   * since has its evidence dated too late — and the repair, if that ever matters, is
   * per-period counts rather than a cleverer function of two instants.
   */
  readonly observedTo: Millis;
  readonly itemsAdmitted: number;
  readonly itemsJoinedStory: number;
  readonly storiesQualified: number;
  /** Stories of theirs that produced a confidently matched asset. Sparse and slow. */
  readonly storiesResolved: number;
}

/**
 * The roster tier.
 *
 * Runs offline, nightly, over the whole author corpus, and writes `Author.rosterTier`
 * — it is not called on the admission path, because the admission path is handed the
 * already-computed tier as data.
 *
 * Two properties it must have, and neither is obvious:
 *   - It must shrink toward the population mean for accounts with little history, or
 *     an account with one lucky item outranks an account with forty good ones.
 *   - It must decay with age, because the accounts that mattered six months ago are
 *     a different population from the ones that matter now, and a roster that never
 *     forgets slowly becomes a list of who was early to the last regime.
 *
 * ★ BOTH PROPERTIES COME OUT OF ONE QUANTITY, which is the part worth understanding
 * before changing anything here. The shrinkage weight is `n/(n+k)`; the decay is
 * applied to `n` rather than to the score. So an account's evidence does not get worse
 * with age, it gets LIGHTER — and a lighter weight is exactly a stronger pull back to
 * the population mean. Forty items from two years ago behave like almost no items at
 * all, which is the correct reading of them, and they do it through the same line of
 * arithmetic that handles an account with two items from yesterday.
 *
 * ★ IT TAKES A POLICY, AND THE STUB'S SIGNATURE DID NOT. Without it every constant
 * above would be a numeric literal in this file: `tools/check-policy.mjs` fails CI on
 * exactly that, and `prior.ts` is not on its allowlist and never will be — "if a stage
 * needs a number, the number is a threshold, and thresholds live in policy.ts". There
 * is also no third option for the population mean in particular: this function sees ONE
 * author's history, so it cannot compute a mean over the population, and the value has
 * to arrive from outside.
 *
 * Purity is unaffected by "runs offline, nightly": `now` is a value, not a call.
 *
 * @returns a number in [0,1]. `admit/stage.ts` wraps this in clamp01, so a value
 *          outside the range would be silently truncated there rather than caught; it
 *          is clamped here so that the truncation never has anything to do.
 */
export function rosterTier(history: AuthorHistory, now: Millis, p: Policy): number {
  const roster = p.admit.roster;

  /*
   * ★ AN EMPTY HISTORY RETURNS THE POPULATION MEAN EXACTLY, and it falls out of the
   * arithmetic rather than being special-cased: n = 0 makes the weight 0, so the
   * result is the shrink target and nothing else.
   *
   * That is the whole point. A zero here would be a CLAIM that the account is bad, and
   * we have not looked — the same rule kinetics/rate.ts enforces for a censored
   * counter and group/stage.ts enforces for a missing similarity. An account nobody
   * has seen is not an account that failed.
   */
  const trials = Math.max(history.itemsAdmitted, 0);
  if (trials === 0) return clamp01(roster.populationMean);

  const w = roster.weights;
  /*
   * The four counts are a funnel — admitted ⊇ joined ⊇ qualified ⊇ resolved — so
   * dividing weighted successes by admissions gives a number in [0,1] whenever the
   * nesting holds, and the weights sum to 1 so an account every one of whose items
   * reached a resolved story scores exactly 1 before shrinkage. The clamp is for the
   * case where the nesting does NOT hold, which a corpus repair or a backfill can
   * produce: a broken denominator should cost the account nothing rather than
   * producing a tier above one that then gets truncated somewhere else.
   */
  const credit =
    w.itemsJoinedStory * history.itemsJoinedStory +
    w.storiesQualified * history.storiesQualified +
    w.storiesResolved * history.storiesResolved;
  const raw = clamp01(credit / trials);

  /*
   * The evidence's age, dated from the midpoint of the window the counts cover, and
   * floored at zero so a window whose end is in the future — a clock skew, a job that
   * ran early — cannot AMPLIFY an account's weight above what its count alone earns.
   */
  const midpoint = (history.observedFrom + history.observedTo) / 2;
  const ageDays = Math.max(now - midpoint, 0) / MS_PER_DAY;
  const decay = Math.exp((-Math.LN2 * ageDays) / roster.halfLifeDays);

  const effectiveTrials = trials * decay;
  const weight = effectiveTrials / (effectiveTrials + roster.shrinkageStrength);

  return clamp01(weight * raw + (1 - weight) * roster.populationMean);
}
