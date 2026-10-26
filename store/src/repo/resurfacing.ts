/**
 * The shares a huge account made of older posts (0139, Policy.judge.resurface): which ones the runner
 * has asked about with the share in view, and the ones the projector counts For You's age from.
 *
 * Its own repository because its table is read by exactly two things — the runner's queue
 * (PgItemRepo `sharedOriginals` leaves out a share with a row here) and the projector (services/project
 * resurfaced.ts) — and the answer itself is never here: it is in internal.post_judgement, filed like
 * any other, so every reader of a post's newest answer treats it as it treats any.
 *
 * ★ A ROW ONLY FOR AN ANSWER THAT CAME BACK. `record` writes a share only when the post has a
 * post-question answer filed at or after `answeredSince` (the pass's start): an outage, a budget
 * pause or a refused batch writes nothing, and the share is asked about again next pass. A row with
 * no answer behind it would let the projector count the post's age from the share on its old answer,
 * given without the share in view.
 *
 * What breaks if changed carelessly: `recent` THROWS when the table is missing (before 0139). The
 * projector catches that and counts every post from its own time; returning an empty map silently
 * here would hide a migration that was never applied.
 */

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';
import type { Millis } from '@insidor/contracts';

/** One share asked about, as the runner writes it. */
export interface ResurfaceAsk {
  readonly itemId: string;
  readonly byItemId: string;
  readonly byAuthorKey: string;
  readonly how: 'quoted' | 'samePicture' | 'reposted';
  readonly sharedAt: Date;
  readonly wordsSha: string;
}

/** The newest share of one post, as the projector reads it. */
export interface StoredShare {
  readonly itemId: string;
  readonly byItemId: string;
  readonly how: 'quoted' | 'samePicture' | 'reposted';
  readonly sharedAtMs: number;
  /** The sharing account's handle; null when we hold none. */
  readonly handle: string | null;
  readonly displayName: string | null;
  /** The sharing post's source and id there, for a link to it. */
  readonly source: string;
  readonly sourceItemId: string;
}

export class PgResurfacingRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Writes each share whose post has a post-question answer (never a kind answer) filed at or after
   * `answeredSince`, with that answer's judge; the rest are left to be asked again. A share already
   * written keeps its first row. Returns how many were written.
   */
  async record(asks: readonly ResurfaceAsk[], answeredSince: Millis, kindPrefix: string): Promise<number> {
    if (asks.length === 0) return 0;
    const rows = await this.#db.query<{ item_id: string }>(
      `insert into internal.resurfacing (item_id, by_item_id, by_author_key, how, shared_at, asked_at, judge_id, words_sha)
       select a.item_id, a.by_item_id, a.by_author_key, a.how, a.shared_at, j.judged_at, j.judge_id, a.words_sha
         from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[])
              as a(item_id, by_item_id, by_author_key, how, shared_at, words_sha)
         join lateral (
                select pj.judged_at, pj.judge_id from internal.post_judgement pj
                 where pj.item_id = a.item_id and pj.prompt_id not like $8 and pj.judged_at >= $7
                 order by pj.judged_at desc, pj.id desc limit 1
              ) j on true
       on conflict (item_id, by_item_id) do nothing
       returning item_id`,
      [
        asks.map((a) => a.itemId),
        asks.map((a) => a.byItemId),
        asks.map((a) => a.byAuthorKey),
        asks.map((a) => a.how),
        asks.map((a) => a.sharedAt),
        asks.map((a) => a.wordsSha),
        toTimestamp(answeredSince),
        `${kindPrefix}%`,
      ],
    );
    return rows.length;
  }

  /**
   * The newest share of each post shared at or after `since`, with the sharing account and post;
   * only `only`'s posts when given. Throws before 0139 (see the header).
   */
  async recent(since: Millis, only: readonly string[] | null = null): Promise<ReadonlyMap<string, StoredShare>> {
    const rows = await this.#db.query<{ item_id: string; by_item_id: string; how: 'quoted' | 'samePicture' | 'reposted'; shared_at: Date | string; handle: string | null; display_name: string | null; source: string; source_item_id: string }>(
      `select distinct on (r.item_id) r.item_id, r.by_item_id, r.how, r.shared_at, a.handle, a.display_name, b.source, b.source_item_id
         from internal.resurfacing r
         join public.item b on b.item_id = r.by_item_id
         left join public.author a on a.author_key = r.by_author_key
        where r.shared_at >= $1
          and ($2::text[] is null or r.item_id = any($2::text[]))
        order by r.item_id, r.shared_at desc`,
      [toTimestamp(since), only === null ? null : [...only]],
    );
    return new Map(rows.map((r) => [r.item_id, {
      itemId: r.item_id,
      byItemId: r.by_item_id,
      how: r.how,
      sharedAtMs: new Date(r.shared_at).getTime(),
      handle: r.handle,
      displayName: r.display_name,
      source: r.source,
      sourceItemId: r.source_item_id,
    }] as const));
  }
}
