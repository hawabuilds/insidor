/**
 * The catch-all search's lane floors: read before a pass, written after a live one.
 *
 * Its own repository because it is the one piece of discovery state that must outlive the
 * process — see 0024, and 0111 for each language's floor on the newest-posts search. Nothing
 * else reads it.
 *
 * What breaks if changed carelessly: `floors` returns only the lanes that have a row. A
 * caller fills the rest from policy's starting floors; returning a default from here would
 * hide the difference between "never adapted" and "adapted to exactly the start".
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

export class PgFeedFloorRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async floors(): Promise<Readonly<Record<string, number>>> {
    const rows = await this.#db.query<{ lane: string; floor: number }>('select lane, floor from internal.feed_floor');
    return Object.fromEntries(rows.map((row) => [row.lane, Number(row.floor)]));
  }

  async set(lane: string, floor: number, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.feed_floor (lane, floor, updated_at) values ($1, $2, $3)
       on conflict (lane) do update set floor = excluded.floor, updated_at = excluded.updated_at`,
      [lane, Math.round(floor), toTimestamp(at)],
    );
  }

  /** Each language's newest-posts floor (0111), for the languages that have one. */
  async langFloors(): Promise<Readonly<Record<string, number>>> {
    const rows = await this.#db.query<{ lang: string; floor: number }>('select lang, floor from internal.feed_lang_floor');
    return Object.fromEntries(rows.map((row) => [row.lang, Number(row.floor)]));
  }

  async setLang(lang: string, floor: number, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.feed_lang_floor (lang, floor, updated_at) values ($1, $2, $3)
       on conflict (lang) do update set floor = excluded.floor, updated_at = excluded.updated_at`,
      [lang, Math.round(floor), toTimestamp(at)],
    );
  }
}
