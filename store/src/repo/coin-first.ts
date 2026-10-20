/**
 * THE COIN-FIRST ROUTE'S READS AND ITS RECORD (0116): the posts a running coin's own link ties, the
 * route's asks so far today, and the coins that tie a post — for the runner's step (services/runner
 * work/coin-first.ts), the one-coin pass's extra launches, the projector and the launch push.
 *
 * Its own repo because the route crosses three records — the coin links (0083), the posts, and its
 * own table — and none of their repos should learn the route's age bound or caps. The SQL narrows;
 * core's `coinFirstStep` / `coinFirstAdmits` decide.
 *
 * ★ SAFE BEFORE 0116. Every read answers "nothing" and every write is skipped while the table is
 * missing, so a runner deployed before the migration runs the route empty instead of failing its
 * loop every few seconds. The table is looked up first (`to_regclass`), never found missing by a
 * failed statement: the projector calls this inside its frame's transaction, which a failed
 * statement would abort.
 *
 * ★ ONE HOP, BOTH WAYS THE SAME. Forward (the runner): a coin's linked post, and the post that linked
 * post reposts or quotes (`reproduction_of` / `rebroadcast_of`). Backward (who ties a post): coins
 * linking it, and coins linking a post whose `reproduction_of` is it — the indexed column — plus the
 * coin the route recorded, which covers a hop through `rebroadcast_of` found forward.
 *
 * What breaks if changed carelessly: `record` keeps every first time (coalesce). The daily caps count
 * the ask columns, and the push and "joins once" read `admitted_at`: a rewrite would reopen both.
 */

import { OBSERVED_ASSET_ORIGINS, type Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillis, toTimestamp } from '../rows.ts';

const MISSING_TABLE = '42P01';
const isMissing = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === MISSING_TABLE;

/** A post a running coin ties, with what we hold of it and what the route did so far. */
export interface CoinFirstRow {
  readonly itemId: string;
  readonly source: string;
  readonly sourceItemId: string;
  /** The coin's own link to it (the URL), when the tie is direct; null for a hop. */
  readonly link: string | null;
  readonly via: 'link' | 'hop';
  readonly address: string;
  readonly launchedAtMs: Millis;
  readonly held: boolean;
  readonly postedAtMs: Millis | null;
  readonly judged: boolean;
  readonly credited: boolean;
  readonly fetchAskedAtMs: Millis | null;
  readonly judgeAskedAtMs: Millis | null;
  readonly admittedAtMs: Millis | null;
}

/** One post's row to write: the coin that brought it and what was done this pass. */
export interface CoinFirstWrite {
  readonly itemId: string;
  readonly address: string;
  readonly launchedAtMs: number;
  readonly via: 'link' | 'hop';
  readonly firstCoinAddress: string | null;
  readonly fetchAsked?: boolean;
  readonly judgeAsked?: boolean;
  readonly credited?: boolean;
}

/** A coin tying a post, with its launch. */
export interface CoinTie {
  readonly address: string;
  readonly launchedAtMs: Millis | null;
}

/** What the projector and the push read of a post the route recorded. */
export interface CoinFirstRecord {
  readonly itemId: string;
  readonly coinAddress: string;
  readonly launchedAtMs: Millis;
  readonly firstCoinAddress: string | null;
  readonly admittedAtMs: Millis | null;
}

const splitId = (id: string): [string, string] => {
  const at = id.indexOf(':');
  return [id.slice(0, at), id.slice(at + 1)];
};

export class PgCoinFirstRepo {
  readonly #db: Db;
  #present: boolean | null = null;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Whether 0116 is applied; asked once per repo, and again until it is. */
  async present(): Promise<boolean> {
    if (this.#present === true) return true;
    const rows = await this.#db.query<{ t: string | null }>(`select to_regclass('internal.coin_first_post')::text as t`);
    this.#present = (rows[0]?.t ?? null) !== null;
    return this.#present;
  }

  async #guard<T>(empty: T, run: () => Promise<T>): Promise<T> {
    if (!(await this.present())) return empty;
    try {
      return await run();
    } catch (e) {
      if (isMissing(e)) return empty;
      throw e;
    }
  }

  /**
   * The posts tied by the own links of observed coins launched since `sinceMs` that have traded at
   * `minCapUsd` or more since their launch (a market reading, or the trade feed's minute), each with
   * what we hold of it and the route's record; oldest launch first, at most `limit`.
   */
  async running(sinceMs: Millis, minCapUsd: number, limit: number): Promise<readonly CoinFirstRow[]> {
    return this.#guard([] as readonly CoinFirstRow[], async () => {
      const rows = await this.#db.query<{
        item_id: string; source: string; source_item_id: string; link: string | null; via: 'link' | 'hop'; address: string; launched_at: Date | string;
        held: boolean; posted_at: Date | string | null; judged: boolean; credited: boolean;
        fetch_asked_at: Date | string | null; judge_asked_at: Date | string | null; admitted_at: Date | string | null;
      }>(
        `with coins as (
           select distinct a.asset_key, a.address, coalesce(a.minted_at, a.first_seen_at) as launched_at
             from internal.coin_post_link l
             join public.asset a on a.asset_key = l.asset_key
            where l.found_at >= $1 and a.origin = any($2::text[]) and a.first_seen_at >= $1
         ), running as (
           select c.* from coins c
            where coalesce((select max(r.market_cap_usd) from public.market_reading r
                             where r.asset_key = c.asset_key and r.taken_at >= c.launched_at), 0) >= $3
               or coalesce((select max(m.last_mcap_usd) from internal.coin_trade_minute m
                             where m.address = c.address and m.minute >= date_trunc('minute', c.launched_at)), 0) >= $3
         ), links as (
           select r.address, r.launched_at, l.source, l.source_item_id, l.link, l.source || ':' || l.source_item_id as linked_id
             from running r join internal.coin_post_link l on l.asset_key = r.asset_key
         ), ties as (
           select k.address, k.launched_at, k.source, k.source_item_id, k.link, k.linked_id as item_id, 'link' as via from links k
           union
           select k.address, k.launched_at, split_part(o.target, ':', 1), substr(o.target, strpos(o.target, ':') + 1), null, o.target, 'hop'
             from links k
             join public.item i on i.item_id = k.linked_id
             cross join lateral (values (i.reproduction_of), (i.rebroadcast_of)) as o(target)
            where o.target is not null and o.target <> k.linked_id and strpos(o.target, ':') > 1
         )
         select t.item_id, t.source, t.source_item_id, t.link, t.via, t.address, t.launched_at,
                i.item_id is not null as held, i.posted_at,
                exists (select 1 from internal.post_judgement j where j.item_id = t.item_id and j.prompt_id not like 'post-kind%') as judged,
                exists (select 1 from internal.item_found_by f where f.item_id = t.item_id) as credited,
                c.fetch_asked_at, c.judge_asked_at, c.admitted_at
           from ties t
           left join public.item i on i.item_id = t.item_id and i.origin = 'observed'
           left join internal.coin_first_post c on c.item_id = t.item_id
          order by t.launched_at, t.item_id, t.address
          limit $4`,
        [toTimestamp(sinceMs), [...OBSERVED_ASSET_ORIGINS], minCapUsd, limit],
      );
      return rows.map((r) => ({
        itemId: r.item_id,
        source: r.source,
        sourceItemId: r.source_item_id,
        link: r.link,
        via: r.via,
        address: r.address,
        launchedAtMs: toMillis(r.launched_at) as Millis,
        held: r.held,
        postedAtMs: toMillis(r.posted_at),
        judged: r.judged,
        credited: r.credited,
        fetchAskedAtMs: toMillis(r.fetch_asked_at),
        judgeAskedAtMs: toMillis(r.judge_asked_at),
        admittedAtMs: toMillis(r.admitted_at),
      }));
    });
  }

  /** How many posts the route read by id, and asked the judge about, since `sinceMs` (the day's start). */
  async spentSince(sinceMs: Millis): Promise<{ readonly fetches: number; readonly judgements: number }> {
    return this.#guard({ fetches: 0, judgements: 0 }, async () => {
      const rows = await this.#db.query<{ fetches: string; judgements: string }>(
        `select (select count(*) from internal.coin_first_post where fetch_asked_at >= $1)::text as fetches,
                (select count(*) from internal.coin_first_post where judge_asked_at >= $1)::text as judgements`,
        [toTimestamp(sinceMs)],
      );
      return { fetches: Number(rows[0]?.fetches ?? 0), judgements: Number(rows[0]?.judgements ?? 0) };
    });
  }

  /** The route's rows written: the first coin, via and every first time kept; a newer first coin replaces the old. */
  async record(rows: readonly CoinFirstWrite[], at: Millis): Promise<void> {
    if (rows.length === 0) return;
    await this.#guard(undefined, async () => {
      const stamp = (b: boolean | undefined): Date | null => (b === true ? toTimestamp(at) : null);
      await this.#db.query(
        `insert into internal.coin_first_post (item_id, coin_address, launched_at, via, first_coin_address, first_seen_at, fetch_asked_at, judge_asked_at, credited_at, updated_at)
         select r.item_id, r.address, r.launched_at, r.via, r.first_coin, $9, r.fetch_at, r.judge_at, r.credit_at, $9
           from unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::timestamptz[])
                as r(item_id, address, launched_at, via, first_coin, fetch_at, judge_at, credit_at)
         on conflict (item_id) do update set
           first_coin_address = coalesce(excluded.first_coin_address, internal.coin_first_post.first_coin_address),
           fetch_asked_at = coalesce(internal.coin_first_post.fetch_asked_at, excluded.fetch_asked_at),
           judge_asked_at = coalesce(internal.coin_first_post.judge_asked_at, excluded.judge_asked_at),
           credited_at = coalesce(internal.coin_first_post.credited_at, excluded.credited_at),
           updated_at = excluded.updated_at`,
        [
          rows.map((r) => r.itemId),
          rows.map((r) => r.address),
          rows.map((r) => toTimestamp(r.launchedAtMs as Millis)),
          rows.map((r) => r.via),
          rows.map((r) => r.firstCoinAddress),
          rows.map((r) => stamp(r.fetchAsked)),
          rows.map((r) => stamp(r.judgeAsked)),
          rows.map((r) => stamp(r.credited)),
          toTimestamp(at),
        ],
      );
    });
  }

  /**
   * Every observed coin tying each post: its own link to the post, or its link to a post whose
   * `reproduction_of` is this one, plus the coin the route recorded for it. Posts none ties are absent.
   */
  async ties(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly CoinTie[]>> {
    if (itemIds.length === 0) return new Map();
    return this.#guard(new Map<string, readonly CoinTie[]>(), async () => {
      const ids = [...new Set(itemIds)];
      const rows = await this.#db.query<{ item_id: string; address: string; launched_at: Date | string | null }>(
        `with t as (select * from unnest($1::text[], $2::text[], $3::text[]) as t(item_id, source, source_item_id))
         select t.item_id, l.address, min(l.minted_at) as launched_at
           from t
           join internal.coin_post_link l on l.source = t.source and l.source_item_id = t.source_item_id
           join public.asset a on a.asset_key = l.asset_key and a.origin = any($4::text[])
          group by 1, 2
         union
         select t.item_id, l.address, min(l.minted_at)
           from t
           join public.item i on i.reproduction_of = t.item_id
           join internal.coin_post_link l on l.source = i.source and l.source_item_id = i.source_item_id
           join public.asset a on a.asset_key = l.asset_key and a.origin = any($4::text[])
          group by 1, 2
         union
         select c.item_id, c.coin_address, c.launched_at
           from internal.coin_first_post c where c.item_id = any($1::text[])`,
        [ids, ids.map((id) => splitId(id)[0]), ids.map((id) => splitId(id)[1]), [...OBSERVED_ASSET_ORIGINS]],
      );
      const out = new Map<string, CoinTie[]>();
      for (const r of rows) {
        const list = out.get(r.item_id) ?? [];
        const at = toMillis(r.launched_at);
        const had = list.find((x) => x.address === r.address);
        if (had === undefined) list.push({ address: r.address, launchedAtMs: at });
        else if (at !== null && (had.launchedAtMs === null || at < had.launchedAtMs)) list.splice(list.indexOf(had), 1, { address: r.address, launchedAtMs: at });
        out.set(r.item_id, list);
      }
      return out;
    });
  }

  /** The route's rows for posts whose coin launched since `sinceMs`, or for these posts. */
  async records(sinceMs: Millis | null, itemIds: readonly string[] = []): Promise<readonly CoinFirstRecord[]> {
    return this.#guard([] as readonly CoinFirstRecord[], async () => {
      const rows = await this.#db.query<{ item_id: string; coin_address: string; launched_at: Date | string; first_coin_address: string | null; admitted_at: Date | string | null }>(
        `select item_id, coin_address, launched_at, first_coin_address, admitted_at
           from internal.coin_first_post
          where ($1::timestamptz is not null and launched_at >= $1) or item_id = any($2::text[])`,
        [sinceMs === null ? null : toTimestamp(sinceMs), [...itemIds]],
      );
      return rows.map((r) => ({ itemId: r.item_id, coinAddress: r.coin_address, launchedAtMs: toMillis(r.launched_at) as Millis, firstCoinAddress: r.first_coin_address, admittedAtMs: toMillis(r.admitted_at) }));
    });
  }

  /** The posts a frame let onto For You by the route alone: `admitted_at` set once, never moved. */
  async admitted(itemIds: readonly string[], at: Millis): Promise<void> {
    if (itemIds.length === 0) return;
    await this.#guard(undefined, async () => {
      await this.#db.query(
        `update internal.coin_first_post set admitted_at = $2, updated_at = $2 where item_id = any($1::text[]) and admitted_at is null`,
        [[...itemIds], toTimestamp(at)],
      );
    });
  }
}
