/**
 * THE FEED'S TRANSLATIONS (0081 public.post_translation): which feed posts have none yet, and
 * writing the answers.
 *
 * Its own repo because its scope is the feed's, not the judge's: the posts are the ones on
 * screen — the live frame (public.rising_row) and the scroll's members (public.feed_post, 0075)
 * shown inside the window and not withdrawn — whatever the judge said about them. The post sheet
 * opens only those, so this scope is every post a person can read.
 *
 * ★ ONE ROW PER POST, WRITTEN ONCE. A post with any row is never a candidate again, so "nothing to
 * translate" (the words were only tags, or the model read them as English) is written too, with
 * `text_en` null: without it the same hashtag-only posts would head every pass's queue forever.
 * A failed or refused call writes nothing, so the post is asked again next pass.
 *
 * What breaks if changed carelessly: the missing-table path. Before 0081 both calls must do
 * nothing quietly — `candidates` empty, `put` false — so the runner deployed ahead of the
 * migration asks nobody and spends nothing.
 */

import type { Db } from '../client.ts';
import { missingTable } from './image-hash.ts';

export interface TranslateCandidate {
  readonly itemId: string;
  readonly text: string;
  /** The source's language tag, as stored; null when it sent none. */
  readonly lang: string | null;
}

export interface TranslationRow {
  readonly itemId: string;
  readonly from: string;
  /** Null: nothing to translate. */
  readonly textEn: string | null;
  /** Null when no model was asked. */
  readonly model: string | null;
  readonly promptId: string;
}

export class PgTranslationRepo {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /** Feed posts shown inside `windowMs` with no translation row, the most recently shown first. Empty before 0081. */
  async candidates(windowMs: number, limit: number): Promise<readonly TranslateCandidate[]> {
    try {
      const rows = await this.#db.query<{ item_id: string; body: string | null; lang: string | null }>(
        `with scope as (
           select item_id, max(at) as at from (
             select r.item_id, now() as at from public.rising_row r
             union all
             select f.item_id, f.last_shown_at from public.feed_post f
              where f.withdrawn_at is null and f.last_shown_at > now() - make_interval(secs => $1::float8 / 1000)) s
            group by item_id)
         select s.item_id, i.body, i.lang
           from scope s join public.item i on i.item_id = s.item_id
          where not exists (select 1 from public.post_translation t where t.item_id = s.item_id)
          order by s.at desc, s.item_id
          limit $2`,
        [windowMs, limit],
      );
      return rows.map((r) => ({ itemId: r.item_id, text: r.body ?? '', lang: r.lang }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** Writes each post's row once; a post already holding one keeps it. False before 0081. */
  async put(rows: readonly TranslationRow[]): Promise<boolean> {
    if (rows.length === 0) return true;
    try {
      await this.#db.query(
        `insert into public.post_translation (item_id, lang_from, text_en, model, prompt_id)
         select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
         on conflict (item_id) do nothing`,
        [rows.map((r) => r.itemId), rows.map((r) => r.from), rows.map((r) => r.textEn), rows.map((r) => r.model), rows.map((r) => r.promptId)],
      );
      return true;
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
  }
}
