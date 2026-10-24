/**
 * The posts the readings loop may read again (Policy.feed.readings): every post on For You, and
 * every post on a feed whose sheet was opened recently (internal.reading_ask, 0090) — each with
 * the time of its newest reading, so the loop can tell which are due without a series per post.
 *
 * Its own repository because the loop that uses it is a cadence over what is on screen, not
 * TRACK's question of what is worth tracking: `PgItemRepo.trackable` reads a day of candidates
 * and their judgements, which is far too much to ask twice a minute for sixty posts.
 *
 * ★ AN OPENED POST MUST STILL BE ON A FEED. The social service checks that at insert, and this
 * checks it again, because a post can leave every feed between the open and the read: a post no
 * feed holds is a read nobody will see.
 *
 * What breaks if changed carelessly: `answered` deletes only rows asked at or before the read's
 * time. Deleting by item alone would drop an open that arrived while the read was out, and that
 * person would wait for the next cadence step instead.
 */

import { COUNTER_KINDS } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillis, type TimestampColumn } from '../rows.ts';

/** A post the readings loop may read, with what it needs to decide and to ask. */
export interface ReadingCandidate {
  readonly itemId: string;
  readonly source: string;
  readonly sourceItemId: string;
  /** The author's handle, which a source that addresses a post by link needs; null when unknown. */
  readonly handle: string | null;
  /** When the post was made; null when the source did not say. */
  readonly postedAt: number | null;
  /** The newest reading of any counter; null when it was never read. */
  readonly lastReadAt: number | null;
  /** On For You now. */
  readonly onForYou: boolean;
  /** When its sheet was last opened, inside the window asked for; null when it was not. */
  readonly openedAt: number | null;
}

interface CandidateRow {
  item_id: string;
  source: string;
  source_item_id: string;
  handle: string | null;
  posted_at: TimestampColumn | null;
  last_read_at: TimestampColumn | null;
  on_for_you: boolean;
  opened_at: TimestampColumn | null;
}

const at = (v: TimestampColumn | null): number | null => toMillis(v);

export class PgReadingsRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * For You's posts and the posts opened since `openedSince` that a feed still holds. Before 0090
   * the open half throws; the caller then reads For You alone (`forYouOnly`). `extra` adds posts
   * the caller wants considered too (the sorts' top posts, work/sort-top.ts), each still required to
   * be on For You's scroll (public.feed_post), so an id the caller got wrong reads nothing.
   */
  async candidates(openedSince: Date, forYouOnly = false, extra: readonly string[] = []): Promise<readonly ReadingCandidate[]> {
    const asked = forYouOnly
      ? `select null::text as item_id, null::timestamptz as asked_at where false`
      : `select k.item_id, k.asked_at from internal.reading_ask k
          where k.asked_at >= $2
            and (exists (select 1 from public.rising_row r where r.item_id = k.item_id)
                 or exists (select 1 from public.feed_post f where f.item_id = k.item_id))`;
    const rows = await this.#db.query<CandidateRow>(
      `with fyp as (select distinct item_id from public.rising_row where feed_id = 'fyp'),
            asked as (${asked}),
            extra as (select f.item_id from public.feed_post f
                       where f.feed_id = 'fyp' and f.withdrawn_at is null and f.item_id = any($${forYouOnly ? 2 : 3}::text[])),
            pool as (select item_id from fyp union select item_id from asked union select item_id from extra)
       select i.item_id, i.source, i.source_item_id, a.handle, i.posted_at,
              /* A read the source answered without the post (0131's post_unreturned) counts as a read:
                 a deleted post never gains a reading, so without this it was the stalest post on every
                 30-second pass, asked about 2,900 times a day (~$0.43 a day each). It now waits its step. */
              greatest((select max((select o.captured_at from public.observation o
                                     where o.item_id = i.item_id and o.kind = k.kind
                                     order by o.captured_at desc limit 1))
                          from unnest($1::text[]) as k(kind)),
                       (select u.last_at from internal.post_unreturned u where u.item_id = i.item_id)) as last_read_at,
              exists (select 1 from fyp where fyp.item_id = i.item_id) as on_for_you,
              (select k.asked_at from asked k where k.item_id = i.item_id) as opened_at
         from pool p
         join public.item i on i.item_id = p.item_id
         left join public.author a on a.author_key = i.author_key`,
      forYouOnly ? [[...COUNTER_KINDS], [...extra]] : [[...COUNTER_KINDS], openedSince, [...extra]],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      source: r.source,
      sourceItemId: r.source_item_id,
      handle: r.handle,
      postedAt: at(r.posted_at),
      lastReadAt: at(r.last_read_at),
      onForYou: r.on_for_you,
      openedAt: at(r.opened_at),
    }));
  }

  /** For You's scroll, every member not withdrawn, with its source and posting time: what the sorts rank. */
  async forYouMembers(): Promise<readonly { readonly itemId: string; readonly source: string; readonly postedAt: number | null; readonly firstSeenAt: number | null; readonly views: number | null; readonly readAtMs: number | null }[]> {
    /* The card's own total and its time, as the read service's Most viewed orders by (post-sorts.ts). */
    const rows = await this.#db.query<{ item_id: string; source: string; posted_at: TimestampColumn | null; first_seen_at: TimestampColumn | null; views: string | null; read_ms: string | null }>(
      `select f.item_id, i.source, i.posted_at, i.first_seen_at, f.payload #>> '{reach,v}' as views, f.payload #>> '{readAt,at}' as read_ms
         from public.feed_post f join public.item i on i.item_id = f.item_id
        where f.feed_id = 'fyp' and f.withdrawn_at is null`,
    );
    const num = (v: string | null): number | null => (v === null || !Number.isFinite(Number(v)) ? null : Number(v));
    return rows.map((r) => ({ itemId: r.item_id, source: r.source, postedAt: at(r.posted_at), firstSeenAt: at(r.first_seen_at), views: num(r.views), readAtMs: num(r.read_ms) }));
  }

  /** Clears the opens these reads answered: rows asked at or before `readAt`, and only those. */
  async answered(itemIds: readonly string[], readAt: Date): Promise<number> {
    if (itemIds.length === 0) return 0;
    const rows = await this.#db.query<{ item_id: string }>(
      `delete from internal.reading_ask where item_id = any($1::text[]) and asked_at <= $2 returning item_id`,
      [[...itemIds], readAt],
    );
    return rows.length;
  }

  /** Drops opens nobody answered in time: the sheet is closed, and the row would only grow the table. */
  async expire(before: Date): Promise<number> {
    const rows = await this.#db.query<{ item_id: string }>(`delete from internal.reading_ask where asked_at < $1 returning item_id`, [before]);
    return rows.length;
  }
}
