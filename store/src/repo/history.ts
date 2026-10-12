/**
 * Past narratives and their coins (0038): written by the history pilot, read by Search.
 *
 * Separate from the story repo because a past narrative is not a story — it was never on the
 * board and has no observed posts — and a writer that could put one into public.story could put
 * one on a live surface.
 *
 * What breaks if changed carelessly: a narrative and its coins are written together, coins
 * replaced wholesale, so regrouping a narrative never leaves a coin pointing at the old grouping.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

export type HistoryGap = 'not_searched_yet' | 'origin_not_found' | 'possibly_deleted' | 'tiktok_not_searchable';

export interface HistoryOriginPost {
  readonly authorLabel: string;
  readonly permalink: string | null;
  readonly postedAt: Millis | null;
  /** Posted after the first coin: shown as "went viral after launch", never as the origin. */
  readonly afterLaunch: boolean;
}

export interface PastNarrative {
  readonly narrativeId: string;
  readonly title: string;
  /** Exactly one of these two is set. */
  readonly originPost: HistoryOriginPost | null;
  readonly originGap: HistoryGap | null;
  readonly firstCoin: string;
  readonly firstCoinAt: Millis | null;
  readonly biggestCoin: string;
  readonly peakMarketCapUsd: number | null;
  readonly coins: readonly string[];
}

export type SpendStep = 'picture' | 'confirm' | 'creator_post' | 'search' | 'judge';

export interface SpendRow {
  readonly narrativeId: string | null;
  readonly supplier: string;
  readonly step: SpendStep;
  readonly usd: number;
}

/** A past narrative whose origin has not been searched yet, with its coins' addresses. */
export interface PendingNarrative {
  readonly narrativeId: string;
  readonly title: string;
  readonly coins: readonly string[];
}

export class PgHistoryRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** What the pilot has spent, in total, across every run. */
  async spent(): Promise<number> {
    const rows = await this.#db.query<{ usd: string | number | null }>(`select coalesce(sum(usd), 0) as usd from internal.history_spend`, []);
    return Number(rows[0]?.usd ?? 0);
  }

  async recordSpend(row: SpendRow, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.history_spend (narrative_id, supplier, step, usd, at) values ($1, $2, $3, $4, $5)`,
      [row.narrativeId, row.supplier, row.step, row.usd, toTimestamp(at)],
    );
  }

  /** Which of these coins are already in a past narrative: the grouping is done for them. */
  async grouped(addresses: readonly string[]): Promise<ReadonlySet<string>> {
    if (addresses.length === 0) return new Set();
    const rows = await this.#db.query<{ address: string }>(`select address from public.history_coin where address = any($1::text[])`, [[...addresses]]);
    return new Set(rows.map((r) => r.address));
  }

  /** Narratives whose origin is still to be searched — the pilot's remaining work. */
  async pending(): Promise<readonly PendingNarrative[]> {
    const rows = await this.#db.query<{ narrative_id: string; title: string; coins: string[] }>(
      `select h.narrative_id, h.title, array_agg(c.address order by c.address) as coins
         from public.history_narrative h
         join public.history_coin c on c.narrative_id = h.narrative_id
        where h.origin_gap = 'not_searched_yet'
        group by h.narrative_id, h.title`,
      [],
    );
    return rows.map((r) => ({ narrativeId: r.narrative_id, title: r.title, coins: r.coins }));
  }

  async save(n: PastNarrative, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into public.history_narrative
         (narrative_id, title, origin_post, origin_gap, first_coin, first_coin_at, biggest_coin, peak_market_cap_usd, built_at)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
       on conflict (narrative_id) do update set
         title = excluded.title, origin_post = excluded.origin_post, origin_gap = excluded.origin_gap,
         first_coin = excluded.first_coin, first_coin_at = excluded.first_coin_at, biggest_coin = excluded.biggest_coin,
         peak_market_cap_usd = greatest(public.history_narrative.peak_market_cap_usd, excluded.peak_market_cap_usd),
         built_at = excluded.built_at`,
      [n.narrativeId, n.title, n.originPost === null ? null : JSON.stringify(n.originPost), n.originGap, n.firstCoin,
        n.firstCoinAt === null ? null : toTimestamp(n.firstCoinAt), n.biggestCoin, n.peakMarketCapUsd, toTimestamp(at)],
    );
    await this.#db.query(`delete from public.history_coin where narrative_id = $1 and address <> all($2::text[])`, [n.narrativeId, [...n.coins]]);
    await this.#db.query(
      `insert into public.history_coin (address, narrative_id) select unnest($1::text[]), $2
       on conflict (address) do update set narrative_id = excluded.narrative_id`,
      [[...n.coins], n.narrativeId],
    );
  }
}
