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
 *   3. record any gap
 *   4. ONLY THEN advance the durable cursor
 *
 * Reversing 2 and 4 loses mints silently: the cursor says we have seen a window
 * that no row can account for, and a lost mint is a lead-time claim we cannot
 * honestly make. Doing 3 before 2 would record a hole we then filled.
 *
 * A failed cycle extends nothing. The next successful read compares against the
 * old watermark and records the interval it missed, so a vendor outage, a
 * crash, and a deploy all produce the same evidence.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { backoffDelayMs, type BackoffOptions } from './backoff.ts';
import { loadChainwatchConfig } from './config.ts';
import { createCoverage } from './coverage.ts';
import { coldCursor, type MintCursor } from './cursor.ts';
import { createHeartbeat } from './heartbeat.ts';
import { createWatchState, startHealthServer } from './health.ts';
import { createLogger, errorText } from './log.ts';
import type { RunOutcome } from './run-record.ts';
import { buildRuntime } from './wiring.ts';

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
    transport: cfg.transport,
    pollIntervalMs: cfg.pollIntervalMs,
    coverageToleranceMs: cfg.coverageToleranceMs,
  });

  const runtime = await buildRuntime(cfg, log);
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

  // Resume. If the cursor cannot be loaded we start cold — and say so as a
  // cursor_reset gap, because a cold start after a warm one is not the same
  // thing as a first ever start.
  let cursor: MintCursor;
  try {
    cursor = await runtime.cursors.load(cfg.feedId);
  } catch (e) {
    log.error('cursor could not be loaded; starting cold', { err: errorText(e) });
    cursor = coldCursor(cfg.feedId);
  }

  // ★ The watermark survives the restart. This is what turns a deploy into a
  //   recorded gap rather than an invisible one.
  const coverage = createCoverage({
    toleranceMs: cfg.coverageToleranceMs,
    resumeFrom: cursor.readAt,
  });
  log.info('resumed', { position: cursor.position, readAt: cursor.readAt });

  let consecutiveFailures = 0;

  while (!ac.signal.aborted) {
    const started = Date.now();
    let outcome: RunOutcome = 'ok';
    let err: string | null = null;
    let seen = 0;
    let runId: string | null = null;

    try {
      runId = await runtime.stageRuns.open(STAGE, cfg.host, started);
      state.lastReadAt = started;

      const page = await runtime.feed.read(cursor, cfg.pageLimit, ac.signal);
      seen = page.mints.length;

      // 2 — durable before the cursor moves past them.
      if (seen > 0) await runtime.sink.recordMints(page.mints);

      // 3 — the silence since the previous successful read, if any.
      const silence = coverage.observed(page.to);
      if (silence !== null) {
        await runtime.sink.recordGap(silence);
        state.gapsRecorded += 1;
        state.lastGap = silence;
        log.warn('coverage gap recorded', { ...silence });
      }

      // A full page means the source may have had more than it gave us. Being
      // connected is not the same as being complete.
      if (page.pageFull) {
        const overflow = coverage.pageOverflow(page.from, page.to, cfg.pageLimit);
        await runtime.sink.recordGap(overflow);
        state.gapsRecorded += 1;
        state.lastGap = overflow;
        log.warn('page overflow recorded', { ...overflow });
      }

      // 4 — and only now.
      cursor = page.cursor;
      await runtime.cursors.save(cursor);

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
      // Deliberately no coverage call here. Not extending the watermark IS the
      // record: the next success will measure the hole this cycle left.
      log.error('watch cycle failed', { err, consecutiveFailures });
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
  await runtime.close();
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
