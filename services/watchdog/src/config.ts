/**
 * Configuration, read once, at boot, with no plausible defaults.
 *
 * STAGE_CADENCES deserves a note, because it looks like duplication and is not.
 * The watchdog is TOLD what each stage's cadence is, as JSON, rather than
 * importing the loop definitions from the runner. Importing them would give
 * this process a build-time dependency on the process it watches — which is
 * precisely the coupling that makes a watchdog die alongside its subject, and
 * it is why the dependency rule forbids `watchdog → any other service`.
 *
 * The cost is real: change a cadence in the runner and this variable has to
 * change too, or W1 fires on a healthy stage. That is why an unconfigured stage
 * raises an alert of its own rather than being skipped — the drift announces
 * itself instead of quietly disabling monitoring.
 */

export type AlertChannel =
  | { readonly kind: 'off' }
  | { readonly kind: 'telegram'; readonly botToken: string; readonly chatId: string };

export type HeartbeatConfig =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly url: string; readonly timeoutMs: number };

export interface WatchdogConfig {
  /**
   * A role that can SELECT two tables and nothing else. An observer with write
   * access is an observer that can become a cause.
   */
  readonly databaseUrl: string;
  readonly healthPort: number;
  readonly checkIntervalMs: number;
  /** How long a firing condition stays quiet before it pages again. */
  readonly alertRepeatMs: number;
  readonly stageCadencesMs: Readonly<Record<string, number>>;
  readonly alerts: AlertChannel;
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

function parseCadences(raw: string, problems: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    problems.push('STAGE_CADENCES must be a JSON object, e.g. {"admit":60000,"track":30000}');
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    problems.push('STAGE_CADENCES must be a JSON object of stage name to milliseconds');
    return out;
  }
  for (const [stage, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      problems.push(`STAGE_CADENCES.${stage} must be a positive integer number of milliseconds`);
      continue;
    }
    out[stage] = value;
  }
  if (Object.keys(out).length === 0) problems.push('STAGE_CADENCES names no stages');
  return out;
}

export function loadWatchdogConfig(env: Env): WatchdogConfig {
  const problems: string[] = [];
  const r = reader(env, problems);

  const databaseUrl = r.text('DATABASE_URL');
  const healthPort = r.int('HEALTH_PORT', 1, 65_535);
  const checkIntervalMs = r.int('CHECK_INTERVAL_MS', 5_000, 600_000);
  const alertRepeatMs = r.int('ALERT_REPEAT_MS', 60_000, 86_400_000);
  const stageCadencesMs = parseCadences(r.text('STAGE_CADENCES'), problems);

  // Silence has to be chosen. A watchdog that defaults to sending nothing is a
  // watchdog that spends a year looking healthy.
  const channel = r.choice('ALERTS', ['off', 'telegram'] as const);
  let alerts: AlertChannel = { kind: 'off' };
  if (channel === 'telegram') {
    alerts = {
      kind: 'telegram',
      botToken: r.text('TELEGRAM_BOT_TOKEN'),
      chatId: r.text('TELEGRAM_CHAT_ID'),
    };
  }

  const hb = r.choice('HEARTBEAT', ['off', 'on'] as const);
  let heartbeat: HeartbeatConfig = { kind: 'off' };
  if (hb === 'on') {
    heartbeat = {
      kind: 'on',
      url: r.text('HEARTBEAT_URL'),
      timeoutMs: r.int('HEARTBEAT_TIMEOUT_MS', 100, 30_000),
    };
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    databaseUrl,
    healthPort,
    checkIntervalMs,
    alertRepeatMs,
    stageCadencesMs,
    alerts,
    heartbeat,
  };
}
