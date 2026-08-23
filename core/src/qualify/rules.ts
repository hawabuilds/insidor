/**
 * Deterministic facts about a story's membership, computed from our own join rows.
 *
 * WHY breadth and not volume: the product's claim is "people are making their own
 * versions of this". One account posting forty times is one person, and a story that
 * counts it as forty reproducers is measuring persistence, not spread. Every rule in
 * this file counts DISTINCT somethings for that reason.
 *
 * These run after the judge and cannot be argued with by it, because their inputs
 * are ours.
 */

import type { StoryMember } from '@insidor/contracts/story.ts';

/**
 * How many different people made a version of this. The single most load-bearing number
 * in the product's claim, which is why it counts DISTINCT `authorKey` and not members.
 *
 * `authorKey` is source-qualified and built from a stable account id, never a handle —
 * so a renamed account stays one author here rather than splitting into two and
 * inflating the count that every breadth gate downstream is expressed in.
 */
export function distinctAuthors(members: readonly StoryMember[]): number {
  const seen = new Set<string>();
  for (const m of members) seen.add(m.authorKey);
  return seen.size;
}

/**
 * Cross-source breadth is the strongest cheap evidence a story is real: a coordinated
 * push is usually one source, and a moment people are actually copying is not.
 */
export function distinctSources(members: readonly StoryMember[]): number {
  const seen = new Set<string>();
  for (const m of members) seen.add(m.source);
  return seen.size;
}

/**
 * The share of joins that cost nothing — an exact carrier or an explicit lineage
 * pointer, as opposed to a paid representation lookup.
 *
 * Kept as a feature rather than a diagnostic because it answers the question that
 * decides whether the paid tier is worth its bill, and because a story assembled
 * entirely from similarity scores is a weaker claim than one assembled from
 * identical images, whatever the two scores say.
 */
export function freeJoinShare(members: readonly StoryMember[]): number | null {
  if (members.length === 0) return null;
  let free = 0;
  for (const m of members) {
    const kind = m.evidence.kind;
    if (kind === 'carrier' || kind === 'lineage' || kind === 'seed') free++;
  }
  return free / members.length;
}
