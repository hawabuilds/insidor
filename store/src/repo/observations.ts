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

import { toStoredRate } from '@insidor/contracts';
import type { CensorReason, CounterKind, Fidelity, Millis, Observation, Rate } from '@insidor/contracts';
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
  rate_over_ms: number | null;
  rate_level: number | null;
  rate_last_level: number | null;
}

const SELECT_OBSERVATION = `
  select item_id, kind, captured_at, value, fidelity_kind, fidelity_digits,
         observed_at, lag_ms, rate_per_min, censored,
         rate_over_ms, rate_level, rate_last_level
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
      // toStoredRate is the ONLY sanctioned flattening of the union, and this is the
      // only place in the system allowed to perform one. The remaining fields of
      // whichever branch it was are written beside it, so the reading round-trips
      // whole instead of being reassembled by guesswork on the way out.
      const stored = toStoredRate(observation.rate);
      const rate = observation.rate;
      const rows = await this.#db.query<{ item_id: string }>(
        `insert into public.observation (
           item_id, kind, captured_at, value, fidelity_kind, fidelity_digits,
           observed_at, lag_ms, rate_per_min, censored,
           rate_over_ms, rate_level, rate_last_level
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
          stored.ratePerMin,
          stored.censored,
          rate.kind === 'measured' ? rate.overMs : null,
          rate.kind === 'measured' ? rate.level : null,
          rate.kind === 'censored' ? rate.lastLevel : null,
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

  /**
   * The window a baseline or an EWMA is computed over. Oldest first.
   *
   * `untilMs` is optional and exclusive. The port asks only for a lower bound; the
   * upper one exists for replay, where the whole point is to see no datum newer
   * than the decision being reproduced. Omitting it reads up to now.
   */
  async series(
    itemId: ItemId,
    kind: CounterKind,
    sinceMs: Millis,
    untilMs?: Millis,
  ): Promise<readonly Observation[]> {
    const rows = await this.#db.query<ObservationRow>(
      `${SELECT_OBSERVATION}
        where item_id = $1 and kind = $2 and captured_at >= $3
          and ($4::timestamptz is null or captured_at < $4)
        order by captured_at asc`,
      [itemId, kind, toTimestamp(sinceMs), untilMs === undefined ? null : toTimestamp(untilMs)],
    );
    return rows.map(toObservation);
  }

  /**
   * Every reading of every counter, for a page of items, in one round trip.
   *
   * WHY IT EXISTS ALONGSIDE `series`. The port's shape is (one item, one counter),
   * which is the right shape for differencing a rate. It is the wrong shape for a
   * stage loop: DETECT and TRACK are handed a batch of up to a thousand items and
   * need every kind on each of them, so the port's shape is `batch × kinds` round
   * trips — two to six thousand queries to decide one pass. That is not a tuning
   * detail; it is the difference between a loop that finishes inside its cadence
   * and one that never does, and a loop that overruns its cadence silently starts
   * skipping reads, which puts the read grid back under the control of load.
   *
   * Newest LAST within each item, which is the order both `DetectInput.observations`
   * and `TrackInput.observations` document ("newest last"). The map is keyed by item
   * so an item with no readings is an absent key rather than an empty array somebody
   * has to remember is different from "we did not ask".
   */
  async seriesForItems(
    itemIds: readonly ItemId[],
    sinceMs: Millis,
  ): Promise<ReadonlyMap<ItemId, readonly Observation[]>> {
    const found = new Map<ItemId, Observation[]>();
    if (itemIds.length === 0) return found;

    const rows = await this.#db.query<ObservationRow>(
      `${SELECT_OBSERVATION}
        where item_id = any($1::text[]) and captured_at >= $2
        order by item_id, captured_at asc`,
      [[...itemIds], toTimestamp(sinceMs)],
    );

    for (const row of rows) {
      const key = reBrand<ItemId>(row.item_id);
      const list = found.get(key);
      if (list === undefined) found.set(key, [toObservation(row)]);
      else list.push(toObservation(row));
    }
    return found;
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
    rate: toRate(row),
  };
}

/**
 * The flat columns back into the union.
 *
 * ★ There is no branch here that produces a zero rate from a censored row, and
 * there never may be. `rate_per_min` null means we learned nothing; a 0 says the
 * item is flat, flat reads downstream as cooling, and cooling demotes exactly the
 * item that is accelerating. The database's `rate_xor_censor` constraint guarantees
 * one of the two columns is set, so a row with neither was written around it and
 * throws rather than defaulting to either answer.
 */
function toRate(row: ObservationRow): Rate {
  if (row.rate_per_min !== null) {
    if (row.rate_over_ms === null || row.rate_level === null) {
      throw new TypeError('a measured rate arrived without its interval or its level');
    }
    return {
      kind: 'measured',
      perMin: row.rate_per_min,
      overMs: row.rate_over_ms,
      level: row.rate_level,
    };
  }
  if (row.censored === null) {
    throw new TypeError('an observation arrived with neither a rate nor a censor reason');
  }
  return { kind: 'censored', reason: row.censored, lastLevel: row.rate_last_level };
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
