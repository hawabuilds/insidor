/**
 * The wide item feature set — the roughly forty numbers a model gets that the rule
 * does not.
 *
 * WHY THIS IS SEPARATE FROM admit/stage.ts's extract(): the rule's vector is small
 * because a rule can only use what a person can reason about. The model's vector is
 * wide because a tree does not care. Both are frozen at decision time, both are
 * logged, and the `featureSet` on the row says which one produced it — so the two can
 * coexist during the changeover instead of requiring a cutover.
 *
 * THE ONE PROHIBITION: no feature here may be an absolute counter from a source.
 * `reach` is autoplay on one source and impressions on another, and does not exist on
 * a third. Every number is a rate, a ratio to the item's own basis, or a percentile
 * within its own source — which is the mechanism that makes a model fitted on one
 * source still valid when a second arrives.
 */

import type { FeatureVector } from '@insidor/contracts/features.ts';
import type { Item, Observation } from '@insidor/contracts/vocabulary.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

/** TO BUILD: the wide item vector. Every value relative; none of them a raw count. */
export function itemFeatures(
  _item: Item,
  _observations: readonly Observation[],
  _now: Millis,
): FeatureVector {
  return notImplemented('features/item.ts: the wide item feature set');
}
