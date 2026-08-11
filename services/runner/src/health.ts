/**
 * The health endpoint, and the in-memory register it reads.
 *
 * This is the CHEAPEST of the three liveness layers and the only one that
 * needs neither the database nor a third party: the platform's own health check
 * restarts the container when a loop stops finishing. It deliberately reports
 * unhealthy on STALENESS, not merely on "the process is up" — a process that is
 * up with six wedged loops is the exact failure this system is built around,
 * and an endpoint that answers 200 to it is worse than no endpoint.
 *
 * The staleness bar is 3× the loop's own cadence, matching the watchdog's rule,
 * so the two layers cannot disagree about what "late" means.
 */

import { createServer, type Server } from 'node:http';
import type { Millis, StageName } from '@insidor/contracts';

import type { Logger } from './log.ts';
import type { RunOutcome } from './run-record.ts';

/** How many cadences a loop may miss before it is considered stale. */
const STALE_AFTER_CADENCES = 3;

export interface LoopHealth {
  readonly stage: string;
  readonly everyMs: number;
  readonly lastStartedAt: Millis | null;
  readonly lastFinishedAt: Millis | null;
  readonly lastOutcome: RunOutcome | null;
  readonly consecutiveFailures: number;
  /** Set while a run is in flight. A value far in the past is a wedged loop. */
  readonly openSince: Millis | null;
  readonly stale: boolean;
}

export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly host: string;
  readonly startedAt: Millis;
  readonly now: Millis;
  readonly loops: readonly LoopHealth[];
}

/**
 * The supervisor writes here; the HTTP handler reads. Kept in memory on
 * purpose — a health endpoint that queries the database reports the database's
 * health, and then cannot answer at all when the database is the problem.
 */
export interface HealthRegistry {
  register(stage: StageName | string, everyMs: number): void;
  runStarted(stage: StageName | string, at: Millis): void;
  runFinished(stage: StageName | string, at: Millis, outcome: RunOutcome): void;
  report(now: Millis): HealthReport;
}

interface MutableLoopHealth {
  everyMs: number;
  lastStartedAt: Millis | null;
  lastFinishedAt: Millis | null;
  lastOutcome: RunOutcome | null;
  consecutiveFailures: number;
  openSince: Millis | null;
}

export function createHealthRegistry(host: string, startedAt: Millis): HealthRegistry {
  const loops = new Map<string, MutableLoopHealth>();

  const entry = (stage: string): MutableLoopHealth => {
    const existing = loops.get(stage);
    if (existing !== undefined) return existing;
    const fresh: MutableLoopHealth = {
      everyMs: 0,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastOutcome: null,
      consecutiveFailures: 0,
      openSince: null,
    };
    loops.set(stage, fresh);
    return fresh;
  };

  return {
    register(stage, everyMs) {
      entry(String(stage)).everyMs = everyMs;
    },

    runStarted(stage, at) {
      const e = entry(String(stage));
      e.lastStartedAt = at;
      e.openSince = at;
    },

    runFinished(stage, at, outcome) {
      const e = entry(String(stage));
      e.lastFinishedAt = at;
      e.lastOutcome = outcome;
      e.openSince = null;
      e.consecutiveFailures = outcome === 'error' ? e.consecutiveFailures + 1 : 0;
    },

    report(now) {
      const rows: LoopHealth[] = [];
      for (const [stage, e] of loops) {
        // A loop that has never finished is stale once it has had 3 cadences
        // plus its own startup offset to produce something. Before that,
        // silence is expected rather than suspicious.
        const reference = e.lastFinishedAt ?? e.lastStartedAt;
        const stale =
          e.everyMs > 0 && reference !== null && now - reference > STALE_AFTER_CADENCES * e.everyMs;
        rows.push({
          stage,
          everyMs: e.everyMs,
          lastStartedAt: e.lastStartedAt,
          lastFinishedAt: e.lastFinishedAt,
          lastOutcome: e.lastOutcome,
          consecutiveFailures: e.consecutiveFailures,
          openSince: e.openSince,
          stale,
        });
      }
      return {
        status: rows.some((r) => r.stale) ? 'degraded' : 'ok',
        host,
        startedAt,
        now,
        loops: rows,
      };
    },
  };
}

export function startHealthServer(
  port: number,
  registry: HealthRegistry,
  now: () => Millis,
  log: Logger,
): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (path !== '/health' && path !== '/') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }

    const report = registry.report(now());
    res.writeHead(report.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify(report));
  });

  server.listen(port, () => log.info('health endpoint listening', { port }));
  server.on('error', (e) => log.error('health endpoint failed', { err: e.message }));
  return server;
}
