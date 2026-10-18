/**
 * One source's finds per language, in time buckets, from what its search lanes stored: the
 * language-drop alarm's one reading (core notify/language-drop.ts), and the 20:00 table's.
 *
 * Its own repository because the alarm in the runner, its backtest and the 20:00 report
 * (tools/name-report.ts) must count the same thing, or the backtest proves a rule nobody runs. A
 * post is counted once, in the bucket of the FIRST of the given lanes to find it: a post the
 * catch-all and the slow lane both found is one find, not two, and a re-find by a later lane does
 * not move it. A post with no language (the short-video source's "undetermined") is no language
 * and is not counted.
 *
 * What breaks if changed carelessly: counting `item_found_by` rows instead of posts lets a lane
 * added later look like a language rising; bucketing by the post's own time instead of the find
 * would measure what people posted, not what we found, and a supplier change would not show.
 */

import type { Db } from '../client.ts';

export interface LanguageBucket {
  readonly lang: string;
  /** The bucket's start, a multiple of the bucket width since the epoch. */
  readonly atMs: number;
  readonly finds: number;
}

export class PgLanguageFindsRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Finds of `source` by `lanes` in [fromMs, toMs), per language and bucket of `bucketMs`. */
  async buckets(source: string, lanes: readonly string[], fromMs: number, toMs: number, bucketMs: number): Promise<readonly LanguageBucket[]> {
    if (lanes.length === 0) return [];
    const rows = await this.#db.query<{ lang: string; b: string; finds: string }>(
      `with first as (
         select f.item_id, min(f.found_at) as at
           from internal.item_found_by f
          where f.lane = any($2::text[])
            and f.item_id in (select item_id from internal.item_found_by where lane = any($2::text[]) and found_at >= $3 and found_at < $4)
          group by f.item_id
         having min(f.found_at) >= $3 and min(f.found_at) < $4
       )
       select i.lang, floor(extract(epoch from first.at) * 1000 / $5)::bigint as b, count(*) as finds
         from first join public.item i on i.item_id = first.item_id
        where i.source = $1 and i.lang is not null
        group by 1, 2`,
      [source, [...lanes], new Date(fromMs), new Date(toMs), bucketMs],
    );
    return rows.map((r) => ({ lang: r.lang, atMs: Number(r.b) * bucketMs, finds: Number(r.finds) }));
  }
}
