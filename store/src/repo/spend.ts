/**
 * The durable half of the money path: one append, and one grouped read.
 *
 * ★ WHY THE READ IS "TOTALS SINCE" AND NOT "EVERY ROW SINCE". The caller seeding a
 * meter wants two numbers and a small map, and the honest way to get them is to make
 * the database add them up. Returning rows would mean the runner summing a day of
 * spend in JavaScript at boot — which works, and which quietly becomes a full table
 * read the day somebody widens the window from a day to a month to answer a different
 * question. The aggregate is the shape that cannot degrade into that.
 *
 * ★ WHY `append` DOES NOT BATCH. It is called from a write-behind sink, once per
 * vendor call, at a rate bounded by the cadences in services/runner — a few hundred
 * rows a day. Batching would buy nothing and would introduce the one failure this
 * table cannot afford: a buffer of unwritten spends lost on the crash that makes the
 * durable ledger matter in the first place. Every row is written as soon as it exists.
 *
 * ★ AND WHY THE NUMBERS ARE PARSED RATHER THAN TRUSTED. `numeric` comes back from
 * node-postgres as a STRING, because a numeric can hold more precision than a double
 * and the driver refuses to lose it silently. A caller that forgot would get
 * `"0.00015" + "0.00015" === "0.000150.00015"` — a total that is not a number, fed
 * into a comparison against a cap, which JavaScript will happily evaluate rather than
 * reject. That is how a cap stops binding without anything throwing, so the conversion
 * is done here, once, at the only place rows leave this file.
 */

import type { Millis, Spend, SpendLedger, SpendTotals } from '@insidor/contracts';
import { BILLING_UNITS } from '@insidor/contracts';
import type { BillingUnit } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

interface TotalRow {
  vendor: string;
  usd: string | number;
}

/**
 * `numeric` arrives as a string. A NaN here would compare false against every cap and
 * therefore permit every call, so it is a throw rather than a fallback: a ledger that
 * cannot say what was spent must stop the process that is spending, not guess zero.
 */
function toUsd(value: string | number, vendor: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new TypeError(
      `internal.spend holds a total for '${vendor}' that is not a finite number (${String(value)}); ` +
        'refusing to seed a budget from it',
    );
  }
  return n;
}

/**
 * A unit read back is one the CHECK constraint accepted, which is not the same as one
 * this code knows: add a fifth billing kind to the contract and the migration, and a
 * row carrying it would flow through here as a `BillingUnit` it is not. It is asserted
 * on the way out for the reason `toConfiguration` in sources.ts gives.
 */
function toBillingUnit(value: string): BillingUnit {
  const known = BILLING_UNITS.find((u) => u === value);
  if (known === undefined) {
    throw new TypeError(`internal.spend.unit holds '${value}', which is not a billing unit`);
  }
  return known;
}

export class PgSpendRepo implements SpendLedger {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * One billable call.
   *
   * The unit is validated on the way IN as well as on the way out, because the CHECK
   * constraint would reject an unknown one with a Postgres error naming a constraint,
   * and that error arrives inside a write-behind sink where it is logged and dropped.
   * A spend that fails to persist is exactly the spend the next process will not know
   * about, so the failure is made to name what is wrong with it here.
   */
  async append(spend: Spend): Promise<void> {
    await this.#db.query(
      `insert into internal.spend (vendor, endpoint, unit, units, usd, at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        spend.vendor,
        spend.endpoint,
        toBillingUnit(spend.unit),
        spend.units,
        spend.usd,
        toTimestamp(spend.at),
      ],
    );
  }

  /**
   * Everything spent on or after `sinceMs`, overall and per vendor.
   *
   * ★ ONE QUERY AND NOT TWO. A total taken separately from the per-vendor breakdown is
   * a total taken at a different instant, and under a concurrent writer the two would
   * not agree — leaving a seeded meter whose parts sum to more than its whole, or less.
   * `grouping sets` gives both from one scan and one snapshot; the overall row is the
   * one whose `vendor` grouped to null.
   */
  async totalsSince(sinceMs: Millis): Promise<SpendTotals> {
    const rows = await this.#db.query<TotalRow>(
      `select coalesce(vendor, '') as vendor, coalesce(sum(usd), 0) as usd
         from internal.spend
        where at >= $1
        group by grouping sets ((vendor), ())`,
      [toTimestamp(sinceMs)],
    );

    const byVendor: Record<string, number> = {};
    let totalUsd = 0;
    for (const row of rows) {
      /* The overall row is the one with no vendor. `coalesce` to the empty string
         rather than reading a null makes the two cases one type, and the empty string
         is not a legal vendor token — the CHECK on the column forbids it — so the two
         can never collide. */
      if (row.vendor === '') totalUsd = toUsd(row.usd, '(all)');
      else byVendor[row.vendor] = toUsd(row.usd, row.vendor);
    }

    return { totalUsd, byVendor };
  }
}
