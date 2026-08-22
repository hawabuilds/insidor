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
 * THE SEVEN STAGES ARE STILL WIRED AGAINST THE STORE. Their store-backed pulls
 * stand in for observation and the judge; where an input genuinely needs a vendor
 * it arrives as its typed absence and the stage returns the verdict that names
 * the absence. Replacing one with a real adapter changes one `pull` and no other
 * line in this service.
 *
 * ★ THE ADAPTERS ARE NOW IMPORTED — FOR DISCOVERY ONLY, AND THROUGH ONE CALL.
 * `resolvePlatforms` takes the environment slice that config.ts captured at boot
 * and returns the sources that could be built AND the ones that could not, with the
 * reason. It cannot throw for a missing credential, so ZERO LIVE SOURCES BOOTS
 * NORMALLY: the process starts, the health rows say what is dark and why, and the
 * discovery loop runs over an empty set. That is the whole activation story — a
 * credential in the environment is the only thing that turns a source on, and its
 * absence is a displayed state rather than an outage.
 *
 * ★ AND EVERY LIVE ADAPTER IS WRAPPED BEFORE IT LEAVES THIS FILE. `watchedRegistry`
 * is applied here, at the one place a registry is constructed, rather than at each
 * call site — a loop written later would otherwise reach for the unwrapped registry,
 * because that is what the registry function returns, and its calls would work
 * perfectly while the health record said the source had never answered.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { Item, Millis } from '@insidor/contracts';
import type { DecisionRepo, SourceHealthRepo } from '@insidor/contracts/ports/store.ts';
import { inMemoryMeter } from '@insidor/meter';
import { resolvePlatforms, type PlatformRegistry, type PlatformRuntime } from '@insidor/platform-registry';
import {
  DB_ROLE,
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgItemRepo,
  PgObservationRepo,
  PgSourceHealthRepo,
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
import { declareSources, watchedRegistry, type WatchDeps } from './sources.ts';
import { storeWork, type StageRepos } from './work/stages.ts';

export interface Runtime {
  readonly db: Db;
  readonly stageRuns: StageRunRecorder;
  readonly loopDeps: LoopDeps;
  /** Partition maintenance and the unapplied sweep. See `maintain` below. */
  readonly maintenance: Maintenance;
  /** Live sources, already wrapped so every call records its own outcome. */
  readonly platforms: PlatformRegistry;
  /** What `watched` needs, exposed so the discovery loop re-declares each pass. */
  readonly watch: WatchDeps;
  /** Where arrivals land. Narrow on purpose: discovery may write items and nothing else. */
  readonly store: (items: readonly Item[]) => Promise<number>;
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

      /* ★ ASSIGNED DIRECTLY RATHER THAN THROUGH A LAMBDA, and that is what carries the
         widening. `StageRunRecorder.open` takes a `SupervisedName` — wider than the
         seven, because discovery is supervised and is not a decision stage — while
         `PgStageRunRepo.open` takes a `StageName`. A method parameter is bivariant in
         TypeScript, so the repository satisfies the wider port with nothing cast and
         nothing silenced; the column it writes to is free text, which is why the
         widening is safe at the database as well as at the type. chainwatch relies on
         exactly this and argues it at length. A wrapping lambda would have had to cast
         its own argument, which is the version that hides the decision. */
      const stageRuns: StageRunRecorder = new PgStageRunRepo(db);
      const sourceHealth: SourceHealthRepo = new PgSourceHealthRepo(db);

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

      // Log first, act, then mark: `write` returns the row id the side effect is
      // stamped against, and nothing else in this service is allowed to reorder
      // those three.
      const decisionLog: DecisionLog = {
        write: (decision) => decisionRepo.append(decision),
        markApplied: (rowId, at) => decisionRepo.markApplied(rowId, at),
      };

      const work = storeWork(repos, policy);

      /* ── the sources ────────────────────────────────────────────────────
         Everything below is construction, and none of it can fail the boot. */

      const watch: WatchDeps = { health: sourceHealth, now: () => Date.now(), log };

      const runtimeDeps: PlatformRuntime = {
        meter: inMemoryMeter({
          dailyCapUsd: policy.budget.dailyUsd,
          softStop: policy.budget.softStopFraction,
          now: () => Date.now(),
        }),
        now: () => Date.now(),
        /* Read off `globalThis` HERE and nowhere below. Every adapter takes it as a
           dep precisely so that no package under adapters/ can reach the network from
           a unit test; this is the one file entitled to hand over the real one. */
        fetch: globalThis.fetch,
        /**
         * ★ NO HANDLE LOOKUP YET, AND SAYING SO IS THE POINT.
         *
         * One source addresses posts by URL, so re-reading one needs the author's
         * handle. We hold that on the author row, but there is no synchronous read for
         * it and this signature is synchronous — an adapter cannot await a database.
         * Returning null means those posts are SKIPPED rather than requested under a
         * guessed URL, which is the honest failure: a wrong URL costs a paid run and
         * returns nothing, and the run would look like the source having nothing to
         * say. What changes it is a warmed handle cache loaded per pass and closed
         * over here; until then this is a stated absence rather than a silent one.
         */
        handles: () => null,
      };

      const platforms = watchedRegistry(resolvePlatforms(cfg.sourceEnv, runtimeDeps), watch);

      /* ★ WRITTEN AT BOOT AND NOT ONLY PER PASS. The dormant/failing distinction has to
         be true on a deploy where discovery is switched off entirely, and it has to be
         true within seconds of a restart rather than at the end of the first cadence —
         otherwise a fresh process spends five minutes with an indicator that says
         nothing at all about sources it already knows everything about. */
      await declareSources(platforms, watch);
      log.info('sources resolved', {
        live: platforms.all().map((a) => String(a.id)),
        dark: platforms.absent().map((a) => `${a.source}:${a.configuration}`),
      });

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

      return {
        value: await use({
          db,
          stageRuns,
          loopDeps,
          maintenance,
          platforms,
          watch,
          store: (items: readonly Item[]) => repos.items.upsert(items),
        }),
      };
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
