/**
 * The short-video training set (0085): every coined short video with what can still be learned from
 * it, and the record of each re-tune's short-video part.
 *
 * Its own repo because the set has one writer (tools/lib/coined-videos.ts, at the re-tune's
 * ten-minute check) and several readers that must see the same rows: the learned search words
 * (PgFinderRepo.coinedPosts), the judge's precedents (PgLabelEmbeddingRepo.fromDatabase), the
 * namer's examples (PgNameExampleRepo.fromDatabase), the reports and the backtest.
 *
 * ★ SAFE BEFORE 0085. Every read is empty and every write is skipped when the table is missing:
 * the readers above then learn from what they read before, as they did.
 *
 * ★ A WRITE NEVER FORGETS. A row written again keeps the words, sound, kind, readings and peak it
 * already had wherever the new row has none (`coalesce(excluded, held)`): the composer may run
 * without the item in hand (public.item is pruned), and a re-fetch is paid once. `found_from`
 * only grows.
 *
 * What breaks if changed carelessly: `added_at` is set once. "Added straight away" is measured
 * from it, and a rewrite on every pass would make every row look new.
 */

import type { Db } from '../client.ts';

const MISSING_TABLE = '42P01';
const isMissing = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === MISSING_TABLE;

export type CoinedVideoFetch = 'held' | 'fetched' | 'gone' | 'unfetched';

export interface CoinedVideo {
  readonly itemId: string;
  readonly source: string;
  readonly sourceItemId: string;
  readonly handle: string | null;
  readonly postedAt: Date | null;
  readonly caption: string | null;
  readonly tags: readonly string[];
  /** The sound as the items' format id (`<source>:sound:<id>`), or null. */
  readonly sound: string | null;
  readonly soundTitle: string | null;
  /** The judge's kind for the post, when it was judged. */
  readonly kind: string | null;
  readonly firstCoin: string;
  readonly firstCoinAt: Date | null;
  readonly coinName: string | null;
  readonly coinTicker: string | null;
  readonly coins: number;
  /** The highest market cap we read for the first coin; null when we read none. */
  readonly peakUsd: number | null;
  /** Where the set heard of it: 'link', 'owner', 'missed', 'sheet:<name>', 'gold'. */
  readonly foundFrom: readonly string[];
  readonly views30m: number | null;
  readonly views1h: number | null;
  readonly views2h: number | null;
  readonly firstReadMin: number | null;
  readonly firstReadViews: number | null;
  readonly latestViews: number | null;
  readonly fetch: CoinedVideoFetch;
  readonly fetchedAt: Date | null;
  readonly addedAt?: Date;
}

export interface ShortVideoTuning {
  readonly slot: Date;
  readonly ranAt: Date;
  readonly setSize: number;
  readonly learned: Record<string, unknown>;
  readonly gate: Record<string, unknown> | null;
  readonly held: boolean | null;
  readonly why: string | null;
  readonly gap: string | null;
}

type Row = {
  item_id: string; source: string; source_item_id: string; handle: string | null; posted_at: Date | null; caption: string | null; tags: string[] | null;
  sound: string | null; sound_title: string | null; kind: string | null; first_coin: string; first_coin_at: Date | null; coin_name: string | null; coin_ticker: string | null;
  coins: number; peak_usd: number | null; found_from: string[] | null; views_30m: number | null; views_1h: number | null; views_2h: number | null;
  first_read_min: number | null; first_read_views: number | null; latest_views: number | null; fetch_state: CoinedVideoFetch; fetched_at: Date | null; added_at: Date;
};

const cut = (s: string | null, n: number): string | null => (s === null ? null : s.slice(0, n));

export class PgCoinedVideoRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async #soft<T>(empty: T, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isMissing(e)) return empty;
      throw e;
    }
  }

  /** True when 0085 is applied. */
  async present(): Promise<boolean> {
    const r = await this.#db.query<{ ok: boolean }>(`select to_regclass('internal.coined_video') is not null as ok`);
    return r[0]?.ok === true;
  }

  /** Every row, newest first coin first. */
  async all(): Promise<readonly CoinedVideo[]> {
    return this.#soft([] as readonly CoinedVideo[], async () => {
      const rows = await this.#db.query<Row>('select * from internal.coined_video order by first_coin_at desc nulls last, item_id');
      return rows.map((r) => ({
        itemId: r.item_id, source: r.source, sourceItemId: r.source_item_id, handle: r.handle, postedAt: r.posted_at, caption: r.caption, tags: r.tags ?? [],
        sound: r.sound, soundTitle: r.sound_title, kind: r.kind, firstCoin: r.first_coin, firstCoinAt: r.first_coin_at, coinName: r.coin_name, coinTicker: r.coin_ticker,
        coins: r.coins, peakUsd: r.peak_usd, foundFrom: r.found_from ?? [], views30m: r.views_30m, views1h: r.views_1h, views2h: r.views_2h,
        firstReadMin: r.first_read_min, firstReadViews: r.first_read_views, latestViews: r.latest_views, fetch: r.fetch_state, fetchedAt: r.fetched_at, addedAt: r.added_at,
      }));
    });
  }

  /** Writes rows (see the header: a write never forgets). The number of rows new to the set; 0 before 0085. */
  async put(rows: readonly CoinedVideo[], now: Date): Promise<number> {
    if (rows.length === 0) return 0;
    return this.#soft(0, async () => {
      let added = 0;
      for (const v of rows) {
        const r = await this.#db.query<{ fresh: boolean }>(
          `insert into internal.coined_video as h (item_id, source, source_item_id, handle, posted_at, caption, tags, sound, sound_title, kind, first_coin, first_coin_at,
                  coin_name, coin_ticker, coins, peak_usd, found_from, views_30m, views_1h, views_2h, first_read_min, first_read_views, latest_views, fetch_state, fetched_at, added_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $26)
           on conflict (item_id) do update set
             handle = coalesce(excluded.handle, h.handle), posted_at = coalesce(excluded.posted_at, h.posted_at),
             caption = coalesce(excluded.caption, h.caption), tags = case when cardinality(excluded.tags) > 0 then excluded.tags else h.tags end,
             sound = coalesce(excluded.sound, h.sound), sound_title = coalesce(excluded.sound_title, h.sound_title), kind = coalesce(excluded.kind, h.kind),
             first_coin = excluded.first_coin, first_coin_at = excluded.first_coin_at,
             coin_name = coalesce(excluded.coin_name, h.coin_name), coin_ticker = coalesce(excluded.coin_ticker, h.coin_ticker), coins = greatest(excluded.coins, h.coins),
             peak_usd = greatest(excluded.peak_usd, h.peak_usd),
             found_from = (select array_agg(distinct f order by f) from unnest(h.found_from || excluded.found_from) f),
             views_30m = coalesce(excluded.views_30m, h.views_30m), views_1h = coalesce(excluded.views_1h, h.views_1h), views_2h = coalesce(excluded.views_2h, h.views_2h),
             first_read_min = coalesce(excluded.first_read_min, h.first_read_min), first_read_views = coalesce(excluded.first_read_views, h.first_read_views),
             latest_views = greatest(excluded.latest_views, h.latest_views),
             fetch_state = case when excluded.fetch_state = 'unfetched' then h.fetch_state when excluded.fetch_state = 'gone' and h.caption is not null then h.fetch_state else excluded.fetch_state end,
             fetched_at = coalesce(excluded.fetched_at, h.fetched_at), updated_at = excluded.updated_at
           returning (xmax = 0) as fresh`,
          [
            v.itemId, v.source, v.sourceItemId, cut(v.handle, 100), v.postedAt, cut(v.caption, 4000), [...v.tags], cut(v.sound, 200), cut(v.soundTitle, 300), cut(v.kind, 60),
            v.firstCoin, v.firstCoinAt, cut(v.coinName, 200), cut(v.coinTicker, 64), v.coins, v.peakUsd, [...v.foundFrom], v.views30m, v.views1h, v.views2h,
            v.firstReadMin, v.firstReadViews, v.latestViews, v.fetch, v.fetchedAt, now,
          ],
        );
        if (r[0]?.fresh === true) added += 1;
      }
      return added;
    });
  }

  async recordTuning(t: ShortVideoTuning): Promise<boolean> {
    return this.#soft(false, async () => {
      await this.#db.query(
        'insert into internal.short_video_tuning (slot, ran_at, set_size, learned, gate, held, why, gap) values ($1, $2, $3, $4, $5, $6, $7, $8)',
        [t.slot, t.ranAt, t.setSize, JSON.stringify(t.learned), t.gate === null ? null : JSON.stringify(t.gate), t.held, cut(t.why, 2000), cut(t.gap, 2000)],
      );
      return true;
    });
  }

  async recentTunings(n: number): Promise<readonly ShortVideoTuning[]> {
    return this.#soft([] as readonly ShortVideoTuning[], async () => {
      const rows = await this.#db.query<{ slot: Date; ran_at: Date; set_size: number; learned: Record<string, unknown>; gate: Record<string, unknown> | null; held: boolean | null; why: string | null; gap: string | null }>(
        'select slot, ran_at, set_size, learned, gate, held, why, gap from internal.short_video_tuning order by ran_at desc limit $1',
        [n],
      );
      return rows.map((r) => ({ slot: r.slot, ranAt: r.ran_at, setSize: r.set_size, learned: r.learned, gate: r.gate, held: r.held, why: r.why, gap: r.gap }));
    });
  }
}
