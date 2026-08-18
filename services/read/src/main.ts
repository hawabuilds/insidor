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

import { Client, Pool } from 'pg';

import { loadReadConfig } from './config.ts';
import { BOARD_CHANNEL, createNotifier, type ListenSocket } from './listen.ts';
import { createLogger, errorText } from './log.ts';
import { createReadServer } from './server.ts';
import { createBoardStream } from './stream.ts';

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

/**
 * A channel name is a SQL identifier, so `LISTEN $1` is a syntax error and the name has to
 * reach the statement as text. That is the one place in this service where a value is
 * concatenated into SQL, so the value is checked against a shape that cannot carry a quote,
 * a semicolon or a space — and it is a module constant in listen.ts, never anything a
 * request touched. The view id travels in the notification payload, where it is data.
 */
const SAFE_CHANNEL = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * The dedicated listening connection.
 *
 * ★ NOT FROM THE POOL, and listen.ts explains why at length: `LISTEN` is session state,
 * `pg-pool` destroys an idle client after ten seconds, and the subscription then disappears
 * with no error and no event. One `Client`, held for the process lifetime, reopened by the
 * notifier's reconnect loop whenever it dies.
 *
 * It uses cfg.databaseUrl — the SAME app credential as the pool. There is no second
 * connection string in this process and there must never be one; config.ts is the argument.
 */
function pgListenSocket(connectionString: string): ListenSocket {
  const client = new Client({
    connectionString,
    application_name: 'insidor-read-listen',
    keepAlive: true,
  });

  let announced = false;
  let onClosed: (reason: string) => void = () => {};
  /* Fired at most once per socket. A pg Client can emit both 'error' and 'end' for the same
     death, and two losses would schedule two reconnect loops for one dropped connection. */
  const closedOnce = (reason: string): void => {
    if (announced) return;
    announced = true;
    onClosed(reason);
  };

  /* Registered before connect, deliberately: an unhandled 'error' on an EventEmitter takes
     the process down, and a database restart is not a reason for the read surface to die. */
  client.on('error', (e: unknown) => closedOnce(errorText(e)));
  client.on('end', () => closedOnce('the listening connection ended'));

  return {
    connect: async () => {
      await client.connect();
    },
    listen: async (channel) => {
      if (!SAFE_CHANNEL.test(channel)) throw new Error('refusing to LISTEN on a channel name that is not a plain identifier');
      await client.query(`listen ${channel}`);
    },
    onNotification: (handler) => {
      client.on('notification', (message) => {
        if (message.channel !== BOARD_CHANNEL) return;
        handler(message.payload ?? null);
      });
    },
    onClosed: (handler) => {
      onClosed = handler;
    },
    end: async () => {
      announced = true;
      await client.end();
    },
  };
}

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

  const deps = {
    db: { query: async (sql: string, params: readonly unknown[]) => (await pool.query(sql, [...params])).rows },
    log,
  };

  /* The live channel and the thing that feeds it. The stream holds the browsers; the
     notifier holds the one database subscription and fans out to them. They are separate
     because the failure modes are separate: a browser going away is routine and costs one
     socket, the database going away is an outage that every attached browser has to be told
     about — and the telling is what makes a dead board look different from a quiet one. */
  const stream = createBoardStream(deps);
  const notifier = createNotifier({
    open: () => pgListenSocket(cfg.databaseUrl),
    log,
    /* The tick is not used to decide anything: the frame is re-read from the table through
       the same statements the polled route uses. Acting on a number from a payload anyone
       can forge is the one thing this must not do. */
    onFrame: (viewId) => stream.publish(viewId),
    onListening: () => stream.linkUp(),
    onLost: () => stream.linkDown(),
  });

  const server = createReadServer({ ...deps, allowedOrigins: cfg.allowedOrigins, stream });

  server.listen(cfg.port, () => log.info('listening', { port: cfg.port, origins: cfg.allowedOrigins }));
  notifier.start();

  const stop = async (signal: string): Promise<void> => {
    log.info('shutting down', { signal, streams: stream.size() });
    /* Streams first. They are the only responses that never finish on their own, so a
       `server.close()` ahead of this would wait for connections that are designed not to
       end and the process would hang until the platform killed it. */
    stream.close();
    await notifier.close();
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
