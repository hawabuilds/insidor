/**
 * GROUP — which story is this item part of?
 *
 * The highest-leverage stage in the system and the worst one in the build this
 * replaces, where the similarity function was a term-frequency map with no term
 * weighting and no learned representation. The result: ninety-one percent of
 * populated stories held exactly one post by one author. A product whose premise is
 * that people make their own versions of things could not see a second version.
 *
 * The design is two tiers and the free one does most of the work — see carriers.ts.
 * The subject of this stage's decision is a PAIR, which is why Decision.subjectKind
 * has a 'pair' member: the thing being judged is (item, story), and logging it that
 * way is what makes the match model trainable on hand-labelled pairs later.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Item } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

export const NAME = 'group' as const;
export const FEATURE_SET: FeatureSetId = 'pair.group.v1';
export const DECIDER = 'rule:group@1';

export interface GroupInput {
  readonly item: Item;
  /** The candidate block: open stories sharing at least one carrier or time bucket. */
  readonly candidates: readonly Story[];
  /**
   * Representation similarity per (story, space), supplied by the embed port. Absent
   * entries mean the paid tier was skipped or unavailable, which must DEGRADE the
   * match rather than block it.
   */
  readonly similarity: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly costUsd: number;
}

/**
 * TO BUILD: score the item against each candidate, take the best, and either join
 * (M0/M1/M2), send to adjudication (M4), or seed a new candidate story (M6).
 */
export function group(_input: GroupInput, _p: Policy, _ctx: StageContext): Decision {
  return notImplemented('group/stage.ts: the join decision');
}

export function extract(_input: GroupInput, _ctx: StageContext): FeatureVector {
  return notImplemented('group/stage.ts: the pair feature vector');
}
