/**
 * The read process. Load configuration, open one pool, listen, shut down.
 *
 * There is no logic here and there is none anywhere else in this package either.
 * The projection was built once, by services/project, running as the service role
 * which can read `public.observation` and apply the censoring rules. What arrives
 * here is finished wire JSON. This process selects it and hands it over.
 *
 * ★ THE POOL IS OPENED WITH cfg.databaseUrl, WHICH IS DATABASE_URL_APP AND NOTHING
 * ELSE. See config.ts: the app role has no USAGE on `internal` or `raw` and no
 * SELECT on `public.observation`, so the safety of this service is enforced by
 * Postgres rather than by review. There is no second connection string in this file
 * and there must never be one — the moment this process can also open a service-role
 * pool, every guarantee above becomes a claim about code that could be edited, and
 * the leak this whole architecture is arranged to make impossible becomes a leak
 * that is merely unlikely.
 */

import { Pool } from 'pg';

import { loadReadConfig } from './config.ts';
import { createLogger, errorText } from './log.ts';
import { createReadServer } from './server.ts';

const log = createLogger();

/**
 * Tuned to match the app role in store/src/client.ts, so the two agree about what
 * this credential is for. The statement timeout is the important one: a read surface
 * has a person waiting on the other end, and a query that has run for five seconds
 * has already failed as far as they are concerned. Better to release the connection
 * than to hold it for an answer nobody is still watching for.
 */
const POOL_MAX = 5;
const STATEMENT_TIMEOUT_MS = 5_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  // The ONE read of process.env in this service. Throws, loudly, before anything is
  // opened, if DATABASE_URL_APP is missing — and never substitutes DATABASE_URL.
  const cfg = loadReadConfig(process.env);

  const pool = new Pool({
    connectionString: cfg.databaseUrl,
    application_name: 'insidor-read',
    max: POOL_MAX,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    keepAlive: true,
  });

  /* An idle client that errors emits on the pool, and an unhandled 'error' event on
     an EventEmitter takes the process down. A database restart is not a reason for
     the read surface to die. */
  pool.on('error', (e) => log.error('idle client failed', { err: errorText(e) }));

  const server = createReadServer({
    db: { query: async (sql, params) => (await pool.query(sql, [...params])).rows },
    log,
    allowedOrigins: cfg.allowedOrigins,
  });

  server.listen(cfg.port, () => log.info('listening', { port: cfg.port, origins: cfg.allowedOrigins }));

  const stop = async (signal: string): Promise<void> => {
    log.info('shutting down', { signal });
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

// Fail loudly. A read service surviving its own unhandled rejection is a process in
// a state nobody designed, still answering the browser.
process.on('uncaughtException', (e) => {
  log.error('uncaught exception', { err: errorText(e) });
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  log.error('unhandled rejection', { err: errorText(e) });
  process.exit(1);
});

main().catch((e: unknown) => {
  log.error('boot failed', { err: errorText(e) });
  process.exit(1);
});
