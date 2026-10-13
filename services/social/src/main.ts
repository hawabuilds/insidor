/**
 * The social service, assembled: the people role's database, Privy's identity check, and the
 * chain for holdings, first buys and proof transactions. Every read of the chain is kept for a
 * while (policy), so one busy comment does not become a burst of RPC calls. The owner's coin check
 * (coin-sources.ts) reads the same chain and the free market sources, for the owner only.
 */

import pg from 'pg';

import { DEFAULT_POLICY } from '@insidor/contracts';
import { portfolioReader, tradesFromTx } from '@insidor/chain-portfolio';
import { privyIdentity } from '@insidor/identity-privy';
import { launchPriceSol } from '@insidor/venue-solana-pumpfun/curve-facts.ts';

import { liveCoinCheck } from './coin-sources.ts';
import { loadSocialConfig } from './config.ts';
import { pacer, serve } from './http.ts';
import { handle, type Chain } from './routes.ts';


const P = DEFAULT_POLICY.social;
const cfg = loadSocialConfig(process.env);
/* The people role's pool. Every statement here is one standalone query — no LISTEN, no lock, no
   SET, no transaction held across calls — so DATABASE_URL_PEOPLE may be the transaction-mode
   pooler (6543), and is on Railway. Three clients and closed after ten idle seconds: each
   process's pool adds up against the same pooler, and a request here is short. */
const POOL_MAX = 3;
const IDLE_CLIENT_MS = 10_000;
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: POOL_MAX, idleTimeoutMillis: IDLE_CLIENT_MS, application_name: 'insidor-social' });
const db = { query: async <R>(sql: string, params?: readonly unknown[]) => (await pool.query(sql, params as unknown[])).rows as R[] };
const log = (level: 'info' | 'error', msg: string, f: Record<string, unknown> = {}) => (level === 'error' ? console.error : console.log)(JSON.stringify({ level, msg, ...f }));

const BUY_KEEP_MS = 86_400_000;
const LAUNCH_KEEP_MS = 3_600_000;

function kept<T>(keepMs: number, load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const held = new Map<string, { at: number; value: T }>();
  return async (key) => {
    const h = held.get(key);
    if (h !== undefined && Date.now() - h.at < keepMs) return h.value;
    const value = await load(key);
    held.set(key, { at: Date.now(), value });
    return value;
  };
}

const chain: Chain | null = (() => {
  if (cfg.rpcUrl === null) return null;
  const rpcUrl = cfg.rpcUrl;
  const reader = portfolioReader({ rpcUrl, parseUrl: cfg.parseUrl, fetch: globalThis.fetch, timeoutMs: 10_000 });
  const balances = kept(P.holderKeepMs, (owner) => reader.balances(owner));
  const firstBuy = kept(BUY_KEEP_MS, async (key) => {
    const [wallet = '', mint = ''] = key.split('|');
    const txs = await reader.parse(await reader.signatures(wallet, DEFAULT_POLICY.wallet.signaturesRead));
    const buys = txs.flatMap((tx) => tradesFromTx(tx, wallet)).filter((t) => t.mint === mint && t.side === 'buy' && t.amount > 0).sort((a, b) => a.at - b.at);
    const first = buys[0];
    return first === undefined ? null : first.sol / first.amount;
  });
  const launch = kept(LAUNCH_KEEP_MS, () => launchPriceSol(rpcUrl));
  return {
    async holds(wallets, mint) {
      try {
        for (const w of wallets) if ((await balances(w)).tokens.some((t) => t.mint === mint && t.amount !== '0')) return true;
        return false;
      } catch {
        return null;
      }
    },
    firstBuyPriceSol: (wallet, mint) => firstBuy(`${wallet}|${mint}`).catch(() => null),
    launchPriceSol: () => launch('global').catch(() => null),
    txTouchesMint: (signature, mint) => reader.txTouchesMint(signature, mint).catch(() => false),
  };
})();

const deps = { db, identity: privyIdentity({ appId: cfg.appId }), chain, policy: P, owner: DEFAULT_POLICY.owner, coinCheck: liveCoinCheck(cfg.rpcUrl), now: Date.now, pace: pacer(P.perClient, P.windowMs) };

serve(cfg.allowedOrigins, async (req) => {
  try {
    return await handle(req, deps);
  } catch (e) {
    log('error', 'request failed', { path: req.url.split('?')[0], err: e instanceof Error ? e.message : String(e) });
    return { status: 500, body: '{"error":"server error"}' };
  }
}).listen(cfg.port, () => log('info', 'listening', { port: cfg.port, likes: chain === null ? 'off: no chain' : 'on' }));
