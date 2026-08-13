/**
 * The composition root: the ONE file in this service that names other packages.
 *
 * The feed itself is unimplemented on purpose. Its body is a venue adapter call
 * — a launchpad list endpoint carrying `created_timestamp`, confirmed against
 * one generic signatures-for-address read — and the venue adapters are separate
 * packages whose names are not fixed yet. Writing a plausible one here would
 * put a chain's field names inside a service, which is the boundary this whole
 * rebuild exists to hold.
 *
 * Everything that makes this process worth deploying — the durable cursor, the
 * backoff, the coverage log, the run records — is implemented, transport
 * agnostic, and tested. Filling in `read()` is a function body, not a redesign.
 *
 * THREE THINGS ABOUT THE STORE SIDE ARE WORTH READING BEFORE CHANGING THEM.
 *
 * 1. THE ROLE IS `internal`, NOT `service`. This process writes
 *    `internal.mint_coverage` and `internal.stage_runs`, and the `service` role
 *    holds SELECT on that schema and nothing more (0001_schemas.sql). A pool
 *    opened as `service` would come up, read fine, and fail on the first gap it
 *    tried to record — which is the one write whose absence is invisible.
 *
 * 2. THE SINGLETON LOCK IS HELD FOR THE LIFE OF THE PROCESS, so the runtime is a
 *    scope rather than a value: `withRuntime(cfg, log, run)`. A session advisory
 *    lock is released when its session ends, so the session has to outlive the
 *    loop, and the only way to say that in a type is to hand the loop the lock's
 *    connection. Two watchers on one cursor is two watchers each convinced they
 *    have full coverage, and neither of them does.
 *
 * 3. THERE IS NO CURSOR TABLE, AND THAT IS DELIBERATE. The resume position lives
 *    on the coverage row (`mint_coverage.cursor_ref`), so saving it and declaring
 *    the window it closed are one write. Resuming is therefore a read of the most
 *    recent coverage row, and a process that has never run finds nothing and
 *    starts cold — which is a different thing from a process that restarted and
 *    lost its place, because that one finds a watermark and the silence since it
 *    becomes a recorded gap.
 */

import { createHash } from 'node:crypto';

import {
  DB_ROLE,
  PgAssetRepo,
  PgStageRunRepo,
  createPool,
  withAdvisoryLock,
  type Db,
} from '@insidor/store';

import type { ChainwatchConfig } from './config.ts';
import { coldCursor, type CursorStore } from './cursor.ts';
import type { MintFeed, MintSink } from './feed.ts';
import type { Logger } from './log.ts';
import { NotImplemented } from './not-implemented.ts';
import type { StageRunRecorder } from './run-record.ts';

export interface Runtime {
  readonly feed: MintFeed;
  readonly sink: MintSink;
  readonly cursors: CursorStore;
  readonly stageRuns: StageRunRecorder;
}

function createFeed(cfg: ChainwatchConfig): MintFeed {
  return {
    id: cfg.feedId,
    transport: cfg.transport,
    read: () =>
      Promise.reject(
        new NotImplemented(
          `mint feed ${cfg.feedId} (${cfg.transport}) — call the venue adapter's creation ` +
            'listing, confirm each mint time against the chain, and return a page whose ' +
            '`pageFull` is true when the source returned exactly the limit',
        ),
      ),
  };
}

/**
 * A stable 32-bit key for `pg_try_advisory_lock`. Postgres keys advisory locks by
 * a bigint and configuration names the lock in words, so the name has to become a
 * number somewhere; doing it deterministically is what makes two chainwatches
 * reading the same `SINGLETON_LOCK_NAME` compete for the same lock across
 * restarts and deploys.
 *
 * Duplicated from the runner rather than shared, for the same reason the logger
 * is, and spelled identically so nobody reading both concludes the two schemes
 * were meant to agree on a value. They are not: different names, different locks.
 */
function lockKey(name: string): number {
  return createHash('sha256').update(name).digest().readUInt32BE(0);
}

function buildRuntime(cfg: ChainwatchConfig, db: Db): Runtime {
  const assets = new PgAssetRepo(db);

  /*
   * ★ The one place in this service where a contract is narrower than the column
   * it governs, called out rather than worked around.
   *
   * `StageRunRepo.open` takes a `StageName`, and STAGE_NAMES is the seven stages
   * of the DECISION pipeline — 'chainwatch' is not among them. But
   * `internal.stage_runs.stage` is free text on purpose, the watchdog's cadence
   * table names 'chainwatch' directly, and the reason this process writes to that
   * table at all is so the watchdog's "last successful run older than 3× cadence"
   * rule is written once instead of twice. So the repository is bound to this
   * service's own recorder port, whose stage is a string. Nothing is cast and
   * nothing is silenced; the widening is one TypeScript allows on a method. What a
   * human should decide is which side is wrong: whether a service belongs in
   * STAGE_NAMES, or whether StageRunRepo should take the column's own type.
   */
  const stageRuns: StageRunRecorder = new PgStageRunRepo(db);

  return {
    feed: createFeed(cfg),

    sink: {
      // A MintEvent already carries a whole Asset — the feed's job is to have
      // built one — so persisting a page is the vocabulary going straight in.
      recordMints: async (mints) => {
        await assets.upsert(mints.map((mint) => mint.asset));
      },

      // A gap is a coverage row that says so, never a missing row. `gap.kind` is
      // carried into the reason because 'not_watching' and 'page_overflow' are
      // answered differently: one is a window nobody was looking at, the other is
      // a window we were connected for and still cannot vouch for.
      recordGap: (gap) =>
        assets.recordCoverage(cfg.chain, gap.fromMs, gap.toMs, null, {
          reason: `${gap.kind}: ${gap.detail}`,
        }),
    },

    cursors: {
      load: async (feedId) => {
        const latest = await assets.latestCoverage(cfg.chain);
        // No coverage row at all: this chain has never been watched. Cold, and
        // genuinely cold — there is no earlier window to have missed.
        if (latest === null) return coldCursor(feedId);
        return { feedId, position: latest.cursorRef, readAt: latest.toMs };
      },

      save: async (cursor, coveredFromMs) => {
        if (cursor.readAt === null) {
          // Only a cold cursor has no read instant, and a cold cursor has closed
          // no window. Persisting one would write a coverage row asserting we
          // watched an interval that no read stands behind.
          throw new Error(
            'refusing to persist a cursor with no read instant: the coverage row it would ' +
              'land on claims a window this process never closed',
          );
        }
        await assets.recordCoverage(
          cfg.chain,
          coveredFromMs,
          cursor.readAt,
          cursor.position,
          null,
        );
      },
    },

    stageRuns,
  };
}

/**
 * Open the pool, take the singleton lock, and run the watch loop inside it.
 *
 * `run` is handed the lock's own connection. That is not tidiness: everything the
 * loop writes then travels on the session that holds the lock, so there is no
 * window in which the lock has been released and writes are still in flight.
 */
export async function withRuntime(
  cfg: ChainwatchConfig,
  log: Logger,
  run: (runtime: Runtime) => Promise<void>,
): Promise<void> {
  const pool = createPool(DB_ROLE.internal, {
    applicationName: `insidor-chainwatch-${cfg.feedId}`,
    // The service takes one connection string and decides which role it is for,
    // rather than the pool reading an environment this process already validated
    // once at boot. Session mode is still asserted, inside createPool.
    env: { DATABASE_URL_INTERNAL: cfg.databaseUrl },
  });

  try {
    const held = await withAdvisoryLock(pool, lockKey(cfg.singletonLockName), async (db) => {
      log.info('runtime ready', {
        feedId: cfg.feedId,
        chain: cfg.chain,
        transport: cfg.transport,
      });
      await run(buildRuntime(cfg, db));
      return true;
    });

    // null means the lock was not granted — `run` never started. Distinguishable
    // from `run` completing, which resolves true.
    if (held === null) {
      throw new Error(
        `another chainwatch already holds ${cfg.singletonLockName}; refusing to start a second one`,
      );
    }
  } finally {
    await pool.end();
  }
}
