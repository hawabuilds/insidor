/**
 * Folding two stories that turn out to be one.
 *
 * This happens constantly and legitimately: two clusters seeded minutes apart from
 * different sources, joined later by a shared image nobody had hashed yet. The rule is
 * carrier overlap, and the direction is always into the OLDER story — the earliest
 * post time is the clock every pre-mint ordering test in RESOLVE depends on, and a
 * merge that moved it forward would silently invalidate decisions already made.
 *
 * Merges must be idempotent and acyclic. A follows-once pointer plus a store
 * invariant is the shape; a chain of merges resolved at read time is how a cycle gets
 * created without anyone choosing one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ WHY THE DIRECTION IS THE WHOLE RULE, spelled out because "oldest wins" reads
 * like a tidiness preference and is not one.
 *
 * `Story.earliestPostAt` is the clock RESOLVE's `G2_predates_post` gate runs against:
 * an asset minted before the story's earliest post was adopted by the story, not
 * minted from it, and that gate is what stops the product claiming credit for a coin
 * that already existed. Merging into the NEWER story would move `earliestPostAt`
 * forward, and every asset in the gap between the two would silently change class
 * from "adopted" to "minted from this" — retroactively, for decisions already logged,
 * with no row anywhere recording that it happened.
 *
 * That is also why earliness is the only thing this direction can be based on. Member
 * count, activity and breadth all argue for merging into the bigger story; all three
 * are things that can move backwards later, and a direction that can flip is a
 * direction that produces a cycle.
 */

import type { Story } from '@insidor/contracts/story.ts';
import type { Fingerprint } from '@insidor/contracts/vocabulary.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { safeRatio } from '../math.ts';
import { carrierMatches, weightOf, type CarrierCorpus } from './carriers.ts';

/**
 * A proposed fold of one story into another. A PLAN and not the act: this file decides,
 * something in store/ executes, and separating them is what lets the decision be logged
 * and replayed without a database.
 *
 * ★ THE TWO FIELDS ARE NOT INTERCHANGEABLE and the type cannot stop you swapping them,
 * because both are a `Story`. `planMerge` decides the direction by `earliestPostAt` for
 * the reason argued at the top of this file; anything that constructs a `MergePlan` by
 * hand — a test fixture, a repair script — inherits the obligation and gets no compiler
 * help with it. That is the one thing to check when reading a caller of this type.
 */
export interface MergePlan {
  readonly into: Story;
  readonly from: Story;
  readonly carrierOverlap: number;
}

/**
 * ★ THE CARRIERS THAT ARE ALLOWED TO ARGUE FOR A MERGE — the ones that carry weight.
 *
 * A shared carrier is not evidence unless it is worth something, and that rule was
 * being enforced on member joins and skipped entirely here. `planMerge` counted
 * PRESENCE: two stories whose only common carrier was `$SOL` — a symbol
 * `persistence.ts` weights at exactly zero, by name, because one story in the previous
 * build accreted thirty-nine unrelated posts on one — computed an overlap of 1.0,
 * cleared the 0.6 bar, and folded into one story. The generic-carrier rule protected
 * every individual join and then the merge sweep behind it undid them all at once.
 *
 * FILTERING BOTH SIDES BEFORE THE RATIO, not just the numerator, and that is the half
 * that matters against an adversary. Leaving worthless carriers in the DENOMINATOR
 * makes the overlap dilutable: pad a story with a hundred stock hashtags and its
 * one-in-a-hundred-and-one share never clears any bar, so a decoy story cloning a
 * target's image can refuse to be merged away while it keeps every arriving item
 * inside the adjudication band. Weightless carriers are not evidence in either
 * direction, so they are not in either half of the fraction.
 */
function weighed(
  carriers: readonly Fingerprint[],
  p: Policy,
  corpus: CarrierCorpus,
): readonly Fingerprint[] {
  return carriers.filter((c) => weightOf(c, p, corpus) > p.group.minCarrierWeight);
}

/**
 * How many of `xs` have a counterpart in `ys`, under the same per-kind distance bars
 * a member join uses.
 *
 * Counted from the `xs` side rather than from the returned match list because a single
 * carrier can match several on the other side — an item with four near-identical
 * frames against a story holding three of them is one shared image, not twelve — and
 * an overlap built on the raw match count can exceed one, at which point the policy
 * ratio stops meaning what its comment says it means.
 *
 * Both arguments have already been through `weighed`, so a match here is a match on
 * something that means something. Re-testing the weight would be checking it twice.
 */
function sharedWith(
  xs: readonly Fingerprint[],
  ys: readonly Fingerprint[],
  p: Policy,
  corpus: CarrierCorpus,
): number {
  let shared = 0;
  for (const x of xs) {
    if (carrierMatches([x], ys, p, corpus).length > 0) shared += 1;
  }
  return shared;
}

/**
 * TO BUILD: carrier overlap against Policy.group.mergeCarrierOverlap, oldest wins.
 *
 * THE SPELLING OF "OVERLAP", stated once so the number in Policy has a meaning:
 * it is the LARGER of the two one-sided shares — what fraction of A's carriers are
 * present in B, and what fraction of B's are present in A. Policy's own comment says
 * "this share of ONE's carriers is present in the other", and taking the larger is
 * what makes that sentence true for either reading. It also makes the function
 * symmetric, which is what makes it idempotent: `planMerge(a,b)` and `planMerge(b,a)`
 * compute the same number and pick the same survivor.
 *
 * Returns null — never a plan — for every case where a merge would be unsafe rather
 * than merely unwanted, so a caller that ignores the distinction still cannot corrupt
 * the graph.
 */
export function planMerge(
  a: Story,
  b: Story,
  p: Policy,
  /**
   * Persistence statistics for the carriers on both sides. Optional and defaulting to
   * empty for the same reason `carrierMatches` does: an unknown carrier keeps its full
   * weight, so a merge sweep works on the first afternoon. With no corpus the weight
   * filter still catches the by-nature list, which is the case that costs a story.
   */
  corpus: CarrierCorpus = {},
): MergePlan | null {
  // A story cannot be folded into itself. The store spells this as `no_self_merge`;
  // failing here fails before the write instead of after it.
  if (a.storyId === b.storyId) return null;

  // ★ THE ACYCLICITY RULE, and it is this one line rather than a cycle detector.
  // Only two LIVE stories may merge. A story that already points somewhere is not a
  // merge target and not a merge source: following it would create the second edge
  // out of a node that already has one, which is precisely how a cycle appears
  // without anyone choosing one. A caller holding a merged story must resolve it to
  // the survivor first — follow the pointer ONCE — and then ask again.
  if (a.state === 'merged' || b.state === 'merged') return null;
  if (a.mergedInto !== null || b.mergedInto !== null) return null;

  const mine = weighed(a.carriers, p, corpus);
  const theirs = weighed(b.carriers, p, corpus);

  const shareA = safeRatio(sharedWith(mine, theirs, p, corpus), mine.length);
  const shareB = safeRatio(sharedWith(theirs, mine, p, corpus), theirs.length);
  // A story with no carriers WORTH ANYTHING has no basis for comparison, which is null
  // and not zero. Two carrier-less stories would otherwise divide to NaN and compare
  // false to every bar, which is the right answer arrived at by accident — and a story
  // whose only carriers are generic is now in exactly that position, deliberately.
  if (shareA === null || shareB === null) return null;

  const carrierOverlap = Math.max(shareA, shareB);
  if (carrierOverlap < p.group.mergeCarrierOverlap) return null;

  // Oldest wins. The tiebreak on story id is arbitrary and that is fine — what it
  // must be is DETERMINISTIC, because a replay that picks the other survivor produces
  // a different graph from the run it claims to be reproducing.
  const aIsOlder =
    a.earliestPostAt === b.earliestPostAt
      ? a.storyId < b.storyId
      : a.earliestPostAt < b.earliestPostAt;

  return aIsOlder
    ? { into: a, from: b, carrierOverlap }
    : { into: b, from: a, carrierOverlap };
}
