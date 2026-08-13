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
 * WHAT IS DELIBERATELY UNFINISHED, and why it is a `NotImplemented` rather than
 * a plausible stub: each `StageWork` below needs a specific store query and a
 * specific adapter call. Guessing at either would produce a service that runs
 * and does the wrong thing, which is strictly worse than one that runs and says
 * exactly which query is missing — that message lands in
 * `internal.stage_runs.err` through the ordinary finally path, so the skeleton
 * reports its own gaps in the same query that reports real failures.
 *
 * ADAPTERS ARE NOT IMPORTED YET. The workspace declares adapters as
 * `adapters/​*​/​*`, one package per vendor, and their package names are not
 * fixed at the time of writing. Each `pull` below names the adapter call that
 * belongs in it. Adding them is a dependency line and an import, not a redesign:
 * services may import everything, and the ports above do not change.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { StageName } from '@insidor/contracts';
import type { DecisionRepo, StageRunRepo } from '@insidor/contracts/ports/store.ts';
import {
  DB_ROLE,
  PgDecisionRepo,
  PgStageRunRepo,
  asDb,
  createPool,
  withAdvisoryLock,
  type Db,
} from '@insidor/store';

import type { RunnerConfig } from './config.ts';
import { advisoryLockKey, policyHash } from './hash.ts';
import type { Logger } from './log.ts';
import type { DecisionLog, LoopDeps, StageWork } from './loop.ts';
import type { StageRunRecorder } from './run-record.ts';
import { NotImplemented } from './not-implemented.ts';

export interface Runtime {
  readonly db: Db;
  readonly stageRuns: StageRunRecorder;
  readonly loopDeps: LoopDeps;
}

/**
 * A stage whose store queries and adapter calls are still to be written.
 * `hint` is the instruction to whoever opens this file next.
 */
function unwired<Input>(stage: StageName, hint: string): StageWork<Input> {
  return {
    pull: () => Promise.reject(new NotImplemented(`${stage}.pull — ${hint}`)),
    subjectId: () => {
      throw new NotImplemented(`${stage}.subjectId`);
    },
    apply: () => Promise.reject(new NotImplemented(`${stage}.apply`)),
  };
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

      const loopDeps: LoopDeps = {
        policy,
        policyHash: hash,
        decisions: decisionLog,
        log,

        admit: unwired('admit', 'platform discover() via the adapter registry, then toItem()'),
        track: unwired('track', 'claim the due queue FOR UPDATE SKIP LOCKED, then platform observe()'),
        detect: unwired('detect', 'load each tracked item’s observation series and its baseline'),
        group: unwired('group', 'load admitted items plus the open story candidates they share carriers with'),
        qualify: unwired('qualify', 'load the story and its members, then call the judge adapter for a Judgement'),
        resolve: unwired('resolve', 'time-first candidate query over asset, then the venue gates G1..G8'),
        rank: unwired('rank', 'load resolved stories and their current board tick'),
      };

      return { value: await use({ db, stageRuns, loopDeps }) };
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
