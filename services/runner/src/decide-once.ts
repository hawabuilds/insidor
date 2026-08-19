/**
 * ONE PASS OF EVERY STAGE, OVER WHAT IS IN THE DATABASE, THEN EXIT.
 *
 * `pnpm db:decide`. It exists because the write path was, until this change, only
 * reachable by booting the full runner against a live pipeline — which meant nobody
 * had ever seen a decision row, and `internal.decisions_id_seq.is_called` was still
 * `false` on a database that had been up for three days. A path that cannot be
 * exercised locally is a path that gets its first real test in production.
 *
 * ★ IT SHARES EVERYTHING WITH THE RUNNER AND MOCKS NOTHING. Same `withRuntime`, same
 * advisory lock, same `recordPolicy`, same seven `Loop` objects, same `makeStageLoop`
 * body, same `commitDecision`. The only difference is the supervisor: instead of
 * looping on a cadence with backoff and heartbeats, each loop's `run` is awaited once.
 * If this writes a row, the runner writes the same row — there is no second code path
 * for it to diverge from.
 *
 * WHY IT IS NOT A LOOP: there is no cursor to lose and no partial state that survives
 * a crash, so a program that runs, prints what it wrote and exits is the whole thing.
 * The same argument services/project/src/main.ts makes for the projector.
 *
 * WHY IT STILL TAKES THE SINGLETON LOCK: because it writes decisions, and two
 * processes writing decisions over the same subjects at the same time is the failure
 * the lock exists to foreclose. Running this while the runner is up should fail, and
 * it does — loudly, at boot, with the lock's name in the message.
 */

import { loadRunnerConfig } from './config.ts';
import { createLogger, errorText } from './log.ts';
import type { Loop, LoopContext, LoopCounts } from './loop.ts';
import { withRuntime } from './wiring.ts';

import { admitLoop } from './loops/admit.ts';
import { detectLoop } from './loops/detect.ts';
import { groupLoop } from './loops/group.ts';
import { qualifyLoop } from './loops/qualify.ts';
import { rankLoop } from './loops/rank.ts';
import { resolveLoop } from './loops/resolve.ts';
import { trackLoop } from './loops/track.ts';

const log = createLogger({ svc: 'decide-once' });

/** How far back the unapplied sweep looks when reporting the repair queue. */
const SWEEP_WINDOW_MS = 7 * 86_400_000;
const SWEEP_LIMIT = 10_000;

interface StageOutcome {
  readonly stage: string;
  readonly counts: LoopCounts | null;
  readonly err: string | null;
}

/**
 * Run one loop once and report, never throw.
 *
 * ★ A STAGE THAT REFUSES MUST NOT TAKE THE OTHER SIX WITH IT. RANK's `pull` rejects by
 * design (see work/stages.ts), and a version of this that let the first rejection
 * escape would report nothing about the six stages that did write rows — which is
 * exactly the "a dead pipeline looks like a quiet night" confusion the whole
 * supervision design is a reaction to. Each stage's outcome is its own row here for
 * the same reason each stage's run is its own row in `internal.stage_runs`.
 */
async function runOnce(loop: Loop, ctx: LoopContext): Promise<StageOutcome> {
  try {
    return { stage: loop.stage, counts: await loop.run(ctx), err: null };
  } catch (e) {
    return { stage: loop.stage, counts: null, err: errorText(e) };
  }
}

async function main(): Promise<void> {
  const cfg = loadRunnerConfig(process.env);

  await withRuntime(cfg, log, async (runtime) => {
    const now = () => Date.now();

    /* Before the first decision of the run, not after. A row that lands in
       `decisions_default` means maintenance stopped; it must not also mean "this is
       the first time anybody ran the thing". */
    const partitions = await runtime.maintenance.ensurePartitions(now());
    log.info('partitions ensured', { partitions });

    /* The queue the log-then-act asymmetry exists to create, counted before we add to
       it, so the delta below is attributable to this run. */
    const unappliedBefore = await runtime.maintenance.countUnapplied(
      now() - SWEEP_WINDOW_MS,
      SWEEP_LIMIT,
    );

    // Never aborted: a one-shot has nothing to shut down gracefully, and a signal
    // that is never fired is the honest way to say so.
    const ctx: LoopContext = { signal: new AbortController().signal, now };

    const loops: readonly Loop[] = [
      admitLoop(runtime.loopDeps),
      trackLoop(runtime.loopDeps),
      detectLoop(runtime.loopDeps),
      groupLoop(runtime.loopDeps),
      qualifyLoop(runtime.loopDeps),
      resolveLoop(runtime.loopDeps),
      rankLoop(runtime.loopDeps),
    ];

    /* Sequential, not Promise.all. Seven loops sharing one pool on a laptop convoy on
       each other, and more importantly the stages have a real order — GROUP wants the
       items ADMIT just decided about. One pass in pipeline order is the honest
       simulation of a cadence. */
    const outcomes: StageOutcome[] = [];
    for (const loop of loops) outcomes.push(await runOnce(loop, ctx));

    const unappliedAfter = await runtime.maintenance.countUnapplied(
      now() - SWEEP_WINDOW_MS,
      SWEEP_LIMIT,
    );

    report(outcomes, unappliedBefore, unappliedAfter);
    return null;
  });
}

/**
 * What was written, by stage, on stderr.
 *
 * `rows` is subjects pulled, and it is the number that matters: EVERY pulled subject
 * is written whatever its verdict. A stage with `rows = 40, passed = 0` wrote forty
 * rows, and forty rows of "we looked and said no" is exactly the population a model
 * needs and the one a pipeline that only logs its passes can never produce.
 *
 * ★ `passed` COUNTS SUBJECTS WHOSE PASS ALSO LANDED, which is why a stage can show
 * `passed = 0` next to a `failed` count of twenty. `LoopCounts.out` is incremented
 * after the side effect, so a verdict of `pass` whose effect could not be performed
 * is counted as failed and not as passed — correct, because `out` is the funnel's
 * compression diagnostic and a pass that never took effect did not come out of the
 * funnel. The decision row is written either way; that is the whole asymmetry.
 */
function report(
  outcomes: readonly StageOutcome[],
  unappliedBefore: number,
  unappliedAfter: number,
): void {
  const w = (s: string, n: number) => s.padEnd(n);
  const lines: string[] = [
    '',
    `  ${w('stage', 10)}${w('rows', 8)}${w('passed', 8)}${w('failed', 8)}first error / refusal`,
    `  ${'─'.repeat(60)}`,
  ];

  let total = 0;
  for (const o of outcomes) {
    if (o.counts === null) {
      lines.push(`  ${w(o.stage, 10)}${w('—', 8)}${w('—', 8)}${w('—', 8)}${o.err ?? ''}`);
      continue;
    }
    total += o.counts.in;
    lines.push(
      `  ${w(o.stage, 10)}${w(String(o.counts.in), 8)}${w(String(o.counts.out), 8)}` +
        `${w(String(o.counts.failed), 8)}${o.counts.firstError ?? ''}`,
    );
  }

  lines.push(`  ${'─'.repeat(60)}`);
  lines.push(`  ${w('total', 10)}${w(String(total), 8)}decision rows written`);
  lines.push('');
  lines.push(
    `  unapplied (pass, last 7d):  ${unappliedBefore} → ${unappliedAfter}` +
      '   ← logged, side effect not yet performed. Repairable, and visible, which is' +
      ' the entire point of writing the row first.',
  );
  lines.push('');
  process.stderr.write(`${lines.join('\n')}\n`);
}

main().catch((e: unknown) => {
  log.error('decide-once failed', { err: errorText(e) });
  process.exit(1);
});
