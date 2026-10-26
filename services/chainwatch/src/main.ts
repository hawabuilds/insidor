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
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { backoffDelayMs, type BackoffOptions } from './backoff.ts';
import { ConfigError, loadChainwatchConfig, type ChainwatchConfig } from './config.ts';
import { createCoverage, observedSegments, type Gap } from './coverage.ts';
import type { MintCursor } from './cursor.ts';
import { createHeartbeat } from './heartbeat.ts';
import { createWatchState, startHealthServer } from './health.ts';
import type { Listing } from './listing.ts';
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
    (req, res) => runtime.live.serve(req, res),
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
  // exists to produce. So it is fatal, deliberately: the boot starts over (`boot`), the
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

  // The launch listing runs beside the socket's cycle on its own clock (listing.ts), and ends
  // with it: the same abort, awaited before the server closes and the lock is released.
  const listingDone = runtime.listing === null ? Promise.resolve() : runListing(runtime.listing, ac.signal);
  // The trade feed likewise: its own clock, the same abort, its socket closed on the way out.
  const tradesDone = runtime.trades === null ? Promise.resolve() : runTrades(runtime.trades, ac.signal);

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

  await listingDone;
  await tradesDone;
  server.close();
  // The pool and the singleton lock are closed by `withRuntime` on the way out of
  // this function, in a `finally`, including when it leaves by throwing.
  log.info('stopped');
}

/**
 * The launch listing's loop. A failed pass waits longer each time (doubling, up to
 * `LISTING_MAX_WAIT_MS`) and never retries faster than the policy's cadence: the listing is a
 * rate-limited API, and a refusal is answered by asking less. A pass refused after its first page
 * keeps what it read but counts as a failure for the wait; a pass held by the day's page budget
 * is not a failure and waits the ordinary cadence. Logged as a summary every
 * `LISTING_SUMMARY_PASSES` passes and on every failure streak's first and tenth failure, so a
 * pass twice a minute does not become a log line twice a minute.
 */
const LISTING_MAX_WAIT_MS = 300_000;
const LISTING_SUMMARY_PASSES = 40;

async function runListing(listing: Listing, signal: AbortSignal): Promise<void> {
  const everyMs = DEFAULT_POLICY.assets.launchListing.everyMs;
  let failures = 0;
  let passes = 0;
  const totals = { listed: 0, added: 0, withoutDetails: 0, behind: 0, credits: 0, pages: 0, held: 0, refused: 0, pairedMarked: 0 };
  while (!signal.aborted) {
    const started = Date.now();
    try {
      const r = await listing.pass();
      // A page refused after the first: what was read is added, and the wait still grows.
      if (r.refused !== null) {
        failures += 1;
        if (failures === 1 || failures % 10 === 0) log.warn('launch listing page refused; the pages before it were kept', { err: r.refused, failures });
      } else failures = 0;
      passes += 1;
      totals.pages += r.pagesRead;
      totals.held += r.held === null ? 0 : 1;
      totals.refused += r.refused === null ? 0 : 1;
      totals.listed += r.listed;
      totals.added += r.added;
      totals.withoutDetails += r.withoutDetails;
      totals.credits += r.credits;
      totals.behind += r.behind ? 1 : 0;
      totals.pairedMarked += r.pairedMarked;
      if (passes % LISTING_SUMMARY_PASSES === 0) {
        log.info('launch listing', { passes: LISTING_SUMMARY_PASSES, ...totals });
        totals.listed = 0;
        totals.added = 0;
        totals.withoutDetails = 0;
        totals.credits = 0;
        totals.behind = 0;
        totals.pages = 0;
        totals.held = 0;
        totals.refused = 0;
        totals.pairedMarked = 0;
      }
    } catch (e) {
      failures += 1;
      if (failures === 1 || failures % 10 === 0) log.warn('launch listing pass failed', { err: errorText(e), failures });
    }
    const wait = Math.min(LISTING_MAX_WAIT_MS, everyMs * 2 ** Math.min(failures, 5));
    await sleep(Math.max(MIN_SLEEP_MS, wait - (Date.now() - started)), signal);
  }
}

/**
 * The trade feed's loop (trade-watch.ts): a pass every `flushMs`; a failed pass waits longer each
 * time, as the listing's does. Every `reportEveryMs` the day's counted cost is logged with the day's
 * projection at the pace since the last report, so the owner can read the bill off the log.
 */
const TRADES_MAX_WAIT_MS = 120_000;

async function runTrades(trades: NonNullable<Runtime['trades']>, signal: AbortSignal): Promise<void> {
  const tf = DEFAULT_POLICY.oneCoin.tradeFeed;
  const tradeLog = log.child({ part: 'trade-feed' });
  try {
    for (;;) {
      if (signal.aborted) return;
      try {
        await trades.watch.boot();
        break;
      } catch (e) {
        tradeLog.warn('trade feed boot failed; trying again', { err: errorText(e) });
        await sleep(TRADES_MAX_WAIT_MS, signal);
      }
    }
    let failures = 0;
    let reportAt = Date.now();
    let reportCredits = trades.watch.status().credits;
    const sums = { trades: 0, truncated: 0, failedDropped: 0, undecodable: 0, openings: 0, ended: {} as Record<string, number> };
    while (!signal.aborted) {
      const started = Date.now();
      try {
        const t = await trades.watch.pass();
        failures = 0;
        sums.trades += t.trades;
        sums.truncated += t.truncated;
        sums.failedDropped += t.failedDropped;
        sums.undecodable += t.undecodable;
        sums.openings += t.openings;
        for (const [k, v] of Object.entries(t.ended)) sums.ended[k] = (sums.ended[k] ?? 0) + (v ?? 0);
      } catch (e) {
        failures += 1;
        if (failures === 1 || failures % 10 === 0) tradeLog.warn('trade feed pass failed', { err: errorText(e), failures });
      }
      const now = Date.now();
      if (now - reportAt >= tf.reportEveryMs) {
        const s = trades.watch.status();
        const pace = s.credits >= reportCredits ? Math.round(((s.credits - reportCredits) * 86_400_000) / (now - reportAt)) : null;
        tradeLog.info('trade feed: the day so far', { dayMB: Math.round(s.bytes / 1e4) / 100, calls: s.calls, dayCredits: Math.round(s.credits), projectedCreditsPerDay: pace, capCredits: tf.dayCapCredits, measuring: s.measuring, dayCapped: s.dayCapped, ...sums });
        reportAt = now;
        reportCredits = s.credits;
        sums.trades = 0;
        sums.truncated = 0;
        sums.failedDropped = 0;
        sums.undecodable = 0;
        sums.openings = 0;
        sums.ended = {};
      }
      const wait = Math.min(TRADES_MAX_WAIT_MS, tf.flushMs * 2 ** Math.min(failures, 5));
      await sleep(Math.max(MIN_SLEEP_MS, wait - (Date.now() - started)), signal);
    }
  } finally {
    trades.stop();
  }
}

process.on('uncaughtException', (e) => {
  log.error('uncaught exception', { err: errorText(e) });
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  log.error('unhandled rejection', { err: errorText(e) });
  process.exit(1);
});

/*
 * ★ A BOOT THAT FAILS IS TRIED AGAIN IN THIS PROCESS, FOREVER, rather than left to the platform.
 * On 2026-10-15 at 07:13 UTC the database went away for a few minutes (its compute was resized;
 * it was back at 07:16:50). This service lost its connection, exited, was restarted by the platform
 * up to its limit of ten failures in quick succession while the database was still down, and then
 * stayed down — eighteen hours with no coin read from the stream. A
 * process that refuses to start is recoverable only while something keeps starting it, so this one
 * keeps starting itself: the same boot (connect, take the lock, load the watermark), after a backoff
 * that grows to a couple of minutes. The watermark is still in the table, so the silence becomes a
 * recorded gap on the first read that succeeds, exactly as a platform restart would make it. A
 * configuration error is the exception: no amount of waiting fixes it, so it still exits.
 */
const BOOT_RETRY: BackoffOptions = { baseMs: 5_000, maxMs: 120_000 };
/** A boot that ran this long before failing starts its backoff over. */
const BOOT_HEALTHY_MS = 10 * 60_000;

async function boot(): Promise<void> {
  let attempt = 0;
  for (;;) {
    const startedAt = Date.now();
    try {
      await main();
      return;
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      attempt = Date.now() - startedAt > BOOT_HEALTHY_MS ? 1 : attempt + 1;
      const retryInMs = backoffDelayMs(attempt, BOOT_RETRY, Math.random());
      log.error('boot failed; trying again in this process', { err: errorText(e), attempt, retryInMs });
      await delay(retryInMs);
    }
  }
}

boot().catch((e: unknown) => {
  log.error('boot failed', { err: errorText(e) });
  process.exit(1);
});
