/**
 * The trade service, assembled: the launchpad's curve, the aggregator for bonded coins, and the
 * chain for simulating and sending. Started off; see config.ts for the three things that turn
 * it on.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import { jupiter } from '@insidor/venue-jupiter';
import { chainClient } from '@insidor/venue-solana-pumpfun';
import { buildCurve, curveState, payerOf, quoteCurve } from '@insidor/venue-solana-pumpfun/curve-trade.ts';

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
  payerOf,
  log,
  allowedOrigins: cfg.allowedOrigins,
});

server.listen(cfg.port, () => {
  /* Never the allowlist itself or the RPC address: the count and whether it is open. */
  log.info('listening', { port: cfg.port, trading: tradingOpen(cfg), allowlisted: cfg.allowlist.size });
});
