/**
 * THE TRADE SOCKET, FROM A FREE TRADE RELAY: the same `TradeSocket` as trade-socket.ts, filled
 * from one stream that pushes every decoded memecoin trade on the chain, instead of one billed log
 * subscription per coin.
 *
 * WHY IT EXISTS. The billed socket charges by the byte, so it carries caps, and the day's cap was
 * reached by about 06:00 UTC every day (2026-10-19 to 26): every watched coin was recorded "not
 * measured" for the other eighteen hours. The relay is free and already decoded, so nothing here
 * is capped, and the watch list costs nothing however long it grows. The owner chose it on
 * 2026-10-26; the billed socket stays in trade-socket.ts, and chainwatch picks between them by
 * whether a relay address is set, so going back is one setting.
 *
 * ★ "WATCHING" A COIN IS A FILTER, NOT A SUBSCRIPTION. The relay sends everything to everyone, so
 * a coin is confirmed (`subscribed`) the instant it is asked for while the stream is live, and
 * again for every wanted coin when the stream comes back: the caller's coverage then starts there,
 * exactly as it does when the billed socket's confirmations arrive. Every frame is about 3 KB and
 * there are hundreds a second, so a frame is parsed only when the first `"mint":"` in it names a
 * watched coin; for trade frames that is the traded coin, and any other frame's first mint is not
 * a trade we keep.
 *
 * ★ THE SAME RULES FOR WHEN IT IS NOT LISTENING as the other two sockets: a drop, a half-open
 * stream (no frame for `staleAfterMs`; with hundreds a second, silence is never a quiet market)
 * and a handshake that never completes are each an outage window handed to the caller as a fact.
 *
 * What a frame becomes: each leg of `breakdown`, on the venue's curve or on any pool the coin
 * trades in after it graduates, is one trade, its trader the user and `creatorFeeAddress` the
 * creator. Graduating ends nothing here (a `migrate` is ignored): the pool's trades keep coming. A
 * trade priced in another token than SOL is `otherQuote`, whose SOL figures are unknown, never 0.
 * Nothing is billed, so `bytes` stays empty and no coin can reach a byte cap.
 *
 * ★ WITH THE CHARTS ON, EVERY FRAME WITH A MINT IS PARSED ONCE (`chart`, chainwatch chart.ts), because
 * a coin's chart must start before anyone opens it. Measured on 2026-10-27: 796 frames and 1.25 MB a
 * second, about 20 ms of parsing a second. The parse is shared, so the live feed and the watch list
 * cost nothing more.
 *
 * What breaks if changed carelessly: the prefilter. Matching on anything but the frame's first mint
 * lets a router's transfer frame, whose first mint is a leg's, pose as a trade of the coin.
 */

import type { Millis } from '@insidor/contracts';

import type { TradeFacts } from './events.ts';
import type { OpenSocket, StreamOutage, StreamSocket } from './stream.ts';
import type { CurveTrade, TradeSocket, TradeSocketDrain } from './trade-socket.ts';

export interface RelayTradeSocketOptions {
  readonly url: string;
  readonly staleAfterMs: number;
  readonly healthyAfterMs: number;
  readonly now: () => Millis;
  readonly reconnectDelayMs: (attempt: number) => number;
  readonly open: OpenSocket;
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly note: (msg: string, fields: Readonly<Record<string, unknown>>) => void;
  /** ★ THE LIVE FEED (live.ts in chainwatch): every trade of a coin someone has open, as it lands, and the SOL price. */
  readonly live?: LiveHooks;
  /** ★ THE CHARTS (chart.ts in chainwatch): every trade of every coin, so a coin's candles start at its first trade. */
  readonly chart?: ChartHooks;
  /** Every launch on the curve as the relay sees it (LaunchHooks). Absent: creates are only charted. */
  readonly launches?: LaunchHooks;
}

/** One trade as it lands, for the screens: facts of the trade, never anything of the rule. */
export interface LiveTick {
  readonly coin: string;
  readonly signature: string;
  readonly side: 'buy' | 'sell';
  /** In the quote token (SOL for nearly every launchpad coin). */
  readonly quoteAmount: number;
  readonly tokens: number;
  readonly trader: string;
  /** The coin's market cap right after the trade, in the quote token; null when the relay gave none. */
  readonly capQuote: number | null;
  /** The coin's price in the quote token right after the trade; null when the relay gave none. */
  readonly priceQuote: number | null;
  readonly quoteMint: string;
  /** The pool it traded in ("pump" on the curve, another after it graduated). */
  readonly pool: string;
  /** The pool's own account; null when the relay gave none. */
  readonly poolAddress: string | null;
  /**
   * How deep the pool is after the trade, in the quote token: its quote reserve, or on a curve its
   * virtual reserve when that is larger (the curve prices from it). Null when the relay gave neither.
   * A coin can trade in a pool someone seeded with a dollar at a third of the price; this is how a
   * reader tells that pool from the one the coin really trades in (chainwatch main-pool.ts).
   */
  readonly poolQuote: number | null;
  /** The chain's time of the trade, ms. */
  readonly atMs: number;
  /** When it reached us, ms. */
  readonly seenAtMs: number;
}

export interface LiveHooks {
  /** Whether anyone has this coin open now: only these frames are parsed for the live feed. */
  readonly wants: (coin: string) => boolean;
  readonly onTick: (t: LiveTick) => void;
  /** SOL in dollars, from the relay's own SOL and USDC trades. */
  readonly onSolUsd: (usd: number, atMs: number) => void;
}

/**
 * Every trade frame of every coin, for the charts. Unlike the live feed this is not filtered by who
 * has a coin open: a chart must begin at the coin's first trade, before anyone knew to open it. The
 * cost is one JSON parse per frame (measured 2026-10-27, see chart.ts in chainwatch).
 */
export interface ChartHooks {
  /** One frame's legs of `coin`; `launch` when the frame is the coin's own creation (it may carry no leg). */
  readonly onTrades: (coin: string, ticks: readonly LiveTick[], launch: boolean, seenAtMs: number) => void;
}

/**
 * ★ EVERY LAUNCH ON THE CURVE, AS IT HAPPENS (the owner, 2026-11-10: "could pump api replace these"). The
 * relay sends a `create` frame for each coin made on the launchpad — every transaction version, unlike the
 * launch socket, which misses version-1 launches — carrying the coin's own name, ticker and metadata link.
 * Sampled 10 Nov 01:20 UTC: 37 creates in two minutes, every launch our store then held among them, the
 * others reaching us only minutes later through the paid listing. chainwatch adds them as the listing
 * does (its relay listing), so the paid listing becomes a backup for when the relay is silent.
 */
export interface LaunchHooks {
  readonly onCreate: (c: RelayCreate) => void;
}

/** A launch read off a relay `create` frame. */
export interface RelayCreate {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  /** The coin's curve account, where its progress is read. */
  readonly marketAddress: string | null;
  /** The creation's chain time, ms. */
  readonly createdAt: number;
  readonly marketCapUsd: number | null;
  /** The token its curve is priced in, when that is not SOL (a launch paired against another token). */
  readonly pairedWith: { readonly address: string; readonly symbol: string | null; readonly name: string | null } | null;
  /** The coin's own name, ticker and metadata link, when the frame carried all three. */
  readonly details: { readonly name: string; readonly symbol: string; readonly uri: string } | null;
}

/** A relay frame read as a launch on the launchpad's curve, or null for anything else. Pure. */
export function readRelayCreate(frame: Record<string, unknown>): RelayCreate | null {
  if (frame['action'] !== 'create' || frame['pool'] !== 'pump') return null;
  const address = str(frame['mint']);
  const createdAt = num(frame['timestamp']);
  if (address === null || createdAt === null) return null;
  const name = str(frame['name']);
  const symbol = str(frame['symbol']);
  const uri = str(frame['uri']);
  const quoteMint = str(frame['quoteMint']);
  const cap = num(frame['marketCapUsd']);
  return {
    address,
    name,
    ticker: symbol,
    marketAddress: str(frame['poolId']),
    createdAt,
    marketCapUsd: cap !== null && cap > 0 ? cap : null,
    pairedWith: quoteMint === null || quoteMint === WRAPPED_SOL ? null : { address: quoteMint, symbol: str(frame['quoteSymbol']), name: str(frame['quoteName']) },
    details: name !== null && symbol !== null && uri !== null ? { name, symbol, uri } : null,
  };
}

/** The stablecoin and wrapped SOL, as the relay names them: their trades give SOL's dollar price. */
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** How often the SOL price is sampled from its trades: plenty for a price that moves in cents. */
const SOL_PRICE_EVERY_MS = 2_000;

/** Every leg of a trade frame as live ticks; empty for anything that is not a trade. Pure. */
export function liveTicksOf(frame: Record<string, unknown>, seenAtMs: number): LiveTick[] {
  const action = frame['action'];
  if (action !== 'buy' && action !== 'sell' && action !== 'create') return [];
  const coin = str(frame['mint']);
  const signature = str(frame['signature']);
  const quoteMint = str(frame['quoteMint']);
  const ts = num(frame['timestamp']);
  if (coin === null || signature === null || quoteMint === null || ts === null || !Array.isArray(frame['breakdown'])) return [];
  const capQuote = num(frame['marketCapQuote']);
  const priceQuote = num(frame['price']);
  const pool = str(frame['pool']) ?? '';
  const poolAddress = str(frame['poolId']);
  const depth = Math.max(num(frame['quoteInPool']) ?? 0, num(frame['virtualQuoteInPool']) ?? 0);
  const poolQuote = depth > 0 ? depth : null;
  const out: LiveTick[] = [];
  for (const leg of frame['breakdown'] as unknown[]) {
    if (leg === null || typeof leg !== 'object') continue;
    const l = leg as Record<string, unknown>;
    const side = l['action'];
    const trader = str(l['trader']);
    const quoteAmount = num(l['quoteAmount']);
    const tokens = num(l['tokenAmount']);
    if ((side !== 'buy' && side !== 'sell') || trader === null || quoteAmount === null || tokens === null) continue;
    out.push({ coin, signature, side, quoteAmount, tokens, trader, capQuote: capQuote !== null && capQuote > 0 ? capQuote : null, priceQuote: priceQuote !== null && priceQuote > 0 ? priceQuote : null, quoteMint, pool, poolAddress, poolQuote, atMs: ts, seenAtMs });
  }
  return out;
}

/** SOL's dollar price from a SOL and USDC trade frame, or null. Pure. */
export function solUsdOf(frame: Record<string, unknown>): number | null {
  const price = num(frame['price']);
  if (price === null || price <= 0) return null;
  if (frame['mint'] === USDC && frame['quoteMint'] === WRAPPED_SOL) return 1 / price;
  if (frame['mint'] === WRAPPED_SOL && frame['quoteMint'] === USDC) return price;
  return null;
}

/** The SOL the venue's curves are priced in, as the relay names it. */
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const MINT_KEY = '"mint":"';

/** The first `"mint":"…"` in a frame, without parsing it; null when there is none. */
export function firstMint(data: string): string | null {
  const at = data.indexOf(MINT_KEY);
  if (at < 0) return null;
  const from = at + MINT_KEY.length;
  const to = data.indexOf('"', from);
  return to < 0 || to - from > 64 ? null : data.slice(from, to);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export type RelayFrameReading =
  | { readonly kind: 'trades'; readonly signature: string; readonly trades: readonly TradeFacts[] }
  | { readonly kind: 'completed' }
  | { readonly kind: 'other_quote' }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'undecodable' };

/** What one parsed relay frame says about `coin`. Pure, so the tests hold the reading. */
export function readRelayFrame(frame: Record<string, unknown>, coin: string): RelayFrameReading {
  if (frame['mint'] !== coin) return { kind: 'ignored' };
  const action = frame['action'];
  if (action !== 'buy' && action !== 'sell' && action !== 'create') return { kind: 'ignored' };
  /* ★ A GRADUATED COIN IS STILL MEASURED (the owner, 2026-10-26: "whatever it takes to catch the
     right coin early"). The relay carries its pool's trades as it carried its curve's, so leaving
     the curve no longer ends the coin: 25 Oct's $Marvin graduated three minutes after launch, and
     every post with one such candidate fell back to readings. */
  const quoteMint = str(frame['quoteMint']);
  if (quoteMint !== WRAPPED_SOL) return { kind: 'other_quote' };
  const signature = str(frame['signature']);
  const ts = num(frame['timestamp']);
  if (signature === null || ts === null || !Array.isArray(frame['breakdown'])) return { kind: 'undecodable' };
  const creator = str(frame['creatorFeeAddress']) ?? '';
  const mcap = num(frame['marketCapQuote']);
  const trades: TradeFacts[] = [];
  for (const leg of frame['breakdown'] as unknown[]) {
    if (leg === null || typeof leg !== 'object') return { kind: 'undecodable' };
    const l = leg as Record<string, unknown>;
    const user = str(l['trader']);
    const tokens = num(l['tokenAmount']);
    const sol = num(l['quoteAmount']);
    if ((l['action'] !== 'buy' && l['action'] !== 'sell') || user === null || tokens === null || sol === null) return { kind: 'undecodable' };
    trades.push({
      mint: coin,
      user,
      creator,
      isBuy: l['action'] === 'buy',
      timestampS: Math.floor(ts / 1000),
      tokens,
      solQuoted: true,
      quoteMint,
      sol,
      mcapSol: mcap !== null && mcap > 0 ? mcap : null,
    });
  }
  return { kind: 'trades', signature, trades };
}

export function createRelayTradeSocket(opts: RelayTradeSocketOptions): TradeSocket {
  const wanted = new Set<string>();
  let socket: StreamSocket | null = null;
  let stopped = false;
  let liveAt: Millis | null = null;
  let downSince: Millis | null = null;
  let downWhy: string | null = null;
  let lastFrameAt: Millis | null = null;
  let attempt = 0;
  let generation = 0;
  let cancelReconnect: (() => void) | null = null;
  let cancelHandshake: (() => void) | null = null;

  let trades: CurveTrade[] = [];
  let subscribed: { coin: string; atMs: Millis }[] = [];
  let completed: { coin: string; atMs: Millis }[] = [];
  let otherQuote: { coin: string; atMs: Millis }[] = [];
  let undecodable = 0;
  let outages: StreamOutage[] = [];

  const markDown = (atMs: Millis, why: string): void => {
    cancelHandshake?.();
    cancelHandshake = null;
    if (downSince === null) {
      downSince = atMs;
      downWhy = why;
    }
    liveAt = null;
    generation += 1;
    const dying = socket;
    socket = null;
    try {
      dying?.close();
    } catch {
      // Already dead: the outage is open either way.
    }
    if (cancelReconnect !== null) return;
    attempt += 1;
    const wait = opts.reconnectDelayMs(attempt);
    opts.note('trade relay disconnected', { why, atMs, attempt, wait });
    if (stopped) return;
    cancelReconnect = opts.schedule(connect, wait);
  };

  const markLive = (atMs: Millis): void => {
    cancelHandshake?.();
    cancelHandshake = null;
    const from = downSince;
    const why = downWhy;
    downSince = null;
    downWhy = null;
    liveAt = atMs;
    lastFrameAt = atMs;
    if (from !== null && atMs > from) {
      outages.push({ fromMs: from, toMs: atMs, detail: `trade relay was not delivering for ${atMs - from}ms (${why ?? 'cause not recorded'})` });
    }
    opts.note('trade relay live', { atMs, recoveredFromMs: from, coins: wanted.size });
    for (const coin of wanted) subscribed.push({ coin, atMs });
  };

  let solSampledAt = 0;
  const handle = (data: string): void => {
    const seenAt = opts.now();
    lastFrameAt = seenAt;
    if (liveAt !== null && seenAt - liveAt >= opts.healthyAfterMs) attempt = 0;
    const coin = firstMint(data);
    if (coin === null) return;
    const live = opts.live;
    const chart = opts.chart;
    /* One parse per frame at most, shared by the live feed, the charts and the watch list. */
    let parsed: Record<string, unknown> | null | undefined;
    const parse = (): Record<string, unknown> | null => {
      if (parsed === undefined) {
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }
      return parsed;
    };
    /* ★ The live feed and the SOL price: parsed only for a coin someone has open, and SOL's pairs every few seconds. */
    if (live !== undefined) {
      const priceFrame = (coin === USDC || coin === WRAPPED_SOL) && seenAt - solSampledAt >= SOL_PRICE_EVERY_MS;
      if (priceFrame || live.wants(coin)) {
        const f = parse();
        if (f !== null) {
          if (priceFrame) {
            const usd = solUsdOf(f);
            if (usd !== null) {
              solSampledAt = seenAt;
              live.onSolUsd(usd, seenAt);
            }
          }
          if (live.wants(coin)) for (const t of liveTicksOf(f, seenAt)) live.onTick(t);
        }
      }
    }
    if (chart !== undefined && coin !== USDC && coin !== WRAPPED_SOL) {
      const f = parse();
      if (f !== null) {
        const ticks = liveTicksOf(f, seenAt);
        if (ticks.length > 0 || f['action'] === 'create') chart.onTrades(coin, ticks, f['action'] === 'create', seenAt);
      }
    }
    /* A launch: the text test first, so a frame that is not a create is never parsed for it. */
    if (opts.launches !== undefined && data.includes('"action":"create"')) {
      const f = parse();
      const c = f === null ? null : readRelayCreate(f);
      if (c !== null) opts.launches.onCreate(c);
    }
    if (!wanted.has(coin)) return;
    const frame = parse();
    if (frame === null) {
      undecodable += 1;
      return;
    }
    const r = readRelayFrame(frame, coin);
    if (r.kind === 'undecodable') undecodable += 1;
    else if (r.kind === 'completed') completed.push({ coin, atMs: seenAt });
    else if (r.kind === 'other_quote') otherQuote.push({ coin, atMs: seenAt });
    else if (r.kind === 'trades') for (const t of r.trades) trades.push({ ...t, coin, signature: r.signature, seenAtMs: seenAt });
  };

  function connect(): void {
    cancelReconnect = null;
    cancelHandshake?.();
    cancelHandshake = null;
    if (stopped) return;
    const mine = ++generation;
    const current = (): boolean => mine === generation && !stopped;
    try {
      socket = opts.open(opts.url, {
        onOpen: () => {
          if (current()) markLive(opts.now());
        },
        onMessage: (data) => {
          if (current()) handle(data);
        },
        onClose: (why) => {
          if (current()) markDown(opts.now(), why);
        },
      });
      if (current() && liveAt === null) {
        cancelHandshake = opts.schedule(() => {
          cancelHandshake = null;
          if (current()) markDown(opts.now(), `handshake did not complete within ${opts.staleAfterMs}ms`);
        }, opts.staleAfterMs);
      }
    } catch (e) {
      socket = null;
      markDown(opts.now(), `open failed: ${e instanceof Error ? e.name : 'unknown'}`);
    }
  }

  const checkStale = (nowMs: Millis): void => {
    if (liveAt === null || lastFrameAt === null || nowMs - lastFrameAt <= opts.staleAfterMs) return;
    markDown(lastFrameAt, `no frame for ${nowMs - lastFrameAt}ms`);
  };

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      generation += 1;
      cancelReconnect?.();
      cancelReconnect = null;
      cancelHandshake?.();
      cancelHandshake = null;
      const dying = socket;
      socket = null;
      liveAt = null;
      try {
        dying?.close();
      } catch {
        // Shutting down.
      }
    },
    live() {
      checkStale(opts.now());
      return liveAt !== null;
    },
    watch(coin) {
      if (wanted.has(coin)) return;
      wanted.add(coin);
      if (liveAt !== null) subscribed.push({ coin, atMs: opts.now() });
    },
    unwatch(coin) {
      wanted.delete(coin);
    },
    watching: () => wanted,
    drain() {
      checkStale(opts.now());
      const out: TradeSocketDrain = {
        trades,
        bytes: new Map(),
        otherBytes: 0,
        subscribed,
        refused: [],
        truncated: [],
        completed,
        otherQuote,
        failedDropped: 0,
        undecodable,
        outages,
      };
      trades = [];
      subscribed = [];
      completed = [];
      otherQuote = [];
      undecodable = 0;
      outages = [];
      return out;
    },
  };
}
