/**
 * ★ ONE BUILDER SET. Serving and training call THIS.
 *
 * The classic reason a machine-learning system must be one language is train/serve
 * skew: the trainer recomputes a feature slightly differently from the server and the
 * model quietly degrades. Here the trainer CANNOT recompute a feature — it reads the
 * frozen vector this package wrote at the moment of the decision. The boundary is
 * data, not code, which is what makes the offline half safe in another language.
 *
 * That guarantee only holds if there is exactly one place a feature is computed. This
 * file is the index of those places, so "where does this number come from" is a
 * lookup rather than a search.
 *
 * A FEATURE SET IS VERSIONED AND THE VERSION IS PART OF THE TYPE. A set that changes
 * shape without changing name silently poisons every training row that shares its
 * label window — the rows look comparable and are not.
 */

import type { FeatureSetId } from '@insidor/contracts/features.ts';
import type { StageName, SubjectKind } from '@insidor/contracts/decision.ts';

import { fnv1aHex } from '../hash.ts';

import { FEATURE_SET as ITEM_WIDE } from './item.ts';
import { FEATURE_SET as STORY_WIDE } from './story.ts';
import { FEATURE_SET as CANDIDATE_WIDE } from './candidate.ts';

import { FEATURE_SET as ADMIT } from '../admit/stage.ts';
import { FEATURE_SET as DETECT } from '../detect/stage.ts';
import { FEATURE_SET as GROUP } from '../group/stage.ts';
import { FEATURE_SET as QUALIFY } from '../qualify/stage.ts';
import { FEATURE_SET as RANK } from '../rank/stage.ts';
import { FEATURE_SET as RESOLVE } from '../resolve/stage.ts';
import { FEATURE_SET as TRACK } from '../track/stage.ts';

/**
 * The NARROW set in force per stage — the small vector a rule reads, one per stage.
 * store/ and eval/ read this rather than a string literal.
 */
export const FEATURE_SETS: Readonly<Record<StageName, FeatureSetId>> = {
  admit: ADMIT,
  track: TRACK,
  detect: DETECT,
  group: GROUP,
  qualify: QUALIFY,
  resolve: RESOLVE,
  rank: RANK,
};

/**
 * The WIDE sets — the roughly forty numbers a model gets that the rule does not.
 *
 * ★ WHY THIS IS A SECOND MAP AND NOT A WIDENING OF THE FIRST. A wide set does not
 * belong to a stage, it belongs to a SUBJECT. The item vector is logged by ADMIT
 * today and by whatever ranks items tomorrow; the candidate vector is logged by
 * RESOLVE and would be logged unchanged by a resolver that came after it. Keying the
 * wide sets by stage would mean copying the same set id under three stage names and
 * then discovering, months later, that two of the copies had drifted.
 *
 * It also forecloses the specific poisoning this file's header warns about. A wide
 * vector logged under `item.admit.v1` is a set that changed shape without changing
 * name, which makes every training row inside the same label window look comparable
 * to rows it is not comparable to. The wide vectors have their own names, so the two
 * shapes can be told apart by the `feature_set` column alone.
 *
 * There is no `pair` entry, and the absence is deliberate rather than pending: GROUP's
 * `pair.group.v2` already IS the wide set for a pair — it records all seven match
 * channels plus the shape of the block — so a second one would be a copy.
 */
export const WIDE_FEATURE_SETS: Readonly<
  Record<Extract<SubjectKind, 'item' | 'story' | 'candidate'>, FeatureSetId>
> = {
  item: ITEM_WIDE,
  story: STORY_WIDE,
  candidate: CANDIDATE_WIDE,
};

/**
 * Every set this package can produce. The one list anything validating a stored
 * `feature_set` string should check against — a row carrying a name that is not in
 * here was written by code that is no longer in this repository, which is worth
 * knowing before it is trained on rather than after.
 */
export const ALL_FEATURE_SETS: readonly FeatureSetId[] = [
  ...Object.values(FEATURE_SETS),
  ...Object.values(WIDE_FEATURE_SETS),
];

/**
 * The stable identity of a feature set's SHAPE, not its values: a hash of the sorted
 * key list, recorded on every decision row.
 *
 * WHY it is worth a column: two rows carrying the same `featureSet` string but
 * different key sets are the single most expensive silent bug in a training pipeline,
 * because nothing about them looks wrong until the model is worse and nobody knows
 * when it started. Comparing this hash makes it a load-time error instead.
 */
export function featureShapeHash(keys: readonly string[]): string {
  // A separator that cannot occur in a feature name, so ['ab','c'] and ['a','bc']
  // cannot collide. Concatenating without one is the oldest hashing mistake there is.
  return fnv1aHex([...keys].sort().join(UNIT_SEPARATOR));
}

const UNIT_SEPARATOR = '\u001f';
