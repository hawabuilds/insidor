/**
 * Feed posts whose video was stored before the text source's read kept the video's playable file:
 * which need reading again, and the one write the re-read makes to a post — its media.
 *
 * Its own repo, not methods on the item repo, because it is a backfill with an end: posts found
 * since 2026-10-13 17:46 UTC arrive with the file, and once the older ones have left the feeds this
 * queue is empty for good. A method on the item repo would invite other writers to rewrite media.
 *
 * ★ WHICH POSTS: on a feed now (public.rising_row — For You first, then Popular; these are every
 * post the post sheet can open), then the subjects of rising-post alerts since `alertsSince` (the
 * Feed tab), newest first. A role that cannot read people.alert gets the feed half, never an error.
 *
 * What breaks if changed carelessly: `setMedia` replaces the post's whole media list with the
 * re-read's. It must only be called with media read from the source for that same post — a list
 * built by hand would drop pictures the projector and the picture matching read. And it writes only
 * while the stored media still lacks the file, so a second writer cannot be overwritten twice.
 */

import type { MediaRef } from '@insidor/contracts';

import type { Db } from '../client.ts';

/** A post owed a re-read of its video. */
export interface RefillDue {
  readonly itemId: string;
  readonly source: string;
  readonly sourceItemId: string;
}

/** A video stored with no playable file, as SQL over `i` (public.item). */
const NEEDS_VIDEO = `exists (select 1 from jsonb_array_elements(case when jsonb_typeof(i.media) = 'array' then i.media else '[]'::jsonb end) m
                      where m->>'kind' = 'video' and coalesce(m->>'playUri', '') = '')`;

export class PgPostRefillRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Up to `limit` posts on `sources` with a video and no file, in the order the header gives. */
  async due(sources: readonly string[], alertsSince: Date, limit: number): Promise<readonly RefillDue[]> {
    if (limit <= 0 || sources.length === 0) return [];
    const select = (from: string) => `
      select i.item_id, i.source, i.source_item_id, q.rank, q.at
        from (${from}) q
        join public.item i on i.item_id = q.item_id
       where i.source = any($1::text[]) and ${NEEDS_VIDEO}`;
    const feeds = `select item_id, min(case feed_id when 'fyp' then 0 else 1 end) as rank, now() as at from public.rising_row group by item_id`;
    const alerts = `select subject as item_id, 2 as rank, max(at) as at from people.alert where kind = 'rising_post' and at >= $3 group by subject`;
    type Row = { item_id: string; source: string; source_item_id: string };
    let rows: readonly Row[];
    try {
      rows = await this.#db.query<Row>(
        `select * from (select distinct on (item_id) * from (${select(feeds)} union all ${select(alerts)}) u order by item_id, rank) d
          order by rank, at desc limit $2`,
        [[...sources], limit, alertsSince],
      );
    } catch {
      rows = await this.#db.query<Row>(`${select(feeds)} order by q.rank limit $2`, [[...sources], limit]);
    }
    return rows.map((r) => ({ itemId: r.item_id, source: r.source, sourceItemId: r.source_item_id }));
  }

  /** The post's media as the source's re-read gave it (see the header). True when it was written. */
  async setMedia(itemId: string, media: readonly MediaRef[]): Promise<boolean> {
    const rows = await this.#db.query<{ item_id: string }>(
      `update public.item i set media = $2::jsonb where i.item_id = $1 and ${NEEDS_VIDEO} returning i.item_id`,
      [itemId, JSON.stringify(media)],
    );
    return rows.length > 0;
  }
}
