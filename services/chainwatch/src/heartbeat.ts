/**
 * The dead-man's switch for this process. One check, because there is one loop.
 *
 * A ping failure never propagates: a monitoring vendor's outage must not stop
 * the thing being monitored. That is not a nicety — it is the difference
 * between losing visibility and losing coverage, and losing coverage costs
 * mints.
 */

import type { HeartbeatConfig } from './config.ts';
import { errorText, type Logger } from './log.ts';

export interface Heartbeat {
  ping(ok: boolean): Promise<void>;
}

export function createHeartbeat(cfg: HeartbeatConfig, log: Logger): Heartbeat {
  if (cfg.kind === 'off') return { ping: async () => {} };

  return {
    async ping(ok) {
      const url = `${cfg.baseUrl}/${cfg.slug}${ok ? '' : '/fail'}`;
      try {
        await fetch(url, { method: 'POST', signal: AbortSignal.timeout(cfg.timeoutMs) });
      } catch (e) {
        log.warn('heartbeat ping failed', { err: errorText(e) });
      }
    },
  };
}
