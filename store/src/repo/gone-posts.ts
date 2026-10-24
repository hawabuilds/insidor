/**
 * Posts a re-read stopped returning, and the ones known to be deleted (0131).
 *
 * The runner's record of what the re-reads it already makes said about each post's presence:
 * `leftOut` when an answered re-read left a post out, `returned` when one brought it back, and
 * `markDeleted` once work/gone-posts.ts has the proof that it was the post that went, not its
 * account. The decision itself is not here: this file stores what was read and hands back what the
 * decision needs (`pending`), so the rule is tested in one place without a database.
 *
 * Its own repository because the readings loop and TRACK both write it, and neither owns the other.
 *
 * What breaks if changed carelessly: `returned` must clear `deleted_at` as well as the record — a
 * post the source shows again is not deleted, whatever we concluded before. And `pending`'s account
 * time must only count sightings AFTER the first miss: a sighting before it proves nothing about the
 * account now. Before 0131 every method throws; the caller logs it and carries on.
 */

import type { Db } from '../client.ts';
import { toMillis, toMillisRequired, type TimestampColumn } from '../rows.ts';

/** A post left out at least once and not yet known to be deleted, with what the decision reads. */
export interface UnreturnedPost {
  readonly itemId: string;
  /** The first answered re-read that left it out since it was last read. */
  readonly firstAt: number;
  readonly lastAt: number;
  readonly misses: number;
  /**
   * The newest time after `firstAt` that the same account was seen publicly: another of its posts
   * read (public.observation), or the account itself returned by a search or lookup
   * (public.author `last_seen_at`). Null when it has not been seen since.
   */
  readonly accountSeenAt: number | null;
}

interface PendingRow {
  item_id: string;
  first_at: TimestampColumn;
  last_at: TimestampColumn;
  misses: number;
  account_seen_at: TimestampColumn;
}

export class PgGonePostRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** An answered re-read at `at` left these posts out: a first miss, or one more. */
  async leftOut(itemIds: readonly string[], at: Date): Promise<void> {
    if (itemIds.length === 0) return;
    await this.#db.query(
      `insert into internal.post_unreturned (item_id, first_at, last_at, misses)
       select u.item_id, $2, $2, 1 from unnest($1::text[]) as u(item_id)
        where exists (select 1 from public.item i where i.item_id = u.item_id)
       on conflict (item_id) do update
         set last_at = greatest(internal.post_unreturned.last_at, excluded.last_at),
             misses = internal.post_unreturned.misses + 1`,
      [[...new Set(itemIds)], at],
    );
  }

  /** A re-read returned these posts: whatever was recorded about their absence no longer holds. */
  async returned(itemIds: readonly string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const ids = [...new Set(itemIds)];
    await this.#db.query(`delete from internal.post_unreturned where item_id = any($1::text[])`, [ids]);
    await this.#db.query(`update public.item set deleted_at = null where item_id = any($1::text[]) and deleted_at is not null`, [ids]);
  }

  /** Posts left out and not yet known deleted, newest miss first, at most `limit`. */
  async pending(limit: number): Promise<readonly UnreturnedPost[]> {
    const rows = await this.#db.query<PendingRow>(
      `select u.item_id, u.first_at, u.last_at, u.misses,
              greatest(
                case when a.last_seen_at > u.first_at then a.last_seen_at end,
                (select max(o.captured_at)
                   from public.item j
                   join public.observation o on o.item_id = j.item_id and o.captured_at > u.first_at
                  where j.author_key = i.author_key and j.item_id <> i.item_id)
              ) as account_seen_at
         from internal.post_unreturned u
         join public.item i on i.item_id = u.item_id
         left join public.author a on a.author_key = i.author_key
        where i.deleted_at is null
        order by u.last_at desc
        limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      firstAt: toMillisRequired(r.first_at, 'first_at'),
      lastAt: toMillisRequired(r.last_at, 'last_at'),
      misses: Number(r.misses),
      accountSeenAt: toMillis(r.account_seen_at),
    }));
  }

  /** These posts are deleted, each as of the time given. Only an unset one is written. */
  async markDeleted(posts: readonly { readonly itemId: string; readonly at: number }[]): Promise<number> {
    if (posts.length === 0) return 0;
    const rows = await this.#db.query<{ item_id: string }>(
      `update public.item i set deleted_at = to_timestamp(d.at_ms / 1000.0)
         from unnest($1::text[], $2::float8[]) as d(item_id, at_ms)
        where i.item_id = d.item_id and i.deleted_at is null
        returning i.item_id`,
      [posts.map((p) => p.itemId), posts.map((p) => p.at)],
    );
    return rows.length;
  }
}
