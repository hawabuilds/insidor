/**
 * ONE POST, ONE COIN (0113, and 0112's trade feed): everything the runner's one-coin step reads
 * and writes — new launches with what ties them to posts, the recent posts with their names and
 * picture hashes, the candidates, the trade minutes and market readings the rule judges on, the
 * picks and their history, and the trade feed's watch list.
 *
 * One file because the shapes meet here: a launch's hash and a post's are compared as the same
 * 16-hex dct64 string (image-hash.ts `fromBits`), a candidate's trades are rolled up the same way
 * live and in the replay (`tradeMinutes`), and a pick's change is recorded in the same statement
 * that writes the pick.
 *
 * ★ 0112 MAY NOT BE THERE. internal.coin_watch, coin_trade_minute and coin_trade_state belong to
 * the trade feed's own migration. Before it is applied, `watch` writes nothing and says so (false),
 * and `tradeFacts` / `tradeFeedAt` answer null: the rule then judges on market readings and records
 * that basis. ★ Before 0113 every read answers nothing and every write is skipped, by Postgres's
 * own code for a missing table (`missingTable`).
 *
 * What breaks if changed carelessly: the trade roll-up. Net buying is the sum of the minutes, and
 * buyers the state's distinct count (else the minutes' new buyers summed); reading `buyers` per
 * minute and adding them counts a wallet that bought in two minutes twice, and the buyer bar with it.
 */

import type { Db } from '../client.ts';
import { fromBits, missingTable } from './image-hash.ts';

export interface RecentLaunch {
  readonly address: string;
  readonly assetKey: string;
  readonly launchedAtMs: number;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly imageUri: string | null;
  readonly hash: string | null;
  /** Item ids of the posts its metadata names (internal.coin_post_link). */
  readonly linksPosts: readonly string[];
}

export interface RecentPost {
  readonly itemId: string;
  readonly postedAtMs: number;
  readonly judgeNames: readonly string[];
  readonly guessNames: readonly string[];
  readonly hash: string | null;
}

export interface CandidateRow {
  readonly itemId: string;
  readonly address: string;
  readonly path: 'launch' | 'existing';
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly launchedAtMs: number | null;
  readonly foundAtMs: number;
}

export interface TradeRollup {
  readonly uniqueBuyers: number;
  readonly netBuy: number;
  readonly capUsd: number | null;
  readonly cap: number | null;
  readonly peakCap: number | null;
  readonly creatorSold: boolean;
}

export interface MinuteRow {
  readonly address: string;
  readonly atMs: number;
  readonly newBuyers: number;
  readonly netBuy: number;
  readonly creatorSold: number;
  readonly cap: number | null;
  readonly capUsd: number | null;
}

export interface StoredPick {
  readonly subjectId: string;
  readonly address: string | null;
  readonly outcome: 'picked' | 'waiting' | 'none';
  readonly decidedAtMs: number;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface PickWrite {
  readonly subjectId: string;
  readonly address: string | null;
  readonly outcome: 'picked' | 'waiting' | 'none';
  readonly decidedAtMs: number;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly basis: 'trades' | 'market_readings' | null;
}

export interface ExistingCoinRow {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAtMs: number | null;
  readonly capUsd: number | null;
  readonly readAtMs: number | null;
}

const ms = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string).getTime());
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const hex = (v: unknown): string | null => (v === null || v === undefined ? null : fromBits(v as string));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export type PickKind = 'post' | 'narrative';
const PICK_TABLE: Readonly<Record<PickKind, { readonly table: string; readonly key: string }>> = {
  post: { table: 'internal.post_coin_pick', key: 'item_id' },
  narrative: { table: 'internal.narrative_coin_pick', key: 'narrative_id' },
};

export class PgOneCoinRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Launches that arrived since `sinceMs` (the live stream's and the backfill's), newest first, with
   * their metadata's name, ticker and picture, the picture's hash when hashed, and the posts their
   * metadata names. The launch time is the coin's own, else when we first saw it.
   */
  async recentLaunches(sinceMs: number, limit: number, hashVersion: string): Promise<readonly RecentLaunch[]> {
    const rows = await this.#db.query<{ address: string; asset_key: string; launched_at: string; name: string | null; ticker: string | null; image_uri: string | null; bits: string | null; links: string[] | null }>(
      `select a.address, a.asset_key, coalesce(a.minted_at, a.first_seen_at) as launched_at,
              coalesce(m.name, a.name) as name, coalesce(m.ticker, a.symbol) as ticker,
              coalesce(m.image_uri, a.image_uri) as image_uri, h.bits::text as bits,
              (select array_agg(distinct i.item_id) from internal.coin_post_link l
                 join public.item i on i.source = l.source and i.source_item_id = l.source_item_id
                where l.asset_key = a.asset_key) as links
         from public.asset a
         left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
         left join internal.image_hash h on h.uri = coalesce(m.image_uri, a.image_uri) and h.version = $3 and h.bits is not null
        where a.origin in ('live_stream', 'backfill') and a.first_seen_at >= $1
        order by a.first_seen_at desc
        limit $2`,
      [new Date(sinceMs).toISOString(), limit, hashVersion],
    );
    return rows.map((r) => ({
      address: r.address,
      assetKey: r.asset_key,
      launchedAtMs: new Date(r.launched_at).getTime(),
      name: r.name,
      ticker: r.ticker,
      imageUri: r.image_uri,
      hash: hex(r.bits),
      linksPosts: r.links ?? [],
    }));
  }

  /**
   * The posts a launch could be the coin of: observed posts the judge called coinable, posted since
   * `sinceMs` (read from the judgements of that window, by their time index: a post is judged after
   * it is posted), with the judge's names (its newest answer), the namer's guesses and the hash of the
   * post's embedded picture.
   */
  async recentPosts(sinceMs: number, limit: number, hashVersion: string): Promise<readonly RecentPost[]> {
    const rows = await this.#db.query<{ item_id: string; posted_at: string; proposed_name: string | null; alternate_names: unknown; guesses: unknown; bits: string | null }>(
      `select i.item_id, coalesce(i.posted_at, i.first_seen_at) as posted_at, j.proposed_name, j.alternate_names,
              (select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb)
                 from internal.name_guess g, lateral (values (g.name), (g.ticker)) as v(x) where g.item_id = i.item_id) as guesses,
              (select h.bits::text from internal.image_embedding e
                 join internal.image_hash h on h.uri = e.uri and h.version = $3 and h.bits is not null
                where e.subject_kind = 'item' and e.subject_id = i.item_id limit 1) as bits
         from (select distinct on (item_id) item_id, proposed_name, alternate_names, coinable
                 from internal.post_judgement where judged_at >= $1 order by item_id, judged_at desc) j
         join public.item i on i.item_id = j.item_id
        where i.origin = 'observed' and coalesce(i.posted_at, i.first_seen_at) >= $1 and j.coinable is true
        order by coalesce(i.posted_at, i.first_seen_at) desc
        limit $2`,
      [new Date(sinceMs).toISOString(), limit, hashVersion],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      postedAtMs: new Date(r.posted_at).getTime(),
      judgeNames: [...(r.proposed_name === null || r.proposed_name.trim() === '' ? [] : [r.proposed_name]), ...strings(r.alternate_names)],
      guessNames: strings(r.guesses),
      hash: hex(r.bits),
    }));
  }

  /** Picture similarity between coins (by asset key) and posts, where both are embedded in `space`. */
  async similarities(pairs: readonly { readonly assetKey: string; readonly itemId: string }[], space: string): Promise<ReadonlyMap<string, number>> {
    if (pairs.length === 0) return new Map();
    const rows = await this.#db.query<{ asset_key: string; item_id: string; sim: number }>(
      `select p.asset_key, p.item_id, max(1 - (c.embedding <=> q.embedding)) as sim
         from unnest($1::text[], $2::text[]) as p(asset_key, item_id)
         join internal.image_embedding c on c.subject_kind = 'asset' and c.subject_id = p.asset_key and c.space = $3
         join internal.image_embedding q on q.subject_kind = 'item' and q.subject_id = p.item_id and q.space = $3
        group by p.asset_key, p.item_id`,
      [pairs.map((p) => p.assetKey), pairs.map((p) => p.itemId), space],
    );
    return new Map(rows.map((r) => [`${r.asset_key}|${r.item_id}`, Number(r.sim)] as const));
  }

  /** Coins whose picture is not embedded in `space` yet, of these asset keys. */
  async unembedded(assetKeys: readonly string[], space: string): Promise<ReadonlySet<string>> {
    if (assetKeys.length === 0) return new Set();
    const rows = await this.#db.query<{ k: string }>(
      `select k from unnest($1::text[]) as k
        where not exists (select 1 from internal.image_embedding e where e.subject_kind = 'asset' and e.subject_id = k and e.space = $2)`,
      [[...assetKeys], space],
    );
    return new Set(rows.map((r) => r.k));
  }

  /** Candidates written or widened: a later tie adds to the evidence, the first `found_at` stays. */
  async upsertCandidates(rows: readonly CandidateRow[], nowMs: number): Promise<number> {
    if (rows.length === 0) return 0;
    try {
      await this.#db.query(
        `insert into internal.one_coin_candidate (item_id, address, path, evidence, launched_at, found_at, updated_at)
         select r.item_id, r.address, r.path, r.evidence, r.launched_at, r.found_at, $7
           from unnest($1::text[], $2::text[], $3::text[], $4::jsonb[], $5::timestamptz[], $6::timestamptz[])
                as r(item_id, address, path, evidence, launched_at, found_at)
         on conflict (item_id, address) do update
           set evidence = excluded.evidence, updated_at = excluded.updated_at
         where internal.one_coin_candidate.evidence is distinct from excluded.evidence`,
        [
          rows.map((r) => r.itemId),
          rows.map((r) => r.address),
          rows.map((r) => r.path),
          rows.map((r) => JSON.stringify(r.evidence)),
          rows.map((r) => (r.launchedAtMs === null ? null : new Date(r.launchedAtMs).toISOString())),
          rows.map((r) => new Date(r.foundAtMs).toISOString()),
          new Date(nowMs).toISOString(),
        ],
      );
      return rows.length;
    } catch (e) {
      if (missingTable(e)) return 0;
      throw e;
    }
  }

  /**
   * The coins on the trade feed's watch list (0112) until `untilMs`; a coin already watched longer
   * keeps its end. False: 0112 is not applied, nothing was written.
   */
  async watch(addresses: readonly string[], reason: string, nowMs: number, untilMs: number): Promise<boolean> {
    if (addresses.length === 0) return true;
    try {
      await this.#db.query(
        `insert into internal.coin_watch (address, reason, since, until)
         select a, $2, $3, $4 from unnest($1::text[]) as a
         on conflict (address) do update set until = greatest(internal.coin_watch.until, excluded.until)`,
        [[...new Set(addresses)], reason, new Date(nowMs).toISOString(), new Date(untilMs).toISOString()],
      );
      return true;
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
  }

  /** Every candidate of posts with one found or launched since `sinceMs`: the subjects still being judged. */
  async openCandidates(sinceMs: number, limit: number): Promise<readonly CandidateRow[]> {
    try {
      const rows = await this.#db.query<{ item_id: string; address: string; path: 'launch' | 'existing'; evidence: Record<string, unknown>; launched_at: string | null; found_at: string }>(
        `select c.item_id, c.address, c.path, c.evidence, c.launched_at, c.found_at
           from internal.one_coin_candidate c
          where c.item_id in (select item_id from internal.one_coin_candidate
                               where greatest(found_at, coalesce(launched_at, found_at)) >= $1
                               group by item_id order by max(found_at) desc limit $2)`,
        [new Date(sinceMs).toISOString(), limit],
      );
      return rows.map((r) => ({ itemId: r.item_id, address: r.address, path: r.path, evidence: r.evidence, launchedAtMs: ms(r.launched_at), foundAtMs: new Date(r.found_at).getTime() }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** Every candidate of these posts, open or not: a narrative is judged over all its posts'. */
  async candidatesOf(itemIds: readonly string[]): Promise<readonly CandidateRow[]> {
    if (itemIds.length === 0) return [];
    try {
      const rows = await this.#db.query<{ item_id: string; address: string; path: 'launch' | 'existing'; evidence: Record<string, unknown>; launched_at: string | null; found_at: string }>(
        `select item_id, address, path, evidence, launched_at, found_at from internal.one_coin_candidate where item_id = any($1::text[])`,
        [[...itemIds]],
      );
      return rows.map((r) => ({ itemId: r.item_id, address: r.address, path: r.path, evidence: r.evidence, launchedAtMs: ms(r.launched_at), foundAtMs: new Date(r.found_at).getTime() }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** The open narratives these posts belong to, and every post of each. */
  async narrativesOf(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    if (itemIds.length === 0) return new Map();
    try {
      const rows = await this.#db.query<{ narrative_id: string; members: string[] }>(
        `select n.narrative_id, array_agg(m.item_id order by m.item_id) as members
           from internal.narrative n join internal.narrative_member m on m.narrative_id = n.narrative_id
          where n.state = 'open' and n.narrative_id in (select narrative_id from internal.narrative_member where item_id = any($1::text[]))
          group by n.narrative_id`,
        [[...itemIds]],
      );
      return new Map(rows.map((r) => [r.narrative_id, r.members] as const));
    } catch (e) {
      if (missingTable(e)) return new Map();
      throw e;
    }
  }

  /** When the trade feed last wrote (0112's state rows); null: not applied, or never written. */
  async tradeFeedAt(): Promise<number | null> {
    try {
      const [r] = await this.#db.query<{ at: string | null }>(`select max(updated_at) as at from internal.coin_trade_state`);
      return ms(r?.at ?? null);
    } catch (e) {
      if (missingTable(e)) return null;
      throw e;
    }
  }

  /** Which of these coins are on the watch list now (0112); empty before it. */
  async watched(addresses: readonly string[], nowMs: number): Promise<ReadonlySet<string>> {
    if (addresses.length === 0) return new Set();
    try {
      const rows = await this.#db.query<{ address: string }>(`select address from internal.coin_watch where address = any($1::text[]) and since <= $2`, [[...addresses], new Date(nowMs).toISOString()]);
      return new Set(rows.map((r) => r.address));
    } catch (e) {
      if (missingTable(e)) return new Set();
      throw e;
    }
  }

  /**
   * Each coin's trading over its life (0112): net buying summed over its minutes, the newest caps,
   * the state's distinct buyers and peak. A coin with no minute and no state is absent. Null: 0112
   * is not applied.
   */
  async tradeFacts(addresses: readonly string[]): Promise<ReadonlyMap<string, TradeRollup> | null> {
    if (addresses.length === 0) return new Map();
    try {
      const rows = await this.#db.query<{ address: string; net: string | null; new_buyers: string | null; last_usd: string | null; last_cap: string | null; peak_minutes: string | null; creator_minutes: string | null; unique_buyers: string | null; peak: string | null; state_cap: string | null; creator_flag: string | null }>(
        `select a.address,
                mm.net, mm.new_buyers, mm.last_usd, mm.last_cap, mm.peak_minutes, mm.creator_minutes,
                s.unique_buyers::text as unique_buyers, s.peak_mcap_sol::text as peak, s.last_mcap_sol::text as state_cap, s.creator_sold::text as creator_flag
           from unnest($1::text[]) as a(address)
           left join lateral (
             select sum(net_sol)::text as net, sum(new_buyers)::text as new_buyers, max(last_mcap_sol)::text as peak_minutes,
                    sum(creator_sold_sol)::text as creator_minutes,
                    (array_agg(last_mcap_usd order by minute desc) filter (where last_mcap_usd is not null))[1]::text as last_usd,
                    (array_agg(last_mcap_sol order by minute desc) filter (where last_mcap_sol is not null))[1]::text as last_cap,
                    count(*) as n
               from internal.coin_trade_minute m where m.address = a.address) mm on true
           left join internal.coin_trade_state s on s.address = a.address
          where mm.n > 0 or s.address is not null`,
        [[...addresses]],
      );
      const truthy = (v: string | null): boolean => v !== null && (v === 'true' || v === 't' || (/^[0-9.eE+-]+$/.test(v) && Number(v) > 0));
      return new Map(rows.map((r) => {
        const peak = [num(r.peak), num(r.peak_minutes)].filter((x): x is number => x !== null);
        return [r.address, {
          uniqueBuyers: num(r.unique_buyers) ?? num(r.new_buyers) ?? 0,
          netBuy: num(r.net) ?? 0,
          capUsd: num(r.last_usd),
          cap: num(r.state_cap) ?? num(r.last_cap),
          peakCap: peak.length === 0 ? null : Math.max(...peak),
          creatorSold: truthy(r.creator_flag) || truthy(r.creator_minutes),
        }] as const;
      }));
    } catch (e) {
      if (missingTable(e)) return null;
      throw e;
    }
  }

  /** Each coin's trade minutes since `sinceMs`, oldest first (the replay). Empty before 0112. */
  async tradeMinutes(addresses: readonly string[], sinceMs: number): Promise<readonly MinuteRow[]> {
    if (addresses.length === 0) return [];
    try {
      const rows = await this.#db.query<{ address: string; minute: string; new_buyers: number; net_sol: string; creator_sold_sol: string | null; last_mcap_sol: string | null; last_mcap_usd: string | null }>(
        `select address, minute, new_buyers, net_sol::text as net_sol, creator_sold_sol::text as creator_sold_sol, last_mcap_sol::text as last_mcap_sol, last_mcap_usd::text as last_mcap_usd
           from internal.coin_trade_minute where address = any($1::text[]) and minute >= $2 order by address, minute`,
        [[...addresses], new Date(sinceMs).toISOString()],
      );
      return rows.map((r) => ({ address: r.address, atMs: new Date(r.minute).getTime(), newBuyers: Number(r.new_buyers ?? 0), netBuy: Number(r.net_sol ?? 0), creatorSold: num(r.creator_sold_sol) ?? 0, cap: num(r.last_mcap_sol), capUsd: num(r.last_mcap_usd) }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** Each coin's newest market cap and its highest since `sinceMs` (public.market_reading), measured readings only. */
  async marketFacts(addresses: readonly string[], sinceMs: number): Promise<ReadonlyMap<string, { readonly capUsd: number; readonly peakCapUsd: number; readonly readAtMs: number }>> {
    if (addresses.length === 0) return new Map();
    const rows = await this.#db.query<{ address: string; cap: number; peak: number; at: string }>(
      `select a.address, r.cap, r.peak, r.at
         from public.asset a
         join lateral (
           select (array_agg(market_cap_usd order by taken_at desc))[1] as cap, max(market_cap_usd) as peak, max(taken_at) as at
             from public.market_reading m
            where m.asset_key = a.asset_key and m.taken_at >= $2 and m.market_cap_usd is not null
         ) r on r.cap is not null
        where a.address = any($1::text[])`,
      [[...addresses], new Date(sinceMs).toISOString()],
    );
    return new Map(rows.map((r) => [r.address, { capUsd: Number(r.cap), peakCapUsd: Number(r.peak), readAtMs: new Date(r.at).getTime() }] as const));
  }

  /** Each coin's market readings since `sinceMs`, oldest first (the replay's fallback). */
  async readings(addresses: readonly string[], sinceMs: number): Promise<readonly { readonly address: string; readonly atMs: number; readonly capUsd: number }[]> {
    if (addresses.length === 0) return [];
    const rows = await this.#db.query<{ address: string; at: string; cap: number }>(
      `select a.address, m.taken_at as at, m.market_cap_usd as cap
         from public.asset a join public.market_reading m on m.asset_key = a.asset_key
        where a.address = any($1::text[]) and m.taken_at >= $2 and m.market_cap_usd is not null
        order by a.address, m.taken_at`,
      [[...addresses], new Date(sinceMs).toISOString()],
    );
    return rows.map((r) => ({ address: r.address, atMs: new Date(r.at).getTime(), capUsd: Number(r.cap) }));
  }

  /**
   * Coins named exactly one of these names (lower-cased name, upper-cased ticker, by public.coin_name's
   * indexes), with their newest market cap: the second path's pool. Core decides which, if any.
   */
  async coinsNamed(names: readonly string[], limit: number): Promise<readonly ExistingCoinRow[]> {
    const lower = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n !== ''))];
    const compact = [...new Set(names.map((n) => n.replace(/[^\p{L}\p{N}]+/gu, '').toUpperCase()).filter((n) => n !== ''))];
    if (lower.length === 0 && compact.length === 0) return [];
    const rows = await this.#db.query<{ address: string; name: string | null; ticker: string | null; launched_at: string | null; cap: number | null; at: string | null }>(
      `select n.address, n.name, n.ticker, n.launched_at, r.cap, r.at
         from public.coin_name n
         join public.asset a on a.address = n.address
         left join lateral (select market_cap_usd as cap, taken_at as at from public.market_reading m
                             where m.asset_key = a.asset_key and m.market_cap_usd is not null order by taken_at desc limit 1) r on true
        where lower(n.name) = any($1::text[]) or upper(n.ticker) = any($2::text[])
        order by r.cap desc nulls last
        limit $3`,
      [lower, compact, limit],
    );
    return rows.map((r) => ({ address: r.address, name: r.name, ticker: r.ticker, launchedAtMs: ms(r.launched_at), capUsd: num(r.cap), readAtMs: ms(r.at) }));
  }

  /** The stored picks of these subjects. */
  async picks(kind: PickKind, ids: readonly string[]): Promise<ReadonlyMap<string, StoredPick>> {
    if (ids.length === 0) return new Map();
    const { table, key } = PICK_TABLE[kind];
    try {
      const rows = await this.#db.query<{ id: string; address: string | null; outcome: StoredPick['outcome']; decided_at: string; evidence: Record<string, unknown> }>(
        `select ${key} as id, address, outcome, decided_at, evidence from ${table} where ${key} = any($1::text[])`,
        [[...ids]],
      );
      return new Map(rows.map((r) => [r.id, { subjectId: r.id, address: r.address, outcome: r.outcome, decidedAtMs: new Date(r.decided_at).getTime(), evidence: r.evidence }] as const));
    } catch (e) {
      if (missingTable(e)) return new Map();
      throw e;
    }
  }

  /**
   * Write each subject's pick, and a change row for every subject whose coin changed from what was
   * stored (`previous`). Returns how many coins changed.
   */
  async writePicks(kind: PickKind, picks: readonly PickWrite[], previous: ReadonlyMap<string, StoredPick>, mode: 'shadow' | 'live', nowMs: number): Promise<number> {
    if (picks.length === 0) return 0;
    const { table, key } = PICK_TABLE[kind];
    const at = new Date(nowMs).toISOString();
    try {
      await this.#db.query(
        `insert into ${table} (${key}, address, outcome, decided_at, evidence, updated_at)
         select p.id, p.address, p.outcome, p.decided_at, p.evidence, $6
           from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::jsonb[]) as p(id, address, outcome, decided_at, evidence)
         on conflict (${key}) do update
           set address = excluded.address, outcome = excluded.outcome, decided_at = excluded.decided_at,
               evidence = excluded.evidence, updated_at = excluded.updated_at`,
        [picks.map((p) => p.subjectId), picks.map((p) => p.address), picks.map((p) => p.outcome), picks.map((p) => new Date(p.decidedAtMs).toISOString()), picks.map((p) => JSON.stringify(p.evidence)), at],
      );
      const changed = picks.filter((p) => (previous.get(p.subjectId)?.address ?? null) !== p.address);
      if (changed.length > 0) {
        await this.#db.query(
          `insert into internal.coin_pick_change (subject_kind, subject_id, from_address, to_address, outcome, mode, basis, changed_at)
           select $1, c.id, c.from_address, c.to_address, c.outcome, $6, c.basis, $7
             from unnest($2::text[], $3::text[], $4::text[], $5::text[], $8::text[]) as c(id, from_address, to_address, outcome, basis)`,
          [kind, changed.map((p) => p.subjectId), changed.map((p) => previous.get(p.subjectId)?.address ?? null), changed.map((p) => p.address), changed.map((p) => p.outcome), mode, at, changed.map((p) => p.basis)],
        );
      }
      return changed.length;
    } catch (e) {
      if (missingTable(e)) return 0;
      throw e;
    }
  }

  /** The newest applied refit's bars (0113 one_coin_fit), or null. */
  async appliedFit(): Promise<Readonly<Record<string, number>> | null> {
    try {
      const [r] = await this.#db.query<{ bars: Record<string, number> }>(`select bars from internal.one_coin_fit where applied order by fitted_at desc limit 1`);
      return r?.bars ?? null;
    } catch (e) {
      if (missingTable(e)) return null;
      throw e;
    }
  }
}
