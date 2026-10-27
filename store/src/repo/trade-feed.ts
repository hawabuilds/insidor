/**
 * THE TRADE FEED'S TABLES (0112, 0114): what chainwatch's trade watcher reads and writes — the
 * watch list with each coin's coverage, the per-minute trade buckets and running state, the
 * creator's opening buy on the coin's row, and the day's counted cost.
 *
 * Separate from one-coin.ts, which READS these for the rule, because this is the only writer and
 * its writes have one shape: the watcher holds each coin's whole record in memory since its
 * subscription was confirmed, so a minute row or a state row is written whole (replacing what the
 * previous flush wrote), never incremented. Two writers would make that a lost update; the
 * chainwatch singleton lock is what makes it safe.
 *
 * ★ COVERAGE ONLY MOVES ONE WAY. measured_from is set once; unmeasured_from and its reason are set
 * once and never cleared (an undercount does not become a measurement by waiting); data_bytes only
 * grows; measured_to only moves forward and never past unmeasured_from.
 *
 * What breaks if changed carelessly: `markRestarted`. A coin the previous process was measuring
 * missed every trade between that process's last flush and this one's subscription; it is marked
 * not measured from its last heartbeat. Skipping it would let a fresh subscription's totals stand
 * for the coin's whole life.
 */

import type { Db } from '../client.ts';

export interface WatchedCoin {
  readonly address: string;
  readonly untilMs: number;
  readonly measuredFromMs: number | null;
  readonly unmeasured: boolean;
}

export interface TradeMinuteWrite {
  readonly address: string;
  readonly minuteMs: number;
  readonly buys: number;
  readonly sells: number;
  readonly buyers: number;
  readonly newBuyers: number;
  readonly buySol: number;
  readonly sellSol: number;
  readonly creatorSoldSol: number;
  readonly lastMcapSol: number;
  readonly lastMcapUsd: number | null;
}

export interface TradeStateWrite {
  readonly address: string;
  readonly uniqueBuyers: number;
  readonly peakMcapSol: number;
  readonly lastMcapSol: number;
  readonly creatorSold: boolean;
  readonly firstTradeMs: number;
  readonly lastTradeMs: number;
}

export type UnmeasuredReason = 'coin_cap' | 'day_cap' | 'outage' | 'restart' | 'refused' | 'graduated' | 'no_curve' | 'other_quote' | 'truncated' | 'feed_off';

export interface CoverWrite {
  readonly address: string;
  readonly measuredFromMs: number | null;
  readonly measuredToMs: number | null;
  readonly unmeasured: { readonly fromMs: number; readonly reason: UnmeasuredReason } | null;
  readonly addBytes: number;
}

export interface OpeningWrite {
  readonly address: string;
  readonly creatorBuyTokens: number;
  readonly creatorBuySol: number;
  readonly launchMcapSol: number | null;
}

export interface FeedDay {
  readonly dayMs: number;
  readonly bytes: number;
  readonly rpcCalls: number;
  readonly credits: number;
}

export interface TradeFeedWrite {
  readonly minutes: readonly TradeMinuteWrite[];
  readonly states: readonly TradeStateWrite[];
  readonly cover: readonly CoverWrite[];
  readonly openings: readonly OpeningWrite[];
  readonly day: FeedDay | null;
  readonly nowMs: number;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const dayIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class PgTradeFeedRepo {
  readonly #db: Db;
  readonly #chain: string;

  constructor(db: Db, chain: string) {
    this.#db = db;
    this.#chain = chain;
  }

  /**
   * The coins whose watch has not ended. A watch with no end runs `defaultWatchMs` from the coin's
   * launch (0112's "reader's default"), or from when it was listed when the launch is unknown.
   *
   * ★ TWO PARTS, ONE ANSWER (2026-10-27). As one `coalesce(w.until, …) > now` over the join it read
   * every coin in public.asset (202 MB) on each call, a dozen times every two minutes, to return a
   * few hundred: 15% of all the database's disk reads on a disk-bound evening. A watch with an end
   * is now found by 0112's `coin_watch_until_idx` and only those few coins are joined; a watch with
   * no end (none at the time) is the second part, joined as before. The same rows either way:
   * `coalesce(until, x) > now` is `until > now` when until is set and `x > now` when it is not.
   */
  async watchList(nowMs: number, defaultWatchMs: number): Promise<readonly WatchedCoin[]> {
    const rows = await this.#db.query<{ address: string; until_at: string; measured_from: string | null; unmeasured_from: string | null }>(
      `select w.address, w.measured_from, w.unmeasured_from, w.until as until_at
         from internal.coin_watch w
        where w.until > $1 and w.since <= $1
       union all
       select w.address, w.measured_from, w.unmeasured_from,
              coalesce(a.minted_at, w.since) + make_interval(secs => $2::double precision / 1000) as until_at
         from internal.coin_watch w
         left join public.asset a on a.chain = $3 and a.address = w.address
        where w.until is null and w.since <= $1
          and coalesce(a.minted_at, w.since) + make_interval(secs => $2::double precision / 1000) > $1`,
      [iso(nowMs), defaultWatchMs, this.#chain],
    );
    return rows.map((r) => ({ address: r.address, untilMs: new Date(r.until_at).getTime(), measuredFromMs: r.measured_from === null ? null : new Date(r.measured_from).getTime(), unmeasured: r.unmeasured_from !== null }));
  }

  /** Of these coins, those whose row has no opening buy recorded. */
  async missingOpenings(addresses: readonly string[]): Promise<ReadonlySet<string>> {
    if (addresses.length === 0) return new Set();
    const rows = await this.#db.query<{ address: string }>(
      `select address from public.asset where chain = $1 and address = any($2::text[]) and (creator_buy_tokens is null or creator_buy_sol is null)`,
      [this.#chain, [...addresses]],
    );
    return new Set(rows.map((r) => r.address));
  }

  /** The day's counted cost so far; null when the feed has not run today. */
  async day(nowMs: number): Promise<FeedDay | null> {
    const [r] = await this.#db.query<{ day: string; bytes: string; rpc_calls: number; credits: string }>(
      `select day::text as day, bytes::text as bytes, rpc_calls, credits::text as credits from internal.trade_feed_day where day = $1::date`,
      [dayIso(nowMs)],
    );
    return r === undefined ? null : { dayMs: Date.parse(`${r.day}T00:00:00Z`), bytes: Number(r.bytes), rpcCalls: Number(r.rpc_calls), credits: Number(r.credits) };
  }

  /** Coins a previous process was measuring and whose watch runs on: not measured from their last heartbeat. */
  async markRestarted(nowMs: number): Promise<number> {
    const rows = await this.#db.query<{ address: string }>(
      `update internal.coin_watch
          set unmeasured_from = coalesce(measured_to, measured_from), unmeasured_reason = 'restart'
        where measured_from is not null and unmeasured_from is null and (until is null or until > $1)
        returning address`,
      [iso(nowMs)],
    );
    return rows.length;
  }

  async write(w: TradeFeedWrite): Promise<void> {
    if (w.minutes.length > 0) {
      const m = w.minutes;
      await this.#db.query(
        `insert into internal.coin_trade_minute (address, minute, buys, sells, buyers, new_buyers, buy_sol, sell_sol, net_sol, creator_sold_sol, last_mcap_sol, last_mcap_usd)
         select a, mi, b, s, bu, nb, bs, ss, bs - ss, cs, lm, lu
           from unnest($1::text[], $2::timestamptz[], $3::int[], $4::int[], $5::int[], $6::int[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[])
             as t(a, mi, b, s, bu, nb, bs, ss, cs, lm, lu)
         on conflict (address, minute) do update set
           buys = excluded.buys, sells = excluded.sells, buyers = excluded.buyers, new_buyers = excluded.new_buyers,
           buy_sol = excluded.buy_sol, sell_sol = excluded.sell_sol, net_sol = excluded.net_sol,
           creator_sold_sol = excluded.creator_sold_sol, last_mcap_sol = excluded.last_mcap_sol, last_mcap_usd = excluded.last_mcap_usd`,
        [m.map((x) => x.address), m.map((x) => iso(x.minuteMs)), m.map((x) => x.buys), m.map((x) => x.sells), m.map((x) => x.buyers), m.map((x) => x.newBuyers), m.map((x) => x.buySol), m.map((x) => x.sellSol), m.map((x) => x.creatorSoldSol), m.map((x) => x.lastMcapSol), m.map((x) => x.lastMcapUsd)],
      );
    }
    if (w.states.length > 0) {
      const s = w.states;
      await this.#db.query(
        `insert into internal.coin_trade_state (address, unique_buyers, peak_mcap_sol, last_mcap_sol, creator_sold, first_trade_at, last_trade_at, updated_at)
         select a, ub, pk, lm, cs, ft, lt, $8
           from unnest($1::text[], $2::int[], $3::numeric[], $4::numeric[], $5::boolean[], $6::timestamptz[], $7::timestamptz[]) as t(a, ub, pk, lm, cs, ft, lt)
         on conflict (address) do update set
           unique_buyers = excluded.unique_buyers, peak_mcap_sol = excluded.peak_mcap_sol, last_mcap_sol = excluded.last_mcap_sol,
           creator_sold = excluded.creator_sold, first_trade_at = excluded.first_trade_at, last_trade_at = excluded.last_trade_at, updated_at = excluded.updated_at`,
        [s.map((x) => x.address), s.map((x) => x.uniqueBuyers), s.map((x) => x.peakMcapSol), s.map((x) => x.lastMcapSol), s.map((x) => x.creatorSold), s.map((x) => iso(x.firstTradeMs)), s.map((x) => iso(x.lastTradeMs)), iso(w.nowMs)],
      );
    }
    if (w.cover.length > 0) {
      const c = w.cover;
      await this.#db.query(
        `update internal.coin_watch w set
           measured_from     = coalesce(w.measured_from, t.mf),
           unmeasured_from   = coalesce(w.unmeasured_from, t.uf),
           unmeasured_reason = case when w.unmeasured_from is null then t.ur else w.unmeasured_reason end,
           measured_to       = case
                                 when coalesce(w.measured_from, t.mf) is null or t.mt is null then w.measured_to
                                 else greatest(coalesce(w.measured_to, w.measured_from, t.mf), least(t.mt, coalesce(w.unmeasured_from, t.uf, t.mt)))
                               end,
           data_bytes        = w.data_bytes + t.ab
         from unnest($1::text[], $2::timestamptz[], $3::timestamptz[], $4::timestamptz[], $5::text[], $6::bigint[]) as t(a, mf, mt, uf, ur, ab)
        where w.address = t.a`,
        [c.map((x) => x.address), c.map((x) => iso(x.measuredFromMs)), c.map((x) => iso(x.measuredToMs)), c.map((x) => iso(x.unmeasured?.fromMs ?? null)), c.map((x) => x.unmeasured?.reason ?? null), c.map((x) => Math.round(x.addBytes))],
      );
    }
    if (w.openings.length > 0) {
      const o = w.openings;
      await this.#db.query(
        `update public.asset a set
           creator_buy_tokens = coalesce(a.creator_buy_tokens, r.tokens),
           creator_buy_sol    = coalesce(a.creator_buy_sol, r.sol),
           launch_mcap_sol    = coalesce(a.launch_mcap_sol, r.mcap)
         from unnest($2::text[], $3::numeric[], $4::numeric[], $5::numeric[]) as r(address, tokens, sol, mcap)
        where a.chain = $1 and a.address = r.address`,
        [this.#chain, o.map((x) => x.address), o.map((x) => x.creatorBuyTokens), o.map((x) => x.creatorBuySol), o.map((x) => x.launchMcapSol)],
      );
    }
    if (w.day !== null) {
      await this.#db.query(
        `insert into internal.trade_feed_day (day, bytes, rpc_calls, credits, updated_at) values ($1::date, $2, $3, $4, $5)
         on conflict (day) do update set bytes = greatest(internal.trade_feed_day.bytes, excluded.bytes), rpc_calls = greatest(internal.trade_feed_day.rpc_calls, excluded.rpc_calls),
           credits = greatest(internal.trade_feed_day.credits, excluded.credits), updated_at = excluded.updated_at`,
        [dayIso(w.day.dayMs), Math.round(w.day.bytes), w.day.rpcCalls, w.day.credits, iso(w.nowMs)],
      );
    }
  }
}
