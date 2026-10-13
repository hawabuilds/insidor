/**
 * The board's narratives held to the same per-post rules as For You: a promoted narrative stays
 * on the board only while `rising.narrativeMinPassingPosts` of its posts pass (scored, memeable,
 * confident, a short name), and lists only those posts.
 *
 * Its own file because it decides what the board may show from the judge's per-post answers,
 * which the board's own projection (project.ts) never reads: the story's promotion is the
 * runner's verdict on the group, this is the owner's rule about what is put in front of people.
 * Hiding happens HERE, at projection, and not by changing the story's state — the runner owns
 * that lifecycle, and a story it re-promoted would otherwise reappear unchecked.
 *
 * ★ THE OWNER'S CALL WINS (owner-calls.ts). A post the owner hid is dropped from every list here
 * with `owner_not_meme`, and a narrative left with too few posts leaves the board; a post the owner
 * called a meme passes, judged or not.
 *
 * What breaks if changed carelessly: a post with no score is NOT passing. Counting it would let
 * a narrative built during a judge outage onto the board on posts nobody looked at. The one
 * exception is the owner's own "Is a meme", which is a look by the person whose rules these are.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { postScoreReason, type PostScoreReason } from '@insidor/core';
import type { Db, FeedRejection } from '@insidor/store';

import { loadOwnerPostCalls, withOwnerCall, type PostStanding } from './owner-calls.ts';
import type { StoryFacts } from './project.ts';

/**
 * Each post's latest per-post answer, held to `postScoreReason`, with the owner's call over it.
 * A post never scored and never called by the owner is absent.
 */
export async function loadPostReasons(db: Db, itemIds: readonly string[], policy: Policy): Promise<ReadonlyMap<string, PostStanding>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db.query<{ item_id: string; coinable: boolean; confidence: number; looked_at: 'text' | 'picture' | 'videoFrame'; proposed_name: string | null }>(
    `select distinct on (item_id) item_id, coinable, confidence, looked_at, proposed_name
       from internal.post_judgement
      where item_id = any($1::text[])
      order by item_id, judged_at desc, id desc`,
    [[...itemIds]],
  );
  const judged = new Map<string, PostScoreReason>(rows.map((r) => [r.item_id, postScoreReason({ coinable: r.coinable, confidence: r.confidence, lookedAt: r.looked_at, proposedName: r.proposed_name }, policy)]));
  const calls = await loadOwnerPostCalls(db, itemIds);
  const out = new Map<string, PostStanding>();
  for (const id of new Set([...judged.keys(), ...calls.keys()])) {
    const standing = withOwnerCall(judged.get(id), calls.get(id));
    if (standing !== undefined) out.set(id, standing);
  }
  return out;
}

export interface NarrativeCheck {
  readonly kept: readonly StoryFacts[];
  readonly rejections: readonly FeedRejection[];
}

/** Pure: which narratives stay, with which posts, and a reason for everything left out. */
export function checkNarratives(stories: readonly StoryFacts[], reasons: ReadonlyMap<string, PostStanding>, policy: Policy): NarrativeCheck {
  const kept: StoryFacts[] = [];
  const rejections: FeedRejection[] = [];
  for (const story of stories) {
    const why = (itemId: string): PostStanding => reasons.get(itemId) ?? 'not_scored';
    const passing = story.members.filter((m) => why(m.itemId) === 'passes');
    const failing = story.members.filter((m) => why(m.itemId) !== 'passes');
    if (passing.length < policy.rising.narrativeMinPassingPosts) {
      rejections.push({ kind: 'narrative', id: story.storyId, reason: 'too_few_passing_posts', detail: `${passing.length} of ${story.members.length} posts pass` });
      continue;
    }
    for (const m of failing) {
      const reason = why(m.itemId);
      if (reason !== 'passes') rejections.push({ kind: 'post', id: m.itemId, reason, detail: `dropped from ${story.storyId}` });
    }
    kept.push(failing.length === 0 ? story : { ...story, members: passing });
  }
  return { kept, rejections };
}
