/**
 * THE TRADE ROUTES: is a coin tradable, a quote, the quote as an unsigned transaction (simulated),
 * and sending what the person signed. No reference to node:http, so every rule is tested
 * against stand-ins for the venues and the chain.
 *
 *   GET  /venue/:mint                        curve | pool | none | unavailable, with the limits a
 *                                            ticket sizes against: the buy cap (null: none), the
 *                                            slippage bounds and the platform fee, all from policy
 *   GET  /quote?mint&side&amount&wallet&slippageBps
 *   POST /build   { quote, wallet }          → { transaction } only if the simulation passed
 *   POST /send    { transaction }            → { signature }
 *   GET  /balance?mint&wallet                how much of the coin the wallet holds, for Sell
 *   POST /transfer { wallet, to, mint, amount }  Send: SOL (mint null) or a coin, unsigned and simulated;
 *                                            a SOL send is capped like a buy, when buys are
 *   GET  /launch/rules                       open or paused, and the fees, read from the chain
 *   POST /launch/preview { wallet, name, symbol, devBuyLamports }  the launch's real costs, no transaction
 *   POST /launch/build   { …, description, imageDataUrl, links }   metadata stored, launch built and simulated
 *   POST /launch/confirm { wallet, signature, mint, storyId }      checked on the chain, then recorded;
 *                        with { postId, name, symbol, pick, offered } also which Create suggestion was kept
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
 *
 * Every build, send and landing is recorded (records.ts, public.trade): a record that cannot be
 * written never stops a trade, and a reply never waits on one.
 */

import type { TradePolicy } from '@insidor/contracts/policy.ts';
import type { CurveQuote } from '@insidor/venue-solana-pumpfun/curve-trade.ts';
import { routeAfter, type TradeRoute } from '@insidor/venue-solana-pumpfun/route.ts';
import { NATIVE, readQuote, type PoolQuote } from '@insidor/venue-jupiter';

import { isAllowed, tradingOpen, type TradeConfig } from './config.ts';
import { capLamports, checkRequest, devBuyCapLamports, REFUSAL_TEXT, type Refusal, type Side } from './gate.ts';
import { messageKey, type BuiltRecord, type TradeRecords } from './records.ts';

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
  readonly chain: {
    simulate(b64: string): Promise<Simulation>;
    send(b64: string): Promise<string>;
    tokenBalance(owner: string, mint: string): Promise<{ readonly amount: string; readonly decimals: number }>;
  };
  readonly transfer: { build(r: { from: string; to: string; mint: string | null; amount: bigint }): Promise<Built> };
  /** Creating a coin; null when metadata storage or the database is not configured. */
  readonly launch: LaunchPort | null;
  readonly payerOf: (signedBase64: string) => string;
  /** Where builds and sends are recorded; absent records nothing. */
  readonly records?: TradeRecords;
  /** Started after a send, not awaited: watches for the transaction to land and records how it ended. */
  readonly settle?: (id: string, signature: string) => void;
  readonly log: { info(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void };
}

/**
 * The Create sheet's suggestions and what was kept, from a confirm's body, recorded for the namer.
 * Read defensively: an old app sends none of these fields and nothing is recorded.
 */
async function notePick(deps: TradeDeps, launch: LaunchPort, mint: string, wallet: string, b: Record<string, unknown>): Promise<void> {
  const itemId = typeof b['postId'] === 'string' ? b['postId'] : null;
  const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
  const ticker = typeof b['symbol'] === 'string' ? b['symbol'].trim().replace(/^\$+/, '') : '';
  if (launch.notePick === undefined || itemId === null || name === '' || ticker === '') return;
  const pick = typeof b['pick'] === 'number' && Number.isInteger(b['pick']) && b['pick'] >= 0 ? b['pick'] : null;
  const offered = (Array.isArray(b['offered']) ? b['offered'] : []).flatMap((o) => {
    const r = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
    return typeof r['name'] === 'string' && typeof r['ticker'] === 'string' ? [{ name: r['name'].slice(0, NAME_MAX), ticker: r['ticker'].slice(0, SYMBOL_MAX) }] : [];
  }).slice(0, MAX_OFFERED);
  try {
    await launch.notePick({ address: mint, itemId, name: name.slice(0, NAME_MAX), ticker: ticker.slice(0, SYMBOL_MAX), pick: pick !== null && pick < offered.length ? pick : null, offered, wallet });
  } catch (e) {
    deps.log.error('create pick not recorded', { mint, err: e instanceof Error ? e.message.slice(0, 200) : String(e) });
  }
}

/** The most suggestions a pick is recorded against: the sheet offers five. */
const MAX_OFFERED = 10;

export interface LaunchPort {
  rules(): Promise<{ readonly open: boolean; readonly creatorFeeBps: number; readonly protocolFeeBps: number }>;
  build(r: { creator: string; name: string; symbol: string; uri: string; devBuyLamports: bigint }): Promise<{
    readonly transactionBase64: string;
    readonly mint: string;
    readonly costs: readonly { readonly key: string; readonly lamports: number }[];
    readonly totalLamports: number;
    readonly balanceLamports: number;
    readonly devBuy: { readonly lamports: number; readonly tokensOut: string; readonly supplyBps: number } | null;
  }>;
  upload(input: { name: string; symbol: string; description: string; imageDataUrl: string; links: { twitter?: string | undefined; telegram?: string | undefined; website?: string | undefined } }): Promise<{ readonly uri: string; readonly image: string }>;
  landed(signature: string): Promise<{ readonly ok: boolean; readonly payer: string | null; readonly accounts: readonly string[] } | null>;
  register(address: string, creator: string, storyId: string | null, signature: string): Promise<void>;
  /**
   * Which Create suggestion was kept for a coin made from a post (`pick`, its position in
   * `offered`), or null when the name was typed (0076 public.record_create_pick). Optional:
   * absent records nothing. Never fails a confirm: a lost pick costs only the namer one example.
   */
  notePick?(r: { address: string; itemId: string; name: string; ticker: string; pick: number | null; offered: readonly { name: string; ticker: string }[]; wallet: string }): Promise<void>;
}

/** Thrown by a launch port for a refusal the person should read: paused, unaffordable, rejected. */
export class LaunchRefusedError extends Error {}

/** What a preview builds against: the transaction is thrown away, so its metadata is never stored. */
const PREVIEW_URI = 'https://insidor.app/launch-preview.json';
const NAME_MAX = 32;
const SYMBOL_MAX = 10;
const DESCRIPTION_MAX = 500;

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

/** Where a coin trades now: its curve while it is open, else the aggregator if it routes. The rule
    itself is `routeAfter`, shared with the market reader, so a card's "tradable" and this answer
    can never disagree. */
async function venueOf(mint: string, deps: TradeDeps): Promise<TradeRoute> {
  let state: 'open' | 'complete' | 'none';
  try {
    state = await deps.curve.state(mint);
  } catch {
    return 'unavailable';
  }
  return routeAfter(state, () =>
    deps.pool.quote({ inputMint: NATIVE, outputMint: mint, amount: BigInt(Math.round(deps.policy.probeSol * 1e9)), slippageBps: deps.policy.defaultSlippageBps }),
  );
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

/** Writes a build's record without holding the reply; a transaction that is not one is not recorded. */
function recordBuilt(deps: TradeDeps, transactionBase64: string, r: Omit<BuiltRecord, 'id'>): void {
  if (deps.records === undefined) return;
  const id = messageKey(transactionBase64);
  if (id !== null) void deps.records.built({ id, ...r });
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
      /* The limits travel with the venue so the order sheet offers only sizes the gate will take:
         a preset over the cap (with its slippage) would be a button that can only be refused. */
      return json(200, {
        kind: await venueOf(mint, deps),
        limits: {
          /* Null: no cap. Said explicitly, so the app can tell "no cap" from "could not read". */
          maxBuyLamports: capLamports(deps.policy)?.toString() ?? null,
          defaultSlippageBps: deps.policy.defaultSlippageBps,
          maxSlippageBps: deps.policy.maxSlippageBps,
          feeBps: deps.policy.platformFeeBps,
        },
      });
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

    if (method === 'GET' && parts.length === 1 && parts[0] === 'balance') {
      const mint = url.searchParams.get('mint') ?? '';
      const wallet = url.searchParams.get('wallet') ?? '';
      if (!ADDRESS.test(mint) || !ADDRESS.test(wallet)) return json(400, { error: 'bad request' });
      if (!isAllowed(deps.cfg.allowlist, wallet)) return refuse(403, 'not_allowed');
      return json(200, await deps.chain.tokenBalance(wallet, mint));
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
      recordBuilt(deps, built.transactionBase64, {
        wallet, kind: side, venue: quote.venue, mint: back.mint, to: null, inAmount: quote.inAmount, outAmount: quote.outAmount, bound: quote.bound,
        slippageBps: quote.slippageBps, feeBps: deps.policy.platformFeeBps, costLamports: null, simulatedOk: simulation.ok, simulationError: simulation.ok ? null : simulation.message,
      });
      if (!simulation.ok) {
        deps.log.info('simulation refused a trade', { side, venue: quote.venue });
        /* No transaction in this reply: nothing here can be signed. */
        return json(422, { error: simulation.message, logs: simulation.logs.slice(-20) });
      }
      return json(200, { transaction: built.transactionBase64, lastValidBlockHeight: built.lastValidBlockHeight, simulated: true });
    }

    if (method === 'POST' && parts.length === 1 && parts[0] === 'transfer') {
      const b = parse(body);
      const wallet = typeof b?.['wallet'] === 'string' ? b['wallet'] : '';
      const to = typeof b?.['to'] === 'string' ? b['to'].trim() : '';
      const mint = b?.['mint'] === null ? null : typeof b?.['mint'] === 'string' ? b['mint'] : undefined;
      const amount = typeof b?.['amount'] === 'string' ? b['amount'] : '';
      if (!ADDRESS.test(to) || to === wallet || mint === undefined || (mint !== null && !ADDRESS.test(mint))) return json(400, { error: 'That is not an address this can send to.' });
      if (!isAllowed(deps.cfg.allowlist, wallet)) return refuse(403, 'not_allowed');
      if (!/^\d+$/.test(amount) || BigInt(amount) === 0n) return refuse(400, 'bad_amount');
      const sendCap = capLamports(deps.policy);
      if (mint === null && sendCap !== null && BigInt(amount) > sendCap) return refuse(403, 'over_cap');
      const built = await deps.transfer.build({ from: wallet, to, mint, amount: BigInt(amount) });
      const simulation = await deps.chain.simulate(built.transactionBase64);
      recordBuilt(deps, built.transactionBase64, {
        wallet, kind: 'transfer', venue: null, mint, to, inAmount: amount, outAmount: amount, bound: null,
        slippageBps: null, feeBps: null, costLamports: null, simulatedOk: simulation.ok, simulationError: simulation.ok ? null : simulation.message,
      });
      if (!simulation.ok) return json(422, { error: simulation.message, logs: simulation.logs.slice(-20) });
      return json(200, { transaction: built.transactionBase64, lastValidBlockHeight: built.lastValidBlockHeight, simulated: true });
    }

    if (parts[0] === 'launch' && parts.length === 2) {
      const launch = deps.launch;
      if (launch === null) return json(503, { error: 'Creating coins is not set up on this server.' });
      if (method === 'GET' && parts[1] === 'rules') {
        const rules = await launch.rules();
        /* Null: no cap on the dev buy (policy); the app then offers every preset. */
        const devCap = devBuyCapLamports(deps.policy);
        return json(200, { ...rules, maxDevBuyLamports: devCap === null ? null : devCap.toString() });
      }
      const b = parse(body) ?? {};
      const wallet = typeof b['wallet'] === 'string' ? b['wallet'] : '';
      if (!isAllowed(deps.cfg.allowlist, wallet)) return refuse(403, 'not_allowed');

      if (method === 'POST' && parts[1] === 'confirm') {
        const signature = typeof b['signature'] === 'string' ? b['signature'] : '';
        const mint = typeof b['mint'] === 'string' ? b['mint'] : '';
        const storyId = typeof b['storyId'] === 'string' ? b['storyId'] : null;
        if (!ADDRESS.test(mint) || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return json(400, { error: 'bad request' });
        const tx = await launch.landed(signature);
        /* Recorded only for a create that landed, was paid for by this wallet, and made this coin. */
        if (tx === null) return json(409, { error: 'Not on the chain yet. Try again in a moment.' });
        if (!tx.ok || tx.payer !== wallet || !tx.accounts.includes(mint)) return json(422, { error: 'That transaction did not create this coin from this wallet.' });
        await launch.register(mint, wallet, storyId, signature);
        await notePick(deps, launch, mint, wallet, b);
        return json(200, { recorded: true, coinId: `solana:${mint}` });
      }

      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      const symbol = typeof b['symbol'] === 'string' ? b['symbol'].trim().replace(/^\$+/, '') : '';
      const dev = typeof b['devBuyLamports'] === 'string' && /^\d+$/.test(b['devBuyLamports']) ? BigInt(b['devBuyLamports']) : null;
      if (name === '' || name.length > NAME_MAX || symbol === '' || symbol.length > SYMBOL_MAX || dev === null) return json(400, { error: `A name up to ${NAME_MAX} characters and a ticker up to ${SYMBOL_MAX}.` });
      const devCap = devBuyCapLamports(deps.policy);
      if (devCap !== null && dev > devCap) return refuse(403, 'over_cap');
      const rules = await launch.rules();
      if (!rules.open) return json(409, { error: 'pump.fun has new coins paused right now.', paused: true });

      try {
        if (method === 'POST' && parts[1] === 'preview') {
          const built = await launch.build({ creator: wallet, name, symbol, uri: PREVIEW_URI, devBuyLamports: dev });
          /* The numbers measured from the chain, passed through; the transaction itself is dropped. */
          return json(200, { costs: built.costs, totalLamports: built.totalLamports, balanceLamports: built.balanceLamports, devBuy: built.devBuy, creatorFeeBps: rules.creatorFeeBps, protocolFeeBps: rules.protocolFeeBps });
        }
        if (method === 'POST' && parts[1] === 'build') {
          const description = typeof b['description'] === 'string' ? b['description'].slice(0, DESCRIPTION_MAX) : '';
          const links = typeof b['links'] === 'object' && b['links'] !== null ? (b['links'] as Record<string, string>) : {};
          const imageDataUrl = typeof b['imageDataUrl'] === 'string' ? b['imageDataUrl'] : '';
          const stored = await launch.upload({ name, symbol, description, imageDataUrl, links: { twitter: links['twitter'], telegram: links['telegram'], website: links['website'] } });
          const built = await launch.build({ creator: wallet, name, symbol, uri: stored.uri, devBuyLamports: dev });
          /* A launch the port built was simulated there; a failed one threw a refusal above. */
          recordBuilt(deps, built.transactionBase64, {
            wallet, kind: 'launch', venue: 'curve', mint: built.mint, to: null, inAmount: dev.toString(), outAmount: built.devBuy?.tokensOut ?? null, bound: null,
            slippageBps: null, feeBps: null, costLamports: built.totalLamports, simulatedOk: true, simulationError: null,
          });
          return json(200, { transaction: built.transactionBase64, mint: built.mint, costs: built.costs, totalLamports: built.totalLamports, devBuy: built.devBuy, simulated: true });
        }
      } catch (e) {
        /* A refusal (paused, not enough SOL, a failed simulation, a rejected picture) is said, and
           nothing signable is returned with it. */
        if (e instanceof LaunchRefusedError) return json(422, { error: e.message });
        throw e;
      }
      return json(404, { error: 'not found' });
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
      if (!isAllowed(deps.cfg.allowlist, payer)) return refuse(403, 'not_allowed');
      const id = messageKey(tx);
      let signature: string;
      try {
        signature = await deps.chain.send(tx);
      } catch (e) {
        if (id !== null) void deps.records?.sent(id, payer, null, e instanceof Error ? e.message : String(e));
        throw e;
      }
      if (id !== null) {
        void deps.records?.sent(id, payer, signature, null);
        deps.settle?.(id, signature);
      }
      return json(200, { signature });
    }

    return json(404, { error: 'not found' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.log.error('trade request failed', { path: url.pathname, err: message });
    return json(502, { error: /rate limited/.test(message) ? 'Prices are busy. Try again in a moment.' : 'This could not be done just now.' });
  }
}

/** For tests and the report: the cap in base units. */
export { capLamports, devBuyCapLamports };
