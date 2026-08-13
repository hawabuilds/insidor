/**
 * ★ Outcomes, settled days after the decision they grade.
 *
 * Every method here forces the population to be named, because the column is NOT
 * NULL with no default and there is no overload that omits it. That is deliberate
 * and it is the cheapest lesson in this repository: the previous backtest reported
 * a claim about coinability in general while its population was graduated coins —
 * about 107 a day against roughly 30,000 mints. Nobody lied. The denominator simply
 * was not written next to the number, and a rate without its denominator is not a
 * fact.
 *
 * The second thing this file refuses to do is coerce `pending` to negative. With a
 * six-day median to peak, the pending population is large relative to the resolved
 * one for months, so that coercion would not be a rounding error — it would be the
 * dataset. `pending` has no path to `y = false` here; only `resolve()` sets y, and
 * only after the window closed with coverage behind it.
 */

import type { Millis } from '@insidor/contracts';
import type { Label, LabelRepo } from '@insidor/contracts/ports/store.ts';

/**
 * The five columns that identify a label row, derived from the vocabulary rather
 * than restated beside it — if the primary key ever changes, this stops compiling
 * instead of quietly addressing the wrong rows.
 */
export type LabelKey = Pick<
  Label,
  'subjectKind' | 'subjectId' | 'labelName' | 'labelVersion' | 'windowDays'
>;

import type { Db } from '../client.ts';
import { toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface LabelRow {
  subject_kind: Label['subjectKind'];
  subject_id: string;
  label_name: string;
  label_version: string;
  window_days: number;
  origin_ts: TimestampColumn;
  resolves_at: TimestampColumn;
  status: Label['status'];
  value: number | null;
  y: boolean | null;
  censor_reason: string | null;
  population: string;
  source: string;
  first_signal_at: TimestampColumn;
  computed_at: TimestampColumn;
}

const SELECT_LABEL = `
  select subject_kind, subject_id, label_name, label_version, window_days,
         origin_ts, resolves_at, status, value, y, censor_reason,
         population, source, first_signal_at, computed_at
    from internal.labels
`;

export class PgLabelRepo implements LabelRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Open a label window. Written at decision time, in `pending`, so that the
   * population and the label recipe are recorded before anybody knows the answer
   * and could be tempted to choose a population that flatters it.
   */
  async open(label: Label): Promise<void> {
    if (label.status !== 'pending') {
      throw new TypeError('open() writes pending rows; use resolve() or censor() to settle one');
    }
    await this.#db.query(
      `insert into internal.labels (
         subject_kind, subject_id, label_name, label_version, window_days,
         origin_ts, resolves_at, status, population, source, first_signal_at
       ) values ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10)
       on conflict (subject_kind, subject_id, label_name, label_version, window_days)
       do nothing`,
      [
        label.subjectKind,
        label.subjectId,
        label.labelName,
        label.labelVersion,
        label.windowDays,
        toTimestamp(label.originMs),
        toTimestamp(label.resolvesAtMs),
        label.population,
        label.source,
        toTimestamp(label.firstSignalMs),
      ],
    );
  }

  /**
   * Record when the FIRST matching evidence arrived, even while the row is still
   * pending.
   *
   * One column today, unrecoverable tomorrow. It is what yields the empirical delay
   * distribution P(delay <= t), and in six months that is what makes the
   * delayed-feedback correction possible — admitting pending rows as negatives
   * weighted by 1 / P(delay <= elapsed). It is written once and never moved: a
   * later, larger signal is not the first one.
   */
  async noteFirstSignal(key: LabelKey, atMs: Millis): Promise<void> {
    await this.#db.query(
      `update internal.labels set first_signal_at = $6
        where subject_kind = $1 and subject_id = $2 and label_name = $3
          and label_version = $4 and window_days = $5
          and first_signal_at is null`,
      [key.subjectKind, key.subjectId, key.labelName, key.labelVersion, key.windowDays, toTimestamp(atMs)],
    );
  }

  /**
   * Settle a label. Only reachable once the window closed AND the window was
   * covered — the caller checks coverage, and the `resolved` status asserts both.
   *
   * A negative here is a real claim: nothing happened AND we watched the whole
   * time. If either half is untrue the row belongs in censor().
   */
  async resolve(key: LabelKey, outcome: { value: number | null; y: boolean; computedAtMs: Millis }): Promise<void> {
    await this.#db.query(
      `update internal.labels
          set status = 'resolved', value = $6, y = $7, computed_at = $8, censor_reason = null
        where subject_kind = $1 and subject_id = $2 and label_name = $3
          and label_version = $4 and window_days = $5
          and status = 'pending'`,
      [
        key.subjectKind,
        key.subjectId,
        key.labelName,
        key.labelVersion,
        key.windowDays,
        outcome.value,
        outcome.y,
        toTimestamp(outcome.computedAtMs),
      ],
    );
  }

  /**
   * Excluded from training but COUNTED. A rising censoring rate is the earliest
   * sign the label pipeline is rotting, and deleting these rows instead of marking
   * them destroys the only signal that would have said so.
   */
  async censor(key: LabelKey, reason: string, computedAtMs: Millis): Promise<void> {
    await this.#db.query(
      `update internal.labels
          set status = 'censored', censor_reason = $6, computed_at = $7, y = null
        where subject_kind = $1 and subject_id = $2 and label_name = $3
          and label_version = $4 and window_days = $5
          and status = 'pending'`,
      [
        key.subjectKind,
        key.subjectId,
        key.labelName,
        key.labelVersion,
        key.windowDays,
        reason,
        toTimestamp(computedAtMs),
      ],
    );
  }

  /** Windows that have closed and are waiting to be graded. The nightly labeller's work queue. */
  async due(nowMs: Millis, limit: number): Promise<readonly Label[]> {
    const rows = await this.#db.query<LabelRow>(
      `${SELECT_LABEL}
        where status = 'pending' and resolves_at <= $1
        order by resolves_at asc
        limit $2`,
      [toTimestamp(nowMs), limit],
    );
    return rows.map(toLabel);
  }

  /**
   * Write labels as given, in bulk. The settleable columns are refreshed on
   * conflict; the identifying ones cannot change, because changing one of them
   * describes a different row.
   *
   * `first_signal_at` is coalesced rather than overwritten, in both directions of
   * this method: a later, larger signal is not the first one, and the empirical
   * delay distribution is built out of firsts.
   */
  async upsert(labels: readonly Label[]): Promise<number> {
    for (const label of labels) {
      await this.#db.query(
        `insert into internal.labels (
           subject_kind, subject_id, label_name, label_version, window_days,
           origin_ts, resolves_at, status, value, y, censor_reason,
           population, source, first_signal_at, computed_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (subject_kind, subject_id, label_name, label_version, window_days)
         do update set
           origin_ts     = excluded.origin_ts,
           resolves_at   = excluded.resolves_at,
           status        = excluded.status,
           value         = excluded.value,
           y             = excluded.y,
           censor_reason = excluded.censor_reason,
           population    = excluded.population,
           source        = excluded.source,
           first_signal_at = coalesce(internal.labels.first_signal_at, excluded.first_signal_at),
           computed_at   = excluded.computed_at`,
        [
          label.subjectKind,
          label.subjectId,
          label.labelName,
          label.labelVersion,
          label.windowDays,
          toTimestamp(label.originMs),
          toTimestamp(label.resolvesAtMs),
          label.status,
          label.value,
          label.y,
          label.censorReason,
          label.population,
          label.source,
          toTimestamp(label.firstSignalMs),
          toTimestamp(label.computedAtMs),
        ],
      );
    }
    return labels.length;
  }

  /**
   * Every version and window of one label for one subject, newest window first.
   *
   * Deliberately NOT filtered by status. A caller counting resolved rows without
   * seeing the pending and censored ones beside them is computing a rate over a
   * population it did not choose, which is the shape of the mistake this whole file
   * is a reaction to.
   */
  async bySubject(subjectId: string, labelName: string): Promise<readonly Label[]> {
    const rows = await this.#db.query<LabelRow>(
      `${SELECT_LABEL}
        where subject_id = $1 and label_name = $2
        order by resolves_at desc`,
      [subjectId, labelName],
    );
    return rows.map(toLabel);
  }

  async byKey(key: LabelKey): Promise<Label | null> {
    const rows = await this.#db.query<LabelRow>(
      `${SELECT_LABEL}
        where subject_kind = $1 and subject_id = $2 and label_name = $3
          and label_version = $4 and window_days = $5`,
      [key.subjectKind, key.subjectId, key.labelName, key.labelVersion, key.windowDays],
    );
    const row = rows[0];
    return row ? toLabel(row) : null;
  }
}

function toLabel(row: LabelRow): Label {
  return {
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    labelName: row.label_name,
    labelVersion: row.label_version,
    windowDays: row.window_days,
    originMs: toMillisRequired(row.origin_ts, 'origin_ts'),
    resolvesAtMs: toMillisRequired(row.resolves_at, 'resolves_at'),
    status: row.status,
    value: row.value,
    y: row.y,
    censorReason: row.censor_reason,
    population: row.population,
    source: row.source,
    firstSignalMs: toMillis(row.first_signal_at),
    computedAtMs: toMillis(row.computed_at),
  };
}
