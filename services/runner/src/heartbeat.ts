/**
 * The dead-man's switch: layer 2 of three.
 *
 * Layer 1 (the run row) needs the database. Layer 3 (the watchdog) needs the
 * database AND different infrastructure. This layer needs neither, which is why
 * it exists: it catches "the whole process is gone" by the absence of a ping,
 * and absence is the one signal a dead process can still send.
 *
 * TWO PROPERTIES THAT ARE NOT NEGOTIABLE:
 *   - a ping failure NEVER propagates. A monitoring vendor's outage must not
 *     take the pipeline down; that inverts the entire point of monitoring.
 *   - a failed run pings the /fail endpoint rather than staying silent, so the
 *     dashboard separates "erroring" from "gone" without a database query.
 */

import type { StageName } from '@insidor/contracts';

import type { HeartbeatConfig } from './config.ts';
import { errorText, type Logger } from './log.ts';
import type { RunOutcome } from './run-record.ts';

export interface Heartbeat {
  ping(stage: StageName | string, outcome: RunOutcome): Promise<void>;
}

export function createHeartbeat(cfg: HeartbeatConfig, log: Logger): Heartbeat {
  if (cfg.kind === 'off') {
    // Explicitly chosen at boot, never inferred from a missing variable.
    return { ping: async () => {} };
  }

  return {
    async ping(stage, outcome) {
      const slug = cfg.slugs[String(stage)];
      if (slug === undefined) {
        log.warn('no heartbeat slug for stage', { stage });
        return;
      }
      const url = `${cfg.baseUrl}/${slug}${outcome === 'error' ? '/fail' : ''}`;
      try {
        await fetch(url, { method: 'POST', signal: AbortSignal.timeout(cfg.timeoutMs) });
      } catch (e) {
        log.warn('heartbeat ping failed', { stage, err: errorText(e) });
      }
    },
  };
}
