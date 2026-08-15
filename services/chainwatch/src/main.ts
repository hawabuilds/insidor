/**
 * The mint watcher: one long-lived process, one durable cursor, one coverage log.
 *
 * It is a separate deployable from the runner for one reason that is worth
 * stating plainly: every runner deploy restarts the runner, and a restart in
 * the middle of a cursor is a hole in the coverage log. A hole makes an outcome
 * label CENSORED rather than NEGATIVE, and censoring a label because we shipped
 * a feature is the sort of measurement damage nobody notices until the model
 * trained on it starts being wrong.
 *
 * THE ORDER OF WRITES IN THE CYCLE IS THE WHOLE DESIGN:
 *
 *   1. read the feed
 *   2. persist the mints
 *   3. record any gap — the ones the page reported inside its own window, and
 *      the silence since the previous read
 *   4. ONLY THEN advance the durable cursor, over the parts of the window that
 *      step 3 did not just declare dark
 *
 * Reversing 2 and 4 loses mints silently: the cursor says we have seen a window
 * that no row can account for, and a lost mint is a lead-time claim we cannot
 * honestly make. Doing 3 before 2 would record a hole we then filled.
 *
 * ★ THE CLAUSE ON STEP 4 IS NOT A REFINEMENT, and severing a live socket is what
 * made it visible. Step 4 used to write ONE row over the whole read-to-read
 * interval. When step 3 had just declared a 612ms socket outage inside that
 * interval, the two rows disagreed: the gap row said those 612ms were dark, and
 * the observed row laid over the top of it said the whole interval was watched.
 * A coverage row is a claim, not a note, so the pair is not merely untidy — the
 * observed one is false, and it is the one that any sum of "time we were
 * watching" reads. So step 4 subtracts every hole this cycle declared and writes
 * what is left, which may be two rows, or none at all.
 *
 * A failed cycle extends nothing, so a vendor outage, a crash and a deploy all
 * produce the same evidence. But NOT EXTENDING THE WATERMARK IS NOT BY ITSELF A
 * RECORD, and believing it was cost eight mints under a live failure injection:
 * the next success only reports a hole when the silence outlasts the coverage
 * tolerance, and a failure that recovers inside that tolerance was written up as
 * one clean, wide window. So a cycle that failed AFTER its read answered
 * declares that window itself, in the catch — see `readNotStored`.
 */

import { setTimeout as delay } from 'node:timers/promises';

import type { Millis } from '@insidor/contracts';

import { backoffDelayMs, type BackoffOptions } from './backoff.ts';
import { loadChainwatchConfig, type ChainwatchConfig } from './config.ts';
import { createCoverage, observedSegments, type Gap } from './coverage.ts';
import type { MintCursor } from './cursor.ts';
import { createHeartbeat } from './heartbeat.ts';
import { createWatchState, startHealthServer } from './health.ts';
import { createLogger, errorText } from './log.ts';
import type { RunOutcome } from './run-record.ts';
import { withRuntime, type Runtime } from './wiring.ts';

const log = createLogger({ svc: 'chainwatch' });

/** Never sleep less than this. A cycle that computes to zero bills by the second. */
const MIN_SLEEP_MS = 1_000;
const STAGE = 'chainwatch';

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // Aborted: shutting down.
  }
}

async function main(): Promise<void> {
  const cfg = loadChainwatchConfig(process.env);
  log.info('booting', {
    host: cfg.host,
    feedId: cfg.feedId,
    chain: cfg.chain,
    transport: cfg.transport,
    pollIntervalMs: cfg.pollIntervalMs,
    coverageToleranceMs: cfg.coverageToleranceMs,
  });

  // The loop runs INSIDE the singleton lock rather than after acquiring one,
  // because a session advisory lock lives exactly as long as its session. See
  // wiring.ts. Everything below is the same cycle it always was.
  await withRuntime(cfg, log, (runtime) => watch(cfg, runtime));
}

async function watch(cfg: ChainwatchConfig, runtime: Runtime): Promise<void> {
  const startedAt = Date.now();
  const state = createWatchState(startedAt);
  const server = startHealthServer(
    cfg.healthPort,
    state,
    cfg.coverageToleranceMs,
    () => Date.now(),
    log,
  );
  const heartbeat = createHeartbeat(cfg.heartbeat, log);
  const backoff: BackoffOptions = { baseMs: cfg.backoffBaseMs, maxMs: cfg.backoffMaxMs };

  const ac = new AbortController();
  let shuttingDown = false;
  const stop = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal, graceMs: cfg.shutdownGraceMs });
    // Aborting ends the sleep and ends the loop after the current cycle's
    // `finally` has closed its run row. An abandoned row would read as a fault.
    ac.abort();
    // A cycle wedged on a hung vendor read must not hold a deploy open forever.
    // Exiting non-zero is correct here: the run row stays open, which is an
    // accurate record of a process that did not finish what it started.
    setTimeout(() => {
      log.error('shutdown grace expired; forcing exit');
      process.exit(1);
    }, cfg.shutdownGraceMs).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // Resume.
  //
  // A feed that has never been watched loads a COLD cursor and that is a normal,
  // successful load: there is no earlier window, so there is nothing to have
  // missed. A load that THROWS is the other thing entirely — we cannot see the
  // watermark, and there may well be one. Starting cold on that would erase it and
  // then write a coverage row claiming the window began at this read, which turns
  // an outage into a clean-looking run and costs exactly the evidence this process
  // exists to produce. So it is fatal, deliberately: the container restarts, the
  // watermark is still in the table, and the silence becomes a recorded gap on the
  // first read that succeeds. A process that refuses to start is recoverable; a
  // process that quietly forgets where it was is not.
  let cursor: MintCursor;
  try {
    cursor = await runtime.cursors.load(cfg.feedId);
  } catch (e) {
    server.close();
    throw new Error(
      `cursor for ${cfg.feedId} could not be loaded (${errorText(e)}); refusing to start cold ` +
        'over a watermark that may exist — restart and resume rather than lose the window',
    );
  }

  // ★ The watermark survives the restart. This is what turns a deploy into a
  //   recorded gap rather than an invisible one.
  const coverage = createCoverage({
    toleranceMs: cfg.coverageToleranceMs,
    resumeFrom: cursor.readAt,
  });
  log.info('resumed', { position: cursor.position, readAt: cursor.readAt });

  let consecutiveFailures = 0;

  /*
   * ★ EVERY HOLE DECLARED SINCE THE LAST WINDOW WE CLOSED, so that the next
   * window we close can be carved around it.
   *
   * It lives outside the loop on purpose. A gap recorded on a cycle that then
   * FAILED is still a hole in the interval the next successful cycle will report
   * — because a failed cycle does not move the watermark, so the next success
   * starts its window back where the failed one did and spans straight over it.
   * Keeping the list per-cycle would carve correctly only when the same cycle
   * both declared the hole and closed the window, which is the easy half.
   *
   * Cleared when a window is successfully closed over it, and never before: an
   * entry that has not yet been subtracted from a written row is an entry that
   * is still load-bearing.
   */
  let pendingHoles: Gap[] = [];

  /**
   * One place where a gap becomes a row, a log line and a counter, so that no
   * caller can record one and forget to remember it. See `pendingHoles`.
   */
  const recordGap = async (gap: Gap): Promise<void> => {
    await runtime.sink.recordGap(gap);
    pendingHoles.push(gap);
    state.gapsRecorded += 1;
    state.lastGap = gap;
    log.warn('coverage gap recorded', { ...gap });
  };

  while (!ac.signal.aborted) {
    const started = Date.now();
    let outcome: RunOutcome = 'ok';
    let err: string | null = null;
    let seen = 0;
    let runId: string | null = null;
    /*
     * The window this cycle's read answered for, remembered so the `catch` can
     * still name it. Null until the read returns, which is what distinguishes a
     * read that never happened from a read whose mints never landed — two
     * failures that look identical from outside the try and mean opposite
     * things. See the catch.
     */
    let readWindow: { from: Millis; to: Millis } | null = null;

    try {
      runId = await runtime.stageRuns.open(STAGE, cfg.host, started);
      state.lastReadAt = started;

      const page = await runtime.feed.read(cursor, cfg.pageLimit, ac.signal);
      readWindow = { from: page.from, to: page.to };
      seen = page.mints.length;

      // The window this cycle is about to close: from the last successful read to
      // this one. Read BEFORE `observed()` moves the watermark. On the first read
      // ever there is no earlier one, so the window starts where this read did —
      // never earlier, which would claim coverage of time nobody watched.
      const coveredFrom = coverage.watermark() ?? page.from;

      // 2 — durable before the cursor moves past them.
      if (seen > 0) await runtime.sink.recordMints(page.mints);

      // 3a — windows INSIDE this read that the source could not answer for.
      //
      // A poll never has any: a read either succeeded or threw, and a throw is
      // measured below as silence between two successes. A stream does, because
      // its connection can drop and recover between two reads that both returned
      // on time — and that hole is invisible to `observed()`, which has no
      // silence to measure. Recorded before the silence check so that when both
      // describe the same window they merge onto one coverage row, gap flag
      // first.
      for (const window of page.blind) await recordGap(window);

      // 3b — the silence since the previous successful read, if any.
      const silence = coverage.observed(page.to);
      if (silence !== null) await recordGap(silence);

      // A full page means the source may have had more than it gave us. Being
      // connected is not the same as being complete.
      if (page.pageFull) {
        await recordGap(coverage.pageOverflow(page.from, page.to, cfg.pageLimit));
      }

      /*
       * 4 — and only now. The save carries the windows it closed, because the
       * resume position is a column on the coverage row and not a table of its
       * own: a position nobody can tie to an interval proves nothing.
       *
       * ★ AND IT CARRIES ONLY WHAT IS LEFT once every hole above is taken out.
       * The gap rows and the observed rows have to partition this interval, not
       * layer over it — one row saying a window was dark while another says the
       * span containing it was watched is a contradiction the table cannot
       * resolve, and the reader that resolves it wrongly is the one totalling up
       * how long we were watching. `observedSegments` is where that arithmetic
       * lives and why it is pure.
       *
       * Empty is a legal answer: a cycle whose whole window was dark claims
       * nothing, and `cursors.save` is required not to invent a row to put the
       * position on.
       */
      cursor = page.cursor;
      const segments = observedSegments(coveredFrom, page.to, pendingHoles);
      await runtime.cursors.save(cursor, segments);
      // Closed over. Anything still unsubtracted would be subtracted twice.
      pendingHoles = [];

      state.lastSuccessAt = page.to;
      state.mintsSeen += seen;
      state.lastError = null;
      outcome = seen === 0 ? 'empty' : 'ok';
      consecutiveFailures = 0;
    } catch (e) {
      outcome = 'error';
      err = errorText(e);
      state.lastError = err;
      consecutiveFailures += 1;
      log.error('watch cycle failed', { err, consecutiveFailures });

      /*
       * ★ A READ THAT ANSWERED AND THEN COULD NOT BE STORED IS A HOLE, AND IT
       * HAS TO BE SAID HERE.
       *
       * `readWindow === null` is the ordinary failure: the read itself threw,
       * so no window was answered for. Nothing to record — the cursor has not
       * moved, a poll will re-read the same window, and a stream's buffer still
       * holds its events. Not extending the watermark is the whole record, and
       * for THAT case the original comment here was right.
       *
       * `readWindow !== null` is the other one, and it was silent until a live
       * failure injection went looking: the feed answered, the mints were
       * drained out of the stream's buffer, and the cycle then failed before
       * `recordMints` made them durable. Those mints are gone. Leaving it to
       * `observed()` only works when the outage outlasts COVERAGE_TOLERANCE_MS
       * — a tolerance that exists to absorb read-cadence jitter and has nothing
       * to say about durability — so a failure that recovers inside it produced
       * one clean, wide coverage row over a window whose mints were destroyed.
       * That is a censored window recorded as a watched one, and every outcome
       * later measured against it inherits the claim.
       *
       * Recorded here rather than at the next success because this is the last
       * place that still knows which window the failed read covered.
       */
      if (readWindow !== null && readWindow.to > readWindow.from) {
        const unstored = coverage.readNotStored(readWindow.from, readWindow.to, err);
        try {
          await runtime.sink.recordGap(unstored);
          /*
           * ★ And it has to be remembered, not only written. A failed cycle does
           * not move the watermark, so the NEXT successful cycle opens its window
           * back where this one did and would otherwise write one observed row
           * straight over this hole — undoing at step 4 exactly what was just
           * declared here. `pendingHoles` is what the next step 4 carves around.
           * Not routed through the `recordGap` helper because the write has to
           * stay inside the try below: a gap write that throws must not replace
           * the error that got us here.
           */
          pendingHoles.push(unstored);
          state.gapsRecorded += 1;
          state.lastGap = unstored;
          log.warn('coverage gap recorded', { ...unstored });
        } catch (gapErr) {
          // The gap write failing is how a database outage looks, and it must
          // not replace the error that got us here. It is loud, and the window
          // is still unproven: the watermark did not move, so the next success
          // measures the silence — which is the weaker of the two records, and
          // is exactly why this one is attempted first.
          log.error('could not record the gap for a read that was never stored', {
            err: errorText(gapErr),
            ...unstored,
          });
        }
      }
    } finally {
      const finished = Date.now();
      state.consecutiveFailures = consecutiveFailures;
      if (runId !== null) {
        try {
          await runtime.stageRuns.close(runId, {
            outcome,
            err,
            itemsIn: seen,
            itemsOut: seen,
            compression: null,
            durationMs: finished - started,
          });
        } catch (closeErr) {
          log.error('could not close run row; it will read as a stuck run', {
            runId,
            err: errorText(closeErr),
          });
        }
      }
      await heartbeat.ping(outcome !== 'error');
    }

    const wait =
      consecutiveFailures === 0
        ? cfg.pollIntervalMs
        : backoffDelayMs(consecutiveFailures, backoff, Math.random());
    const elapsed = Date.now() - started;
    await sleep(Math.max(MIN_SLEEP_MS, wait - elapsed), ac.signal);
  }

  server.close();
  // The pool and the singleton lock are closed by `withRuntime` on the way out of
  // this function, in a `finally`, including when it leaves by throwing.
  log.info('stopped');
}

process.on('uncaughtException', (e) => {
  log.error('uncaught exception', { err: errorText(e) });
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  log.error('unhandled rejection', { err: errorText(e) });
  process.exit(1);
});

main().catch((e: unknown) => {
  log.error('boot failed', { err: errorText(e) });
  process.exit(1);
});
