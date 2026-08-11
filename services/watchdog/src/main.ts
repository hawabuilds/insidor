/**
 * The watchdog: one query loop, on different infrastructure, watching everything
 * else.
 *
 * WHY IT IS DEPLOYED SOMEWHERE ELSE. The runner and the mint watcher share a
 * host, a control plane and a provider. A monitor that shares any of the three
 * cannot report the failure of any of the three — it goes down in the same
 * incident, and the silence looks exactly like health. Provider-wide incidents
 * are one of the three ways this pipeline actually dies, so the watchdog runs on
 * a different vendor, on a $2 machine, and it is the cheapest line on the bill.
 *
 * WHAT IT DOES NOT DO. It does not restart anything, retry anything, or repair
 * anything. It reads two tables and says what it sees. An observer that can act
 * is an actor, and an actor's failures are the sort you find out about from a
 * user.
 *
 * The check loop's own failure is itself an alert: a read that throws is logged
 * and turns the health endpoint red, and the dead-man's switch is pinged only
 * when a check actually completed. Nothing here gets to fail quietly, including
 * this file.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { createNotifier } from './alert.ts';
import { checkSnapshot, createAlertGate } from './checks.ts';
import { loadWatchdogConfig } from './config.ts';
import { createWatchdogState, startHealthServer } from './health.ts';
import { createLogger, errorText } from './log.ts';
import { buildRuntime } from './wiring.ts';

const log = createLogger();

/** The check loop's floor, for the same billing reason as everywhere else. */
const MIN_SLEEP_MS = 1_000;

async function pingSelf(url: string, timeoutMs: number): Promise<void> {
  try {
    await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    log.warn('watchdog heartbeat failed', { err: errorText(e) });
  }
}

async function main(): Promise<void> {
  const cfg = loadWatchdogConfig(process.env);
  log.info('booting', {
    healthPort: cfg.healthPort,
    checkIntervalMs: cfg.checkIntervalMs,
    stages: Object.keys(cfg.stageCadencesMs),
    alerts: cfg.alerts.kind,
  });

  const runtime = buildRuntime(cfg);
  const startedAt = Date.now();
  const state = createWatchdogState(startedAt);
  const server = startHealthServer(cfg.healthPort, state, cfg.checkIntervalMs, () => Date.now(), log);

  const notifier = createNotifier(cfg.alerts, log);
  const gate = createAlertGate(cfg.alertRepeatMs);

  const ac = new AbortController();
  let shuttingDown = false;
  const stop = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    ac.abort();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  while (!ac.signal.aborted) {
    const started = Date.now();
    try {
      const snapshot = await runtime.snapshots.read(started);
      const alerts = checkSnapshot(snapshot, cfg.stageCadencesMs);

      // Order matters: admit records what was sent this round, then recovered
      // clears whatever is no longer in the list.
      await notifier.fire(gate.admit(alerts, started));
      await notifier.clear(gate.recovered(alerts, started));

      state.lastCheckAt = started;
      state.lastCheckOk = true;
      state.lastError = null;
      state.checksRun += 1;
      state.alertsFiring = alerts.length;

      // Pinged only on a completed check. Pinging regardless would report the
      // process as alive while it was failing to read anything, which is the
      // precise failure this whole layer exists to catch.
      if (cfg.heartbeat.kind === 'on') await pingSelf(cfg.heartbeat.url, cfg.heartbeat.timeoutMs);
    } catch (e) {
      // A watchdog that cannot read is not a quiet watchdog, it is a blind one.
      state.lastCheckOk = false;
      state.lastError = errorText(e);
      log.error('check loop failed', { err: state.lastError });
    }

    const elapsed = Date.now() - started;
    try {
      await delay(Math.max(MIN_SLEEP_MS, cfg.checkIntervalMs - elapsed), undefined, {
        signal: ac.signal,
      });
    } catch {
      // Aborted: shutting down.
    }
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
