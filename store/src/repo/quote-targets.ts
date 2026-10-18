/**
 * The posts whose quotes the quote search may ask for (Policy.feed.reproductions): held posts on one
 * source, by an account with at least so many followers, posted inside an age window, with their
 * newest like count and when it was read — most liked first. Whether a count is past the floor, or
 * old enough to be read again first, is the caller's call (work/quote-search.ts).
 *
 * Its own repository because it is the one read that lane makes, and it joins three tables (post,
 * account, readings) the items repository has no other reason to join. Read-only.
 *
 * ★ THE ACCOUNT'S FOLLOWERS ARE THE STORED FIGURE (public.author.follower_count), as of its last
 * read: an account just past the bar is asked from its next read, never guessed. A post with no time
 * is never in an age window, so it is not here. The likes are the newest reading
 * (public.observation, kind 'approval'), the same reading the feed shows; a post never read has
 * none and is not here.
 *
 * What breaks if changed carelessly: dropping `origin = 'observed'` lets a seeded fiction be asked
 * about on a paid line; dropping the repost filter asks the same quotes twice under two ids.
 */

import type { Db } from '../client.ts';

export interface QuoteTarget {
  readonly itemId: string;
  /** The source's own id of the post, which the quote search names. */
  readonly sourceItemId: string;
  readonly postedAtMs: number;
  readonly approvals: number;
  /** When `approvals` was read. */
  readonly readAtMs: number;
  readonly followers: number;
}

export class PgQuoteTargetRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async due(args: {
    readonly source: string;
    readonly minFollowers: number;
    readonly postedAfterMs: number;
    readonly postedBeforeMs: number;
    readonly limit: number;
  }): Promise<readonly QuoteTarget[]> {
    if (args.limit <= 0) return [];
    const rows = await this.#db.query<{ item_id: string; source_item_id: string; posted_at: Date | string; approvals: string | number; read_at: Date | string; followers: string | number }>(
      `select i.item_id, i.source_item_id, i.posted_at, l.value as approvals, l.captured_at as read_at, a.follower_count as followers
         from public.item i
         join public.author a on a.author_key = i.author_key
         join lateral (select o.value, o.captured_at from public.observation o
                        where o.item_id = i.item_id and o.kind = 'approval'
                        order by o.captured_at desc limit 1) l on true
        where i.source = $1
          and i.origin = 'observed'
          and i.rebroadcast_of is null
          and i.posted_at >= $3 and i.posted_at < $4
          and a.follower_count >= $2
        order by l.value desc, i.item_id
        limit $5`,
      [args.source, args.minFollowers, new Date(args.postedAfterMs), new Date(args.postedBeforeMs), args.limit],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      sourceItemId: r.source_item_id,
      postedAtMs: r.posted_at instanceof Date ? r.posted_at.getTime() : Date.parse(r.posted_at),
      approvals: Number(r.approvals),
      readAtMs: r.read_at instanceof Date ? r.read_at.getTime() : Date.parse(r.read_at),
      followers: Number(r.followers),
    }));
  }
}
