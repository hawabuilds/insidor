/**
 * The trade service, assembled: the launchpad's curve, the aggregator for bonded coins, and the
 * chain for simulating and sending. Started off; see config.ts for the three things that turn
 * it on.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import { jupiter } from '@insidor/venue-jupiter';
import { chainClient } from '@insidor/venue-solana-pumpfun';
import { buildCurve, curveState, payerOf, quoteCurve } from '@insidor/venue-solana-pumpfun/curve-trade.ts';
import { buildTransfer } from '@insidor/venue-solana-pumpfun/transfer.ts';
import { LaunchRefused, buildLaunch, launchRules } from '@insidor/venue-solana-pumpfun/launch.ts';
import { MetadataRejected, supabaseStorage } from '@insidor/storage-supabase';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

import { LaunchRefusedError, type LaunchPort } from './routes.ts';
import { NO_RECORDS, pgRecords, watchSettlement } from './records.ts';

import { loadTradeConfig, tradingOpen } from './config.ts';
import { createTradeServer } from './server.ts';

const ROUTER_TIMEOUT_MS = 8_000;

const log = {
  info: (msg: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: 'info', msg, ...f })),
  error: (msg: string, f: Record<string, unknown> = {}) => console.error(JSON.stringify({ level: 'error', msg, ...f })),
};

const cfg = loadTradeConfig(process.env);
const rpc = cfg.rpcUrl ?? '';
const chain = chainClient({ launchpadBaseUrl: '', rpcUrl: rpc, fetch: globalThis.fetch });
const router = jupiter({ ...cfg.jupiter, fetch: globalThis.fetch, timeoutMs: ROUTER_TIMEOUT_MS });

/** A refusal the person should read crosses into the routes as one type; anything else is an outage. */
const refusals = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (e) {
    if (e instanceof LaunchRefused || e instanceof MetadataRejected) throw new LaunchRefusedError(e.message);
    throw e;
  }
};

/** The launch pool's size and idle close; see where it is opened. */
const LAUNCH_POOL_MAX = 2;
const LAUNCH_IDLE_CLIENT_MS = 10_000;

/* Creating coins: metadata stored in our own bucket, the coin recorded through 0042's function —
   the only thing the app role this service holds may write. */
const launch: LaunchPort | null = (() => {
  const l = cfg.launch;
  if (l === null) return null;
  const storage = supabaseStorage({ url: l.storageUrl, serviceKey: l.storageKey, fetch: globalThis.fetch, id: randomUUID });
  /* One standalone statement per launch, so the app role's URL may be the transaction-mode
     pooler (6543), and is on Railway. Two clients at most, closed after ten idle seconds. */
  const pool = new pg.Pool({ connectionString: l.databaseUrl, max: LAUNCH_POOL_MAX, idleTimeoutMillis: LAUNCH_IDLE_CLIENT_MS, application_name: 'insidor-trade' });
  return {
    rules: () => launchRules(rpc),
    build: (r) => refusals(() => buildLaunch(rpc, r)),
    upload: (input) => refusals(() => storage.upload(input)),
    landed: (signature) => chain.landed(signature),
    register: async (address, creator, storyId, signature) => {
      await pool.query('select public.register_created_coin($1, $2, $3, $4)', [address, creator, storyId, signature]);
    },
    /* Which suggestion the owner kept (0076); before 0076 the function is missing and the route logs it. */
    notePick: async (r) => {
      await pool.query('select public.record_create_pick($1, $2, $3, $4, $5, $6::jsonb, $7)', [r.address, r.itemId, r.name, r.ticker, r.pick, JSON.stringify(r.offered), r.wallet]);
    },
  };
})();

/* The trade record (public.trade): one client, closed when idle, apart from the launch pool so a
   slow record write never holds a launch's connection. */
const records = (() => {
  if (cfg.recordsDatabaseUrl === null) return NO_RECORDS;
  const pool = new pg.Pool({ connectionString: cfg.recordsDatabaseUrl, max: 1, idleTimeoutMillis: LAUNCH_IDLE_CLIENT_MS, application_name: 'insidor-trade-records' });
  /* An idle client dropped by the database is a log line, never a crashed trade service. */
  pool.on('error', (e) => log.error('trade record pool', { err: e.message.slice(0, 200) }));
  return pgRecords(pool, log);
})();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const server = createTradeServer({
  cfg,
  policy: DEFAULT_POLICY.trade,
  curve: {
    state: (mint) => curveState(rpc, mint),
    quote: (r) => quoteCurve(rpc, r),
    build: (q, user) => buildCurve(rpc, q, user),
  },
  pool: router,
  chain,
  transfer: { build: (r) => buildTransfer(rpc, r) },
  launch,
  payerOf,
  records,
  settle: (id, signature) => void watchSettlement(id, signature, { landed: (sig) => chain.landed(sig), records, sleep }),
  log,
  allowedOrigins: cfg.allowedOrigins,
});

server.listen(cfg.port, () => {
  /* Never the allowlist itself or the RPC address: the count and whether it is open. */
  log.info('listening', { port: cfg.port, trading: tradingOpen(cfg), allowlisted: cfg.allowlist.size });
});
