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
 *
 * MINT_OBSERVATION_LAG_S is the second one, and on a push transport it is the
 * more dangerous of the two. It is how many seconds before a notification the
 * mint is allowed to have happened, which is the only thing that turns an
 * arrival instant into a comparable mint time. Every claim about a post
 * preceding a coin is measured against a number nobody can derive from the data.
 */

import { hostname } from 'node:os';

import { chainId, type ChainId } from '@insidor/contracts';

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
  /**
   * The settlement layer this feed watches. Required because the coverage log is
   * keyed by chain — a gap row cannot be written without one, and a gap has to be
   * writable on a cycle that saw no mints at all, so it can never be inferred from
   * what the feed returned.
   */
  readonly chain: ChainId;
  readonly transport: 'poll' | 'stream';
  readonly pollIntervalMs: number;
  readonly pageLimit: number;

  /** See the header. Not defaultable. */
  readonly coverageToleranceMs: number;

  /** Where a push transport connects. Named for what it is, never for who runs it. */
  readonly streamUrl: string;
  /**
   * How many events a push transport may hold between drains. The bound is the
   * point: an unbounded queue is an out-of-memory crash during a mint storm, and
   * a crash is a gap nobody chose the shape of. Overflow is declared, so the
   * question this answers is how much memory a declared hole is worth avoiding.
   */
  readonly streamBufferLimit: number;
  /**
   * How long a nominally-connected stream may deliver nothing before it is
   * treated as dead. This is the half-open socket: TCP alive, no bytes, no close
   * event, every liveness check answering yes. Set it well above the quietest
   * genuine minute on the source, because the cost of being wrong is a reconnect
   * and a recorded gap — loud and cheap, in that order.
   */
  readonly streamStaleAfterMs: number;

  /**
   * ★ The widest interval, in seconds, a live observation is allowed to claim it
   * bounds: the mint is asserted to have happened within this many seconds
   * BEFORE the notification reached us.
   *
   * This sits beside COVERAGE_TOLERANCE_MS in the header's warning for the same
   * reason. It is the number that turns an arrival instant into a comparable
   * mint time, so it decides whether the pre-mint ordering gate is measuring
   * anything. Too wide and every candidate fails that gate for carrying a bound
   * wider than the lag it is measuring; too narrow and the interval stops
   * containing the truth, which does not blur the ordering — it reverses it.
   */
  readonly observationLagS: number;

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
  const chainToken = r.text('MINT_FEED_CHAIN');
  const transport = r.choice('MINT_FEED_TRANSPORT', ['poll', 'stream'] as const);
  const pollIntervalMs = r.int('POLL_INTERVAL_MS', 1_000, 600_000);
  const pageLimit = r.int('PAGE_LIMIT', 1, 10_000);
  const coverageToleranceMs = r.int('COVERAGE_TOLERANCE_MS', 1_000, 3_600_000);

  // Required whatever MINT_FEED_TRANSPORT says. `transport` is a declaration
  // about what is running, not a switch, and nothing in this service branches on
  // it; a value that is only validated on some paths is a value that is wrong on
  // the day the path changes, and the whole point of this module is that the
  // process refuses to start rather than discovering that at 3am.
  const streamUrl = r.text('MINT_STREAM_URL');
  const streamBufferLimit = r.int('MINT_STREAM_BUFFER_LIMIT', 1, 1_000_000);
  const streamStaleAfterMs = r.int('MINT_STREAM_STALE_MS', 1_000, 3_600_000);
  const observationLagS = r.int('MINT_OBSERVATION_LAG_S', 1, 3_600);

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

  if (streamBufferLimit < pageLimit) {
    // A buffer smaller than a page can never fill one, so every busy window
    // would report `pageFull` and be recorded as a hole that never happened —
    // the same way an under-set coverage tolerance turns the log into noise.
    problems.push('MINT_STREAM_BUFFER_LIMIT must not be smaller than PAGE_LIMIT');
  }
  if (streamStaleAfterMs <= pollIntervalMs) {
    // Otherwise the staleness check fires on an ordinary quiet interval and the
    // watcher reconnects on its own cadence, recording a gap each time.
    problems.push('MINT_STREAM_STALE_MS must be greater than POLL_INTERVAL_MS');
  }
  if (streamUrl !== '' && !/^wss?:\/\//.test(streamUrl)) {
    // Checked here rather than left to the socket constructor, which fails
    // asynchronously on the first connect attempt and looks like an outage.
    problems.push("MINT_STREAM_URL must be a websocket URL ('ws://' or 'wss://')");
  }

  // `chainId` throws on a token it cannot make an id from, and a throw from inside
  // the reader would replace the full list of problems with the first one found.
  // So the shape is checked here and the id is constructed after the report.
  if (chainToken !== '' && (chainToken.includes(':') || chainToken.includes('|'))) {
    problems.push("MINT_FEED_CHAIN must be a bare chain token, with no ':' or '|'");
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    databaseUrl,
    healthPort,
    host: hostname(),
    shutdownGraceMs,
    singletonLockName,
    feedId,
    chain: chainId(chainToken),
    transport,
    pollIntervalMs,
    pageLimit,
    coverageToleranceMs,
    streamUrl,
    streamBufferLimit,
    streamStaleAfterMs,
    observationLagS,
    backoffBaseMs,
    backoffMaxMs,
    heartbeat,
  };
}
