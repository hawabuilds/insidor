/**
 * Crypto attention under For You posts (internal.crypto_attention, 0064): which posts are owed a
 * read of their replies and quote posts, and the facts each read found.
 *
 * Its own repo because the rows are measurements kept beside the feed, never read by it: the item
 * repo answers "what may show", and a method there would invite a reader of feed posts to start
 * filtering on these counts before the owner has chosen to.
 *
 * ★ OWN AND OTHERS, INSIDE THE `cashtags` JSONB (no migration, 2026-10-13). Ticker keys are capitals
 * and digits; keys starting `_` are not tickers and carry the split the owner asked for:
 * `_others` and `_own` ({cashtags, addresses, ca}: other accounts' coin talk, and the post author's
 * own replies'), `_postShill` (the post's own text names a coin; null when not read), `_authorKnown`,
 * `_othersFirstAt`, `_cutAt` (responses only before this instant; absent for a live read) and
 * `_readFor` ('live', or 'test' for the one-off re-read of the judge's test posts, which is kept out
 * of the live step's queue and its day's cap). A row without `_others` predates the split: its
 * columns count every response, the author's too. The columns always count every response.
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
  /** The post's own words and its author: what tells a shill and the author's own replies apart. */
  readonly text: string | null;
  readonly authorId: string | null;
  readonly authorHandle: string | null;
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
  /** The split (see the header). Absent on a caller that predates it. */
  readonly others?: CoinTalkRow;
  readonly own?: CoinTalkRow;
  readonly authorKnown?: boolean;
  readonly postShill?: boolean | null;
  readonly othersFirstAt?: Millis | null;
  readonly cutAt?: Millis | null;
  readonly readFor?: 'live' | 'test';
}

export interface CoinTalkRow {
  readonly cashtags: Readonly<Record<string, number>>;
  readonly addresses: number;
  readonly ca: number;
}

/** Only the live step's own reads count toward its queue and its day. */
const LIVE_READ = `coalesce(cashtags->>'_readFor', 'live') = 'live'`;

/** The `cashtags` jsonb: the tickers, then the split under `_` keys. */
function cashtagsJson(row: AttentionRow): string {
  const split = row.others === undefined
    ? {}
    : {
        _others: row.others,
        _own: row.own ?? null,
        _authorKnown: row.authorKnown ?? false,
        _postShill: row.postShill ?? null,
        _othersFirstAt: row.othersFirstAt == null ? null : new Date(row.othersFirstAt).toISOString(),
        ...(row.cutAt == null ? {} : { _cutAt: new Date(row.cutAt).toISOString() }),
        _readFor: row.readFor ?? 'live',
      };
  return JSON.stringify({ ...row.cashtags, ...split });
}

export class PgCryptoAttentionRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Reads recorded since `at` (the day's cap). */
  async readsSince(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string }>(`select count(*)::text as n from internal.crypto_attention where read_at >= $1 and ${LIVE_READ}`, [toTimestamp(at)]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Catch-all posts on `sources`, first seen since `since`, some reading of whose reach is at least
   * `minReach`, owed a first read or (with `rereadBefore`) a second whose first was at or before
   * it. The judged-yes posts first, then newest first. The caller holds each to the exact bar.
   */
  async due(sources: readonly string[], since: Millis, minReach: number, rereadBefore: Millis | null, limit: number): Promise<readonly DueAttention[]> {
    if (limit <= 0 || sources.length === 0) return [];
    const rows = await this.#db.query<{ item_id: string; source: string; source_item_id: string; posted_at: Date | null; reads: number; judged_yes: boolean; body: string | null; handle: string | null; source_author_id: string | null }>(
      `select i.item_id, i.source, i.source_item_id, i.posted_at, c.reads, i.body, au.handle, au.source_author_id,
              coalesce((select j.coinable from internal.post_judgement j where j.item_id = i.item_id
                         order by j.judged_at desc, j.id desc limit 1), false) as judged_yes
         from public.item i
         left join public.author au on au.author_key = i.author_key
         cross join lateral (select count(*)::int as reads, max(read_at) as last_read
                               from internal.crypto_attention a where a.item_id = i.item_id and ${LIVE_READ.replaceAll('cashtags', 'a.cashtags')}) c
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
      text: r.body,
      authorId: r.source_author_id,
      authorHandle: r.handle,
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
        itemId, toTimestamp(readAt), row.repliesRead, row.quotesRead, row.repliesCut, row.quotesCut, cashtagsJson(row),
        row.coinWords, row.caMentions, row.contractAddresses, row.cryptoQuoters, row.cryptoRepliers, toTimestamp(row.firstSignalAt), row.costUsd,
      ],
    );
  }

  /**
   * Posts first seen since `since` whose newest read says shill (the post's own text, or its
   * author's own replies, name a coin) and whose newest post answer is not the shill rule's
   * `promptId` — a re-score filed after it would otherwise hide the AD label again.
   */
  async shillsToRefile(since: Millis, promptId: string, limit: number): Promise<readonly string[]> {
    if (limit <= 0) return [];
    const rows = await this.#db.query<{ item_id: string }>(
      `select r.item_id
         from (select distinct on (a.item_id) a.item_id, a.cashtags
                 from internal.crypto_attention a
                 join public.item i on i.item_id = a.item_id and i.first_seen_at >= $1
                order by a.item_id, a.read_at desc) r
        where r.cashtags ? '_own'
          and ((r.cashtags->>'_postShill') = 'true'
               or coalesce((r.cashtags->'_own'->>'addresses')::int, 0) > 0
               or coalesce((r.cashtags->'_own'->>'ca')::int, 0) > 0
               or coalesce(r.cashtags->'_own'->'cashtags', '{}'::jsonb) <> '{}'::jsonb)
          and coalesce((select pj.prompt_id from internal.post_judgement pj where pj.item_id = r.item_id
                         order by pj.judged_at desc, pj.id desc limit 1), '') <> $2
        limit $3`,
      [toTimestamp(since), promptId, limit],
    );
    return rows.map((r) => r.item_id);
  }
}
