/**
 * THE MISSED-RUNNER NET'S READS (services/runner work/missed-runners.ts, Policy.runnerLink.missed):
 * the coins that ran past every pick, and the posts we hold that one of them may have come from.
 *
 * Its own repo because both reads cross what the one-coin repo keeps apart: a coin's whole market
 * history against every pick of posts and narratives, and two days of stored posts read by a coin's
 * name in their words, their translation, the judge's names and the namer's — the search the matcher
 * never makes, since it starts from the launch and the recent posts. The net writes through the one-
 * coin repo (a candidate and a pick), so the one place a pick is written stays one.
 *
 * ★ ONLY READINGS WE HOLD. A coin is a runner here only on a market reading over the bar, and the
 * market reader reads a bounded set (the newest launches, the screen, the picks and the stated-name
 * coins): a coin it never read cannot be found, which the report says rather than this file hiding.
 *
 * What breaks if changed carelessly: the "no pick holds it" test. It must read every pick, shadow or
 * live, of posts and of narratives: a narrative's coin that ran is not missed, and treating it as one
 * would hand it to a post a second time.
 */

import type { Db } from '../client.ts';

/** A coin over the bar that no pick holds. */
export interface RunnerCoinRow {
  readonly address: string;
  readonly assetKey: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAtMs: number | null;
  /** The highest cap read in the window, and the newest, in dollars. */
  readonly peakCapUsd: number;
  readonly capUsd: number | null;
}

/** A post we hold, with what the net weighs it on. */
export interface RunnerPostRow {
  readonly itemId: string;
  readonly postedAtMs: number;
  readonly handle: string | null;
  readonly judgeNames: readonly string[];
  readonly guessNames: readonly string[];
  readonly text: string | null;
  readonly textEn: string | null;
  readonly views: number | null;
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []);
const ms = (x: string | Date | null): number | null => (x === null ? null : new Date(x).getTime());
const num = (x: unknown): number | null => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));

/** A name's search key, as the SQL below compacts: lower case, letters and digits only. */
export const runnerKey = (s: string): string => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export class PgMissedRunnerRepo {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Coins of `origins` launched since `sinceMs` whose market cap read `minCapUsd` or more since then on
   * at least `minReadings` readings with a pool (liquidity null — a coin on its curve — or at least
   * `minLiquidityUsd`), that no post's or narrative's pick holds, biggest first, at most `limit`.
   *
   * ★ A QUOTE WITH NO POOL IS NOT A RUN. On 21-24 Oct the biggest "caps" over the bar were $6-21B read
   * once on a $0 pool ("CDMW 4", "SYGNAL", "GTA VI"): frozen quotes, as one-coin.ts says of "Kim". One
   * reading is one quote; two over the bar is a coin that stayed there.
   */
  async runners(sinceMs: number, minCapUsd: number, origins: readonly string[], limit: number, minLiquidityUsd = 0, minReadings = 1): Promise<readonly RunnerCoinRow[]> {
    const rows = await this.#db.query<{ address: string; asset_key: string; name: string | null; symbol: string | null; launched_at: string | Date | null; peak: unknown; cap: unknown }>(
      `with big as (
         select m.asset_key, max(m.market_cap_usd) as peak
           from public.market_reading m
          where m.taken_at >= $1 and m.market_cap_usd >= $2 and (m.liquidity_usd is null or m.liquidity_usd >= $5)
          group by m.asset_key
         having count(*) >= $6
       )
       select a.address, a.asset_key, a.name, a.symbol, coalesce(a.minted_at, a.first_seen_at) as launched_at, b.peak,
              (select m.market_cap_usd from public.market_reading m where m.asset_key = a.asset_key and m.market_cap_usd is not null order by m.taken_at desc limit 1) as cap
         from big b
         join public.asset a on a.asset_key = b.asset_key
        where a.first_seen_at >= $1 and coalesce(a.minted_at, a.first_seen_at) >= $1 and a.origin = any($3::text[])
          and not exists (select 1 from internal.post_coin_pick p where p.address = a.address and p.outcome = 'picked')
          and not exists (select 1 from internal.narrative_coin_pick p where p.address = a.address and p.outcome = 'picked')
        order by b.peak desc, a.asset_key
        limit $4`,
      [new Date(sinceMs).toISOString(), minCapUsd, [...origins], limit, minLiquidityUsd, minReadings],
    );
    return rows.map((r) => ({ address: r.address, assetKey: r.asset_key, name: r.name, ticker: r.symbol, launchedAtMs: ms(r.launched_at), peakCapUsd: num(r.peak) ?? 0, capUsd: num(r.cap) }));
  }

  /**
   * Observed posts first seen since `fromMs` and posted by `toMs` whose words (or English translation)
   * hold one of `phrases`, or whose judge's (first question, a yes) or namer's names compact to one of
   * `keys`. At most `limit`, the most viewed first. The caller ranks them (core `rankRunnerPosts`).
   */
  async postsFor(phrases: readonly string[], keys: readonly string[], fromMs: number, toMs: number, limit: number): Promise<readonly RunnerPostRow[]> {
    const likes = [...new Set(phrases.map((p) => p.trim()).filter((p) => p !== ''))].map((p) => `%${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const k = [...new Set(keys.filter((x) => x !== ''))];
    if (likes.length === 0 && k.length === 0) return [];
    const rows = await this.#db.query<{ item_id: string; posted_at: string | Date; handle: string | null; body: string | null; text_en: string | null; judge: unknown; guesses: unknown; views: unknown }>(
      `with posts as (
         select i.item_id, coalesce(i.posted_at, i.first_seen_at) as posted_at, i.body, i.author_key
           from public.item i
          where i.origin = 'observed' and i.first_seen_at >= $1 and coalesce(i.posted_at, i.first_seen_at) <= $2
       ),
       named as (
         select j.item_id, jsonb_agg(distinct n.x) as names
           from internal.post_judgement j
           join posts p on p.item_id = j.item_id
           cross join lateral (select j.proposed_name union all select jsonb_array_elements_text(coalesce(j.alternate_names, '[]'::jsonb))) as n(x)
          where j.coinable is true and j.prompt_id not like 'post-kind%' and n.x is not null
          group by j.item_id
       ),
       guessed as (
         select g.item_id, jsonb_agg(distinct v.x) as names
           from internal.name_guess g
           join posts p on p.item_id = g.item_id
           cross join lateral (values (g.name), (g.ticker)) as v(x)
          group by g.item_id
       ),
       hit as (
         select p.item_id from posts p
           left join public.post_translation t on t.item_id = p.item_id
          where p.body ilike any($3::text[]) or t.text_en ilike any($3::text[])
         union
         select n.item_id from named n, jsonb_array_elements_text(n.names) x where regexp_replace(lower(x), '[^[:alnum:]]+', '', 'g') = any($4::text[])
         union
         select g.item_id from guessed g, jsonb_array_elements_text(g.names) x where regexp_replace(lower(x), '[^[:alnum:]]+', '', 'g') = any($4::text[])
       )
       select p.item_id, p.posted_at, au.handle, p.body, t.text_en, n.names as judge, g.names as guesses,
              (select max(o.value) from public.observation o where o.item_id = p.item_id and o.kind = 'reach') as views
         from hit h
         join posts p on p.item_id = h.item_id
         left join public.author au on au.author_key = p.author_key
         left join public.post_translation t on t.item_id = p.item_id
         left join named n on n.item_id = p.item_id
         left join guessed g on g.item_id = p.item_id
        order by views desc nulls last, p.posted_at
        limit $5`,
      [new Date(fromMs).toISOString(), new Date(toMs).toISOString(), likes, k, limit],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      postedAtMs: new Date(r.posted_at).getTime(),
      handle: r.handle,
      judgeNames: strings(r.judge),
      guessNames: strings(r.guesses),
      text: r.body,
      textEn: r.text_en,
      views: num(r.views),
    }));
  }

  /** The coin's picture similarity to each of these posts', where both are embedded in `space`. */
  async pictureSimilarity(assetKey: string, itemIds: readonly string[], space: string): Promise<ReadonlyMap<string, number>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; sim: unknown }>(
      `select q.subject_id as item_id, max(1 - (c.embedding <=> q.embedding)) as sim
         from internal.image_embedding c
         join internal.image_embedding q on q.subject_kind = 'item' and q.subject_id = any($2::text[]) and q.space = $3
        where c.subject_kind = 'asset' and c.subject_id = $1 and c.space = $3
        group by q.subject_id`,
      [assetKey, [...itemIds], space],
    );
    return new Map(rows.flatMap((r) => (num(r.sim) === null ? [] : [[r.item_id, num(r.sim) as number] as const])));
  }
}
