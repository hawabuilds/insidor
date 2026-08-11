/**
 * The composition root: the ONE file that knows the names of other packages.
 *
 * Everything else in this service talks to the small ports declared in
 * `loop.ts` and `run-record.ts`. That is not ceremony — it is what keeps the
 * supervision machinery testable without a database, and it means a change to
 * the store's export names costs one file rather than fifteen.
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

import {
  acquireSingletonLock,
  closeDb,
  closeStageRun,
  createDb,
  loadActivePolicy,
  markDecisionApplied,
  openStageRun,
  writeDecision,
  type Db,
} from '@insidor/store';
import type { StageName } from '@insidor/contracts';

import type { RunnerConfig } from './config.ts';
import type { Logger } from './log.ts';
import type { DecisionLog, LoopDeps, StageWork } from './loop.ts';
import type { StageRunRecorder } from './run-record.ts';
import { NotImplemented } from './not-implemented.ts';

export interface Runtime {
  readonly db: Db;
  readonly stageRuns: StageRunRecorder;
  readonly loopDeps: LoopDeps;
  close(): Promise<void>;
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

export async function buildRuntime(cfg: RunnerConfig, log: Logger): Promise<Runtime> {
  const db = createDb(cfg.databaseUrl);

  // A session advisory lock, not a row: two runners draining the same claim
  // queue is failure mode #2 of the serverless build, and it produced double
  // spend with no error anywhere. Session mode (5432) is required for this to
  // hold; transaction mode cannot keep a session lock.
  const solo = await acquireSingletonLock(db, cfg.singletonLockName);
  if (!solo) {
    await closeDb(db);
    throw new Error(
      `another runner already holds ${cfg.singletonLockName}; refusing to start a second one`,
    );
  }

  // Read once, at boot. A policy that changes under a running loop makes the
  // policy hash on the decision row a lie, and the hash is the only thing that
  // makes a past decision auditable.
  const { policy, hash } = await loadActivePolicy(db);
  log.info('policy loaded', { policyHash: hash });

  const stageRuns: StageRunRecorder = {
    open: (stage, host, startedAt) => openStageRun(db, stage, host, startedAt),
    close: (runId, result) => closeStageRun(db, runId, result),
  };

  const decisions: DecisionLog = {
    write: (decision) => writeDecision(db, decision),
    markApplied: (rowId, at) => markDecisionApplied(db, rowId, at),
  };

  const loopDeps: LoopDeps = {
    policy,
    policyHash: hash,
    decisions,
    log,

    admit: unwired('admit', 'platform discover() via the adapter registry, then toItem()'),
    track: unwired('track', 'claim the due queue FOR UPDATE SKIP LOCKED, then platform observe()'),
    detect: unwired('detect', 'load each tracked item’s observation series and its baseline'),
    group: unwired('group', 'load admitted items plus the open story candidates they share carriers with'),
    qualify: unwired('qualify', 'load the story and its members, then call the judge adapter for a Judgement'),
    resolve: unwired('resolve', 'time-first candidate query over asset, then the venue gates G1..G8'),
    rank: unwired('rank', 'load resolved stories and their current board tick'),
  };

  return {
    db,
    stageRuns,
    loopDeps,
    close: () => closeDb(db),
  };
}
