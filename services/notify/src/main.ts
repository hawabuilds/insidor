/**
 * The alert service, assembled. The routes always answer. With NOTIFY=on, three loops run:
 * deliver what is queued (seconds), check prices and curves (minutes), and check the pipeline
 * (a minute) — each on its policy interval, each pass independent, a failed pass logged and
 * tried again next time.
 */

import pg from 'pg';

import { DEFAULT_POLICY } from '@insidor/contracts';
import { portfolioReader, positionsFrom, tradesFromTx } from '@insidor/chain-portfolio';
import { privyIdentity } from '@insidor/identity-privy';
import { dexscreenerQuotes } from '@insidor/market-dexscreener';
import { webPushSender } from '@insidor/push-webpush';
import { curveOf } from '@insidor/venue-solana-pumpfun/curve-facts.ts';

import { loadNotifyConfig } from './config.ts';
import { deliverQueued } from './deliver.ts';
import { pacer, serve } from './http.ts';
import { checkMarket, type MarketPorts } from './market.ts';
import { checkPipeline } from './pipeline.ts';
import { handle } from './routes.ts';

const P = DEFAULT_POLICY.notify;
const cfg = loadNotifyConfig(process.env);
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 5, application_name: 'insidor-notify' });
const db = { query: async <R>(sql: string, params?: readonly unknown[]) => (await pool.query(sql, params as unknown[])).rows as R[] };
const log = (level: 'info' | 'error', msg: string, f: Record<string, unknown> = {}) => (level === 'error' ? console.error : console.log)(JSON.stringify({ level, msg, ...f }));
const push = webPushSender(cfg.vapid);

const deps = { db, identity: privyIdentity({ appId: cfg.appId }), push, pushOn: cfg.notifyOn, policy: P, now: Date.now, pace: pacer(P.perClient, P.windowMs) };

serve(cfg.allowedOrigins, async (req) => {
  try {
    return await handle(req, deps);
  } catch (e) {
    log('error', 'request failed', { path: req.url.split('?')[0], err: e instanceof Error ? e.message : String(e) });
    return { status: 500, body: '{"error":"server error"}' };
  }
}).listen(cfg.port, () => log('info', 'listening', { port: cfg.port, notify: cfg.notifyOn ? 'on' : 'off', push: push.configured ? 'configured' : 'no keys', chain: cfg.rpcUrl === null ? 'none' : 'on' }));

function every(ms: number, name: string, work: () => Promise<unknown>): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await work();
      if (typeof r === 'number' && r > 0) log('info', name, { queued: r });
    } catch (e) {
      log('error', `${name} failed`, { err: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), ms);
}

if (cfg.notifyOn) {
  every(P.deliverLoopMs, 'delivered', async () => (await deliverQueued(deps)).length);
  every(P.pipelineLoopMs, 'pipeline alerts', () => checkPipeline(db));
  if (cfg.rpcUrl !== null) {
    const rpcUrl = cfg.rpcUrl;
    const reader = portfolioReader({ rpcUrl, parseUrl: cfg.parseUrl, fetch: globalThis.fetch, timeoutMs: 10_000 });
    const dex = dexscreenerQuotes({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: 6_000 });
    const bases = new Map<string, { at: number; value: ReadonlyMap<string, number> }>();
    const ports: MarketPorts = {
      async balances(wallet) {
        const b = await reader.balances(wallet);
        return new Map(b.tokens.map((t) => [t.mint, Number(t.amount) / 10 ** t.decimals]));
      },
      async costBasis(wallet) {
        const kept = bases.get(wallet);
        if (kept !== undefined && Date.now() - kept.at < P.positionsKeepMs) return kept.value;
        const txs = await reader.parse(await reader.signatures(wallet, DEFAULT_POLICY.wallet.signaturesRead));
        const positions = positionsFrom(txs.flatMap((tx) => tradesFromTx(tx, wallet)));
        const value = new Map([...positions].filter(([, p]) => p.qty > 0 && p.costSol > 0).map(([mint, p]) => [mint, p.costSol / p.qty]));
        bases.set(wallet, { at: Date.now(), value });
        return value;
      },
      async quotes(mints) {
        const q = await dex.quotes(mints);
        return new Map([...q].map(([mint, c]) => [mint, { ticker: c.ticker ?? '', priceUsd: c.priceUsd, priceSol: c.priceSol }]));
      },
      curve: (mint) => curveOf(rpcUrl, mint),
    };
    every(P.marketLoopMs, 'market alerts', () => checkMarket(db, ports, P));
  } else {
    log('info', 'market alerts off: no HELIUS_API_KEY for the chain');
  }
}
