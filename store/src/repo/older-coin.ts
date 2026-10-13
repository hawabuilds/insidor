/**
 * Older coins named for a feed post's subject (internal.older_coin, 0060): found by the post's
 * name search, measured by the runner's older-coins step.
 *
 * Separate from the coin universe repo because these coins are not candidates for anything: a
 * coin launched before a post is never its coin, is not added to the universe, and is kept only
 * to say whether its trading jumped after the post. Mixing the two would let a reader of the
 * universe mistake "an older coin of this name" for "a coin that may be this post's".
 *
 * What breaks if changed carelessly: `recordFound` keeps only coins whose market time is before
 * the post beyond the grace (`allowanceMs`, the origin rule's). A coin launched in the grace is
 * one the matching rule may still give the post, and it must never also be called "older".
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillisRequired, toTimestamp } from '../rows.ts';

/** A coin a post's search returned, as the search described it. */
export interface FoundOlderCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: Millis;
}

/** A (post, coin) owed a measurement, with what the step needs to make it. */
export interface DueOlderCoin {
  readonly itemId: string;
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: Millis;
  readonly postedAt: Millis;
  /** The judge's names for the post's subject, its proposed name first. */
  readonly names: readonly string[];
  /** `waiting` when never measured: the step first holds the coin's name against the subject's. */
  readonly outcome: 'waiting' | 'read' | 'unavailable';
}

/** What one measurement found; each number null when it could not be read. */
export interface OlderCoinReading {
  readonly hourBeforeUsd: number | null;
  readonly peakHourUsd: number | null;
  readonly priceAtPostUsd: number | null;
  readonly priceSinceUsd: number | null;
  readonly running: boolean;
}

export class PgOlderCoinRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * A post's search answer: each coin launched before the post beyond `allowanceMs` is noted.
   * A coin seen again keeps its measurement; its name and ticker take the newer answer's.
   */
  async recordFound(itemId: string, coins: readonly FoundOlderCoin[], allowanceMs: number, at: Millis): Promise<number> {
    if (coins.length === 0) return 0;
    const rows = await this.#db.query<{ n: string | number }>(
      `with found as (
         select * from unnest($2::text[], $3::text[], $4::text[], $5::timestamptz[]) as f(address, name, ticker, launched_at)
       ), added as (
         insert into internal.older_coin (item_id, address, name, ticker, launched_at, found_at)
         select $1, f.address, f.name, f.ticker, f.launched_at, $6
           from found f
           join public.item i on i.item_id = $1
          where f.launched_at < coalesce(i.posted_at, i.first_seen_at) - make_interval(secs => $7::double precision / 1000)
         on conflict (item_id, address) do update set
           name = coalesce(excluded.name, internal.older_coin.name),
           ticker = coalesce(excluded.ticker, internal.older_coin.ticker)
         returning 1
       )
       select count(*) as n from added`,
      [itemId, coins.map((c) => c.address), coins.map((c) => c.name), coins.map((c) => c.ticker), coins.map((c) => toTimestamp(c.launchedAt)), toTimestamp(at), allowanceMs],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Pairs owed a measurement, newest post first: never measured; or measured more than
   * `recheckMs` ago while the post is on a feed and no measurement yet covers its whole watch
   * (a check at or after `postedAt + watchMs`). A name that does not fit is never owed again.
   */
  async due(now: Millis, watchMs: number, recheckMs: number, limit: number): Promise<readonly DueOlderCoin[]> {
    const rows = await this.#db.query<{
      item_id: string; address: string; name: string | null; ticker: string | null; launched_at: string | Date;
      posted_at: string | Date; proposed_name: string | null; alternate_names: string[] | null; outcome: 'waiting' | 'read' | 'unavailable';
    }>(
      `select o.item_id, o.address, o.name, o.ticker, o.launched_at, o.outcome,
              coalesce(i.posted_at, i.first_seen_at) as posted_at, j.proposed_name, j.alternate_names
         from internal.older_coin o
         join public.item i on i.item_id = o.item_id
         join lateral (
                select pj.proposed_name, pj.alternate_names from internal.post_judgement pj
                 where pj.item_id = o.item_id order by pj.judged_at desc, pj.id desc limit 1
              ) j on true
        where o.outcome in ('waiting', 'read', 'unavailable')
          and exists (select 1 from public.rising_row r where r.item_id = o.item_id)
          and (o.checked_at is null
               or (o.checked_at < $1::timestamptz - make_interval(secs => $3::double precision / 1000)
                   and o.checked_at < coalesce(i.posted_at, i.first_seen_at) + make_interval(secs => $2::double precision / 1000)))
        order by o.checked_at asc nulls first, coalesce(i.posted_at, i.first_seen_at) desc, o.address
        limit $4`,
      [toTimestamp(now), watchMs, recheckMs, limit],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      address: r.address,
      name: r.name,
      ticker: r.ticker,
      launchedAt: toMillisRequired(r.launched_at, 'launched_at'),
      postedAt: toMillisRequired(r.posted_at, 'posted_at'),
      names: [r.proposed_name, ...(r.alternate_names ?? [])].filter((n): n is string => n !== null && n.trim() !== ''),
      outcome: r.outcome,
    }));
  }

  /** The coin's name does not carry the subject's: never measured, never shown. */
  async recordNameDiffers(itemId: string, address: string, at: Millis): Promise<void> {
    await this.#db.query(
      `update internal.older_coin set outcome = 'name_differs', checked_at = $3, running = false
        where item_id = $1 and address = $2`,
      [itemId, address, toTimestamp(at)],
    );
  }

  /** A measurement, written over the last one. */
  async recordReading(itemId: string, address: string, reading: OlderCoinReading, at: Millis): Promise<void> {
    await this.#db.query(
      `update internal.older_coin set
         outcome = 'read', checks = checks + 1, checked_at = $3, last_error = null,
         hour_before_usd = $4, peak_hour_usd = $5, price_at_post_usd = $6, price_since_usd = $7, running = $8
        where item_id = $1 and address = $2`,
      [itemId, address, toTimestamp(at), reading.hourBeforeUsd, reading.peakHourUsd, reading.priceAtPostUsd, reading.priceSinceUsd, reading.running],
    );
  }

  /**
   * The market source failed. A pair already read keeps its last reading and stays `read`: an
   * outage is not news about the coin. One never read is `unavailable`, tried again later.
   */
  async recordFailed(itemId: string, address: string, error: string, at: Millis): Promise<void> {
    await this.#db.query(
      `update internal.older_coin set
         outcome = case when outcome = 'read' then 'read' else 'unavailable' end,
         checks = checks + 1, checked_at = $3, last_error = $4
        where item_id = $1 and address = $2`,
      [itemId, address, toTimestamp(at), error.slice(0, 500)],
    );
  }
}
