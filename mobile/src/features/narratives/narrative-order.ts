/**
 * The Narratives list's two orders, both by a published fact and nothing else.
 *
 *   New      newest first, by when the narrative began.
 *   Popular  most viewed first.
 *
 * And the stage's word for a row (Early, Forming, Big), which the server names from the posts
 * listed and the top post's views; this file only spells it.
 *
 * ★ AN UNKNOWN NEVER SORTS AS ZERO OR AS "BRAND NEW". A narrative whose start nobody read, or
 * whose views were not reported, goes after every one that has the fact, in the order it came,
 * so a missing number cannot promote a row to the top or bury it as the least seen.
 */

import type { Story } from '../../shared/api/index.ts';

export type NarrativeOrder = 'new' | 'popular';

export function orderNarratives(list: readonly Story[], order: NarrativeOrder): readonly Story[] {
  const key = (s: Story): number | null =>
    order === 'new'
      ? s.firstSeenAt.known ? s.firstSeenAt.at : null
      : s.reach.known ? s.reach.amount : null;
  const withKey = list.filter((s) => key(s) !== null);
  const without = list.filter((s) => key(s) === null);
  return [...withKey].sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0)).concat(without);
}

/** The stage's word on the row. Null when the server named none: no label, never a guess. */
export function stageLabel(s: Story): string | null {
  if (s.stage === 'early') return 'Early';
  if (s.stage === 'forming') return 'Forming';
  if (s.stage === 'big') return 'Big';
  return null;
}

/** "9 posts on X, TikTok". A count of the posts we list, and the sites they are on. */
export function postsLine(s: Story): string {
  const n = s.evidence.length;
  const sites = [...new Set(s.evidence.map((e) => e.sourceLabel))].join(', ');
  if (n === 0) return 'No posts listed';
  return `${n === 1 ? '1 post' : `${n} posts`} on ${sites}`;
}
