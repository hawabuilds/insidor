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
import type { StageName } from '@insidor/contracts/decision.ts';

import { fnv1aHex } from '../hash.ts';

import { FEATURE_SET as ADMIT } from '../admit/stage.ts';
import { FEATURE_SET as DETECT } from '../detect/stage.ts';
import { FEATURE_SET as GROUP } from '../group/stage.ts';
import { FEATURE_SET as QUALIFY } from '../qualify/stage.ts';
import { FEATURE_SET as RANK } from '../rank/stage.ts';
import { FEATURE_SET as RESOLVE } from '../resolve/stage.ts';
import { FEATURE_SET as TRACK } from '../track/stage.ts';

/** The set in force per stage. store/ and eval/ read this rather than a string literal. */
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
