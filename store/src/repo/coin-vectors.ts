/**
 * COIN PICTURE VECTORS LEAVING THE DATABASE: the two ways a coin's row in internal.image_embedding
 * (subject_kind 'asset') goes — archived after `Policy.coinVectors.keepMs`, or deleted because the
 * coin never traded in its first hour and nothing can read its vector any more.
 *
 * Its own repository, apart from image-embeddings.ts, because that file is how vectors are written
 * and compared and this one is how they are removed; a reader of the comparison code should never
 * have to reason about deletes. The tool that runs both is tools/archive-coin-vectors.ts.
 *
 * ★ "UNTRADED" IS AN ANSWER, NEVER AN ABSENCE. A coin is untraded only when the market reader read
 * it an hour or more after launch and saw no market, or the launch market cap unchanged within
 * `flatWithin`, and nothing it read up to then was an unreadable or unreported market. A coin with
 * no reading after its hour is not known to be untraded and keeps its vector.
 *
 * ★ AND ONLY WHEN NOTHING CAN STILL READ IT (see Policy.coinVectors for the reader map): its origin
 * check is settled — not waiting, not due the one recheck of an unlinked, account-only or promo-only
 * coin, or the coin is past `universe.lookbackMs` and the check will never pick it again — it has no
 * origin post, it is on no feed or board, and no feed post's name search found it (the coin-match
 * step would pay to embed it again on its next pass).
 *
 * What breaks if changed carelessly: dropping the settled condition makes the origin check's recheck
 * a day later pay to embed the picture again, for a coin that is three quarters of the rows; dropping
 * the "read after the hour" condition deletes the vectors of coins we simply never looked at. And
 * the archive's day bounds: a UTC day is written out with `at time zone 'UTC'`; a bare `::date`
 * compared with a timestamptz takes the session's zone, and the rows read for the archive and the
 * rows deleted would then be different days.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

/** One coin vector's key. */
export interface CoinVectorKey {
  readonly assetKey: string;
  readonly uri: string;
  readonly space: string;
}

/** The origin statuses checked once more after `universe.recheckAfterMs` (store coin-universe.ts `unchecked`). */
const RECHECKED = ['unlinked', 'account_only', 'promo_only'] as const;

/*
 * $1 now, $2 the hour, $3 flatWithin, $4 universe.lookbackMs, $5 decideWithinMs, $6 rechecked
 * statuses, $7 limit. A reading's "hour" is the first one taken at or after launch + the hour.
 */
const UNTRADED_SQL = `
  with on_screen as (
    select distinct c #>> '{}' as asset_key
      from (select payload from public.rising_row union all select payload from public.board_row) p,
           jsonb_path_query(p.payload, 'strict $.**.coinId') c
  ), feed_hits as (
    select distinct h.address
      from (select distinct item_id from public.rising_row) r
      join internal.coin_lookup l on l.subject_kind = 'post' and l.subject_id = r.item_id and l.hits is not null
      cross join lateral unnest(l.hits) as h(address)
  ), c as (
    select e.subject_id, e.uri, e.space, a.chain, a.address, a.minted_at
      from internal.image_embedding e
      join public.asset a on a.asset_key = e.subject_id
      left join internal.coin_origin o on o.asset_key = a.asset_key
     where e.subject_kind = 'asset'
       and a.minted_at is not null
       and a.minted_at <= $1::timestamptz - make_interval(secs => $2::double precision / 1000)
       and a.minted_at >= $1::timestamptz - make_interval(secs => $5::double precision / 1000)
       and o.post_item_id is null
       and (a.first_seen_at < $1::timestamptz - make_interval(secs => $4::double precision / 1000)
            or (o.status is not null and o.status <> 'not_checked_yet'
                and not (o.status = any($6::text[]) and o.checks = 1)))
       and not exists (select 1 from on_screen s where s.asset_key = a.asset_key)
       and not exists (select 1 from feed_hits f where f.address = a.address)
  )
  select c.subject_id as asset_key, c.uri, c.space
    from c
    cross join lateral (
      select m.taken_at, m.market_cap_usd
        from public.market_reading m
       where m.chain = c.chain and m.address = c.address
         and m.taken_at >= c.minted_at + make_interval(secs => $2::double precision / 1000)
       order by m.taken_at asc
       limit 1
    ) hr
    cross join lateral (
      select (array_agg(m.market_cap_usd order by m.taken_at) filter (where m.market_cap_usd is not null))[1] as first_cap,
             min(m.market_cap_usd) as lo, max(m.market_cap_usd) as hi,
             count(m.market_cap_usd) as capped,
             count(*) filter (where m.market_cap_usd is null and m.market_cap_absent is distinct from 'no_market') as unclear
        from public.market_reading m
       where m.chain = c.chain and m.address = c.address and m.taken_at <= hr.taken_at
    ) up
   where up.unclear = 0
     and ((hr.market_cap_usd is null and up.capped = 0)
          or (hr.market_cap_usd is not null and up.first_cap > 0
              and up.hi <= up.first_cap * (1 + $3::double precision)
              and up.lo >= up.first_cap * (1 - $3::double precision)))
   limit $7`;

export class PgCoinVectorRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Coin vectors whose coin never traded in its first hour and that nothing can read any more. */
  async untradedDue(policy: Policy, now: Millis, limit: number): Promise<readonly CoinVectorKey[]> {
    const u = policy.coinVectors.untraded;
    const rows = await this.#db.query<{ asset_key: string; uri: string; space: string }>(UNTRADED_SQL, [
      toTimestamp(now),
      u.afterLaunchMs,
      u.flatWithin,
      policy.universe.lookbackMs,
      u.decideWithinMs,
      [...RECHECKED],
      limit,
    ]);
    return rows.map((r) => ({ assetKey: r.asset_key, uri: r.uri, space: r.space }));
  }

  /** Deletes exactly these coin vectors; returns how many went. */
  async deleteKeys(keys: readonly CoinVectorKey[]): Promise<number> {
    if (keys.length === 0) return 0;
    const rows = await this.#db.query<{ n: string | number }>(
      `with gone as (
         delete from internal.image_embedding e
          using unnest($1::text[], $2::text[], $3::text[]) as k(subject_id, uri, space)
          where e.subject_kind = 'asset' and e.subject_id = k.subject_id and e.uri = k.uri and e.space = k.space
         returning 1)
       select count(*) as n from gone`,
      [keys.map((k) => k.assetKey), keys.map((k) => k.uri), keys.map((k) => k.space)],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** The UTC days of coin vectors embedded wholly before `before`, oldest first, with their row counts. */
  async daysBefore(before: Millis, limit: number): Promise<readonly { readonly day: string; readonly rows: number }[]> {
    const rows = await this.#db.query<{ day: string; n: string | number }>(
      `select to_char((embedded_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, count(*) as n
         from internal.image_embedding
        where subject_kind = 'asset' and embedded_at < $1
        group by 1 order by 1 limit $2`,
      [toTimestamp(before), limit],
    );
    return rows.map((r) => ({ day: r.day, rows: Number(r.n) }));
  }

  /** How many coin vectors were embedded on this UTC day. */
  async countDay(day: string): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(
      `select count(*) as n from internal.image_embedding
        where subject_kind = 'asset' and embedded_at >= ($1::date)::timestamp at time zone 'UTC' and embedded_at < ($1::date + 1)::timestamp at time zone 'UTC'`,
      [day],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * One page of a day's coin vectors as JSON lines, in key order after `after` (null: from the
   * start). The vector is its text form, which reads back with `::vector`.
   */
  async dayPage(day: string, after: CoinVectorKey | null, limit: number): Promise<readonly { readonly key: CoinVectorKey; readonly json: string }[]> {
    const rows = await this.#db.query<{ subject_id: string; uri: string; space: string; j: string }>(
      `select e.subject_id, e.uri, e.space,
              json_build_object('subject_kind', e.subject_kind, 'subject_id', e.subject_id, 'uri', e.uri, 'space', e.space,
                                'embedding', e.embedding::text, 'embedded_at', e.embedded_at)::text as j
         from internal.image_embedding e
        where e.subject_kind = 'asset' and e.embedded_at >= ($1::date)::timestamp at time zone 'UTC' and e.embedded_at < ($1::date + 1)::timestamp at time zone 'UTC'
          and ($2::text is null or (e.subject_id, e.uri, e.space) > ($2::text, $3::text, $4::text))
        order by e.subject_id, e.uri, e.space
        limit $5`,
      [day, after?.assetKey ?? null, after?.uri ?? null, after?.space ?? null, limit],
    );
    return rows.map((r) => ({ key: { assetKey: r.subject_id, uri: r.uri, space: r.space }, json: r.j }));
  }

  /** Deletes up to `limit` of a day's coin vectors; returns how many went. Call until it returns 0. */
  async deleteDayBatch(day: string, limit: number): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(
      `with gone as (
         delete from internal.image_embedding
          where ctid = any(array(
                  select ctid from internal.image_embedding
                   where subject_kind = 'asset' and embedded_at >= ($1::date)::timestamp at time zone 'UTC' and embedded_at < ($1::date + 1)::timestamp at time zone 'UTC'
                   limit $2))
         returning 1)
       select count(*) as n from gone`,
      [day, limit],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
