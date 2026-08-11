/**
 * What a loop IS, and the one body all seven of them share.
 *
 * The seven stages differ in what they pull and what they write. They do not
 * differ in shape, because `Stage<Input>` in contracts makes them uniform:
 * pull subjects, decide purely, log the decision, apply the side effect, mark
 * it applied. Writing that seven times would let the seven copies drift, and
 * the first thing to drift would be the log-then-act ordering below — which is
 * the ordering that makes a failed side effect recoverable instead of invisible.
 *
 * WHY THE ORDER IS LOG → ACT → MARK (architecture §5.2): a logged decision
 * whose side effect failed leaves `applied_at IS NULL`, which is one query away
 * from a repair. A side effect with no decision row is a permanent hole, and it
 * is correlated with failures, so it biases training exactly where bias hurts.
 *
 * WHY `apply` RUNS ON EVERY VERDICT, not only on `pass`: what a `drop` means
 * operationally is a product decision, and product decisions live in core and
 * store, never here. This service moves data; it does not interpret verdicts.
 */

import type { Decision, Millis, Policy, StageContext, StageName } from '@insidor/contracts';
import type * as core from '@insidor/core';

import { errorText, type Logger } from './log.ts';

/* ── what a run reports ───────────────────────────────────────────────── */

export interface LoopCounts {
  /** Subjects pulled. */
  readonly in: number;
  /** Subjects that passed. `in / out` is the funnel compression diagnostic. */
  readonly out: number;
  /**
   * Subjects whose side effect threw. Non-zero forces the run's outcome to
   * 'error' WITHOUT losing the counts — a run that throws its way out reports
   * items_in = 0, which is how a partially-working stage hides.
   */
  readonly failed: number;
  readonly firstError: string | null;
}

export interface LoopContext {
  /** Aborted on SIGTERM. A loop that ignores it delays every deploy. */
  readonly signal: AbortSignal;
  readonly now: () => Millis;
}

export interface Loop {
  readonly stage: StageName;
  readonly everyMs: number;
  /** Startup stagger. Seven loops all firing at t=0 convoy on the same pool. */
  readonly offsetMs: number;
  run(ctx: LoopContext): Promise<LoopCounts>;
}

/* ── the two things a loop needs from the outside world ───────────────── */

/**
 * The store side of the log-then-act asymmetry. `write` returns the row id so
 * `markApplied` can close it; a repo that cannot return the id cannot support
 * the asymmetry at all.
 */
export interface DecisionLog {
  write(decision: Decision): Promise<string>;
  markApplied(rowId: string, at: Millis): Promise<void>;
}

/**
 * One stage's connection to everything outside core.
 *
 * `pull` is where an adapter call or a store query happens. `apply` is where
 * the result is persisted. Both are async; the decider between them is not,
 * and cannot be, which is the whole replay guarantee.
 */
export interface StageWork<Input> {
  pull(limit: number, ctx: LoopContext): Promise<readonly Input[]>;
  /** Stable, per subject. Seeds holdout and epsilon assignment deterministically. */
  subjectId(input: Input): string;
  apply(input: Input, decision: Decision): Promise<void>;
}

/**
 * Stage input types, taken from core's own signatures rather than re-declared.
 * If core changes what `admit` accepts, this service fails to typecheck instead
 * of quietly passing the wrong object.
 */
export type AdmitInput = Parameters<typeof core.admit>[0];
export type TrackInput = Parameters<typeof core.track>[0];
export type DetectInput = Parameters<typeof core.detect>[0];
export type GroupInput = Parameters<typeof core.group>[0];
export type QualifyInput = Parameters<typeof core.qualify>[0];
export type ResolveInput = Parameters<typeof core.resolve>[0];
export type RankInput = Parameters<typeof core.rank>[0];

export interface LoopDeps {
  /** Loaded once at boot. A policy that changes mid-run breaks the audit trail. */
  readonly policy: Policy;
  readonly policyHash: string;
  readonly decisions: DecisionLog;
  readonly log: Logger;

  readonly admit: StageWork<AdmitInput>;
  readonly track: StageWork<TrackInput>;
  readonly detect: StageWork<DetectInput>;
  readonly group: StageWork<GroupInput>;
  readonly qualify: StageWork<QualifyInput>;
  readonly resolve: StageWork<ResolveInput>;
  readonly rank: StageWork<RankInput>;
}

/* ── the shared body ──────────────────────────────────────────────────── */

export interface StageLoopSpec<Input> {
  readonly stage: StageName;
  readonly everyMs: number;
  readonly offsetMs: number;
  readonly batchSize: number;
  /** A core stage. Synchronous by type, therefore incapable of I/O. */
  readonly decide: (input: Input, policy: Policy, ctx: StageContext) => Decision;
  readonly work: StageWork<Input>;
}

export function makeStageLoop<Input>(spec: StageLoopSpec<Input>, deps: LoopDeps): Loop {
  return {
    stage: spec.stage,
    everyMs: spec.everyMs,
    offsetMs: spec.offsetMs,

    async run(ctx: LoopContext): Promise<LoopCounts> {
      // A failure here means we never saw any work, so the counts really are
      // zero and throwing loses nothing. Everything after this point is
      // per-subject and must not take the batch down with it.
      const inputs = await spec.work.pull(spec.batchSize, ctx);

      let passed = 0;
      let failed = 0;
      let firstError: string | null = null;

      for (const input of inputs) {
        if (ctx.signal.aborted) break;

        const subjectId = spec.work.subjectId(input);
        try {
          const stageCtx: StageContext = {
            // The clock is read HERE and handed in as a value. The decider
            // cannot ask what time it is, so a replay gets the same answer.
            now: ctx.now(),
            policyHash: deps.policyHash,
            seed: `${spec.stage}:${subjectId}`,
          };

          const decision = spec.decide(input, deps.policy, stageCtx);

          const rowId = await deps.decisions.write(decision); // log …
          await spec.work.apply(input, decision); //             … then act …
          await deps.decisions.markApplied(rowId, ctx.now()); // … then mark

          if (decision.verdict === 'pass') passed += 1;
        } catch (e) {
          failed += 1;
          const text = errorText(e);
          firstError ??= `${subjectId}: ${text}`;
          // One poison subject must not stall a stage forever. It is counted,
          // it is logged, and it forces the run's outcome to 'error', so it is
          // never silent — but the other 499 subjects still get decided.
          deps.log.error('subject failed', { stage: spec.stage, subjectId, err: text });
        }
      }

      return { in: inputs.length, out: passed, failed, firstError };
    },
  };
}
