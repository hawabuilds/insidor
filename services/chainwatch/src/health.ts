/**
 * The health endpoint for the mint watcher.
 *
 * It reports unhealthy on the SAME condition the coverage log records — a
 * silence wider than the tolerance — so the container's restart policy and the
 * lead-time arithmetic agree about what "watching" means. An endpoint that
 * answered 200 while a gap was open would be the seven-hour failure again,
 * wearing a green tick.
 *
 * It also exposes the most recent gap, because the first question anyone asks
 * about this process is not "is it up" but "did we miss anything".
 */

import { createServer, type Server } from 'node:http';
import type { Millis } from '@insidor/contracts';

import type { Gap } from './coverage.ts';
import type { Logger } from './log.ts';

export interface WatchState {
  readonly startedAt: Millis;
  lastReadAt: Millis | null;
  lastSuccessAt: Millis | null;
  consecutiveFailures: number;
  lastError: string | null;
  mintsSeen: number;
  gapsRecorded: number;
  lastGap: Gap | null;
}

export function createWatchState(startedAt: Millis): WatchState {
  return {
    startedAt,
    lastReadAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastError: null,
    mintsSeen: 0,
    gapsRecorded: 0,
    lastGap: null,
  };
}

export function startHealthServer(
  port: number,
  state: WatchState,
  toleranceMs: number,
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

    const at = now();
    // Before the first successful read we judge against process start, so a
    // process that comes up and never reads anything still goes red.
    const reference = state.lastSuccessAt ?? state.startedAt;
    const silentFor = at - reference;
    const healthy = silentFor <= toleranceMs;

    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: healthy ? 'ok' : 'degraded',
        now: at,
        silentForMs: silentFor,
        toleranceMs,
        ...state,
      }),
    );
  });

  server.listen(port, () => log.info('health endpoint listening', { port }));
  server.on('error', (e) => log.error('health endpoint failed', { err: e.message }));
  return server;
}
