/**
 * Per-source health: three narrow writes and one read.
 *
 * ★ WHY THREE WRITES AND NOT ONE `upsert(SourceHealth)`. The three facts have three
 * different owners and merging them loses the one that matters. `declare` is written
 * by the process that holds the environment and is the ONLY path by which `dormant`
 * can ever be recorded — nothing observable about a source that is never called tells
 * you whether anybody meant to call it. `recordSuccess` and `recordFailure` are
 * written by whoever made the call, and neither touches `configuration`: a source
 * answering does not prove somebody configured it deliberately, and a source erroring
 * must never be able to rewrite itself as unconfigured, which would turn every outage
 * into "nobody turned this on".
 *
 * A whole-row upsert would let any one of the three clobber the other two, and the
 * direction it would clobber in is always the same — toward the state that looks like
 * nothing is wrong.
 *
 * ★ AND WHY THE ARITHMETIC IS IN SQL RATHER THAN READ-MODIFY-WRITE. The consecutive
 * failure count is incremented by the statement itself. Two loops calling the same
 * source — a discovery pass and a tracking pass — would otherwise read the same count,
 * both add one, and both write the same number: two failures recorded as one. The
 * count would then sit permanently below its threshold on exactly the source that is
 * failing most, which is the one bug this column cannot be allowed to have.
 */

import { SOURCE_CONFIGURATIONS } from '@insidor/contracts';
import type { Millis, SourceConfiguration, SourceHealth } from '@insidor/contracts';
import type { SourceId } from '@insidor/contracts/ids.ts';
import type { SourceHealthRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { reBrand, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface Row {
  source: string;
  configuration: string;
  configuration_detail: string | null;
  configured_at: TimestampColumn;
  last_success_at: TimestampColumn;
  last_failure_at: TimestampColumn;
  last_failure_reason: string | null;
  consecutive_failures: number | string;
}

/**
 * `configuration` is a bare text column with a CHECK, which means a value read back is
 * one the database accepted and not necessarily one this code knows. An unrecognised
 * value is a row written by something that is not this code, and it says so loudly
 * rather than flowing on as a state that is not one — the same rule `toStageName` in
 * runs.ts applies to `stage_runs.stage`, for the same reason.
 *
 * ★ AND IT MATCHES AGAINST THE CONTRACT'S OWN LIST, NOT A COPY OF IT. `runs.ts` imports
 * `STAGE_NAMES` for exactly this check and this file is written to that model, so a
 * second array spelled out here would be the one place the two could disagree. The
 * direction it would disagree in is not symmetric: add a fourth configuration to
 * contracts and to the CHECK in 0018, and a local copy would refuse every row carrying
 * it — from inside `all()`, which throws before it has mapped a single source, so ONE
 * unrecognised row takes the whole indicator down rather than one pip. A surface whose
 * job is to say which inputs are dark must not be the thing that goes dark.
 */
function toConfiguration(value: string): SourceConfiguration {
  const known = SOURCE_CONFIGURATIONS.find((c) => c === value);
  if (known === undefined) {
    throw new TypeError(`source_health.configuration holds '${value}', which is not a configuration`);
  }
  return known;
}

export class PgSourceHealthRepo implements SourceHealthRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Record what the environment says about this source.
   *
   * ★ `configured_at` MOVES ONLY WHEN THE CONFIGURATION ITSELF CHANGED, which is the
   * whole reason this is not a plain overwrite. The question the column answers is
   * "since when has this been off", and a boot that rewrote it unconditionally would
   * turn every deploy into a source that was configured five seconds ago — so a source
   * dormant for a month would be indistinguishable from one switched off during the
   * last release, on a surface whose entire job is telling those apart.
   *
   * ★ AND IT NEVER TOUCHES THE CALL COLUMNS. A boot must not erase the record of a
   * failure that happened before the restart; that record is often the only evidence
   * of why the process restarted.
   */
  async declare(
    source: SourceId,
    configuration: SourceConfiguration,
    detail: string | null,
    at: Millis,
  ): Promise<void> {
    await this.#db.query(
      `insert into internal.source_health
         (source, configuration, configuration_detail, configured_at, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (source) do update
          set configuration        = excluded.configuration,
              configuration_detail = excluded.configuration_detail,
              configured_at        = case
                                       when internal.source_health.configuration = excluded.configuration
                                       then internal.source_health.configured_at
                                       else excluded.configured_at
                                     end,
              updated_at           = now()`,
      [String(source), configuration, detail, toTimestamp(at)],
    );
  }

  /**
   * A call that worked.
   *
   * The insert branch writes `configuration = 'configured'` because a source that
   * answered demonstrably had credentials; the conflict branch leaves it alone, because
   * `declare` owns that column and knows something this path does not — whether the
   * environment was complete. `greatest` guards the one ordering this table cannot
   * enforce: two passes finishing out of order must not move the last-success instant
   * backwards, which would age a healthy source across the freshness bar.
   */
  async recordSuccess(source: SourceId, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.source_health
         (source, configuration, configured_at, last_success_at, consecutive_failures, updated_at)
       values ($1, 'configured', $2, $2, 0, now())
       on conflict (source) do update
          set last_success_at      = greatest(internal.source_health.last_success_at, excluded.last_success_at),
              consecutive_failures = 0,
              updated_at           = now()`,
      [String(source), toTimestamp(at)],
    );
  }

  /**
   * A call that did not work.
   *
   * `reason` is the vendor's own message and is stored whole. It is never parsed and
   * never matched against: the moment a caller branches on the text of an error, a
   * vendor rewording a message silently changes what we do about it. The typed error
   * classes at the vendor edge are what a caller branches on; this is what a human
   * reads afterwards.
   */
  async recordFailure(source: SourceId, at: Millis, reason: string): Promise<void> {
    await this.#db.query(
      `insert into internal.source_health
         (source, configuration, configured_at, last_failure_at, last_failure_reason,
          consecutive_failures, updated_at)
       values ($1, 'configured', $2, $2, $3, 1, now())
       on conflict (source) do update
          set last_failure_at      = greatest(internal.source_health.last_failure_at, excluded.last_failure_at),
              last_failure_reason  = excluded.last_failure_reason,
              consecutive_failures = internal.source_health.consecutive_failures + 1,
              updated_at           = now()`,
      [String(source), toTimestamp(at), reason],
    );
  }

  /**
   * Every source we have ever declared, in a stable order.
   *
   * ★ ORDERED BY `source` AND NOT BY ANYTHING THAT MOVES. The caller draws a row of
   * pips somebody glances at many times a day; an order that changed when a state
   * changed would move the pip under the reader's cursor, and the reader would have to
   * re-read the labels every time instead of learning the positions once.
   *
   * ★ AND IT RETURNS EVERY ROW INCLUDING THE DORMANT ONES. Filtering to the configured
   * ones here would be the same mistake as counting only the sources that answered:
   * a source that is off is a fact the surface exists to show, not a row to omit.
   */
  async all(): Promise<readonly SourceHealth[]> {
    const rows = await this.#db.query<Row>(
      `select source, configuration, configuration_detail, configured_at,
              last_success_at, last_failure_at, last_failure_reason, consecutive_failures
         from internal.source_health
        order by source asc`,
    );
    return rows.map((row) => ({
      source: reBrand<SourceId>(row.source),
      configuration: toConfiguration(row.configuration),
      configurationDetail: row.configuration_detail,
      configuredAt: toMillisRequired(row.configured_at, 'configured_at'),
      lastSuccessAt: toMillis(row.last_success_at),
      lastFailureAt: toMillis(row.last_failure_at),
      lastFailureReason: row.last_failure_reason,
      /* `integer` arrives as a number from this driver and `bigint` as a string; the
         column is `integer` today, and Number() here means a widening later cannot turn
         a count into a string that compares false against every threshold. */
      consecutiveFailures: Number(row.consecutive_failures),
    }));
  }
}
