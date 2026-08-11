/**
 * The wide story feature set.
 *
 * The features that matter here are all shapes of BREADTH over time — how many
 * distinct authors, from how many distinct sources, arriving how fast, joined by how
 * much free evidence. Not volume: one account posting forty times is one person, and
 * a feature that counts it as forty is measuring persistence and calling it spread.
 *
 * The trap to avoid, and it is subtle: a story's features must be computable as of an
 * arbitrary past instant, because that is what a replay does. Anything derived from
 * "the story as it stands now" is lookahead wearing a convenience costume.
 */

import type { FeatureVector } from '@insidor/contracts/features.ts';
import type { Story, StoryMember } from '@insidor/contracts/story.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

/** TO BUILD: the wide story vector, computed strictly from members at or before asOf. */
export function storyFeatures(
  _story: Story,
  _members: readonly StoryMember[],
  _asOf: Millis,
): FeatureVector {
  return notImplemented('features/story.ts: the wide story feature set');
}
