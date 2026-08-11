/**
 * Configuration, read once, at boot, in one place, with no plausible defaults.
 *
 * The value worth arguing about is COVERAGE_TOLERANCE_MS. It is the width of a
 * silence we are willing to call jitter rather than a hole, and every lead-time
 * number the product publishes is computed over windows this variable defines.
 * A default here would mean the honesty of a marketing claim was decided by
 * whoever last edited a constant. So it is required, and it should be set to a
 * small multiple of POLL_INTERVAL_MS — one missed read is jitter, three in a
 * row is a gap.
 */

import { hostname } from 'node:os';

export type HeartbeatConfig =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'on';
      readonly baseUrl: string;
      readonly slug: string;
      readonly timeoutMs: number;
    };

export interface ChainwatchConfig {
  readonly databaseUrl: string;
  readonly healthPort: number;
  readonly host: string;
  readonly shutdownGraceMs: number;
  readonly singletonLockName: string;

  /** Which feed this process follows. One process per feed, one cursor per feed. */
  readonly feedId: string;
  readonly transport: 'poll' | 'stream';
  readonly pollIntervalMs: number;
  readonly pageLimit: number;

  /** See the header. Not defaultable. */
  readonly coverageToleranceMs: number;

  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;

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
      const fallback = allowed[0] as T;
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and must be one of ${allowed.join(' | ')}`);
        return fallback;
      }
      const v = raw.trim() as T;
      if (!allowed.includes(v)) {
        problems.push(`${key} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(raw)}`);
        return fallback;
      }
      return v;
    },
  };
}

export function loadChainwatchConfig(env: Env): ChainwatchConfig {
  const problems: string[] = [];
  const r = reader(env, problems);

  const databaseUrl = r.text('DATABASE_URL');
  const healthPort = r.int('HEALTH_PORT', 1, 65_535);
  const shutdownGraceMs = r.int('SHUTDOWN_GRACE_MS', 1_000, 300_000);
  const singletonLockName = r.text('SINGLETON_LOCK_NAME');

  const feedId = r.text('MINT_FEED_ID');
  const transport = r.choice('MINT_FEED_TRANSPORT', ['poll', 'stream'] as const);
  const pollIntervalMs = r.int('POLL_INTERVAL_MS', 1_000, 600_000);
  const pageLimit = r.int('PAGE_LIMIT', 1, 10_000);
  const coverageToleranceMs = r.int('COVERAGE_TOLERANCE_MS', 1_000, 3_600_000);

  const backoffBaseMs = r.int('BACKOFF_BASE_MS', 100, 60_000);
  const backoffMaxMs = r.int('BACKOFF_MAX_MS', 1_000, 3_600_000);

  const mode = r.choice('HEARTBEAT', ['off', 'on'] as const);
  let heartbeat: HeartbeatConfig = { kind: 'off' };
  if (mode === 'on') {
    heartbeat = {
      kind: 'on',
      baseUrl: r.text('HEARTBEAT_BASE_URL').replace(/\/+$/, ''),
      slug: r.text('HEARTBEAT_SLUG'),
      timeoutMs: r.int('HEARTBEAT_TIMEOUT_MS', 100, 30_000),
    };
  }

  if (backoffMaxMs < backoffBaseMs) {
    problems.push('BACKOFF_MAX_MS must not be smaller than BACKOFF_BASE_MS');
  }
  if (coverageToleranceMs <= pollIntervalMs) {
    // Otherwise every ordinary read cadence registers as a gap and the coverage
    // log becomes noise, which is how a real gap stops being noticed.
    problems.push('COVERAGE_TOLERANCE_MS must be greater than POLL_INTERVAL_MS');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    databaseUrl,
    healthPort,
    host: hostname(),
    shutdownGraceMs,
    singletonLockName,
    feedId,
    transport,
    pollIntervalMs,
    pageLimit,
    coverageToleranceMs,
    backoffBaseMs,
    backoffMaxMs,
    heartbeat,
  };
}
