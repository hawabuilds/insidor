/**
 * WHICH NARRATIVE THE TOKEN PAGE SHOWS UNDER ITS CHART, AND WHAT ITS SLIM CARD SAYS (the owner,
 * 2026-10-17: "the token page shows the narrative, not the post"). Pure, so `node --test` holds it;
 * the card itself is NarrativeCard.tsx.
 *
 * WHICH NARRATIVE: the one the page was opened from (a narrative's coin bar); else the board
 * narrative whose coin this is, as the read service names it (`storyId` on the coin's About read:
 * its settled coin, else its top coin); else the narrative of the most-viewed feed post naming the
 * coin. None of these: no narrative, and the page shows the old post card at the same slim size.
 *
 * WHAT THE CARD SAYS, facts only: the title, "6 posts   1.3M views   +84K 1h" (a part the narrative
 * did not carry is left out, never zeroed), and on the right "Story coin" when THIS coin is the
 * narrative's settled coin (its posts prove it or the owner marked it right: the projector settles
 * no other) and "Not checked" otherwise, including a top coin nobody has checked.
 *
 * What breaks if changed carelessly: "Story coin" must test this coin's address against the
 * narrative's settled one. A narrative with a settled coin opened from a different coin of the same
 * name would otherwise call that coin its own.
 */

import type { AboutPost, Story } from '../../shared/api/index.ts';
import { compact } from '../../shared/format/number.ts';
import { viralPost } from './viral-post.ts';

/** The narrative to read for this coin, by id, when the page was not opened from one. */
export function narrativeIdFor(about: { readonly storyId: string | null; readonly posts: readonly AboutPost[] } | null): string | null {
  if (about === null) return null;
  if (about.storyId !== null) return about.storyId;
  return viralPost(about.posts)?.post.story?.storyId ?? about.posts.find((p) => p.story !== null)?.story?.storyId ?? null;
}

export interface NarrativeCardFacts {
  readonly title: string;
  readonly posts: string;
  readonly views: string | null;
  /** "+84K 1h", or null when the narrative carried no last-hour gain. */
  readonly gain: string | null;
  readonly coin: 'story' | 'unchecked';
}

const measured = (m: Story['viewsTotal']): number | null => (m !== null && m.known ? m.amount : null);

export function narrativeCardFacts(story: Story, coinAddress: string): NarrativeCardFacts {
  const n = story.postCount ?? story.evidence.length;
  const views = measured(story.viewsTotal) ?? (story.reach.known ? story.reach.amount : null);
  const gain = measured(story.viewsGained1h);
  return {
    title: story.title,
    posts: n === 1 ? '1 post' : `${n} posts`,
    views: views === null ? null : `${compact(views)} views`,
    gain: gain === null ? null : `${gain >= 0 ? '+' : ''}${compact(gain)} 1h`,
    coin: story.coins.kind === 'one' && story.coins.coin.address === coinAddress ? 'story' : 'unchecked',
  };
}
