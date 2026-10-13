/**
 * Crypto attention under For You posts (internal.crypto_attention, 0064): which posts are owed a
 * read of their replies and quote posts, and the facts each read found.
 *
 * Its own repo because the rows are measurements kept beside the feed, never read by it: the item
 * repo answers "what may show", and a method there would invite a reader of feed posts to start
 * filtering on these counts before the owner has chosen to.
 *
 * What breaks if changed carelessly: `due` hands out a post for its first read, and for its second
 * once `rereadAfterMs` has passed since the first — never a third. The day's cap is counted from
 * these rows (`readsSince`), so a read must be recorded the moment it is made or a restart pays
 * for it twice and the cap undercounts.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillis, toTimestamp } from '../rows.ts';

/** A post owed a read: enough to check its reach bar and to address it on its source. */
export interface DueAttention {
  readonly itemId: string;
  readonly source: string;
  readonly sourceItemId: string;
  readonly postedAt: Millis | null;
  /** Reads already recorded: 0 for the first, 1 for the re-read. */
  readonly reads: number;
  /** The post's newest answer to the post question said yes. */
  readonly judgedYes: boolean;
}

/** One read's facts, in the table's terms. */
export interface AttentionRow {
  readonly repliesRead: number;
  readonly quotesRead: number;
  readonly repliesCut: boolean;
  readonly quotesCut: boolean;
  readonly cashtags: Readonly<Record<string, number>>;
  readonly coinWords: number;
  readonly caMentions: number;
  readonly contractAddresses: number;
  readonly cryptoQuoters: number;
  readonly cryptoRepliers: number;
  readonly firstSignalAt: Millis | null;
  readonly costUsd: number;
}

export class PgCryptoAttentionRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Reads recorded since `at` (the day's cap). */
  async readsSince(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string }>('select count(*)::text as n from internal.crypto_attention where read_at >= $1', [toTimestamp(at)]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Catch-all posts on `sources`, first seen since `since`, some reading of whose reach is at least
   * `minReach`, owed a first read or (with `rereadBefore`) a second whose first was at or before
   * it. The judged-yes posts first, then newest first. The caller holds each to the exact bar.
   */
  async due(sources: readonly string[], since: Millis, minReach: number, rereadBefore: Millis | null, limit: number): Promise<readonly DueAttention[]> {
    if (limit <= 0 || sources.length === 0) return [];
    const rows = await this.#db.query<{ item_id: string; source: string; source_item_id: string; posted_at: Date | null; reads: number; judged_yes: boolean }>(
      `select i.item_id, i.source, i.source_item_id, i.posted_at, c.reads,
              coalesce((select j.coinable from internal.post_judgement j where j.item_id = i.item_id
                         order by j.judged_at desc, j.id desc limit 1), false) as judged_yes
         from public.item i
         cross join lateral (select count(*)::int as reads, max(read_at) as last_read
                               from internal.crypto_attention a where a.item_id = i.item_id) c
        where i.origin = 'observed'
          and i.source = any($1::text[])
          and i.first_seen_at >= $2
          and exists (select 1 from internal.item_found_by f where f.item_id = i.item_id)
          and exists (select 1 from public.observation o where o.item_id = i.item_id and o.kind = 'reach' and o.value >= $3)
          and (c.reads = 0 or (c.reads = 1 and $4::timestamptz is not null and c.last_read <= $4))
        order by judged_yes desc, i.first_seen_at desc
        limit $5`,
      [[...sources], toTimestamp(since), minReach, toTimestamp(rereadBefore), limit],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      source: r.source,
      sourceItemId: r.source_item_id,
      postedAt: toMillis(r.posted_at),
      reads: Number(r.reads),
      judgedYes: r.judged_yes,
    }));
  }

  async record(itemId: string, readAt: Millis, row: AttentionRow): Promise<void> {
    await this.#db.query(
      `insert into internal.crypto_attention
         (item_id, read_at, replies_read, quotes_read, replies_cut, quotes_cut, cashtags, coin_words, ca_mentions,
          contract_addresses, crypto_quoters, crypto_repliers, first_signal_at, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14)
       on conflict (item_id, read_at) do nothing`,
      [
        itemId, toTimestamp(readAt), row.repliesRead, row.quotesRead, row.repliesCut, row.quotesCut, JSON.stringify(row.cashtags),
        row.coinWords, row.caMentions, row.contractAddresses, row.cryptoQuoters, row.cryptoRepliers, toTimestamp(row.firstSignalAt), row.costUsd,
      ],
    );
  }
}
