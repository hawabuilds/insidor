/**
 * The watchdog's own health endpoint.
 *
 * A monitor that cannot itself be monitored is a single point of undetected
 * failure, and it is the one this design would otherwise have: three layers,
 * and the third silently dead. So this endpoint goes red on the same condition
 * the watchdog would page about elsewhere — its own check loop having stopped
 * completing — and the process also pings a dead-man's switch of its own.
 */

import { createServer, type Server } from 'node:http';
import type { Millis } from '@insidor/contracts';

import type { Logger } from './log.ts';

export interface WatchdogState {
  readonly startedAt: Millis;
  lastCheckAt: Millis | null;
  lastCheckOk: boolean;
  lastError: string | null;
  checksRun: number;
  alertsFiring: number;
}

export function createWatchdogState(startedAt: Millis): WatchdogState {
  return {
    startedAt,
    lastCheckAt: null,
    lastCheckOk: false,
    lastError: null,
    checksRun: 0,
    alertsFiring: 0,
  };
}

export function startHealthServer(
  port: number,
  state: WatchdogState,
  checkIntervalMs: number,
  now: () => Millis,
  log: Logger,
): Server {
  // Same 3× rule the watchdog applies to everyone else. Applying a looser rule
  // to itself is how a monitor grades its own homework.
  const staleAfterMs = checkIntervalMs * 3;

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/health' && path !== '/') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }

    const at = now();
    const reference = state.lastCheckAt ?? state.startedAt;
    const healthy = at - reference <= staleAfterMs;

    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', now: at, staleAfterMs, ...state }));
  });

  server.listen(port, () => log.info('health endpoint listening', { port }));
  server.on('error', (e) => log.error('health endpoint failed', { err: e.message }));
  return server;
}
