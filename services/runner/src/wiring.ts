/**
 * The composition root: the ONE file that knows the names of other packages.
 *
 * Everything else in this service talks to the small ports declared in
 * `loop.ts` and `run-record.ts`. That is not ceremony — it is what keeps the
 * supervision machinery testable without a database, and it means a change to
 * the store's export names costs one file rather than fifteen.
 *
 * WHY THIS IS A `withRuntime(cfg, log, use)` AND NOT A `buildRuntime` THAT
 * RETURNS: the singleton guard is a SESSION advisory lock, and a session lock
 * lives exactly as long as the client that took it. `withAdvisoryLock` therefore
 * scopes it to a callback, and the only honest way to hold it for the lifetime of
 * the process is to run the process inside that callback. A version that returned
 * a Runtime would have to keep the lock alive by some side channel, and a
 * singleton guard that is subtly not held is worse than none: it reads as held.
 * Failure mode #2 of the build this replaces was two runners draining one claim
 * queue, and it produced double spend with no error anywhere.
 *
 * ★ THE STAGE WORK IS WIRED, AND IT IS WIRED AGAINST THE STORE. Every `pull`
 * below reads rows we already hold; none of them calls a vendor. That is what
 * makes the decision log fillable today rather than on the day the last adapter
 * lands — and `internal.decisions` is one of the two tables SETUP.md says cannot
 * be backfilled, so a day spent waiting for adapters is a day of training data
 * that never existed. Which stage is wired and which still refuses, and the rule
 * that decides, is argued in `work/stages.ts`.
 *
 * ADAPTERS ARE STILL NOT IMPORTED. The store-backed pulls stand in for
 * discovery, observation and the judge; where an input genuinely needs a vendor
 * it arrives as its typed absence and the stage returns the verdict that names
 * the absence. Adding a real adapter later replaces one `pull` and changes no
 * other line in this service.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { Millis } from '@insidor/contracts';
import type { DecisionRepo, StageRunRepo } from '@insidor/contracts/ports/store.ts';
import {
  DB_ROLE,
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgItemRepo,
  PgObservationRepo,
  PgStageRunRepo,
  PgStoryRepo,
  asDb,
  createPool,
  withAdvisoryLock,
  type Db,
} from '@insidor/store';

import type { RunnerConfig } from './config.ts';
import { advisoryLockKey, policyHash } from './hash.ts';
import type { Logger } from './log.ts';
import type { DecisionLog, LoopDeps } from './loop.ts';
import type { StageRunRecorder } from './run-record.ts';
import { storeWork, type StageRepos } from './work/stages.ts';

export interface Runtime {
  readonly db: Db;
  readonly stageRuns: StageRunRecorder;
  readonly loopDeps: LoopDeps;
  /** Partition maintenance and the unapplied sweep. See `maintain` below. */
  readonly maintenance: Maintenance;
}

/**
 * The two calls on `PgDecisionRepo` that had no caller anywhere in the repository.
 *
 * They are a port rather than a direct use of the concrete class for the same reason
 * everything else in this service is: the supervision machinery stays testable without
 * a database. But the reason they exist AT ALL is worth stating, because both were
 * documented as "the runner does this" and neither was ever called:
 *
 *   ensurePartition — `internal.decisions` is partitioned by day, and 0006 defines a
 *   row landing in `decisions_default` as meaning "the partition-maintenance job
 *   stopped running". With nothing calling this, EVERY row lands there — so on day one
 *   a hundred percent of the log arrives in the signal that means the system is broken,
 *   and the signal is worthless from then on.
 *
 *   sweepUnapplied — `applied_at IS NULL` is the whole payoff of writing the log before
 *   performing the effect. `decisions_unapplied_idx` indexes it and nothing queried it,
 *   which means the asymmetry bought a repair queue nobody could see. Counting it at
 *   boot is the smallest honest version: a count that grows rather than drains is a
 *   stage failing after it logged.
 */
/** `2026-08-19`. The width of an ISO date, which is what ensure_decision_partition takes. */
const DATE_LENGTH = 10;
const MS_PER_DAY = 86_400_000;

export interface Maintenance {
  /** Create today's and tomorrow's partitions. Idempotent; safe to call every day. */
  ensurePartitions(now: Millis): Promise<readonly string[]>;
  /** How many logged decisions never had their side effect land. */
  countUnapplied(sinceMs: Millis, limit: number): Promise<number>;
}

/**
 * Opens the pool, takes the singleton lock, builds the ports, and runs `use`
 * inside all three. The lock is released and the pool closed only after `use`
 * resolves — releasing either while a loop is still writing would hand the queue
 * to a second runner mid-flight.
 */
export async function withRuntime<T>(
  cfg: RunnerConfig,
  log: Logger,
  use: (runtime: Runtime) => Promise<T>,
): Promise<T> {
  // The runner writes decisions and judgements, so it holds the `internal` role
  // and no other. Configuration owns the one read of process.env in this
  // service, which is why the URL is handed in rather than read again here.
  const pool = createPool(DB_ROLE.internal, {
    applicationName: `insidor-runner@${cfg.host}`,
    env: { DATABASE_URL_INTERNAL: cfg.databaseUrl },
  });

  try {
    // A session advisory lock, not a row. Session mode (5432) is required for
    // this to hold; transaction mode cannot keep a session lock, which is why
    // createPool refuses the transaction-mode pooler for this role.
    //
    // The result is wrapped in an object so that "the lock was not free" (null)
    // stays distinguishable from "the work returned null" — the same distinction
    // between empty and dead that the rest of this service is built around.
    const outcome = await withAdvisoryLock(pool, advisoryLockKey(cfg.singletonLockName), async () => {
      // The lock-holding client does nothing else: repositories run on the pool,
      // so seven loops do not serialise behind one backend.
      const db = asDb(pool);
      const decisions = new PgDecisionRepo(db);
      const decisionRepo: DecisionRepo = decisions;
      const stageRunRepo: StageRunRepo = new PgStageRunRepo(db);

      const repos: StageRepos = {
        items: new PgItemRepo(db),
        authors: new PgAuthorRepo(db),
        observations: new PgObservationRepo(db),
        stories: new PgStoryRepo(db),
        assets: new PgAssetRepo(db),
        decisions,
      };

      // The policy body lives in code and is hashed here, once, at boot. The
      // body is recorded under its hash before the first decision of that
      // version is written: a hash whose body nobody kept is not an audit
      // trail, it is a checksum of something we lost.
      const policy = DEFAULT_POLICY;
      const hash = policyHash(policy);
      await decisions.recordPolicy(hash, policy, `runner boot on ${cfg.host}`);
      log.info('policy loaded', { policyHash: hash });

      const stageRuns: StageRunRecorder = {
        open: (stage, host, startedAt) => stageRunRepo.open(stage, host, startedAt),
        // `result` carries a compression ratio this port computes for its own
        // logging; the repository recomputes what it stores from itemsIn and
        // itemsOut, so the extra field is ignored rather than invented.
        close: (runId, result) =>
          stageRunRepo.close(runId, {
            outcome: result.outcome,
            err: result.err,
            itemsIn: result.itemsIn,
            itemsOut: result.itemsOut,
            durationMs: result.durationMs,
          }),
      };

      // Log first, act, then mark: `write` returns the row id the side effect is
      // stamped against, and nothing else in this service is allowed to reorder
      // those three.
      const decisionLog: DecisionLog = {
        write: (decision) => decisionRepo.append(decision),
        markApplied: (rowId, at) => decisionRepo.markApplied(rowId, at),
      };

      const work = storeWork(repos, policy);

      const loopDeps: LoopDeps = {
        policy,
        policyHash: hash,
        decisions: decisionLog,
        log,

        admit: work.admit,
        track: work.track,
        detect: work.detect,
        group: work.group,
        qualify: work.qualify,
        resolve: work.resolve,
        rank: work.rank,
      };

      /**
       * ★ THE PARTITION IS CREATED BEFORE THE FIRST DECISION OF THE DAY, NOT AFTER.
       *
       * Today's and tomorrow's, both, and tomorrow's is the one that matters: a runner
       * that only ever creates today's has nothing in place at midnight, and the first
       * rows of the new day land in `decisions_default` — which is the row the schema
       * defines as "the partition-maintenance job stopped running". Creating a day
       * ahead means the maintenance signal only ever fires when maintenance has
       * genuinely stopped for more than a day.
       */
      const maintenance: Maintenance = {
        ensurePartitions: async (now) => {
          const made: string[] = [];
          for (const offset of [0, MS_PER_DAY]) {
            const day = new Date(now + offset).toISOString().slice(0, DATE_LENGTH);
            await decisions.ensurePartition(day);
            made.push(day);
          }
          return made;
        },
        countUnapplied: async (sinceMs, limit) =>
          (await decisions.unapplied(sinceMs, limit)).length,
      };

      return { value: await use({ db, stageRuns, loopDeps, maintenance }) };
    });

    if (outcome === null) {
      throw new Error(
        `another runner already holds ${cfg.singletonLockName}; refusing to start a second one`,
      );
    }
    return outcome.value;
  } finally {
    await pool.end();
  }
}
