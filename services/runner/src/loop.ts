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
 * ★ THAT ORDERING IS NOT WRITTEN HERE ANY MORE. It lives in `commit.ts`, which
 * owns all three steps and hands `apply` a `DecisionReceipt` that only a
 * completed write can produce. This body cannot decide without committing,
 * because it is never given the decider — only a thunk it passes straight in.
 * See commit.ts for why that is a helper and not a `finally`.
 *
 * WHY `apply` RUNS ON EVERY VERDICT, not only on `pass`: what a `drop` means
 * operationally is a product decision, and product decisions live in core and
 * store, never here. This service moves data; it does not interpret verdicts.
 */

import type { Decision, Millis, Policy, StageContext, StageName } from '@insidor/contracts';
import type * as core from '@insidor/core';

import { commitDecision, type DecisionLog, type DecisionReceipt } from './commit.ts';
import { errorText, type Logger } from './log.ts';

/* The log seam and the receipt are declared in commit.ts, next to the ordering
   they exist to enforce. Re-exported here because this is the file a stage's
   wiring reads to find out what it must supply. */
export type { DecisionLog, DecisionReceipt } from './commit.ts';

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
 * One stage's connection to everything outside core.
 *
 * `pull` is where an adapter call or a store query happens. `apply` is where
 * the result is persisted. Both are async; the decider between them is not,
 * and cannot be, which is the whole replay guarantee.
 *
 * ★ `apply` TAKES A RECEIPT AND NOT A DECISION, and that is the enforcement.
 * A `DecisionReceipt` is unforgeable outside commit.ts, so an implementation of
 * this interface CANNOT perform its side effect against a decision that was
 * never written. The row is not something a stage remembers to log; it is the
 * only thing that unlocks the effect.
 */
export interface StageWork<Input> {
  pull(limit: number, ctx: LoopContext): Promise<readonly Input[]>;
  /** Stable, per subject. Seeds holdout and epsilon assignment deterministically. */
  subjectId(input: Input): string;
  apply(input: Input, receipt: DecisionReceipt): Promise<void>;
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

        /*
         * ★ INSIDE THE TRY, AND IT USED TO BE OUTSIDE IT.
         *
         * `StageWork.subjectId` is a plain sync method and nothing stops it throwing —
         * `rankWork`'s throws NotImplemented on purpose, which is this repository's own
         * proof that the interface permits it. Called above the `try`, one such subject
         * took the WHOLE REMAINING BATCH down: the exception escaped `run()`, so every
         * subject after it in the page was never decided and never logged, and the
         * counts came back as a thrown run rather than as `failed: 1`. That is the
         * "a partially-working stage hides" failure `LoopCounts.failed` exists to
         * prevent, arriving three lines above the comment that promises it cannot.
         *
         * The id therefore starts as a placeholder and is replaced by the real one as
         * the first statement in the block, so the catch below always has something to
         * name — an unidentifiable subject is still a row in `firstError` and still a
         * line in the log, which is the only way anybody finds out it exists.
         */
        let subjectId = '<subject id unavailable>';
        try {
          subjectId = spec.work.subjectId(input);

          const stageCtx: StageContext = {
            // The clock is read HERE and handed in as a value. The decider
            // cannot ask what time it is, so a replay gets the same answer.
            now: ctx.now(),
            policyHash: deps.policyHash,
            seed: `${spec.stage}:${subjectId}`,
          };

          // Decide, log, act, mark — as one indivisible step this body cannot
          // take apart. `spec.decide` is handed over as a thunk rather than
          // called here, so there is no point in this file at which a Decision
          // exists and has not been written.
          const decision = await commitDecision(
            {
              input,
              decide: () => spec.decide(input, deps.policy, stageCtx),
              apply: spec.work.apply.bind(spec.work),
            },
            { decisions: deps.decisions, now: ctx.now },
          );

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
