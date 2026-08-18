/**
 * The pg client factory. Three roles, three connection strings, one shape.
 *
 * WHY `pg` AND NOT THE HOSTED REST CLIENT:
 * the REST client cannot open a transaction spanning statements, cannot take
 * `FOR UPDATE SKIP LOCKED`, and cannot hold a session advisory lock. Those three
 * absences are what forced the previous build's tracking queue to be raced by
 * overlapping invocations, and what made "log the decision, then act, then mark it
 * applied" impossible to do deliberately rather than accidentally. A real client
 * also means SQL genuinely lives only in this package, instead of leaking out as
 * `.select()` strings written wherever data was needed.
 *
 * WHY THE ROLE IS AN ARGUMENT AND NOT A CONFIG FLAG:
 * a process picks its privileges when it opens its pool, and the database enforces
 * the choice. An ingest worker that acquires a bug still cannot append to the
 * decision log, because the connection it holds has no INSERT on that schema.
 */

import { Pool } from 'pg';
import type { PoolClient, PoolConfig, QueryResultRow } from 'pg';

/* erasableSyntaxOnly bans enums, so every closed set in this repo is a frozen
   object plus a union derived from it. */
export const DB_ROLE = {
  /** The browser's read surface. SELECT on a hand-picked set of public tables. */
  app: 'app',
  /** Ingest and tracking. Read-write on public and raw; may READ internal. */
  service: 'service',
  /** The runner and the labeller. The only role that may write a judgement. */
  internal: 'internal',
} as const;

export type DbRole = (typeof DB_ROLE)[keyof typeof DB_ROLE];

const ENV_VAR: Readonly<Record<DbRole, string>> = {
  app: 'DATABASE_URL_APP',
  service: 'DATABASE_URL_SERVICE',
  internal: 'DATABASE_URL_INTERNAL',
};

/**
 * Everything the repositories are allowed to know about a connection. A Pool and a
 * PoolClient-inside-a-transaction both satisfy it, which is what lets a repository
 * method be called standalone or as one step of a larger transaction without the
 * method knowing which.
 */
export interface Db {
  query<R extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

/** The transaction-mode pooler port. Named so the error message can say why. */
const TRANSACTION_POOLER_PORT = '6543';

/**
 * Session mode only, and this is not a preference.
 *
 * Transaction mode hands a different backend to each statement, so prepared
 * statements do not survive and a session advisory lock is released the moment the
 * statement that took it ends. Both of those are silent: the lock APPEARS to be
 * taken, the singleton guard APPEARS to hold, and two runners drain the same queue.
 *
 * The app role is exempt because its POOL is read-only and stateless, and that
 * exemption is narrower than it used to read. It once said "the app is read-only and
 * stateless" full stop; that is no longer true of the credential. services/read now
 * also holds a dedicated LISTEN connection on the same URL, and a LISTEN is session
 * state — a transaction-mode pooler in front of it drops the subscription with no
 * error and no event, exactly the way an idle pooled client does. That connection is
 * opened directly with `new Client` and never through this factory, so this guard
 * would not see it either way; see services/read/src/listen.ts, which owns the
 * argument. Stated here so the exemption is not read as a claim about the role.
 */
function assertSessionMode(role: DbRole, url: string): void {
  if (role === DB_ROLE.app) return;
  let port: string;
  try {
    port = new URL(url).port;
  } catch {
    throw new Error(`${ENV_VAR[role]} is not a valid connection URL`);
  }
  if (port === TRANSACTION_POOLER_PORT) {
    throw new Error(
      `${ENV_VAR[role]} points at the transaction-mode pooler (port ${TRANSACTION_POOLER_PORT}). ` +
        'Session mode (5432) is required: transaction mode drops prepared statements and ' +
        'releases session advisory locks between statements, so the singleton guard silently ' +
        'stops guarding.',
    );
  }
}

/** Per-role limits. The app gets a short leash because a slow page is not worth a held backend. */
const ROLE_TUNING: Readonly<Record<DbRole, { max: number; statementTimeoutMs: number }>> = {
  app: { max: 5, statementTimeoutMs: 5_000 },
  service: { max: 10, statementTimeoutMs: 30_000 },
  internal: { max: 10, statementTimeoutMs: 60_000 },
};

export interface PoolOptions {
  /** Shows up in pg_stat_activity. Worth setting: it is how you find the loop that is stuck. */
  readonly applicationName?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Open the pool for one role. Throws if that role's connection string is missing,
 * because a process that silently falls back to another role's credentials is
 * strictly worse than a process that refuses to start.
 */
export function createPool(role: DbRole, options: PoolOptions = {}): Pool {
  const env = options.env ?? process.env;
  const url = env[ENV_VAR[role]];
  if (!url) {
    throw new Error(`${ENV_VAR[role]} is not set; refusing to open a pool for role '${role}'`);
  }
  assertSessionMode(role, url);

  const tuning = ROLE_TUNING[role];
  const config: PoolConfig = {
    connectionString: url,
    max: tuning.max,
    application_name: options.applicationName ?? `insidor-${role}`,
    statement_timeout: tuning.statementTimeoutMs,
    idle_in_transaction_session_timeout: 30_000,
    keepAlive: true,
  };
  return new Pool(config);
}

/** Adapt a Pool or a checked-out client to the narrow interface repositories take. */
export function asDb(source: Pool | PoolClient): Db {
  return {
    async query<R extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]> {
      const result = await source.query<R>(sql, params ? [...params] : undefined);
      return result.rows;
    },
  };
}

/**
 * Run `fn` inside one transaction. Rolls back on any throw and always releases.
 *
 * The whole reason this exists: "write the decision and perform the side effect"
 * is now a choice about atomicity rather than a constraint imposed by the client.
 * Where the two genuinely cannot be atomic, the asymmetry is chosen deliberately —
 * log first, act, then stamp applied_at — so a failure leaves a detectable
 * unapplied row rather than an invisible hole.
 */
export async function withTransaction<T>(pool: Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(asDb(client));
    await client.query('commit');
    return result;
  } catch (error: unknown) {
    await client.query('rollback').catch(() => {
      /* the connection is already broken; the original error is the interesting one */
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A genuine singleton guard: hold a session advisory lock for the life of `fn`.
 *
 * This is the thing serverless could not provide and the reason two overlapping
 * invocations used to drain the same tracking queue. Returns null without running
 * `fn` when another holder has the lock — the caller decides whether that is normal
 * (it usually is) or worth reporting.
 */
export async function withAdvisoryLock<T>(
  pool: Pool,
  lockKey: number,
  fn: (db: Db) => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  try {
    const held = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [lockKey],
    );
    if (held.rows[0]?.locked !== true) return null;
    try {
      return await fn(asDb(client));
    } finally {
      await client.query('select pg_advisory_unlock($1)', [lockKey]);
    }
  } finally {
    client.release();
  }
}
