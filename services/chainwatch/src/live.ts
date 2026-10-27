/**
 * THE LIVE FEED: every trade of a coin someone has open, the moment the relay delivers it, with the
 * coin's market cap in dollars right after it (the owner, 2026-10-26: "every price, mc, trade should
 * be instant using the fastest on-chain data").
 *
 * Why here: the trade relay allows one connection per address, and this process holds it (the trade
 * feed, wiring.ts). So the relay socket hands this hub every trade of a coin it `wants`, and the SOL
 * price from SOL's own trades; the hub turns each into a tick with dollars and sends it to whoever
 * asked for that coin. Nothing is stored: the trade tables are the trade feed's.
 *
 * ★ PRIVATE, NEVER THE BROWSER'S. The hub answers on this process's own port, which only Railway's
 * private network reaches. The read service is its one listener (services/read live-coins.ts): it
 * holds one connection here with every coin any phone has open, and fans the ticks out to phones
 * over its own public stream. A browser never talks to this process.
 *
 * ★ BATCHED, NOT THROTTLED AWAY. Ticks are held for `FLUSH_MS` and sent together, every tick kept:
 * the Trades list wants each fill, and a busy coin's 40 trades a second arrive as four messages, not
 * forty. A coin nobody asked for is never parsed (the relay socket's prefilter asks `wants`).
 *
 * ★ DOLLARS ONLY WITH A PRICE. A tick in SOL becomes dollars at the median SOL price the relay's SOL
 * and USDC trades gave in the last `SOL_FRESH_MS` (one odd sample is not kept); with none that fresh, the dollar fields are null and
 * the screen shows the SOL cap's age rather than a guessed number. A coin priced in another token
 * than SOL carries no dollars here.
 *
 * What breaks if changed carelessly: the coin cap per listener. Each listener names its coins in the
 * request; without `MAX_COINS` one request could make this process parse the whole relay.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LiveHooks, LiveTick } from '@insidor/venue-solana-pumpfun/relay-trade-socket.ts';

/** How long ticks are held before they are sent together. */
const FLUSH_MS = 250;
/** The most coins one listener may ask for. */
const MAX_COINS = 400;
/** The SOL price is used for dollars this long after it was read. */
const SOL_FRESH_MS = 60_000;
/** A SOL sample this far from the last minute's median (a share of it) is not kept, once there are enough to judge. */
const SOL_OUTLIER = 0.03;
const SOL_MIN_SAMPLES = 5;
/** The most SOL samples kept for the median. */
const SOL_MAX_SAMPLES = 200;
/** A comment line this often, so a quiet stream is not taken for a dead one. */
const HEARTBEAT_MS = 15_000;
/** The relay's name for wrapped SOL. */
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
/** A coin address as the relay writes it. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

/** One tick as sent: short keys, because a busy minute is thousands of them. */
export interface WireTick {
  /** The coin. */
  readonly a: string;
  /** 'b' a buy, 's' a sell. */
  readonly s: 'b' | 's';
  /** SOL (the quote token) traded. */
  readonly q: number;
  /** Tokens traded. */
  readonly k: number;
  /** The trader's wallet. */
  readonly w: string;
  /** Market cap in dollars right after the trade; null without a fresh SOL price or a SOL quote. */
  readonly c: number | null;
  /** Price in dollars right after the trade; null as `c`. */
  readonly p: number | null;
  /** Market cap in the quote token. */
  readonly cq: number | null;
  /** The chain's time of the trade, ms. */
  readonly t: number;
  /** The transaction's signature. */
  readonly x: string;
  /** The pool ("pump" on the curve). */
  readonly o: string;
}

interface Listener {
  readonly coins: ReadonlySet<string>;
  readonly res: ServerResponse;
}

export interface LiveHub {
  readonly hooks: LiveHooks;
  /** Serves GET /live?coins=a,b on the process's own server; false when the path is not this hub's. */
  serve(req: IncomingMessage, res: ServerResponse): boolean;
  stop(): void;
  stats(): { readonly listeners: number; readonly coins: number; readonly solUsd: number | null };
  /** SOL in dollars now (the median above), or null when none is fresh: the charts price trades with it. */
  solUsdNow(): number | null;
}

export function createLiveHub(now: () => number = Date.now): LiveHub {
  const listeners = new Set<Listener>();
  const wanted = new Map<string, number>();
  let pending: WireTick[] = [];
  let solUsd: { readonly usd: number; readonly at: number } | null = null;
  let solSamples: { readonly usd: number; readonly at: number }[] = [];

  const dollars = (t: LiveTick): { c: number | null; p: number | null } => {
    if (t.quoteMint !== WRAPPED_SOL || solUsd === null || now() - solUsd.at > SOL_FRESH_MS) return { c: null, p: null };
    return { c: t.capQuote === null ? null : t.capQuote * solUsd.usd, p: t.priceQuote === null ? null : t.priceQuote * solUsd.usd };
  };

  const flush = (): void => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (const l of listeners) {
      const mine = batch.filter((t) => l.coins.has(t.a));
      if (mine.length > 0) l.res.write(`data: ${JSON.stringify({ ticks: mine, solUsd: solUsd?.usd ?? null })}\n\n`);
    }
  };
  const flushTimer = setInterval(flush, FLUSH_MS);
  flushTimer.unref();
  const beat = setInterval(() => {
    for (const l of listeners) l.res.write(`: ${now()}\n\n`);
  }, HEARTBEAT_MS);
  beat.unref();

  const add = (l: Listener): void => {
    listeners.add(l);
    for (const c of l.coins) wanted.set(c, (wanted.get(c) ?? 0) + 1);
  };
  const remove = (l: Listener): void => {
    if (!listeners.delete(l)) return;
    for (const c of l.coins) {
      const n = (wanted.get(c) ?? 1) - 1;
      if (n <= 0) wanted.delete(c);
      else wanted.set(c, n);
    }
  };

  return {
    hooks: {
      wants: (coin) => wanted.has(coin),
      onTick: (t) => {
        const d = dollars(t);
        pending.push({ a: t.coin, s: t.side === 'buy' ? 'b' : 's', q: t.quoteAmount, k: t.tokens, w: t.trader, c: d.c, p: d.p, cq: t.capQuote, t: t.atMs, x: t.signature, o: t.pool });
      },
      onSolUsd: (usd, atMs) => {
        if (!Number.isFinite(usd) || !(usd > 0)) return;
        /* ★ THE MEDIAN OF THE LAST MINUTE, NOT THE LAST TRADE (the owner, 2026-10-27: a token page "looked
           like it rugged for a second"). Every SOL/USDC trade on any pool reaches here; one in a thin or
           odd pool at a bad price would put every coin's dollars wrong until the next. A sample more
           than SOL_OUTLIER from the median of the kept ones is not kept. */
        solSamples = solSamples.filter((x) => atMs - x.at <= SOL_FRESH_MS);
        const kept = [...solSamples].map((x) => x.usd).sort((a, b) => a - b);
        const median = kept.length === 0 ? null : kept[Math.floor(kept.length / 2)]!;
        if (median !== null && kept.length >= SOL_MIN_SAMPLES && Math.abs(usd - median) > SOL_OUTLIER * median) return;
        solSamples.push({ usd, at: atMs });
        if (solSamples.length > SOL_MAX_SAMPLES) solSamples.shift();
        const all = solSamples.map((x) => x.usd).sort((a, b) => a - b);
        solUsd = { usd: all[Math.floor(all.length / 2)]!, at: atMs };
      },
    },
    serve(req, res) {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname !== '/live') return false;
      const coins = new Set((url.searchParams.get('coins') ?? '').split(',').map((c) => c.trim()).filter((c) => ADDRESS.test(c)).slice(0, MAX_COINS));
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`retry: 2000\n\n`);
      res.write(`data: ${JSON.stringify({ ready: true, coins: coins.size, solUsd: solUsd?.usd ?? null })}\n\n`);
      const l: Listener = { coins, res };
      add(l);
      const end = (): void => remove(l);
      req.on('close', end);
      res.on('error', end);
      return true;
    },
    stop() {
      clearInterval(flushTimer);
      clearInterval(beat);
      for (const l of [...listeners]) {
        l.res.end();
        remove(l);
      }
    },
    stats: () => ({ listeners: listeners.size, coins: wanted.size, solUsd: solUsd?.usd ?? null }),
    solUsdNow: () => (solUsd === null || now() - solUsd.at > SOL_FRESH_MS ? null : solUsd.usd),
  };
}
