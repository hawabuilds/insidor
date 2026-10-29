/**
 * A LAUNCHPAD COIN'S CAP FROM OUR OWN CANDLES (0144), for the one-coin pick: each coin's newest
 * one-minute close and its highest close since a moment, in dollars of cap.
 *
 * Its own file, apart from coin-chart.ts, because that repo is chainwatch's writer and the read
 * service's chart; this is one narrow read the runner makes once a minute over its open candidates.
 *
 * ★ A LAUNCHPAD COIN ONLY. A candle's price is per coin; the cap is that price times the supply, and
 * only a launchpad coin's supply is known (1e9: services/read trade-card.ts). Coins off the curve read
 * as millions of billions this way (22-29 Oct: 14 of 1,543 charted candidates over $100M), so the
 * caller passes launchpad addresses alone and this file multiplies by that supply and nothing else.
 *
 * What breaks if changed carelessly: the close, not the high. The rug test compares the newest cap
 * with the peak; a peak taken from one-minute highs is a wick a single buy can print, and every coin
 * would read as fallen from it.
 */

import type { Db } from '../client.ts';

/** A launchpad coin's supply: 1e9 coins (services/read trade-card.ts `LAUNCHPAD_SUPPLY`). */
const LAUNCHPAD_SUPPLY = 1e9;

export interface CandleCap {
  /** The newest closed minute's close, as a cap in dollars. */
  readonly capUsd: number;
  /** The highest close since the asked moment, as a cap in dollars. */
  readonly peakCapUsd: number;
  /** The newest candle's minute. */
  readonly atMs: number;
}

export class PgCandleCapRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Each of these coins we chart with a candle since `sinceMs`: its newest close and its highest. A coin without one is absent. */
  async caps(addresses: readonly string[], sinceMs: number): Promise<ReadonlyMap<string, CandleCap>> {
    if (addresses.length === 0) return new Map();
    const rows = await this.#db.query<{ address: string; c: number; peak: number; at: number | string }>(
      `select cc.address, last.c, top.peak, extract(epoch from last.bucket)::float8 * 1000 as at
         from internal.chart_coin cc
         cross join lateral (select k.c, k.bucket from internal.coin_candle_1m k where k.coin_id = cc.id and k.bucket >= $2 order by k.bucket desc limit 1) last
         cross join lateral (select max(k.c) as peak from internal.coin_candle_1m k where k.coin_id = cc.id and k.bucket >= $2) top
        where cc.address = any($1::text[])`,
      [[...new Set(addresses)], new Date(sinceMs).toISOString()],
    );
    return new Map(rows.map((r) => [r.address, { capUsd: Number(r.c) * LAUNCHPAD_SUPPLY, peakCapUsd: Number(r.peak) * LAUNCHPAD_SUPPLY, atMs: Number(r.at) }] as const));
  }
}
