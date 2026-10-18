/**
 * COIN PICTURE VECTORS LEAVING THE DATABASE: a coin's rows in internal.image_embedding
 * (subject_kind 'asset') embedded more than `Policy.coinVectors.keepMs` ago, read out a UTC day at a
 * time for the archive and then deleted.
 *
 * Its own repository, apart from image-embeddings.ts, because that file is how vectors are written
 * and compared and this one is how they are removed; a reader of the comparison code should never
 * have to reason about deletes. The tool that runs it is tools/archive-coin-vectors.ts.
 *
 * What breaks if changed carelessly: the day bounds. A day is UTC midnight to midnight, written out
 * with `at time zone 'UTC'`; a bare `::date` compared with a timestamptz takes the session's zone, and
 * the rows read for the archive and the rows deleted would then be different days.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

/** One coin vector's key. */
export interface CoinVectorKey {
  readonly assetKey: string;
  readonly uri: string;
  readonly space: string;
}

export class PgCoinVectorRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
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
