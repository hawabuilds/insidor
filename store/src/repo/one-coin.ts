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
 * ★ MEASURED IS 0114's WORD, NOT "WATCHED". A coin counts as a measured nothing ('quiet') only once
 * chainwatch confirmed its subscription and while no cap, outage or restart ended it; a coin it
 * stopped measuring has no trade facts at all, so the rule reads it as unknown.
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
  /** The posts those linked posts quote or re-share (one hop), each with the linked post that does. */
  readonly linksThrough: readonly { readonly itemId: string; readonly via: string }[];
}

export interface RecentPost {
  readonly itemId: string;
  readonly postedAtMs: number;
  readonly judgeNames: readonly string[];
  readonly guessNames: readonly string[];
  readonly hash: string | null;
  /** The post's own words (public.item body): a short ticker ties only alongside them. */
  readonly text: string | null;
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
  /** The newest reading's pool liquidity; null when the reading had none (a coin on its curve) or there is no reading. */
  readonly liquidityUsd: number | null;
  /** The coin's promotion (`PROMO_OF`): its description and the post its link names; null when none is on file. */
  readonly promo?: string | null;
}

export interface PriorCoinRow extends ExistingCoinRow {
  /** The newest reading's pool liquidity; null when the reading had none (a coin on its curve) or there is no reading. */
  readonly liquidityUsd: number | null;
}

/**
 * A coin's promotion, read after the pool is cut to its limit: its metadata description and the post its
 * social link or website names (by the post's primary key — a link we hold no post for adds nothing).
 * Core's `guessBacked` compares it with the post a guess named the coin for (the owner, 2026-10-28).
 */
const PROMO_OF = (alias: string): string => `
  left join lateral (
    select nullif(concat_ws(' ', md.description,
             (select i.body from public.item i
               where i.item_id = 'x:' || coalesce(substring(md.social_link from '/status/([0-9]+)'), substring(md.website from '/status/([0-9]+)'))
               limit 1)), '') as promo
      from internal.coin_metadata md
     where md.asset_key = ${alias}.asset_key
     limit 1) pr on true`;

const ms = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string).getTime());
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const hex = (v: unknown): string | null => (v === null || v === undefined ? null : fromBits(v as string));
export interface MarketFact { readonly capUsd: number; readonly peakCapUsd: number; readonly readAtMs: number; readonly liquidityUsd: number | null }
export interface LastHour { readonly volume1hUsd: number; readonly trades1h: number; readonly capUsd: number | null }

/* One coin's row of each lookup, read the same whether it came alone or in `coinFacts`. */
const marketFactOf = (r: { cap: unknown; liq: unknown; peak: unknown; at: unknown }): MarketFact => ({ capUsd: Number(r.cap), peakCapUsd: Number(r.peak), readAtMs: new Date(r.at as string).getTime(), liquidityUsd: num(r.liq) });
const lastHourOf = (r: Record<string, unknown>): LastHour | null => {
  const v = num(r['v']);
  const b = num(r['b']);
  const s = num(r['s']);
  return v !== null && b !== null && s !== null && Number.isFinite(v + b + s) ? { volume1hUsd: v, trades1h: b + s, capUsd: num(r['cap']) } : null;
};
const truthy = (v: string | null): boolean => v !== null && (v === 'true' || v === 't' || (/^[0-9.eE+-]+$/.test(v) && Number(v) > 0));
const tradeRollupOf = (r: { net: string | null; new_buyers: string | null; last_usd: string | null; last_cap: string | null; peak_minutes: string | null; creator_minutes: string | null; unique_buyers: string | null; peak: string | null; state_cap: string | null; creator_flag: string | null }): TradeRollup => {
  const peak = [num(r.peak), num(r.peak_minutes)].filter((x): x is number => x !== null);
  return {
    uniqueBuyers: num(r.unique_buyers) ?? num(r.new_buyers) ?? 0,
    netBuy: num(r.net) ?? 0,
    capUsd: num(r.last_usd),
    cap: num(r.state_cap) ?? num(r.last_cap),
    peakCap: peak.length === 0 ? null : Math.max(...peak),
    creatorSold: truthy(r.creator_flag) || truthy(r.creator_minutes),
  };
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

interface PostRow {
  item_id: string;
  posted_at: string;
  proposed_name: string | null;
  alternate_names: unknown;
  guesses: unknown;
  bits: string | null;
  body: string | null;
}

/** A post's namer guesses and picture hash, read beside its judgement; `hashParam` holds the hash version. */
const postExtras = (hashParam: string): string => `(select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb)
                 from internal.name_guess g, lateral (values (g.name), (g.ticker)) as v(x) where g.item_id = i.item_id) as guesses,
              (select h.bits::text from internal.image_embedding e
                 join internal.image_hash h on h.uri = e.uri and h.version = ${hashParam} and h.bits is not null
                where e.subject_kind = 'item' and e.subject_id = i.item_id limit 1) as bits`;

const postOf = (r: PostRow): RecentPost => ({
  itemId: r.item_id,
  postedAtMs: new Date(r.posted_at).getTime(),
  judgeNames: [...(r.proposed_name === null || r.proposed_name.trim() === '' ? [] : [r.proposed_name]), ...strings(r.alternate_names)],
  guessNames: strings(r.guesses),
  hash: hex(r.bits),
  text: r.body,
});

export type PickKind = 'post' | 'narrative';
const PICK_TABLE: Readonly<Record<PickKind, { readonly table: string; readonly key: string }>> = {
  post: { table: 'internal.post_coin_pick', key: 'item_id' },
  narrative: { table: 'internal.narrative_coin_pick', key: 'narrative_id' },
};

/**
 * How far back each catch-up read of the candidate mirror reaches behind the newest `updated_at` it
 * holds. `updated_at` is stamped from the writer's clock, not the database's, so a row written a
 * moment after the last read can carry an instant just behind it; the overlap re-reads those few
 * rows rather than missing one for the life of the process. The one writer is the runner's own
 * one-coin step, in the same process and before its reads, so two minutes is wide; every row the
 * overlap covers crosses the wire again on each read, so it is not made wider than it needs to be.
 */
const MIRROR_OVERLAP_MS = 2 * 60_000;

/**
 * A post none of whose candidates was written for this long leaves the mirror (it is set aside as
 * `pruned`): the table only grows, and the open set is the last hour's (Policy.oneCoin.watchMs).
 * A pruned post asked about by `candidatesOf` is read from the table; one that gets a new candidate
 * is read whole again and held as before.
 */
const MIRROR_KEEP_MS = 24 * 3_600_000;
const MIRROR_PRUNE_EVERY_MS = 10 * 60_000;
/**
 * ★ A POST ASKED ABOUT STAYS HELD, HOWEVER OLD. The sweeps (held and waiting picks, a narrative's
 * older members) ask `candidatesOf` for posts days old on every pass; read from the table each
 * time, evidence and all, that was ~4,700 rows every ten seconds and on 29 Oct 2026 the second
 * largest share of the database's egress. A pruned post asked about is read once and held again
 * (a later write reaches it through the catch-up read, as for any held post), and it is pruned
 * only once it has been neither written for `MIRROR_KEEP_MS` nor asked about for this long.
 */
const MIRROR_KEEP_ASKED_MS = 3_600_000;

type CandidateDbRow = { item_id: string; address: string; path: 'launch' | 'existing'; evidence: Record<string, unknown>; launched_at: string | null; found_at: string };
/** The mirror's state: the held posts' candidates by post then coin, each post's newest `updated_at`, and the newest read (epoch ms). */
interface CandidateMirror {
  readonly byItem: Map<string, Map<string, CandidateRow>>;
  readonly itemNewestMs: Map<string, number>;
  /** Posts set aside by the prune: not held, read from the table when asked about. */
  readonly pruned: Set<string>;
  /** When each post was last asked about by `candidatesOf`, on the table's clock (`newestMs`): see MIRROR_KEEP_ASKED_MS. */
  readonly askedMs: Map<string, number>;
  /** Every post whose candidates were all written before this is pruned; `openCandidates` asked for older falls back to the table. */
  prunedBelowMs: number | null;
  prunedAt: number | null;
  newestMs: number | null;
}
const toCandidate = (r: CandidateDbRow): CandidateRow => ({ itemId: r.item_id, address: r.address, path: r.path, evidence: r.evidence, launchedAtMs: ms(r.launched_at), foundAtMs: new Date(r.found_at).getTime() });

/** A stored pick's digest: every field `picks` returns, so the same digest is the same answer. */
const PICK_DIGEST = `md5(coalesce(address, '') || '|' || outcome || '|' || decided_at::text || '|' || evidence::text)`;
/** Past this many picks held a kind, `picks` starts over (each holds its evidence, ~1–5 KB). */
const HELD_PICKS_MAX = 20_000;

/** Past this many coins `watched` holds, it starts over: a coin leaves the sweeps when its watch ends. */
const HELD_WATCH_MAX = 50_000;

export class PgOneCoinRepo {
  readonly #db: Db;
  /**
   * ★ THE CANDIDATE MIRROR (opt-in, the runner's one long-lived repo): every row of
   * internal.one_coin_candidate held in the process, by post then coin, brought up to date by
   * `updated_at` before each read. The one-coin step asks for every open post's candidates and every
   * narrative member's, evidence and all, every thirty seconds — ~7k rows a read, twice a pass, and
   * nearly all of them unchanged. 0113 never deletes a candidate and every write stamps
   * `updated_at`, so a catch-up read of the rows stamped since the last one (less the overlap) holds
   * exactly what a full read would. Null: not mirrored, every read goes to the table as before.
   */
  readonly #mirror: CandidateMirror | null;
  /** The waiting sweep's evidence by post, with the row version it was read at: see `waitingPostPicks`. */
  readonly #waitingEvidence = new Map<string, { readonly v: string; readonly evidence: Record<string, unknown> }>();
  /** The same for `heldPostPicks`. */
  readonly #heldEvidence = new Map<string, { readonly v: string; readonly evidence: Record<string, unknown> }>();
  /** `picks`' rows by subject with the digest each was read at: see `picks`. */
  readonly #heldPicks: Record<PickKind, Map<string, { readonly v: string; readonly pick: StoredPick }>> = { post: new Map(), narrative: new Map() };
  /**
   * `watched`'s last answer by coin. The sweeps ask about the same ~2,500 coins ~11,000 times a day
   * (~1.5 GB a day of database egress when each read sent every watched coin back), and almost every
   * answer is the one before.
   */
  readonly #watchedHeld = new Map<string, boolean>();

  constructor(db: Db, opts: { readonly mirrorCandidates?: boolean } = {}) {
    this.#db = db;
    this.#mirror = opts.mirrorCandidates === true ? { byItem: new Map(), itemNewestMs: new Map(), pruned: new Set(), askedMs: new Map(), prunedBelowMs: null, prunedAt: null, newestMs: null } : null;
  }

  /** Brings the mirror up to date; false when 0113 is not applied (every read then answers nothing). */
  async #syncMirror(mirror: CandidateMirror): Promise<boolean> {
    let rows: (CandidateDbRow & { u: number })[];
    try {
      rows = await this.#db.query<CandidateDbRow & { u: number }>(
        `select item_id, address, path, evidence, launched_at, found_at, extract(epoch from updated_at)::float8 * 1000 as u
           from internal.one_coin_candidate
          where $1::float8 is null or updated_at >= to_timestamp($1::float8 / 1000)`,
        [mirror.newestMs === null ? null : mirror.newestMs - MIRROR_OVERLAP_MS],
      );
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
    const revived = new Set<string>();
    for (const r of rows) {
      const u = Number(r.u);
      if (mirror.newestMs === null || u > mirror.newestMs) mirror.newestMs = u;
      mirror.itemNewestMs.set(r.item_id, Math.max(u, mirror.itemNewestMs.get(r.item_id) ?? u));
      /* A pruned post written again: its older candidates are not held, so it is read whole below. */
      if (mirror.pruned.has(r.item_id)) {
        revived.add(r.item_id);
        continue;
      }
      const coins = mirror.byItem.get(r.item_id) ?? new Map<string, CandidateRow>();
      coins.set(r.address, toCandidate(r));
      mirror.byItem.set(r.item_id, coins);
    }
    if (revived.size > 0) {
      const whole = await this.#db.query<CandidateDbRow & { u: number }>(
        `select item_id, address, path, evidence, launched_at, found_at, extract(epoch from updated_at)::float8 * 1000 as u
           from internal.one_coin_candidate where item_id = any($1::text[])`,
        [[...revived]],
      );
      for (const id of revived) {
        mirror.pruned.delete(id);
        mirror.byItem.set(id, new Map());
      }
      for (const r of whole) {
        mirror.byItem.get(r.item_id)?.set(r.address, toCandidate(r));
        mirror.itemNewestMs.set(r.item_id, Math.max(Number(r.u), mirror.itemNewestMs.get(r.item_id) ?? 0));
      }
    }
    /* Measured on the table's own clock (the newest `updated_at` read), never this process's. */
    const now = mirror.newestMs;
    if (now !== null && (mirror.prunedAt === null || now - mirror.prunedAt >= MIRROR_PRUNE_EVERY_MS)) {
      mirror.prunedAt = now;
      const below = now - MIRROR_KEEP_MS;
      for (const [id, newest] of mirror.itemNewestMs) {
        if (newest >= below || (mirror.askedMs.get(id) ?? -Infinity) >= now - MIRROR_KEEP_ASKED_MS) continue;
        mirror.askedMs.delete(id);
        mirror.byItem.delete(id);
        mirror.itemNewestMs.delete(id);
        mirror.pruned.add(id);
      }
      mirror.prunedBelowMs = below;
    }
    return true;
  }

  /**
   * Launches that arrived since `sinceMs` (the live stream's and the backfill's), newest first, with
   * their metadata's name, ticker and picture, the picture's hash when hashed, the posts their
   * metadata names, and the posts those quote or re-share (one hop: a coin's own account quoting
   * the viral post is the usual link). The launch time is the coin's own, else when we first saw it.
   */
  async recentLaunches(sinceMs: number, limit: number, hashVersion: string): Promise<readonly RecentLaunch[]> {
    return this.#launches(`a.origin in ('live_stream', 'backfill') and a.first_seen_at >= $1`, [new Date(sinceMs).toISOString()], limit, hashVersion);
  }

  /**
   * ★ THE COIN-FIRST ROUTE'S LAUNCHES (Policy.rising.coinFirst, 0116): every observed coin first seen
   * since `sinceMs` whose own link ties a post the route recorded — the post itself, or a post whose
   * `reproduction_of` is it. `recentLaunches` looks at a launch for `rematchMs` only, and a coin-first
   * post is judged after its coin starts running, minutes later: without these, its coin and its
   * rivals would never become its candidates. Empty before 0116.
   *
   * ★ AND THE COINS OF THE POINTER IT WALKED FROM (0118). The route takes the original a coin's linked
   * post points at, which may be hops away (a link by URL, a re-uploaded video, a quote of a quote):
   * every coin linking that pointer is returned with the original in `linksThrough`, through the
   * pointer, so the pick is made for the post For You shows. Before 0118, as before.
   */
  async coinFirstLaunches(sinceMs: number, limit: number, hashVersion: string): Promise<readonly RecentLaunch[]> {
    const base = `a.origin in ('live_stream', 'backfill') and a.first_seen_at >= $1
         and a.asset_key in (
           select l.asset_key from internal.coin_first_post c
             join internal.coin_post_link l on l.source = split_part(c.item_id, ':', 1) and l.source_item_id = substr(c.item_id, strpos(c.item_id, ':') + 1)
            where c.launched_at >= $1
           union
           select l.asset_key from internal.coin_first_post c
             join public.item i on i.reproduction_of = c.item_id
             join internal.coin_post_link l on l.source = i.source and l.source_item_id = i.source_item_id
            where c.launched_at >= $1`;
    const params = [new Date(sinceMs).toISOString()];
    try {
      return await this.#launches(
        `${base}
           union
           select l.asset_key from internal.coin_first_post c
             join internal.coin_post_link l on l.source = split_part(c.pointer_item_id, ':', 1) and l.source_item_id = substr(c.pointer_item_id, strpos(c.pointer_item_id, ':') + 1)
            where c.launched_at >= $1 and c.role = 'original' and c.pointer_item_id is not null)`,
        params,
        limit,
        hashVersion,
        true,
      );
    } catch (e) {
      if (!missingTable(e)) throw e;
    }
    try {
      return await this.#launches(`${base})`, params, limit, hashVersion);
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /**
   * ★ THE COINS THAT LINK THESE POSTS (2026-10-29, the owner: "fix the matching so we catch runners
   * earlier"). `recentLaunches` looks at a launch for `rematchMs` only, and only against posts the judge
   * has already called coinable; a coin launched within a minute of its post was gone from it before the
   * judge answered (median four minutes), and nothing looked again. Every observed coin we chart (0144:
   * it traded) whose own link names one of `itemIds` — or a quote of one — whatever its age; the
   * matcher's link bounds decide. Charted only: over 22-29 Oct the uncharted ones were 1,000 a week of
   * coins nobody traded, none of which reached the pick's cap bar.
   */
  async launchesLinking(itemIds: readonly string[], limit: number, hashVersion: string): Promise<readonly RecentLaunch[]> {
    if (itemIds.length === 0) return [];
    const where = `a.origin in ('live_stream', 'backfill') and a.asset_key in (
           select l.asset_key from unnest($1::text[]) as x(item_id)
             join internal.coin_post_link l on l.source = split_part(x.item_id, ':', 1) and l.source_item_id = substr(x.item_id, strpos(x.item_id, ':') + 1)
           union
           select l.asset_key from public.item i
             join internal.coin_post_link l on l.source = i.source and l.source_item_id = i.source_item_id
            where i.reproduction_of = any($1::text[]))
         and exists (select 1 from internal.chart_coin cc where cc.address = a.address)`;
    try {
      return await this.#launches(where, [[...new Set(itemIds)]], limit, hashVersion);
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** The launches `where` selects (its parameters first), with everything the matcher reads of each. */
  async #launches(where: string, params: readonly unknown[], limit: number, hashVersion: string, throughPointers = false): Promise<readonly RecentLaunch[]> {
    const limitAt = `$${params.length + 1}`;
    const hashAt = `$${params.length + 2}`;
    /* The originals the coin-first route walked to from a post this coin links (0118), through that post. */
    const pointed = throughPointers
      ? `(select array_agg(distinct c.item_id || ' ' || c.pointer_item_id) from internal.coin_post_link l
                 join internal.coin_first_post c on c.pointer_item_id = l.source || ':' || l.source_item_id and c.role = 'original'
                where l.asset_key = a.asset_key and c.item_id <> c.pointer_item_id)`
      : 'null::text[]';
    const rows = await this.#db.query<{ address: string; asset_key: string; launched_at: string; name: string | null; ticker: string | null; image_uri: string | null; bits: string | null; links: string[] | null; through: string[] | null; pointed: string[] | null }>(
      `select a.address, a.asset_key, coalesce(a.minted_at, a.first_seen_at) as launched_at,
              coalesce(m.name, a.name) as name, coalesce(m.ticker, a.symbol) as ticker,
              coalesce(m.image_uri, a.image_uri) as image_uri, h.bits::text as bits,
              (select array_agg(distinct i.item_id) from internal.coin_post_link l
                 join public.item i on i.source = l.source and i.source_item_id = l.source_item_id
                where l.asset_key = a.asset_key) as links,
              (select array_agg(distinct o.target || ' ' || i.item_id) from internal.coin_post_link l
                 join public.item i on i.source = l.source and i.source_item_id = l.source_item_id
                 cross join lateral (values (i.reproduction_of), (i.rebroadcast_of)) as o(target)
                where l.asset_key = a.asset_key and o.target is not null and o.target <> i.item_id) as through,
              ${pointed} as pointed
         from public.asset a
         left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
         left join internal.image_hash h on h.uri = coalesce(m.image_uri, a.image_uri) and h.version = ${hashAt} and h.bits is not null
        where ${where}
        order by a.first_seen_at desc
        limit ${limitAt}`,
      [...params, limit, hashVersion],
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
      linksThrough: [...new Set([...(r.through ?? []), ...(r.pointed ?? [])])].flatMap((t) => {
        const [itemId, via] = t.split(' ');
        return itemId === undefined || via === undefined ? [] : [{ itemId, via }];
      }),
    }));
  }

  /**
   * The posts a launch could be the coin of: observed posts the judge called coinable, posted since
   * `sinceMs` (read from the judgements of that window, by their time index: a post is judged after
   * it is posted), with the judge's names (its newest answer), the namer's guesses and the hash of the
   * post's embedded picture.
   *
   * ★ THE FIRST QUESTION'S ANSWER, NEVER A KIND ANSWER. A held kind (POLITICS, SPORT…) is filed as a
   * newer "no" row of the kind prompt; read as the post's verdict, it dropped a coinable post and its
   * names out of the matcher. @TocRadio (23 Oct, "YOU MISSED BITCHES") was answered POLITICS two
   * minutes after its yes and never met "You Missed Coin". The kind holds a post off For You; it says
   * nothing about which coin is the post's. 740 posts had a kind row in the three days to 24 Oct.
   */
  async recentPosts(sinceMs: number, limit: number, hashVersion: string): Promise<readonly RecentPost[]> {
    const rows = await this.#db.query<PostRow>(
      `select i.item_id, coalesce(i.posted_at, i.first_seen_at) as posted_at, j.proposed_name, j.alternate_names, i.body, ${postExtras('$3')}
         from (select distinct on (item_id) item_id, proposed_name, alternate_names, coinable
                 from internal.post_judgement where judged_at >= $1 and prompt_id not like 'post-kind%' order by item_id, judged_at desc) j
         join public.item i on i.item_id = j.item_id
        where i.origin = 'observed' and coalesce(i.posted_at, i.first_seen_at) >= $1 and j.coinable is true
        order by coalesce(i.posted_at, i.first_seen_at) desc
        limit $2`,
      [new Date(sinceMs).toISOString(), limit, hashVersion],
    );
    return rows.map(postOf);
  }

  /**
   * These posts by id, whatever their age, on the same terms as `recentPosts` (observed, the newest
   * judgement coinable): the posts a launch's link names that are older than the window.
   */
  async postsByIds(itemIds: readonly string[], hashVersion: string): Promise<readonly RecentPost[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.#db.query<PostRow>(
      `select i.item_id, coalesce(i.posted_at, i.first_seen_at) as posted_at, j.proposed_name, j.alternate_names, i.body, ${postExtras('$2')}
         from (select distinct on (item_id) item_id, proposed_name, alternate_names, coinable
                 from internal.post_judgement where item_id = any($1::text[]) and prompt_id not like 'post-kind%' order by item_id, judged_at desc) j
         join public.item i on i.item_id = j.item_id
        where i.origin = 'observed' and j.coinable is true`,
      [[...new Set(itemIds)], hashVersion],
    );
    return rows.map(postOf);
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
  async upsertCandidates(given: readonly CandidateRow[], nowMs: number): Promise<number> {
    const rows = oneCandidateEach(given);
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
    /* A watch already over (an older coin whose watch window ended before now) has nothing to
       follow; written, it broke 0112's `watch_ends_after_it_starts` and threw the whole pick loop. */
    if (addresses.length === 0 || untilMs <= nowMs) return true;
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
    const mirror = this.#mirror;
    if (mirror !== null && (await this.#syncMirror(mirror)) && (mirror.prunedBelowMs === null || sinceMs >= mirror.prunedBelowMs)) {
      /* The statement below, over the mirror: posts with a candidate found or launched since
         `sinceMs`, newest find among those first, at most `limit`; then all of each one's rows. */
      const newest: { itemId: string; foundMs: number }[] = [];
      for (const [itemId, coins] of mirror.byItem) {
        let found: number | null = null;
        for (const c of coins.values()) {
          if (Math.max(c.foundAtMs, c.launchedAtMs ?? c.foundAtMs) >= sinceMs && (found === null || c.foundAtMs > found)) found = c.foundAtMs;
        }
        if (found !== null) newest.push({ itemId, foundMs: found });
      }
      newest.sort((a, b) => b.foundMs - a.foundMs || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
      return newest.slice(0, limit).flatMap((n) => [...(mirror.byItem.get(n.itemId)?.values() ?? [])]);
    }
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
    const mirror = this.#mirror;
    if (mirror !== null) {
      if (!(await this.#syncMirror(mirror))) return [];
      const ids = [...new Set(itemIds)];
      for (const id of ids) mirror.askedMs.set(id, mirror.newestMs ?? 0);
      const asideIds = ids.filter((id) => mirror.pruned.has(id));
      if (asideIds.length > 0) {
        /* Read once and held again (MIRROR_KEEP_ASKED_MS). */
        const aside = await this.#db.query<CandidateDbRow & { u: number }>(
          `select item_id, address, path, evidence, launched_at, found_at, extract(epoch from updated_at)::float8 * 1000 as u
             from internal.one_coin_candidate where item_id = any($1::text[])`,
          [asideIds],
        );
        for (const r of aside) {
          if (mirror.pruned.delete(r.item_id)) mirror.byItem.set(r.item_id, new Map());
          mirror.byItem.get(r.item_id)?.set(r.address, toCandidate(r));
          mirror.itemNewestMs.set(r.item_id, Math.max(Number(r.u), mirror.itemNewestMs.get(r.item_id) ?? 0));
        }
      }
      return ids.flatMap((id) => [...(mirror.byItem.get(id)?.values() ?? [])]);
    }
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

  /**
   * When the trade feed last vouched for its coins: the newest heartbeat on the watch list (0114's
   * measured_to, moved on every flush while its socket is live, trades or not) or the newest state
   * row. Null: not applied, or never written.
   */
  async tradeFeedAt(): Promise<number | null> {
    try {
      const [r] = await this.#db.query<{ at: string | null }>(`select max(updated_at) as at from internal.coin_trade_state`);
      let heartbeat: number | null = null;
      try {
        const [h] = await this.#db.query<{ at: string | null }>(`select max(measured_to) as at from internal.coin_watch`);
        heartbeat = ms(h?.at ?? null);
      } catch (e) {
        if (!missingTable(e)) throw e;
      }
      const at = [ms(r?.at ?? null), heartbeat].filter((x): x is number => x !== null);
      return at.length === 0 ? null : Math.max(...at);
    } catch (e) {
      if (missingTable(e)) return null;
      throw e;
    }
  }

  /**
   * Which of these coins the trade feed is MEASURING now (0114): watched, its subscription
   * confirmed, and not past a cap, an outage or any other end of measurement. Such a coin with no
   * trade is a measured nothing; every other coin is unknown. Empty before 0114.
   */
  async watched(addresses: readonly string[], nowMs: number): Promise<ReadonlySet<string>> {
    if (addresses.length === 0) return new Set();
    const asked = [...new Set(addresses)];
    const held = this.#watchedHeld;
    try {
      /* ★ Only the coins whose answer is not the one held come back: the held answer goes in with
         the question (null: never asked) and the database returns the rows that differ, so the
         answer is the one a full read gives now, and steady state crosses a few rows, not ~2,500. */
      const rows = await this.#db.query<{ address: string; ok: boolean }>(
        `select a.address, (w.address is not null) as ok
           from unnest($1::text[], $3::boolean[]) as a(address, held)
           left join internal.coin_watch w
             on w.address = a.address and w.since <= $2 and w.measured_from is not null and w.measured_from <= $2 and w.unmeasured_from is null
          where a.held is distinct from (w.address is not null)`,
        [asked, new Date(nowMs).toISOString(), asked.map((a) => held.get(a) ?? null)],
      );
      if (held.size + rows.length > HELD_WATCH_MAX) held.clear();
      for (const r of rows) held.set(r.address, r.ok);
      return new Set(asked.filter((a) => held.get(a) === true));
    } catch (e) {
      if (missingTable(e)) return new Set();
      throw e;
    }
  }

  /** Of these coins, those the trade feed stopped measuring (0114: a cap, an outage, …). Empty before 0114. */
  async unmeasured(addresses: readonly string[]): Promise<ReadonlySet<string>> {
    if (addresses.length === 0) return new Set();
    try {
      const rows = await this.#db.query<{ address: string }>(`select address from internal.coin_watch where address = any($1::text[]) and unmeasured_from is not null`, [[...addresses]]);
      return new Set(rows.map((r) => r.address));
    } catch (e) {
      if (missingTable(e)) return new Set();
      throw e;
    }
  }

  /**
   * Each coin's trading over its life (0112): net buying summed over its minutes, the newest caps,
   * the state's distinct buyers and peak. A coin with no minute and no state is absent, and so is a
   * coin the feed stopped measuring (0114): its totals stop where its measurement did, and summed as
   * if whole they would be an undercount read as a fact. Null: 0112 or 0114 is not applied.
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
          where (mm.n > 0 or s.address is not null)
            and not exists (select 1 from internal.coin_watch w where w.address = a.address and w.unmeasured_from is not null)`,
        [[...addresses]],
      );
      return new Map(rows.map((r) => [r.address, tradeRollupOf(r)] as const));
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

  /**
   * Each coin's newest market cap, that reading's pool liquidity (null: the reading gave none), and
   * its highest cap since `sinceMs` (public.market_reading), measured readings only.
   */
  async marketFacts(addresses: readonly string[], sinceMs: number): Promise<ReadonlyMap<string, { readonly capUsd: number; readonly peakCapUsd: number; readonly readAtMs: number; readonly liquidityUsd: number | null }>> {
    if (addresses.length === 0) return new Map();
    const rows = await this.#db.query<{ address: string; cap: number; liq: number | null; peak: number; at: string }>(
      `select a.address, r.cap, r.liq, r.peak, r.at
         from public.asset a
         join lateral (
           select (array_agg(market_cap_usd order by taken_at desc))[1] as cap, (array_agg(liquidity_usd order by taken_at desc))[1] as liq,
                  max(market_cap_usd) as peak, max(taken_at) as at
             from public.market_reading m
            where m.asset_key = a.asset_key and m.taken_at >= $2 and m.market_cap_usd is not null
         ) r on r.cap is not null
        where a.address = any($1::text[])`,
      [[...addresses], new Date(sinceMs).toISOString()],
    );
    return new Map(rows.map((r) => [r.address, marketFactOf(r)] as const));
  }

  /**
   * ★ `watched`, `marketFacts`, and optionally `tradeFacts` and `lastHours`, for ONE list of coins, in
   * ONE statement (2026-11-07). A pass asked the four separately with the same several thousand
   * addresses, so the list crossed the wire up to four times — ~40% of the runner's database egress.
   * Each part below is its method's own statement over the list sent once, and each row is read by the
   * same function, so every answer is the one the four calls give. The parts run one after another in
   * one statement where the calls ran side by side; copy-tested for time as well as answers. Null
   * trades: 0112 or 0114 is not applied (the whole statement then falls back to the separate calls).
   */
  async coinFacts(addresses: readonly string[], nowMs: number, opts: { readonly marketSinceMs: number; readonly trades: boolean; readonly hoursSinceMs: number | null }): Promise<{
    readonly watched: ReadonlySet<string>;
    readonly market: ReadonlyMap<string, MarketFact>;
    readonly trades: ReadonlyMap<string, TradeRollup> | null;
    readonly hours: ReadonlyMap<string, LastHour> | null;
  }> {
    const asked = [...new Set(addresses)];
    if (asked.length === 0) return { watched: new Set(), market: new Map(), trades: opts.trades ? new Map() : null, hours: opts.hoursSinceMs === null ? null : new Map() };
    const held = this.#watchedHeld;
    let rows: { k: 'w' | 'm' | 't' | 'h'; address: string; d: Record<string, unknown> }[];
    try {
      rows = await this.#db.query(
        `with a as (select * from unnest($1::text[], $2::boolean[]) as a(address, held))
         select 'w' as k, a.address, jsonb_build_object('ok', w.address is not null) as d
           from a left join internal.coin_watch w
             on w.address = a.address and w.since <= $3 and w.measured_from is not null and w.measured_from <= $3 and w.unmeasured_from is null
          where a.held is distinct from (w.address is not null)
         union all
         select 'm', x.address, jsonb_build_object('cap', r.cap, 'liq', r.liq, 'peak', r.peak, 'at', r.at)
           from public.asset x
           join lateral (
             select (array_agg(market_cap_usd order by taken_at desc))[1] as cap, (array_agg(liquidity_usd order by taken_at desc))[1] as liq,
                    max(market_cap_usd) as peak, max(taken_at) as at
               from public.market_reading m
              where m.asset_key = x.asset_key and m.taken_at >= $4 and m.market_cap_usd is not null
           ) r on r.cap is not null
          where x.address in (select address from a)
         union all
         select 't', a.address, jsonb_build_object('net', mm.net, 'new_buyers', mm.new_buyers, 'last_usd', mm.last_usd, 'last_cap', mm.last_cap,
                  'peak_minutes', mm.peak_minutes, 'creator_minutes', mm.creator_minutes, 'unique_buyers', s.unique_buyers::text,
                  'peak', s.peak_mcap_sol::text, 'state_cap', s.last_mcap_sol::text, 'creator_flag', s.creator_sold::text)
           from a
           left join lateral (
             select sum(net_sol)::text as net, sum(new_buyers)::text as new_buyers, max(last_mcap_sol)::text as peak_minutes,
                    sum(creator_sold_sol)::text as creator_minutes,
                    (array_agg(last_mcap_usd order by minute desc) filter (where last_mcap_usd is not null))[1]::text as last_usd,
                    (array_agg(last_mcap_sol order by minute desc) filter (where last_mcap_sol is not null))[1]::text as last_cap,
                    count(*) as n
               from internal.coin_trade_minute m where m.address = a.address) mm on true
           left join internal.coin_trade_state s on s.address = a.address
          where $5::boolean and (mm.n > 0 or s.address is not null)
            and not exists (select 1 from internal.coin_watch w where w.address = a.address and w.unmeasured_from is not null)
         union all
         select 'h', y.address, jsonb_build_object('v', y.v, 'b', y.b, 's', y.s, 'cap', y.cap)
           from (select distinct on (x.address) x.address, m.volume_1h_usd as v, m.buys_1h as b, m.sells_1h as s, m.market_cap_usd as cap
                   from public.asset x join public.market_reading m on m.asset_key = x.asset_key
                  where $6::timestamptz is not null and x.address in (select address from a) and m.taken_at >= $6::timestamptz
                  order by x.address, m.taken_at desc) y`,
        [asked, asked.map((a) => held.get(a) ?? null), new Date(nowMs).toISOString(), new Date(opts.marketSinceMs).toISOString(), opts.trades, opts.hoursSinceMs === null ? null : new Date(opts.hoursSinceMs).toISOString()],
      );
    } catch (e) {
      if (!missingTable(e)) throw e;
      const [watched, market, trades, hours] = await Promise.all([
        this.watched(asked, nowMs),
        this.marketFacts(asked, opts.marketSinceMs),
        opts.trades ? this.tradeFacts(asked) : Promise.resolve(null),
        opts.hoursSinceMs === null ? Promise.resolve(null) : this.lastHours(asked, opts.hoursSinceMs),
      ]);
      return { watched, market, trades, hours };
    }
    const market = new Map<string, MarketFact>();
    const trades = opts.trades ? new Map<string, TradeRollup>() : null;
    const hours = opts.hoursSinceMs === null ? null : new Map<string, LastHour>();
    const watchRows: { address: string; ok: boolean }[] = [];
    for (const r of rows) {
      if (r.k === 'w') watchRows.push({ address: r.address, ok: r.d['ok'] === true });
      else if (r.k === 'm') market.set(r.address, marketFactOf(r.d as never));
      else if (r.k === 't') trades?.set(r.address, tradeRollupOf(r.d as never));
      else {
        const h = lastHourOf(r.d);
        if (h !== null) hours?.set(r.address, h);
      }
    }
    if (held.size + watchRows.length > HELD_WATCH_MAX) held.clear();
    for (const r of watchRows) held.set(r.address, r.ok);
    return { watched: new Set(asked.filter((a) => held.get(a) === true)), market, trades, hours };
  }

  /** Each coin's market readings since `sinceMs`, oldest first, with each reading's pool (the replay's fallback). */
  async readings(addresses: readonly string[], sinceMs: number): Promise<readonly { readonly address: string; readonly atMs: number; readonly capUsd: number; readonly liquidityUsd: number | null }[]> {
    if (addresses.length === 0) return [];
    const rows = await this.#db.query<{ address: string; at: string; cap: number; liq: number | null }>(
      `select a.address, m.taken_at as at, m.market_cap_usd as cap, m.liquidity_usd as liq
         from public.asset a join public.market_reading m on m.asset_key = a.asset_key
        where a.address = any($1::text[]) and m.taken_at >= $2 and m.market_cap_usd is not null
        order by a.address, m.taken_at`,
      [[...addresses], new Date(sinceMs).toISOString()],
    );
    return rows.map((r) => ({ address: r.address, atMs: new Date(r.at).getTime(), capUsd: Number(r.cap), liquidityUsd: num(r.liq) }));
  }

  /**
   * Coins named exactly one of these names (lower-cased name, upper-cased ticker, by public.coin_name's
   * indexes), first seen on pump.fun's bonding curve (venue_id = 'solana:pumpfun'), with their newest
   * market cap: the second path's pool. Core decides which, if any. Coins first seen on PumpSwap or
   * another venue are excluded: they were not launched through the bonding curve and may be scam pools.
   */
  async coinsNamed(names: readonly string[], limit: number): Promise<readonly ExistingCoinRow[]> {
    const lower = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n !== ''))];
    const compact = [...new Set(names.map((n) => n.replace(/[^\p{L}\p{N}]+/gu, '').toUpperCase()).filter((n) => n !== ''))];
    if (lower.length === 0 && compact.length === 0) return [];
    const rows = await this.#db.query<{ address: string; name: string | null; ticker: string | null; launched_at: string | null; cap: number | null; liq: number | null; at: string | null; promo: string | null }>(
      `select x.address, x.name, x.ticker, x.launched_at, x.cap, x.liq, x.at, pr.promo
         from (select n.address, n.name, n.ticker, n.launched_at, r.cap, r.liq, r.at, a.asset_key
                 from public.coin_name n
                 join public.asset a on a.address = n.address
                 left join lateral (select market_cap_usd as cap, liquidity_usd as liq, taken_at as at from public.market_reading m
                                     where m.asset_key = a.asset_key and m.market_cap_usd is not null order by taken_at desc limit 1) r on true
                where (lower(n.name) = any($1::text[]) or upper(n.ticker) = any($2::text[]))
                  and a.venue_id = 'solana:pumpfun'
                order by r.cap desc nulls last
                limit $3) x
         ${PROMO_OF('x')}
        order by x.cap desc nulls last`,
      [lower, compact, limit],
    );
    return rows.map((r) => ({ address: r.address, name: r.name, ticker: r.ticker, launchedAtMs: ms(r.launched_at), capUsd: num(r.cap), liquidityUsd: num(r.liq), readAtMs: ms(r.at), promo: r.promo }));
  }

  /**
   * Coins launched in [`fromMs`, `toMs`) named exactly one of these names, or whose ticker is one of
   * these words (a post's own words: core decides whether the name goes with it), first seen on
   * pump.fun's bonding curve (venue_id = 'solana:pumpfun'), each with its newest market reading and
   * that reading's pool liquidity: the second path's lookback pool. Coins first seen on PumpSwap or
   * another venue are excluded for the same reason as `coinsNamed`.
   */
  async coinsLaunchedBetween(names: readonly string[], words: readonly string[], fromMs: number, toMs: number, limit: number): Promise<readonly PriorCoinRow[]> {
    const lower = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n !== ''))];
    const upper = [...new Set([...names, ...words].map((n) => n.replace(/[^\p{L}\p{N}]+/gu, '').toUpperCase()).filter((n) => n !== ''))];
    if (lower.length === 0 && upper.length === 0) return [];
    const rows = await this.#db.query<{ address: string; name: string | null; ticker: string | null; launched_at: string | null; cap: number | null; liq: number | null; at: string | null; promo: string | null }>(
      `select x.address, x.name, x.ticker, x.launched_at, x.cap, x.liq, x.at, pr.promo
         from (select n.address, n.name, n.ticker, n.launched_at, r.cap, r.liq, r.at, a.asset_key
                 from public.coin_name n
                 join public.asset a on a.address = n.address
                 left join lateral (select market_cap_usd as cap, liquidity_usd as liq, taken_at as at from public.market_reading m
                                     where m.asset_key = a.asset_key and m.market_cap_usd is not null order by taken_at desc limit 1) r on true
                where (lower(n.name) = any($1::text[]) or upper(n.ticker) = any($2::text[]))
                  and a.venue_id = 'solana:pumpfun'
                  and n.launched_at >= $3 and n.launched_at < $4
                order by r.cap desc nulls last
                limit $5) x
         ${PROMO_OF('x')}
        order by x.cap desc nulls last`,
      [lower, upper, new Date(fromMs).toISOString(), new Date(toMs).toISOString(), limit],
    );
    return rows.map((r) => ({ address: r.address, name: r.name, ticker: r.ticker, launchedAtMs: ms(r.launched_at), capUsd: num(r.cap), liquidityUsd: num(r.liq), readAtMs: ms(r.at), promo: r.promo }));
  }

  /**
   * The stored picks of these subjects.
   *
   * ★ WHOLE ROWS ONLY WHERE THEY CHANGED (2026-11-07). Every pass read every open subject's pick,
   * evidence and all (~5 GB a day of the database's transfer), to compare with what it decides — and
   * nearly every row was the one read the pass before. Each row now comes first as a digest of all it
   * holds; a row held here at that digest is answered from memory, and only the rest are read whole.
   */
  async picks(kind: PickKind, ids: readonly string[]): Promise<ReadonlyMap<string, StoredPick>> {
    if (ids.length === 0) return new Map();
    const { table, key } = PICK_TABLE[kind];
    const held = this.#heldPicks[kind];
    try {
      const digests = await this.#db.query<{ id: string; v: string }>(
        `select ${key} as id, ${PICK_DIGEST} as v from ${table} where ${key} = any($1::text[])`,
        [[...ids]],
      );
      const stale = digests.filter((d) => held.get(d.id)?.v !== d.v).map((d) => d.id);
      if (stale.length > 0) {
        const rows = await this.#db.query<{ id: string; v: string; address: string | null; outcome: StoredPick['outcome']; decided_at: string; evidence: Record<string, unknown> }>(
          `select ${key} as id, ${PICK_DIGEST} as v, address, outcome, decided_at, evidence from ${table} where ${key} = any($1::text[])`,
          [stale],
        );
        if (held.size + rows.length > HELD_PICKS_MAX) held.clear();
        for (const r of rows) held.set(r.id, { v: r.v, pick: { subjectId: r.id, address: r.address, outcome: r.outcome, decidedAtMs: new Date(r.decided_at).getTime(), evidence: r.evidence } });
      }
      /* A row changed again between the two reads is answered as read whole: the digest it came with
         is the one held, so the next pass reads it again. One gone between them is left out. */
      return new Map(digests.flatMap((d) => {
        const h = held.get(d.id);
        return h === undefined ? [] : [[d.id, h.pick] as const];
      }));
    } catch (e) {
      if (missingTable(e)) return new Map();
      throw e;
    }
  }

  /**
   * Write each subject's pick, and a change row for every subject whose coin changed from what was
   * stored (`previous`). Returns how many coins changed.
   */
  async writePicks(kind: PickKind, given: readonly PickWrite[], previous: ReadonlyMap<string, StoredPick>, mode: 'shadow' | 'live', nowMs: number): Promise<number> {
    const picks = onePickEach(given);
    if (picks.length === 0) return 0;
    const { table, key } = PICK_TABLE[kind];
    const at = new Date(nowMs).toISOString();
    /* ★ A PICK THE SAME AS THE ONE STORED IS ONLY STAMPED (2026-11-07). Every pass rewrote every
       subject's pick, evidence and all — ~1 MB a call for the narratives, the runner's largest share of
       its database egress once the coin-post check was cut — though most were what `previous` already
       held. Such a pick now sends only its id, to move `updated_at` as the rewrite did (the held sweep
       selects by it); a pick that differs in any field, or whose stored row was not read, is written
       whole. The runner is the only writer of these tables, so `previous`, read this pass, is the row. */
    const unchanged = (p: PickWrite): boolean => {
      const s = previous.get(p.subjectId);
      return s !== undefined && s.address === p.address && s.outcome === p.outcome && s.decidedAtMs === p.decidedAtMs && canonical(s.evidence) === canonical(p.evidence);
    };
    const whole = picks.filter((p) => !unchanged(p));
    const stamped = picks.filter(unchanged).map((p) => p.subjectId);
    try {
      if (whole.length > 0) {
        /* ★ THE ROWS WRITTEN ARE HELD AS WRITTEN (2026-11-07). Most picks' evidence moves every pass (its
           standings carry live caps), so the next pass's reads found a new digest and read back the
           evidence this repo had just sent — ~9 GB a day of the database's transfer. The write returns
           each row's digests, computed by the database from what it stored, and the row is held at
           them: the next read finds it current and reads nothing whole. Held as JSON gives it back
           (a field JSON drops is dropped here too). */
        const stored = await this.#db.query<{ id: string; v: string; ev: string }>(
          `insert into ${table} (${key}, address, outcome, decided_at, evidence, updated_at)
           select p.id, p.address, p.outcome, p.decided_at, p.evidence, $6
             from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::jsonb[]) as p(id, address, outcome, decided_at, evidence)
           on conflict (${key}) do update
             set address = excluded.address, outcome = excluded.outcome, decided_at = excluded.decided_at,
                 evidence = excluded.evidence, updated_at = excluded.updated_at
           returning ${key} as id, ${PICK_DIGEST} as v, md5(evidence::text) as ev`,
          [whole.map((p) => p.subjectId), whole.map((p) => p.address), whole.map((p) => p.outcome), whole.map((p) => new Date(p.decidedAtMs).toISOString()), whole.map((p) => JSON.stringify(p.evidence)), at],
        );
        const written = new Map(whole.map((p) => [p.subjectId, p] as const));
        const held = this.#heldPicks[kind];
        if (held.size + stored.length > HELD_PICKS_MAX) held.clear();
        for (const s of stored) {
          const p = written.get(s.id);
          if (p === undefined) continue;
          const evidence = JSON.parse(JSON.stringify(p.evidence)) as Record<string, unknown>;
          held.set(s.id, { v: s.v, pick: { subjectId: s.id, address: p.address, outcome: p.outcome, decidedAtMs: p.decidedAtMs, evidence } });
          if (kind === 'post') {
            this.#heldEvidence.set(s.id, { v: s.ev, evidence });
            this.#waitingEvidence.set(s.id, { v: s.ev, evidence });
          }
        }
      }
      if (stamped.length > 0) {
        await this.#db.query(`update ${table} set updated_at = $2 where ${key} = any($1::text[])`, [stamped, at]);
      }
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

  /**
   * The posts whose pick holds a coin and was written since `sinceMs` (the runner hand-over's
   * subjects, Policy.runnerLink.handover), most recently written first, at most `limit`.
   */
  async heldPostPicks(sinceMs: number, limit: number): Promise<readonly StoredPick[]> {
    try {
      /* The evidence only for rows changed since this repo last read them: see `waitingPostPicks`. */
      const rows = await this.#db.query<{ id: string; address: string; decided_at: string; v: string }>(
        `select item_id as id, address, decided_at, md5(evidence::text) as v from internal.post_coin_pick
          where outcome = 'picked' and address is not null and updated_at >= $1
          order by updated_at desc limit $2`,
        [new Date(sinceMs).toISOString(), limit],
      );
      const evidence = await this.#evidenceAt(this.#heldEvidence, rows);
      return rows.flatMap((r) => {
        const e = evidence.get(r.id);
        return e === undefined ? [] : [{ subjectId: r.id, address: r.address, outcome: 'picked' as const, decidedAtMs: new Date(r.decided_at).getTime(), evidence: e }];
      });
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /**
   * The posts still waiting for a coin, decided since `sinceMs`, with a candidate whose trades have
   * peaked at `minPeakQuote` or more in the quote token, newest first (the runner's waiting sweep,
   * work/one-coin.ts): a post judged "waiting" in its hour is otherwise never judged again. The peak
   * keeps the sweep to the posts where a coin did trade; most waiting posts have only dust.
   *
   * ★ THE EVIDENCE ONLY WHEN THE ROW CHANGED. The sweep runs every pass over the same ~900 posts,
   * and each pick's evidence is about a kilobyte: ~4 GB a day of the database's egress on 29 Oct
   * 2026, nearly all of it the rows the pass before was sent. The selection now returns each row's
   * evidence digest (`md5(evidence::text)`), and the evidence is read only for the rows this repo does
   * not hold at that digest — the runner's one long-lived repo holds them between passes. A digest,
   * not the row version (`xmin`): every pass stamps each pick's `updated_at`, which moves `xmin`
   * though the evidence is the same, and re-read it all (~7 GB a day, 2026-11-07).
   */
  async waitingPostPicks(sinceMs: number, limit: number, minPeakQuote: number): Promise<readonly StoredPick[]> {
    try {
      const rows = await this.#db.query<{ id: string; decided_at: string; v: string }>(
        `select p.item_id as id, p.decided_at, md5(p.evidence::text) as v from internal.post_coin_pick p
          where p.outcome = 'waiting' and p.decided_at >= $1
            and exists (select 1 from internal.one_coin_candidate oc join internal.coin_trade_state s on s.address = oc.address
                         where oc.item_id = p.item_id and s.peak_mcap_sol >= $3)
          order by p.decided_at desc limit $2`,
        [new Date(sinceMs).toISOString(), limit, minPeakQuote],
      );
      const evidence = await this.#evidenceAt(this.#waitingEvidence, rows);
      return rows.flatMap((r) => {
        const e = evidence.get(r.id);
        return e === undefined ? [] : [{ subjectId: r.id, address: null, outcome: 'waiting' as const, decidedAtMs: new Date(r.decided_at).getTime(), evidence: e }];
      });
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /**
   * Each selected post pick's evidence: from `held` where it was read at the row's version, else read
   * now. `held` keeps only the posts of this selection. A row gone between the two reads (picks are
   * never deleted) has no evidence and is left out by the caller rather than given an invented one.
   */
  async #evidenceAt(held: Map<string, { readonly v: string; readonly evidence: Record<string, unknown> }>, rows: readonly { readonly id: string; readonly v: string }[]): Promise<ReadonlyMap<string, Record<string, unknown>>> {
    const stale = rows.filter((r) => held.get(r.id)?.v !== r.v).map((r) => r.id);
    if (stale.length > 0) {
      const fresh = await this.#db.query<{ id: string; v: string; evidence: Record<string, unknown> }>(
        `select item_id as id, md5(evidence::text) as v, evidence from internal.post_coin_pick where item_id = any($1::text[])`,
        [stale],
      );
      for (const f of fresh) held.set(f.id, { v: f.v, evidence: f.evidence });
    }
    const asked = new Set(rows.map((r) => r.id));
    for (const id of [...held.keys()]) if (!asked.has(id)) held.delete(id);
    return new Map([...held].map(([id, e]) => [id, e.evidence] as const));
  }

  /**
   * Each coin's last hour from its newest market reading since `sinceMs` (0127's volume and trades),
   * with that reading's cap. A newest reading without its hour is absent: unread, never a quiet hour.
   */
  async lastHours(addresses: readonly string[], sinceMs: number): Promise<ReadonlyMap<string, { readonly volume1hUsd: number; readonly trades1h: number; readonly capUsd: number | null }>> {
    if (addresses.length === 0) return new Map();
    const rows = await this.#db.query<{ address: string; v: unknown; b: unknown; s: unknown; cap: unknown }>(
      `select distinct on (a.address) a.address, m.volume_1h_usd as v, m.buys_1h as b, m.sells_1h as s, m.market_cap_usd as cap
         from public.asset a join public.market_reading m on m.asset_key = a.asset_key
        where a.address = any($1::text[]) and m.taken_at >= $2
        order by a.address, m.taken_at desc`,
      [[...new Set(addresses)], new Date(sinceMs).toISOString()],
    );
    const out = new Map<string, LastHour>();
    for (const r of rows) {
      const h = lastHourOf(r);
      if (h !== null) out.set(r.address, h);
    }
    return out;
  }

  /**
   * The coins whose newest market reading is a frozen quote (core match/one-coin.ts `priceFrozen`):
   * no pool, and a last hour the source counted, with no buy and no sell in it. A last hour the source
   * did not report is unknown, never zero, so its coin is not in the set. One indexed newest reading
   * a coin (market_reading_latest_idx); the runner asks it only for the second path's older coins.
   */
  /**
   * Narrative picks held since `sinceMs` whose coin's newest reading is a frozen price (as
   * `frozenPrices` reads it), with their members: the runner's narrative sweep judges these again,
   * since a narrative is otherwise judged only while one of its posts is in its first hour. Only the
   * few matching rows come back, so the evidence is read with them.
   */
  async heldFrozenNarrativePicks(sinceMs: number, limit: number): Promise<readonly { readonly pick: StoredPick; readonly members: readonly string[] }[]> {
    try {
      const rows = await this.#db.query<{ id: string; address: string; decided_at: string; evidence: Record<string, unknown>; members: string[] | null }>(
        `select n.narrative_id as id, n.address, n.decided_at, n.evidence,
                (select array_agg(m.item_id order by m.item_id) from internal.narrative_member m where m.narrative_id = n.narrative_id) as members
           from internal.narrative_coin_pick n
           join public.asset a on a.address = n.address
           join lateral (select m.liquidity_usd, m.buys_1h, m.sells_1h from public.market_reading m
                          where m.asset_key = a.asset_key and m.market_cap_usd is not null order by m.taken_at desc limit 1) r on true
          where n.outcome = 'picked' and n.updated_at >= $1 and r.liquidity_usd is null and r.buys_1h = 0 and r.sells_1h = 0
          order by n.updated_at desc limit $2`,
        [new Date(sinceMs).toISOString(), limit],
      );
      return rows.map((r) => ({ pick: { subjectId: r.id, address: r.address, outcome: 'picked' as const, decidedAtMs: new Date(r.decided_at).getTime(), evidence: r.evidence ?? {} }, members: r.members ?? [] }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  async frozenPrices(addresses: readonly string[]): Promise<ReadonlySet<string>> {
    if (addresses.length === 0) return new Set();
    const rows = await this.#db.query<{ address: string }>(
      `select a.address
         from public.asset a
         join lateral (select m.liquidity_usd, m.buys_1h, m.sells_1h from public.market_reading m
                        where m.asset_key = a.asset_key and m.market_cap_usd is not null order by m.taken_at desc limit 1) r on true
        where a.address = any($1::text[]) and r.liquidity_usd is null and r.buys_1h = 0 and r.sells_1h = 0`,
      [[...new Set(addresses)]],
    );
    return new Set(rows.map((r) => r.address));
  }

  /**
   * For the early pick's push (services/runner work/early-pick.ts): when each post was first on For
   * You (null: never), and whether For You took it by the coin-first route (0116/0117), whose coin
   * always came first. A database before 0117 reads every post as not coin-first.
   */
  async shownOf(itemIds: readonly string[]): Promise<ReadonlyMap<string, { readonly forYouMs: number | null; readonly coinFirst: boolean }>> {
    const out = new Map<string, { forYouMs: number | null; coinFirst: boolean }>();
    if (itemIds.length === 0) return out;
    const ids = [...new Set(itemIds)];
    const shown = await this.#db.query<{ item_id: string; at: string }>(
      `select item_id, min(first_shown_at) as at from public.feed_post where feed_id = 'fyp' and item_id = any($1::text[]) group by item_id`,
      [ids],
    );
    for (const id of ids) out.set(id, { forYouMs: null, coinFirst: false });
    for (const r of shown) out.set(r.item_id, { forYouMs: ms(r.at), coinFirst: false });
    try {
      const cf = await this.#db.query<{ item_id: string }>(`select item_id from internal.coin_first_post where item_id = any($1::text[]) and admitted_at is not null`, [ids]);
      for (const r of cf) out.set(r.item_id, { forYouMs: out.get(r.item_id)?.forYouMs ?? null, coinFirst: true });
    } catch (e) {
      if (!missingTable(e)) throw e;
    }
    return out;
  }

  /** What a push about a post's coin says: the coin's ticker, and the post's words and poster. Null fields when unknown. */
  async pushFacts(itemId: string, address: string): Promise<{ readonly ticker: string | null; readonly excerpt: string | null; readonly handle: string | null; readonly image: string | null }> {
    const [coin] = await this.#db.query<{ symbol: string | null; image_uri: string | null }>(`select symbol, image_uri from public.asset where address = $1 limit 1`, [address]);
    const [post] = await this.#db.query<{ body: string | null; handle: string | null }>(
      `select i.body, au.handle from public.item i left join public.author au on au.author_key = i.author_key where i.item_id = $1`,
      [itemId],
    );
    const text = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const image = text(coin?.image_uri);
    return { ticker: text(coin?.symbol), excerpt: text(post?.body), handle: text(post?.handle), image: image !== null && /^https:\/\/\S+$/.test(image) ? image : null };
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

/**
 * ★ ONE ROW PER KEY IN ONE STATEMENT (2026-11-05: the pick loop threw "ON CONFLICT DO UPDATE command
 * cannot affect row a second time" when a batch named the same row twice, and lost the whole pass).
 * Each keeps what writing the rows one after another would have left in the table, so nothing a
 * batch without repeats writes is different.
 *
 *   candidates (item, coin): the first row is inserted, a later one only replaces its evidence,
 *     so the first path, launch time and found time stay and the last evidence wins.
 *   picks (subject): each write replaces the last, so the last pick wins.
 */
export function oneCandidateEach(rows: readonly CandidateRow[]): CandidateRow[] {
  const byKey = new Map<string, CandidateRow>();
  for (const r of rows) {
    const k = `${r.itemId}\u0000${r.address}`;
    const first = byKey.get(k);
    byKey.set(k, first === undefined ? r : { ...first, evidence: r.evidence });
  }
  return [...byKey.values()];
}

/**
 * A value as jsonb would store it, as one string: keys sorted at every level, and what JSON drops
 * (an undefined field) dropped. Two evidences equal here are the same stored row; a difference this
 * misses only costs a whole write.
 */
export function canonical(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort)
    : x !== null && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]))
    : x;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(v ?? null))));
}

export function onePickEach(picks: readonly PickWrite[]): PickWrite[] {
  const byKey = new Map<string, PickWrite>();
  for (const p of picks) {
    byKey.delete(p.subjectId);
    byKey.set(p.subjectId, p);
  }
  return [...byKey.values()];
}
