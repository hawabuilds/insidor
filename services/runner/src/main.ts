/**
 * The runner process: seven supervised loops, one Node process, one deployable.
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

async function main(): Promise<void> {
  // The ONE read of process.env in this service. Throws, loudly, listing every
  // missing key, before anything is opened.
  const cfg = loadRunnerConfig(process.env);
  log.info('booting', { host: cfg.host, healthPort: cfg.healthPort, heartbeat: cfg.heartbeat.kind });

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
      admitLoop(runtime.loopDeps),
      trackLoop(runtime.loopDeps),
      detectLoop(runtime.loopDeps),
      groupLoop(runtime.loopDeps),
      qualifyLoop(runtime.loopDeps),
      resolveLoop(runtime.loopDeps),
      rankLoop(runtime.loopDeps),
    ];

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
    await Promise.race([Promise.allSettled(running), delay(cfg.shutdownGraceMs)]);
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
