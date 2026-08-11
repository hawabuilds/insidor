/**
 * Configuration, read exactly once, at boot, in exactly one place.
 *
 * TWO RULES, and both exist because of specific damage:
 *
 *   1. This is the ONLY module in the service permitted to touch `process.env`.
 *      Configuration read at the point of use is configuration that changes
 *      under a running process, and a value that changes mid-run makes the
 *      decision log unauditable — the row says which policy it was judged
 *      against, but not which database it was written to.
 *
 *   2. A missing value fails the process at boot, loudly, naming EVERY missing
 *      key at once. Never a plausible default. A default port, a default
 *      cadence or a default "alerts off" is the same class of bug as writing a
 *      zero rate for a censored counter: it substitutes a confident wrong value
 *      for an honest absence, and nobody finds out until it matters.
 *
 * The heartbeat is the shape worth copying: it cannot be merely absent. You
 * either declare `HEARTBEAT=on` and supply every slug, or you declare
 * `HEARTBEAT=off` and accept that a dead process will not page anyone. Silence
 * has to be chosen, not inherited — the same argument as `capabilities.absent`.
 */

import { hostname } from 'node:os';
import type { StageName } from '@insidor/contracts';

/** The stages this process supervises. See loops/ for the cadence of each. */
export const SUPERVISED_STAGES = [
  'admit',
  'track',
  'detect',
  'group',
  'qualify',
  'resolve',
  'rank',
] as const satisfies readonly StageName[];

export type SupervisedStage = (typeof SUPERVISED_STAGES)[number];

export type HeartbeatConfig =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'on';
      /** Pings are `${baseUrl}/${slug}` and `${baseUrl}/${slug}/fail`. */
      readonly baseUrl: string;
      /**
       * Keyed by stage name. Deliberately a wide `string` key: the lookup then
       * yields `string | undefined`, so a stage with no slug is a case the
       * caller has to handle rather than a silent empty URL.
       */
      readonly slugs: Readonly<Record<string, string>>;
      readonly timeoutMs: number;
    };

export interface RunnerConfig {
  /** Session mode (port 5432). Transaction mode cannot hold the singleton lock. */
  readonly databaseUrl: string;
  readonly healthPort: number;
  /** Recorded on every run row, so two instances are distinguishable. */
  readonly host: string;
  /** How long a SIGTERM waits for in-flight loops before the process gives up. */
  readonly shutdownGraceMs: number;
  /**
   * Advisory-lock name. Two runners draining the same claim queue is failure
   * mode #2 of the build this replaces; the lock is what forecloses it.
   */
  readonly singletonLockName: string;
  readonly heartbeat: HeartbeatConfig;
}

export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `configuration is not usable; the process will not start:\n  - ${problems.join('\n  - ')}`,
    );
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** Collects problems rather than throwing on the first one: a boot failure that
 *  names one missing variable per restart costs an evening. */
function reader(env: Env, problems: string[]) {
  return {
    text(key: string): string {
      const raw = env[key];
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and was not set`);
        return '';
      }
      return raw.trim();
    },
    int(key: string, min: number, max: number): number {
      const raw = env[key];
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and was not set`);
        return min;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) {
        problems.push(`${key} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`);
        return min;
      }
      return n;
    },
    choice<T extends string>(key: string, allowed: readonly T[]): T {
      const raw = env[key];
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and must be one of ${allowed.join(' | ')}`);
        return allowed[0] as T;
      }
      const v = raw.trim() as T;
      if (!allowed.includes(v)) {
        problems.push(`${key} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(raw)}`);
        return allowed[0] as T;
      }
      return v;
    },
  };
}

function heartbeatSlugEnv(stage: SupervisedStage): string {
  return `HEARTBEAT_SLUG_${stage.toUpperCase()}`;
}

export function loadRunnerConfig(env: Env): RunnerConfig {
  const problems: string[] = [];
  const r = reader(env, problems);

  const databaseUrl = r.text('DATABASE_URL');
  const healthPort = r.int('HEALTH_PORT', 1, 65_535);
  const shutdownGraceMs = r.int('SHUTDOWN_GRACE_MS', 1_000, 300_000);
  const singletonLockName = r.text('SINGLETON_LOCK_NAME');
  const mode = r.choice('HEARTBEAT', ['off', 'on'] as const);

  let heartbeat: HeartbeatConfig = { kind: 'off' };
  if (mode === 'on') {
    const baseUrl = r.text('HEARTBEAT_BASE_URL');
    const timeoutMs = r.int('HEARTBEAT_TIMEOUT_MS', 100, 30_000);
    const slugs: Record<string, string> = {};
    for (const stage of SUPERVISED_STAGES) slugs[stage] = r.text(heartbeatSlugEnv(stage));
    heartbeat = { kind: 'on', baseUrl: baseUrl.replace(/\/+$/, ''), timeoutMs, slugs };
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    databaseUrl,
    healthPort,
    host: hostname(),
    shutdownGraceMs,
    singletonLockName,
    heartbeat,
  };
}
