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
 * Which pooler mode a pool is behind, decided by the URL it was opened with.
 *
 * Session mode gives the pool's client one backend for as long as it is connected.
 * Transaction mode lends a backend for one transaction (or one standalone statement)
 * and takes it back, so anything that lives on the SESSION is gone by the next
 * statement: a session advisory lock, a LISTEN, a named prepared statement, a SET that
 * is not SET LOCAL, a temp table. The pg client only prepares a named statement when a
 * query is given a `name`, and nothing in this repo does — unnamed extended-protocol
 * queries, which is every parameterised query we send, work in transaction mode.
 */
export type PoolMode = 'session' | 'transaction';

function modeOf(envVar: string, url: string): PoolMode {
  let port: string;
  try {
    port = new URL(url).port;
  } catch {
    throw new Error(`${envVar} is not a valid connection URL`);
  }
  return port === TRANSACTION_POOLER_PORT ? 'transaction' : 'session';
}

/* Remembered per pool so the two helpers that depend on the mode can check it at the
   moment they are used, rather than trusting whoever opened the pool to have asked. */
const POOL_MODE = new WeakMap<Pool, PoolMode>();

/**
 * Session mode where the caller holds session state, and only there.
 *
 * Transaction mode releases a session advisory lock the moment the statement that took
 * it ends, and it does so silently: the lock APPEARS to be taken, the singleton guard
 * APPEARS to hold, and two runners drain the same queue. So a process that holds a
 * singleton lock opens that lock's pool with `session: true`, and this refuses a
 * transaction-pooler URL for it at boot — and `withAdvisoryLock` refuses a
 * transaction-mode pool at the moment of use, for a caller that forgot to ask.
 *
 * This used to refuse the transaction pooler for every role but the app. That spent a
 * session-mode client on every pooled connection in every process, and Supavisor caps
 * session clients per user (fifteen on this plan): the services ran out and failed with
 * "max clients reached in session mode". Stateless request/response work — every
 * repository call, every `withTransaction` — loses nothing in transaction mode, so the
 * refusal now sits on the one thing that needs a session rather than on the role.
 *
 * services/read holds a LISTEN on a plain `Client` that never passes through this
 * factory; its own config refuses a transaction-pooler URL for that connection, and
 * services/read/src/listen.ts owns the argument.
 */
function assertSessionMode(envVar: string, url: string): void {
  if (modeOf(envVar, url) === 'transaction') {
    throw new Error(
      `${envVar} points at the transaction-mode pooler (port ${TRANSACTION_POOLER_PORT}), but this pool ` +
        'holds session state. Session mode (5432) is required: transaction mode releases session ' +
        'advisory locks between statements, so the singleton guard silently stops guarding.',
    );
  }
}

/**
 * Per-role limits. The app gets a short leash because a slow page is not worth a held backend.
 *
 * ★ THE SIZES ARE SMALL ON PURPOSE, AND THEY ADD UP ACROSS PROCESSES. Every service, every
 * job the projector spawns and every tool on a laptop opens its own pool against the same
 * pooler, so a "generous" ten per pool was ten per process — and a busy minute ran the
 * session pooler out of clients. Five is what the runner's seven loops actually need at
 * once (they spend their time waiting on vendors, not on the database); the service role's
 * projectors run one transaction each. Raise one only with a count of the whole fleet.
 *
 * ★ THE TIMEOUTS ARE A STARTUP PARAMETER, AND THE TRANSACTION POOLER DROPS THEM. Supavisor
 * in transaction mode ignores `statement_timeout` and `idle_in_transaction_session_timeout`
 * sent at connect (measured: a pool opened with 4321 ms reads back the server default), so a
 * transaction-mode pool gets them by `set_config(..., true)` at the start of every
 * `withTransaction`. A standalone statement on such a pool runs under the role's own default;
 * the durable fix is a per-role `alter role ... set statement_timeout`, which is a migration.
 */
const ROLE_TUNING: Readonly<Record<DbRole, { max: number; statementTimeoutMs: number }>> = {
  app: { max: 3, statementTimeoutMs: 5_000 },
  service: { max: 3, statementTimeoutMs: 30_000 },
  internal: { max: 5, statementTimeoutMs: 60_000 },
};

/** Ended after this long unused, so a pool that was busy for a minute does not hold its peak. */
const IDLE_CLIENT_MS = 10_000;
const IDLE_IN_TRANSACTION_MS = 30_000;

/* What withTransaction re-applies inside a transaction-mode pool, per pool. */
const POOL_TIMEOUTS = new WeakMap<Pool, { statementMs: number; idleInTransactionMs: number }>();

export interface PoolOptions {
  /** Shows up in pg_stat_activity. Worth setting: it is how you find the loop that is stuck. */
  readonly applicationName?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * This pool will hold session state — a session advisory lock — so it must be in
   * session mode. A transaction-pooler URL is refused at boot rather than discovered
   * as a guard that does not guard.
   */
  readonly session?: boolean;
  /** Fewer clients than the role's default, for a pool that only ever needs one. */
  readonly max?: number;
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
  if (options.session === true) assertSessionMode(ENV_VAR[role], url);
  const mode = modeOf(ENV_VAR[role], url);

  const tuning = ROLE_TUNING[role];
  const config: PoolConfig = {
    connectionString: url,
    max: Math.min(options.max ?? tuning.max, tuning.max),
    application_name: options.applicationName ?? `insidor-${role}`,
    statement_timeout: tuning.statementTimeoutMs,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_MS,
    idleTimeoutMillis: IDLE_CLIENT_MS,
    keepAlive: true,
  };
  const pool = new Pool(config);
  POOL_MODE.set(pool, mode);
  if (mode === 'transaction') {
    POOL_TIMEOUTS.set(pool, { statementMs: tuning.statementTimeoutMs, idleInTransactionMs: IDLE_IN_TRANSACTION_MS });
  }
  return pool;
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
    /* Transaction mode dropped the timeouts sent at connect; these last until commit. */
    const timeouts = POOL_TIMEOUTS.get(pool);
    if (timeouts !== undefined) {
      await client.query(
        "select set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $2, true)",
        [String(timeouts.statementMs), String(timeouts.idleInTransactionMs)],
      );
    }
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
  if (POOL_MODE.get(pool) === 'transaction') {
    throw new Error(
      'withAdvisoryLock was handed a transaction-mode pool: the lock would be released as soon as ' +
        'the statement that took it ended. Open this pool with { session: true } on a session-mode URL.',
    );
  }
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
