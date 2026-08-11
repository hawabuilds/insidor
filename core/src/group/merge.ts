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
 */

import type { Story } from '@insidor/contracts/story.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { notImplemented } from '../not-implemented.ts';

export interface MergePlan {
  readonly into: Story;
  readonly from: Story;
  readonly carrierOverlap: number;
}

/** TO BUILD: carrier overlap against Policy.group.mergeCarrierOverlap, oldest wins. */
export function planMerge(_a: Story, _b: Story, _p: Policy): MergePlan | null {
  return notImplemented('group/merge.ts: the merge rule, always into the older story');
}
