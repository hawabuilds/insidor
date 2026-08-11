/**
 * The supervision loop. This is the most important file in the service, and it
 * is short on purpose: everything it does is about making failure VISIBLE.
 *
 * Read the `finally` block first. The run row is opened before the work and
 * closed in a `finally`, so there are exactly four terminal states and all four
 * are queryable:
 *
 *   outcome='ok'      ran, produced output
 *   outcome='empty'   ran, produced nothing        ← NOT an error
 *   outcome='error'   ran, threw                   ← NOT silence
 *   finished_at NULL  never came back              ← the process was killed
 *
 * The build this replaces had one state for the first three and none for the
 * fourth.
 *
 * Two smaller decisions that are load-bearing:
 *
 *   - THE SLEEP FLOOR. Railway bills by usage, so a cadence that computes to
 *     zero is a runaway invoice, not a busy loop. `Math.max` is not decoration.
 *
 *   - BACKOFF ON CONSECUTIVE FAILURES, which slows a stage that is failing
 *     against a database that is struggling — but every attempt still writes
 *     its run row, so backoff can never turn a broken stage into a quiet one.
 *     Backing off without recording would reintroduce the original bug.
 */

import type { Millis } from '@insidor/contracts';

import type { Heartbeat } from './heartbeat.ts';
import type { HealthRegistry } from './health.ts';
import { errorText, type Logger } from './log.ts';
import type { Loop } from './loop.ts';
import { compressionOf, type RunOutcome, type StageRunRecorder } from './run-record.ts';

/** Never sleep less than this, whatever the arithmetic says. */
const MIN_SLEEP_MS = 1_000;
/** Random spread added to every sleep, so seven loops stop convoying. */
const JITTER_MS = 2_000;
/** Backoff ceiling. Beyond this the watchdog is the right escalation, not patience. */
const MAX_BACKOFF_MS = 300_000;

export interface SupervisorDeps {
  readonly stageRuns: StageRunRecorder;
  readonly heartbeat: Heartbeat;
  readonly health: HealthRegistry;
  readonly host: string;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly now: () => Millis;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Injected so the jitter is deterministic under test. */
  readonly random: () => number;
}

/** Full-jitter exponential backoff over the loop's own cadence. */
export function backoffMs(everyMs: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return everyMs;
  const exponent = Math.min(consecutiveFailures, 16);
  return Math.min(MAX_BACKOFF_MS, everyMs * 2 ** exponent);
}

/**
 * Runs one loop until the signal aborts. Resolves — never rejects. A supervisor
 * that can throw takes one loop down and leaves the process alive with six,
 * which reads externally as a healthy service doing six sevenths of the work.
 */
export async function supervise(loop: Loop, deps: SupervisorDeps): Promise<void> {
  const log = deps.log.child({ stage: loop.stage });
  deps.health.register(loop.stage, loop.everyMs);

  await deps.sleep(loop.offsetMs, deps.signal);

  let consecutiveFailures = 0;

  while (!deps.signal.aborted) {
    const started = deps.now();
    let outcome: RunOutcome = 'ok';
    let counts = { in: 0, out: 0, failed: 0, firstError: null as string | null };
    let err: string | null = null;
    let runId: string | null = null;

    try {
      // ★ BEFORE the work. If the process dies during `run`, this row keeps
      //   `finished_at` NULL forever and the watchdog sees it inside a minute.
      runId = await deps.stageRuns.open(loop.stage, deps.host, started);
      deps.health.runStarted(loop.stage, started);

      counts = await loop.run({ signal: deps.signal, now: deps.now });

      // 'empty' is a run that produced nothing, which is a normal state for a
      // quiet stage. `items_in` on the same row says whether anything arrived.
      outcome = counts.failed > 0 ? 'error' : counts.out === 0 ? 'empty' : 'ok';
      err = counts.firstError;
    } catch (e) {
      outcome = 'error';
      err = errorText(e);
      log.error('loop threw', { err });
    } finally {
      // ★ ALWAYS closed. Every early return, every throw, every abort.
      const finished = deps.now();
      if (runId !== null) {
        try {
          await deps.stageRuns.close(runId, {
            outcome,
            err,
            itemsIn: counts.in,
            itemsOut: counts.out,
            compression: compressionOf(counts.in, counts.out),
            durationMs: finished - started,
          });
        } catch (e) {
          // The row stays open, so this failure surfaces as a stuck run rather
          // than as nothing. That is the safe direction: a false alarm beats
          // the silence we are here to eliminate.
          log.error('could not close run row; it will read as a stuck run', {
            runId,
            err: errorText(e),
          });
        }
      }
      deps.health.runFinished(loop.stage, finished, outcome);
      await deps.heartbeat.ping(loop.stage, outcome);
    }

    consecutiveFailures = outcome === 'error' ? consecutiveFailures + 1 : 0;
    if (consecutiveFailures === 1) log.warn('entering backoff', { consecutiveFailures });

    const target = backoffMs(loop.everyMs, consecutiveFailures);
    const elapsed = deps.now() - started;
    const jitter = deps.random() * JITTER_MS;
    await deps.sleep(Math.max(MIN_SLEEP_MS, target - elapsed + jitter), deps.signal);
  }

  log.info('loop stopped');
}
