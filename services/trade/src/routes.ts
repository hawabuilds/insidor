/**
 * THE TRADE ROUTES: is a coin tradable, a quote, the quote as an unsigned transaction (simulated),
 * and sending what the person signed. No reference to node:http, so every rule is tested
 * against stand-ins for the venues and the chain.
 *
 *   GET  /venue/:mint                        curve | pool | none | unavailable
 *   GET  /quote?mint&side&amount&wallet&slippageBps
 *   POST /build   { quote, wallet }          → { transaction } only if the simulation passed
 *   POST /send    { transaction }            → { signature }
 *
 * ★ TRADING OFF MEANS NO TRADE PATH. When the switch, the allowlist or the RPC is missing, every
 * route above answers "trading is off" before reading anything else — not a quote, not a venue.
 *
 * ★ A FAILED SIMULATION RETURNS NO TRANSACTION. The reply carries the reason and the program's
 * last log lines, and nothing a wallet could sign. Ported from Trador's `api/swap/build`, which
 * fails closed the same way.
 *
 * ★ THE QUOTE IS NOT RE-PRICED. The build takes the quote the person saw and builds exactly it;
 * the quote functions are not called on the build path at all. Because the quote went through
 * the browser, its amounts are checked again (allowlist, cap, slippage), and a pool quote's
 * fields must agree with the router's reply inside it — that reply is what actually executes.
 *
 * Coins on the launchpad's curve are traded with the launchpad's own instructions; coins that
 * bonded are routed through the aggregator. The platform fee is off (policy).
 */

import type { TradePolicy } from '@insidor/contracts/policy.ts';
import type { CurveQuote } from '@insidor/venue-solana-pumpfun/curve-trade.ts';
import { NATIVE, readQuote, type PoolQuote } from '@insidor/venue-jupiter';

import { tradingOpen, type TradeConfig } from './config.ts';
import { capLamports, checkRequest, REFUSAL_TEXT, type Refusal, type Side } from './gate.ts';

export interface Reply {
  readonly status: number;
  readonly body: string;
}

export interface Built {
  readonly transactionBase64: string;
  readonly lastValidBlockHeight: number | null;
}

export type Simulation = { readonly ok: true } | { readonly ok: false; readonly message: string; readonly logs: readonly string[] };

export interface TradeDeps {
  readonly cfg: Pick<TradeConfig, 'trading' | 'allowlist' | 'rpcUrl'>;
  readonly policy: TradePolicy;
  readonly curve: {
    state(mint: string): Promise<'open' | 'complete' | 'none'>;
    quote(r: { mint: string; side: Side; amount: bigint; slippageBps: number }): Promise<CurveQuote>;
    build(q: CurveQuote, user: string): Promise<Built>;
  };
  readonly pool: {
    quote(r: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number }): Promise<PoolQuote>;
    build(q: PoolQuote, user: string): Promise<Built>;
  };
  readonly chain: { simulate(b64: string): Promise<Simulation>; send(b64: string): Promise<string> };
  readonly payerOf: (signedBase64: string) => string;
  readonly log: { info(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void };
}

const json = (status: number, value: unknown): Reply => ({ status, body: JSON.stringify(value) });
const refuse = (status: number, why: Refusal): Reply => json(status, { error: REFUSAL_TEXT[why], refusal: why });
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function parse(body: string | null): Record<string, unknown> | null {
  if (body === null) return null;
  try {
    const v: unknown = JSON.parse(body);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Where a coin trades now: its curve while it is open, else the aggregator if it routes. */
async function venueOf(mint: string, deps: TradeDeps): Promise<'curve' | 'pool' | 'none' | 'unavailable'> {
  let state: 'open' | 'complete' | 'none';
  try {
    state = await deps.curve.state(mint);
  } catch {
    return 'unavailable';
  }
  if (state === 'open') return 'curve';
  try {
    await deps.pool.quote({ inputMint: NATIVE, outputMint: mint, amount: BigInt(Math.round(deps.policy.probeSol * 1e9)), slippageBps: deps.policy.defaultSlippageBps });
    return 'pool';
  } catch (e) {
    /* No route is a fact about the coin; any other failure is ours, and is not "no liquidity". */
    return e instanceof Error && /no route/.test(e.message) ? 'none' : 'unavailable';
  }
}

/** A quote that came back through the browser, checked before it is built. */
function readBack(raw: unknown): { readonly quote: CurveQuote | PoolQuote; readonly side: Side; readonly mint: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const q = raw as Record<string, unknown>;
  if (q['venue'] === 'curve') {
    const { side, mint, inAmount, outAmount, bound, slippageBps } = q;
    if ((side !== 'buy' && side !== 'sell') || typeof mint !== 'string' || !ADDRESS.test(mint)) return null;
    if (![inAmount, outAmount, bound].every((v) => typeof v === 'string' && /^\d+$/.test(v)) || typeof slippageBps !== 'number') return null;
    return { quote: { venue: 'curve', side, mint, inAmount: inAmount as string, outAmount: outAmount as string, bound: bound as string, slippageBps }, side, mint };
  }
  if (q['venue'] === 'pool') {
    let inner: PoolQuote;
    try {
      inner = readQuote(q['raw']);
    } catch {
      return null;
    }
    /* The router executes `raw`; every field the person saw must be raw's own. */
    for (const k of ['inputMint', 'outputMint', 'inAmount', 'outAmount', 'bound', 'slippageBps'] as const) {
      if (q[k] !== inner[k]) return null;
    }
    if (inner.inputMint === NATIVE) return { quote: inner, side: 'buy', mint: inner.outputMint };
    if (inner.outputMint === NATIVE) return { quote: inner, side: 'sell', mint: inner.inputMint };
    return null;
  }
  return null;
}

export async function handle(method: string, rawUrl: string, body: string | null, deps: TradeDeps): Promise<Reply> {
  const url = new URL(rawUrl, 'http://trade');
  const parts = url.pathname.split('/').filter((s) => s !== '');
  if (method === 'GET' && (parts.length === 0 || (parts.length === 1 && parts[0] === 'health'))) return json(200, { status: 'ok' });

  /* The switch, before anything is read: off means there is no trade path at all. */
  if (!tradingOpen(deps.cfg)) return refuse(403, 'trading_off');

  try {
    if (method === 'GET' && parts.length === 2 && parts[0] === 'venue') {
      const mint = parts[1] ?? '';
      if (!ADDRESS.test(mint)) return json(400, { error: 'bad request' });
      return json(200, { kind: await venueOf(mint, deps) });
    }

    if (method === 'GET' && parts.length === 1 && parts[0] === 'quote') {
      const q = url.searchParams;
      const mint = q.get('mint') ?? '';
      const side = q.get('side');
      const wallet = q.get('wallet') ?? '';
      const amount = q.get('amount') ?? '';
      const slippageBps = Number(q.get('slippageBps') ?? deps.policy.defaultSlippageBps);
      if (!ADDRESS.test(mint) || (side !== 'buy' && side !== 'sell')) return json(400, { error: 'bad request' });
      const refusal = checkRequest({ wallet, side, amount, slippageBps }, deps.cfg.allowlist, deps.policy);
      if (refusal !== null) return refuse(403, refusal);
      const venue = await venueOf(mint, deps);
      if (venue === 'curve') return json(200, { quote: await deps.curve.quote({ mint, side, amount: BigInt(amount), slippageBps }) });
      if (venue === 'pool') {
        const quote = await deps.pool.quote(side === 'buy'
          ? { inputMint: NATIVE, outputMint: mint, amount: BigInt(amount), slippageBps }
          : { inputMint: mint, outputMint: NATIVE, amount: BigInt(amount), slippageBps });
        return json(200, { quote });
      }
      return json(409, { error: venue === 'none' ? "This coin can't be traded right now." : 'Prices could not be read just now.', venue });
    }

    if (method === 'POST' && parts.length === 1 && parts[0] === 'build') {
      const b = parse(body);
      const wallet = typeof b?.['wallet'] === 'string' ? b['wallet'] : '';
      const back = readBack(b?.['quote']);
      if (back === null) return refuse(400, 'quote_tampered');
      const { quote, side } = back;
      const refusal = checkRequest({ wallet, side, amount: quote.inAmount, slippageBps: quote.slippageBps }, deps.cfg.allowlist, deps.policy);
      if (refusal !== null) return refuse(403, refusal);
      const built = quote.venue === 'curve' ? await deps.curve.build(quote, wallet) : await deps.pool.build(quote, wallet);
      const simulation = await deps.chain.simulate(built.transactionBase64);
      if (!simulation.ok) {
        deps.log.info('simulation refused a trade', { side, venue: quote.venue });
        /* No transaction in this reply: nothing here can be signed. */
        return json(422, { error: simulation.message, logs: simulation.logs.slice(-20) });
      }
      return json(200, { transaction: built.transactionBase64, lastValidBlockHeight: built.lastValidBlockHeight, simulated: true });
    }

    if (method === 'POST' && parts.length === 1 && parts[0] === 'send') {
      const b = parse(body);
      const tx = typeof b?.['transaction'] === 'string' ? b['transaction'] : '';
      if (tx === '') return json(400, { error: 'bad request' });
      let payer: string;
      try {
        payer = deps.payerOf(tx);
      } catch {
        return json(400, { error: 'bad request' });
      }
      if (!deps.cfg.allowlist.has(payer)) return refuse(403, 'not_allowed');
      return json(200, { signature: await deps.chain.send(tx) });
    }

    return json(404, { error: 'not found' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.log.error('trade request failed', { path: url.pathname, err: message });
    return json(502, { error: /rate limited/.test(message) ? 'Prices are busy. Try again in a moment.' : 'This could not be done just now.' });
  }
}

/** For tests and the report: the cap in base units. */
export { capLamports };
