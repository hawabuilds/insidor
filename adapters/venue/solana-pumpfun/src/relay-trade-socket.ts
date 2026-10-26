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
 * What a frame becomes: each leg of `breakdown` on the venue's curve (`pool` "pump") is one trade,
 * its trader the user and `creatorFeeAddress` the creator. A watched coin seen on any other pool,
 * or a `migrate`, is a completed curve (graduated); a curve priced in another token than SOL is
 * `otherQuote`, whose SOL figures are unknown, never 0. Nothing is billed, so `bytes` stays empty
 * and no coin can reach a byte cap.
 *
 * What breaks if changed carelessly: the prefilter. Parsing every frame is a few megabytes of JSON a
 * second; matching on anything but the frame's first mint lets a router's transfer frame, whose
 * first mint is a leg's, pose as a trade of the coin.
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
}

/** The SOL the venue's curves are priced in, as the relay names it. */
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
/** The venue's own curve, as the relay names its pool. */
const CURVE_POOL = 'pump';
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
  if (action === 'migrate') return { kind: 'completed' };
  if (action !== 'buy' && action !== 'sell' && action !== 'create') return { kind: 'ignored' };
  if (frame['pool'] !== CURVE_POOL) return { kind: 'completed' };
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

  const handle = (data: string): void => {
    const seenAt = opts.now();
    lastFrameAt = seenAt;
    if (liveAt !== null && seenAt - liveAt >= opts.healthyAfterMs) attempt = 0;
    const coin = firstMint(data);
    if (coin === null || !wanted.has(coin)) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
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
