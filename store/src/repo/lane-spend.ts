/**
 * What each capped search lane has spent today (0088): read before an ask, added to after it.
 *
 * Its own repository because it is the one number a lane's daily cap is checked against, and it
 * must outlive the process: the runner restarts several times a day, and a tally kept in memory
 * would give every restart a fresh day's money. Nothing but the lanes' ledger reads it.
 *
 * What breaks if changed carelessly: `spent` THROWS when the table is missing (before 0088). It
 * must not return 0 there — a lane that cannot read what it spent would then spend its whole cap
 * again on every restart. The caller treats a throw as "do not ask" (work/lane-ledger.ts).
 */

import type { Db } from '../client.ts';

export class PgLaneSpendRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Dollars `lane` has recorded on `day` (a UTC date, YYYY-MM-DD); 0 when it has no row yet. */
  async spent(lane: string, day: string): Promise<number> {
    const rows = await this.#db.query<{ usd: number }>('select usd from internal.lane_spend where day = $1::date and lane = $2', [day, lane]);
    return Number(rows[0]?.usd ?? 0);
  }

  /** Adds `usd` to `lane`'s day. Additive in one statement, so two writers never lose each other's spend. */
  async add(lane: string, day: string, usd: number, at: Date): Promise<void> {
    if (!(usd > 0)) return;
    await this.#db.query(
      `insert into internal.lane_spend (day, lane, usd, updated_at) values ($1::date, $2, $3, $4)
       on conflict (day, lane) do update set usd = internal.lane_spend.usd + excluded.usd, updated_at = excluded.updated_at`,
      [day, lane, usd, at],
    );
  }
}
