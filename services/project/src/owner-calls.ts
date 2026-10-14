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
 * ★ AND THE OWNER'S COIN CALL NAMES A POST'S COIN (`loadOwnerCoins`). A current coin call `right`
 * with an address — "This is the coin", tapped on a card or pasted in "Which coin?" — makes that
 * coin the post's own for everyone: rising.ts shows it as proven ("Links this post", Buy when it
 * can be traded), over the evidence and over a narrative's link, marked `ownerChecked` on the wire.
 * The owner's pick after "Wrong coin" (`wrong` WITH a coin) is "This is the coin" too, unless it
 * takes back a coin an earlier `right` named (core match/owner-coin-calls.ts, the KARL retraction).
 * A newest `cleared` (0072, "Remove my label"), bare `wrong` or `none` is no owner coin, and the
 * evidence decides again. A coin we do not hold yet is not shown until the runner adds it
 * (services/runner work/owner-coins.ts); the card never offers Buy on a coin it cannot draw.
 *
 * What breaks if changed carelessly: the order. The NEWEST row is the call — the table is
 * append-only and changing your mind is a new row. Reading the oldest would make "Is a meme"
 * powerless against an earlier "Not a meme".
 */

import { addressOfCoinId, foldCoinCalls, type PostCoinCalls, type PostScoreReason } from '@insidor/core';
import { PgOwnerCoinCallRepo, type Db } from '@insidor/store';

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

/**
 * Every post's coin calls folded in order (core `foldCoinCalls`): its own coin, the coins it must
 * never show, and "No coin is from this". All posts when `itemIds` is null — the story coins read
 * every confirmation, not only the feed's.
 */
export async function loadCoinCalls(db: Db, itemIds: readonly string[] | null): Promise<ReadonlyMap<string, PostCoinCalls>> {
  const rows = await new PgOwnerCoinCallRepo(db).rows(itemIds);
  return foldCoinCalls(rows.map((r) => ({ itemId: r.itemId, verdict: r.verdict, coinAddress: r.coinAddress, shownCoin: addressOfCoinId(r.shownCoinId), atMs: r.atMs, id: r.id })));
}

/** The coin the owner's calls name as each post's own (the pick after "Wrong coin" included); a post with none is absent. */
export async function loadOwnerCoins(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (itemIds.length === 0) return new Map();
  return ownCoins(await loadCoinCalls(db, itemIds));
}

/** Pure: each post's own coin from its folded calls. */
export function ownCoins(calls: ReadonlyMap<string, PostCoinCalls>): ReadonlyMap<string, string> {
  return new Map([...calls].flatMap(([id, c]) => (c.own === null ? [] : [[id, c.own.address] as const])));
}
