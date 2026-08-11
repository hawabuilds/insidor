/**
 * The counter series. Append only.
 *
 * There is no update method and no delete method in this file, and that is not an
 * oversight to be corrected later — it is the asset. Nobody sells you what a
 * counter read at 03:14 last Tuesday, and every rate the system computes is a
 * difference between two of these rows. A correction is a new reading.
 *
 * The one rule worth restating at the storage layer: `ratePerMin` is null when the
 * reading was censored, and null is not zero. Zero says the item is flat, flat
 * reads downstream as cooling, and cooling demotes exactly the item that is
 * accelerating. The database enforces the pairing (`rate_xor_censor`), so a caller
 * that tries to write a zero in place of a censor reason gets an error rather than
 * a plausible number.
 */

import type { CensorReason, CounterKind, Fidelity, Millis, Observation } from '@insidor/contracts';
import type { ItemId } from '@insidor/contracts/ids.ts';
import type { ObservationRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { reBrand, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface ObservationRow {
  item_id: string;
  kind: CounterKind;
  captured_at: TimestampColumn;
  value: number | null;
  fidelity_kind: Fidelity['kind'];
  fidelity_digits: number | null;
  observed_at: TimestampColumn;
  lag_ms: number | null;
  rate_per_min: number | null;
  censored: CensorReason | null;
}

const SELECT_OBSERVATION = `
  select item_id, kind, captured_at, value, fidelity_kind, fidelity_digits,
         observed_at, lag_ms, rate_per_min, censored
    from public.observation
`;

export class PgObservationRepo implements ObservationRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Append readings. `do nothing` on conflict, because re-reading the same instant
   * is a retry, not a correction — and the append-only trigger would refuse the
   * update anyway, which is a worse way to find out.
   *
   * A row-at-a-time loop is correct and fast enough at this volume. When the
   * tracking fan-out makes it not, the replacement is COPY into this same table,
   * not a batching layer above it.
   */
  async append(observations: readonly Observation[]): Promise<number> {
    let written = 0;
    for (const observation of observations) {
      const rows = await this.#db.query<{ item_id: string }>(
        `insert into public.observation (
           item_id, kind, captured_at, value, fidelity_kind, fidelity_digits,
           observed_at, lag_ms, rate_per_min, censored
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (item_id, kind, captured_at) do nothing
         returning item_id`,
        [
          observation.itemId,
          observation.kind,
          toTimestamp(observation.capturedAt),
          observation.counter.value,
          observation.counter.fidelity.kind,
          observation.counter.fidelity.kind === 'quantized'
            ? observation.counter.fidelity.significantDigits
            : null,
          toTimestamp(observation.counter.observedAt),
          observation.counter.lagMs ?? null,
          observation.ratePerMin,
          observation.censored,
        ],
      );
      written += rows.length;
    }
    return written;
  }

  /** The previous reading a rate is differenced against. */
  async latest(itemId: ItemId, kind: CounterKind): Promise<Observation | null> {
    const rows = await this.#db.query<ObservationRow>(
      `${SELECT_OBSERVATION}
        where item_id = $1 and kind = $2
        order by captured_at desc
        limit 1`,
      [itemId, kind],
    );
    const row = rows[0];
    return row ? toObservation(row) : null;
  }

  /** The window a baseline or an EWMA is computed over. Oldest first. */
  async series(
    itemId: ItemId,
    kind: CounterKind,
    sinceMs: Millis,
    untilMs: Millis,
  ): Promise<Observation[]> {
    const rows = await this.#db.query<ObservationRow>(
      `${SELECT_OBSERVATION}
        where item_id = $1 and kind = $2 and captured_at >= $3 and captured_at < $4
        order by captured_at asc`,
      [itemId, kind, toTimestamp(sinceMs), toTimestamp(untilMs)],
    );
    return rows.map(toObservation);
  }

  /**
   * Censoring rate by week, by reason.
   *
   * Kept next to the writes on purpose. A rising censoring rate is the earliest
   * sign a source changed shape under us, and it is invisible to any check that
   * only looks at whether rows are arriving — they still arrive, they just stop
   * carrying rates.
   */
  async censoringByWeek(
    sinceMs: Millis,
  ): Promise<{ week: Millis; reason: CensorReason | null; count: number }[]> {
    const rows = await this.#db.query<{ week: TimestampColumn; reason: CensorReason | null; count: string }>(
      `select date_trunc('week', captured_at) as week, censored as reason, count(*)::text as count
         from public.observation
        where captured_at >= $1
        group by 1, 2
        order by 1, 2`,
      [toTimestamp(sinceMs)],
    );
    return rows.map((row) => ({
      week: toMillisRequired(row.week, 'week'),
      reason: row.reason,
      count: Number(row.count),
    }));
  }
}

function toObservation(row: ObservationRow): Observation {
  return {
    itemId: reBrand<ItemId>(row.item_id),
    capturedAt: toMillisRequired(row.captured_at, 'captured_at'),
    kind: row.kind,
    counter: {
      value: row.value,
      fidelity: toFidelity(row.fidelity_kind, row.fidelity_digits),
      observedAt: toMillisRequired(row.observed_at, 'observed_at'),
      // Spread rather than `?? undefined`: under exactOptionalPropertyTypes an
      // explicit undefined is not the same as an absent key, and lagMs is only
      // meaningful when the source admitted its own staleness.
      ...(row.lag_ms === null ? {} : { lagMs: row.lag_ms }),
    },
    ratePerMin: row.rate_per_min,
    censored: row.censored,
  };
}

function toFidelity(kind: Fidelity['kind'], digits: number | null): Fidelity {
  if (kind === 'quantized') {
    if (digits === null) {
      throw new TypeError('quantized fidelity arrived without significant digits');
    }
    return { kind: 'quantized', significantDigits: digits };
  }
  return { kind };
}
