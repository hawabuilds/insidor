/**
 * When a candidate becomes a story anything downstream is allowed to look at.
 *
 * The bar is breadth, not volume: distinct authors and distinct sources, never member
 * count alone. In the build this replaces, ninety-one percent of populated stories
 * contained exactly one post by one author — the product's premise is that people are
 * making their own versions, and the grouper could not see a second version. A
 * promotion rule that counts members would have called every one of those a story.
 *
 * Promotion is also what makes the judge affordable: QUALIFY runs after this, so the
 * expensive call happens once per surviving story instead of once per member.
 */

import type { Story } from '@insidor/contracts/story.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { notImplemented } from '../not-implemented.ts';

/** TO BUILD: the promotion test against Policy.group.promoteMin*, and nothing else. */
export function shouldPromote(_story: Story, _p: Policy): boolean {
  return notImplemented('group/promote.ts: the promotion bar, on breadth not volume');
}
