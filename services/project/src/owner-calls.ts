/**
 * THE OWNER'S CALL ON A POST WINS OVER THE JUDGE'S — at projection, before anything is shown.
 *
 * The owner taps "Not a meme" or "Is a meme" in the phone app (services/social writes
 * internal.owner_feedback, 0054). The projector reads the newest post call per item and applies it
 * to every list it writes: For You and Popular (rising.ts) and each narrative's posts
 * (narrative-rules.ts). Search and the story pages read those lists, so a hidden post is hidden
 * there too without a rule of their own.
 *
 *   'not'  → the post fails with `owner_not_meme`, whatever the judge said, and is recorded as
 *            such in public.feed_rejection — the owner's no kept apart from the judge's.
 *   'meme' → the post PASSES the per-post rule, whatever the judge said, including a post the
 *            judge has not answered yet. It still has to clear each feed's reach bar: the owner
 *            says what a post is, not how many people saw it, and For You stays a list of posts
 *            that are moving. On a narrative's list there is no reach bar, so it is listed.
 *
 * Its own file because two projections apply the same rule and a third reader (the re-tune) reads
 * the same table: one SQL statement and one pure function, so the feeds and the narratives can
 * never disagree about whether the owner hid a post.
 *
 * What breaks if changed carelessly: the order. The NEWEST row is the call — the table is
 * append-only and changing your mind is a new row. Reading the oldest would make "Is a meme"
 * powerless against an earlier "Not a meme".
 */

import type { PostScoreReason } from '@insidor/core';
import type { Db } from '@insidor/store';

export type OwnerPostCall = 'meme' | 'not';

/** A post's standing after the owner's call: the judge's reason, or the owner's no. */
export type PostStanding = PostScoreReason | 'owner_not_meme';

/** The newest post call for each of these items; an item the owner never called is absent. */
export async function loadOwnerPostCalls(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, OwnerPostCall>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db.query<{ item_id: string; verdict: string }>(
    `select distinct on (item_id) item_id, verdict
       from internal.owner_feedback
      where subject_kind = 'post' and item_id = any($1::text[])
      order by item_id, created_at desc, id desc`,
    [[...itemIds]],
  );
  return new Map(rows.flatMap((r) => (r.verdict === 'meme' || r.verdict === 'not' ? [[r.item_id, r.verdict] as const] : [])));
}

/** Pure: the owner's call over the judge's reason. No call leaves the judge's reason untouched. */
export function withOwnerCall(judge: PostScoreReason | undefined, call: OwnerPostCall | undefined): PostStanding | undefined {
  if (call === 'not') return 'owner_not_meme';
  if (call === 'meme') return 'passes';
  return judge;
}
