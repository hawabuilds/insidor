/**
 * The runner process: eight supervised loops, one Node process, one deployable.
 *
 * Seven of them are the decision stages. The eighth is discovery, which decides
 * nothing and is supervised for exactly the same reason they are — a loop that stops
 * finishing must be visible within one cadence, whether or not it was making
 * judgements. See loops/discover.ts for why it does not go through the shared stage
 * body, and config.ts for why `discover` is deliberately not a StageName.
 *
 * This file does four things and nothing else — load configuration, build the
 * runtime, start the loops, and shut them down cleanly. There is no logic here
 * because there is no logic in this package: every decision is made by a pure
 * function in core, every vendor call is made by an adapter, every statement of
 * SQL is in store. A service that grows an `if` about the product has taken a
 * decision out of the place where it can be replayed.
 *
 * SHUTDOWN IS PART OF THE CORRECTNESS STORY, not politeness. Every deploy
 * restarts this process; a restart that abandons an in-flight run leaves the
 * run row open forever and pages the watchdog for a fault that never happened.
 * SIGTERM aborts the signal, each loop's `finally` closes its row, and only
 * then does the pool close.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { loadRunnerConfig } from './config.ts';
import { createHealthRegistry, startHealthServer } from './health.ts';
import { createHeartbeat } from './heartbeat.ts';
import { createLogger, errorText } from './log.ts';
import type { Loop } from './loop.ts';
import { supervise, type SupervisorDeps } from './supervisor.ts';
import { withRuntime } from './wiring.ts';

import { admitLoop } from './loops/admit.ts';
import { detectLoop } from './loops/detect.ts';
import { discoverLoop } from './loops/discover.ts';
import { groupLoop } from './loops/group.ts';
import { qualifyLoop } from './loops/qualify.ts';
import { rankLoop } from './loops/rank.ts';
import { resolveLoop } from './loops/resolve.ts';
import { trackLoop } from './loops/track.ts';

const log = createLogger({ svc: 'runner' });

/** Abortable sleep. An unabortable one makes every deploy wait a full cadence. */
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // Aborted: shutdown is in progress and there is nothing to wait for.
  }
}

/**
 * Six hours, and it is a re-check interval rather than a schedule.
 *
 * `ensurePartitions` creates today's AND tomorrow's, so one successful call buys at
 * least a day of headroom and the cadence only has to be comfortably under that. Six
 * hours means four attempts before the headroom runs out, so a database that was
 * unreachable at one attempt has three more before a single row could land in the
 * default partition — and it is not tied to the wall clock, so a process started at
 * 23:59 is not one minute away from its first rollover.
 */
const PARTITION_MAINTENANCE_MS = 21_600_000;

/**
 * ★ THE MAINTENANCE THAT WAS DOCUMENTED AND NEVER RAN.
 *
 * `internal.decisions` is partitioned by day. 0006 creates a DEFAULT partition and says
 * a row landing in it means the partition-maintenance job stopped running. This process
 * IS that job — wiring.ts has said so since `Maintenance` was written — and until this
 * function existed nothing here called it. Only `decide-once.ts` did.
 *
 * The consequence was not the cosmetic one. Every decision this runner ever wrote landed
 * in `decisions_default`, so on day one a hundred percent of the log arrived in the
 * signal that means the system is broken. Worse, it broke a second documented command:
 * the next `pnpm db:decide` asked Postgres to create that day's partition, Postgres
 * re-validated the default against the new range, found the runner's rows there, and
 * raised — permanently, because stopping the runner does not remove the rows. Two
 * documented commands, and running one bricked the other until a destructive reset.
 *
 * ★ THE FIRST CALL IS AWAITED BEFORE ANY LOOP STARTS, which is the half that matters.
 * A version that only started this alongside the stages would race the first ADMIT pass
 * for the first rows of a boot, and the rows it lost that race for are exactly the ones
 * nobody would ever look for.
 *
 * It never throws. A partition that could not be created is a bookkeeping failure, and
 * the default partition is what makes it survivable — the decisions still get written.
 * Taking the runner down over it would be the maintenance of the safety net tearing the
 * net. It is logged at error level, every attempt, so it cannot be a quiet failure.
 */
type PartitionMaintenance = { ensurePartitions(now: number): Promise<readonly string[]> };

async function ensurePartitionsNow(maintenance: PartitionMaintenance): Promise<void> {
  try {
    const partitions = await maintenance.ensurePartitions(Date.now());
    log.info('decision partitions ensured', { partitions });
  } catch (e) {
    log.error('could not ensure decision partitions', { err: errorText(e) });
  }
}

/** Sleeps FIRST: the boot call is made by the caller, awaited, before a loop can run. */
async function maintainPartitions(
  maintenance: PartitionMaintenance,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    await sleep(PARTITION_MAINTENANCE_MS, signal);
    if (signal.aborted) return;
    await ensurePartitionsNow(maintenance);
  }
}

async function main(): Promise<void> {
  // The ONE read of process.env in this service. Throws, loudly, listing every
  // missing key, before anything is opened.
  const cfg = loadRunnerConfig(process.env);
  log.info('booting', {
    host: cfg.host,
    healthPort: cfg.healthPort,
    heartbeat: cfg.heartbeat.kind,
    /* Printed on every boot including the ordinary one. A field that appears only
       when something is off is a field nobody knows the normal value of. */
    discovery: cfg.discovery.kind,
  });

  // Everything runs INSIDE the runtime callback, because the singleton advisory
  // lock lives exactly as long as the session that holds it. Returning from here
  // is what releases the lock and closes the pool, in that order, and it happens
  // only once the loops have stopped.
  await withRuntime(cfg, log, async (runtime) => {
    const startedAt = Date.now();
    const health = createHealthRegistry(cfg.host, startedAt);
    const server = startHealthServer(cfg.healthPort, health, () => Date.now(), log);

    const ac = new AbortController();
    const supervisorDeps: SupervisorDeps = {
      stageRuns: runtime.stageRuns,
      heartbeat: createHeartbeat(cfg.heartbeat, log),
      health,
      host: cfg.host,
      log,
      signal: ac.signal,
      now: () => Date.now(),
      sleep,
      random: Math.random,
    };

    const loops: readonly Loop[] = [
      /* ★ FIRST IN THE LIST AND LAST TO START (see its offset). It is the only loop
         that talks to a vendor, and it is the one that must run whether any source is
         live or not: with none configured it declares that plainly, records it, and
         returns — which is what keeps "we ingest from nothing" a visible state rather
         than an absence of log lines. */
      discoverLoop({
        platforms: runtime.platforms,
        store: runtime.store,
        discovery: cfg.discovery,
        policy: runtime.loopDeps.policy,
        meter: runtime.meter,
        /* ★ THE ONE PLACE `SPEND` IS TURNED INTO BEHAVIOUR, and it reaches exactly the
           loop that can contact a vendor. Handing it to the other seven would suggest
           they have a paid path to switch off, which they do not — every one of them
           reads rows we already hold. */
        mode: cfg.spend.kind,
        log,
        watch: runtime.watch,
      }),
      admitLoop(runtime.loopDeps),
      trackLoop(runtime.loopDeps),
      detectLoop(runtime.loopDeps),
      groupLoop(runtime.loopDeps),
      qualifyLoop(runtime.loopDeps),
      resolveLoop(runtime.loopDeps),
      rankLoop(runtime.loopDeps),
    ];

    /* ★ BEFORE THE LOOPS, AND AWAITED. See maintainPartitions: the first decision of a
       boot must not be able to precede the partition it belongs in. */
    await ensurePartitionsNow(runtime.maintenance);
    const maintaining = maintainPartitions(runtime.maintenance, ac.signal);

    const running = loops.map((loop) => supervise(loop, supervisorDeps));
    log.info('supervising', { loops: loops.map((l) => l.stage) });

    // Both listeners stay registered, so a second SIGTERM from an impatient
    // deploy is absorbed rather than killing the process mid-run: `resolve` on
    // an already-settled promise is a no-op.
    const signalled = new Promise<string>((resolve) => {
      process.on('SIGTERM', () => resolve('SIGTERM'));
      process.on('SIGINT', () => resolve('SIGINT'));
    });

    const reason = await Promise.race([
      signalled,
      Promise.allSettled(running).then(() => 'every loop returned'),
    ]);
    log.info('shutting down', { reason, graceMs: cfg.shutdownGraceMs });
    ac.abort();

    // Bounded: a loop wedged on a hung vendor call must not hold the deploy
    // open forever. Its run row stays open, which is the correct record of
    // what happened.
    /* `maintaining` is in here rather than in the race above: it returns only when the
       signal aborts, so a version that let it decide "every loop returned" would hold a
       finished runner open for six hours. Settled here so the pool does not close under
       an in-flight CREATE TABLE. */
    await Promise.race([
      Promise.allSettled([...running, maintaining]),
      delay(cfg.shutdownGraceMs),
    ]);

    /**
     * ★ THE LEDGER IS FLUSHED LAST, AFTER THE LOOPS AND BEFORE THE POOL CLOSES.
     *
     * Spend is written BEHIND the call — `Meter.record` is synchronous because it runs
     * inside an adapter, on the path of every request — so at this instant the last
     * few writes of the process may still be in flight. Exiting without waiting drops
     * exactly the spend of the final pass, and the process most likely to be shut down
     * mid-pass is the one being redeployed, which is also the one about to start again
     * with a budget it believes is untouched.
     *
     * ★ AND IT IS RACED AGAINST THE SAME GRACE PERIOD, for the reason the line above
     * is: a database that has gone away must not hold a deploy open. Losing the flush
     * is not silent — those dollars are already counted on `BudgetLine.unrecordedUsd`
     * and were logged when their write failed.
     */
    await Promise.race([runtime.meter.drain(), delay(cfg.shutdownGraceMs)]);
    const unrecorded = runtime.meter.unrecordedUsd();
    if (unrecorded > 0) {
      log.warn('shutting down with spend that never reached the ledger', {
        unrecordedUsd: unrecorded,
      });
    }

    server.close();
  });

  log.info('stopped');
  process.exit(0);
}

// Fail loudly. A process that survives its own unhandled rejection is a process
// running in a state nobody designed, and it will keep writing decisions.
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
