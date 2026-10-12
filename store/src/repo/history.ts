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

export class PgHistoryRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
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
