/**
 * THE TRADE SOCKET: one long-lived chain socket carrying a log subscription per watched coin (on
 * the coin's curve account, see curve-rpc.ts), every byte it delivers counted against the coin it
 * was for, and an honest record of every interval it was not delivering.
 *
 * WHY IT EXISTS beside the launch stream (stream.ts). That one reads a free relay's launch frames;
 * this one reads the chain's own transaction logs for a few hundred coins, on a key billed by the
 * byte delivered. So it does three things the launch stream does not: it subscribes and
 * unsubscribes one coin at a time as the watch list changes, it counts the bytes of every frame
 * against the coin whose subscription it came on (the caller's caps are built on that count), and
 * it drops what we do not pay to keep — failed transactions (their notification is billed all the
 * same and counted) and events of any coin but the subscribed one.
 *
 * ★ THE SAME RULES AS THE LAUNCH STREAM FOR WHEN IT IS NOT LISTENING. A drop, a half-open socket
 * (no frame for `staleAfterMs`, measured from the last frame, while a probe is sent every
 * `probeEveryMs` so a quiet watch list is not mistaken for a dead socket) and a handshake that
 * never completes are each an outage window [stopped, live again), handed to the caller as a fact;
 * reconnects back off on the caller's schedule, and the retry count is reset only by a connection
 * that lasted `healthyAfterMs`. Every subscription dies with its connection, so an outage is an
 * outage for EVERY coin watched across it: the caller records those coins as not measured from the
 * outage's start. They are subscribed again on reconnect only if the caller still asks.
 *
 * ★ A CUT LOG IS NOT A COMPLETE ONE. A notification whose log the node truncated is reported with
 * its signature and NOTHING decoded from it is handed over as a trade: the caller either fetches
 * the whole transaction or records the coin as not measured. Half a transaction's trades summed as
 * if whole is the undercount this file exists to avoid.
 *
 * Everything that touches a clock, a timer or a socket is injected, as in stream.ts.
 *
 * What breaks if changed carelessly: the subscription maps. A notification names a subscription
 * id, not a coin; the id comes back in the reply to our subscribe request. A frame for an id we no
 * longer map (it arrived after we unsubscribed) still costs bytes and is still counted, against the
 * coin it was for; dropping that count would let a coin past its cap.
 */

import type { Millis } from '@insidor/contracts';

import { curveEvents, type TradeFacts } from './events.ts';
import type { OpenSocket, StreamOutage, StreamSocket } from './stream.ts';

export interface CurveTrade extends TradeFacts {
  /** The watched coin this trade was delivered for. */
  readonly coin: string;
  readonly signature: string;
  readonly seenAtMs: Millis;
}

export interface TradeSocketDrain {
  readonly trades: readonly CurveTrade[];
  /** Bytes delivered for each coin since the last drain, failed transactions included. */
  readonly bytes: ReadonlyMap<string, number>;
  /** Bytes no coin can be charged with: subscribe replies, probe replies, unknown frames. */
  readonly otherBytes: number;
  /** Coins whose subscription the far end confirmed, and when. */
  readonly subscribed: readonly { readonly coin: string; readonly atMs: Millis }[];
  /** Coins whose subscription the far end refused. */
  readonly refused: readonly { readonly coin: string; readonly detail: string }[];
  /** Cut logs: their trades are NOT in `trades`. */
  readonly truncated: readonly { readonly coin: string; readonly signature: string; readonly atMs: Millis }[];
  /** Coins whose curve completed (graduated) in a delivered transaction. */
  readonly completed: readonly { readonly coin: string; readonly atMs: Millis }[];
  /** Coins that traded in another token than SOL: their SOL figures are not measurable here. */
  readonly otherQuote: readonly { readonly coin: string; readonly atMs: Millis }[];
  readonly failedDropped: number;
  readonly undecodable: number;
  readonly outages: readonly StreamOutage[];
}

export interface TradeSocket {
  start(): void;
  stop(): void;
  /** Connected right now; asking also notices a half-open socket (as stream.ts's `live`). */
  live(): boolean;
  watch(coin: string): void;
  unwatch(coin: string): void;
  /** The coins asked for. */
  watching(): ReadonlySet<string>;
  drain(): TradeSocketDrain;
}

export interface TradeSocketOptions {
  readonly url: string;
  /** The account to subscribe to for a coin (its curve). */
  readonly accountOf: (coin: string) => string;
  readonly staleAfterMs: number;
  readonly probeEveryMs: number;
  readonly healthyAfterMs: number;
  readonly now: () => Millis;
  readonly reconnectDelayMs: (attempt: number) => number;
  readonly open: OpenSocket;
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly note: (msg: string, fields: Readonly<Record<string, unknown>>) => void;
}

/** A notification frame larger than this is not one transaction's logs. Counted, not parsed. */
const MAX_FRAME_BYTES = 1_000_000;
/** Request ids at or above this are probes. */
const PROBE_ID_BASE = 1_000_000_000;

export function createTradeSocket(opts: TradeSocketOptions): TradeSocket {
  const wanted = new Set<string>();
  /** Request id → coin, until the subscribe reply names the subscription. */
  const pending = new Map<number, string>();
  /** Subscription id → coin, live subscriptions. */
  const subs = new Map<number, string>();
  /** Coin → subscription id. */
  const subOf = new Map<string, number>();
  /** Subscription ids we unsubscribed: their late frames are still charged to the coin. */
  const retired = new Map<number, string>();

  let socket: StreamSocket | null = null;
  let stopped = false;
  let liveAt: Millis | null = null;
  let downSince: Millis | null = null;
  let downWhy: string | null = null;
  let lastFrameAt: Millis | null = null;
  let attempt = 0;
  let generation = 0;
  let nextId = 1;
  let probeId = PROBE_ID_BASE;
  let cancelReconnect: (() => void) | null = null;
  let cancelHandshake: (() => void) | null = null;
  let cancelProbe: (() => void) | null = null;

  let trades: CurveTrade[] = [];
  let bytes = new Map<string, number>();
  let otherBytes = 0;
  let subscribed: { coin: string; atMs: Millis }[] = [];
  let refused: { coin: string; detail: string }[] = [];
  let truncated: { coin: string; signature: string; atMs: Millis }[] = [];
  let completed: { coin: string; atMs: Millis }[] = [];
  let otherQuote: { coin: string; atMs: Millis }[] = [];
  let failedDropped = 0;
  let undecodable = 0;
  let outages: StreamOutage[] = [];

  const send = (frame: unknown): boolean => {
    if (socket === null || liveAt === null) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (e) {
      markDown(opts.now(), `send failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  const subscribe = (coin: string): void => {
    const id = nextId++;
    pending.set(id, coin);
    if (!send({ jsonrpc: '2.0', id, method: 'logsSubscribe', params: [{ mentions: [opts.accountOf(coin)] }, { commitment: 'confirmed' }] })) pending.delete(id);
  };

  const clearSubscriptions = (): void => {
    pending.clear();
    subs.clear();
    subOf.clear();
    retired.clear();
  };

  const markDown = (atMs: Millis, why: string): void => {
    cancelHandshake?.();
    cancelHandshake = null;
    cancelProbe?.();
    cancelProbe = null;
    if (downSince === null) {
      downSince = atMs;
      downWhy = why;
    }
    liveAt = null;
    generation += 1;
    clearSubscriptions();
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
    opts.note('trade socket disconnected', { why, atMs, attempt, wait });
    if (stopped) return;
    cancelReconnect = opts.schedule(connect, wait);
  };

  const probe = (): void => {
    cancelProbe = null;
    if (liveAt === null || stopped) return;
    /* Unsubscribing an id nobody holds is answered `false`: a round trip that proves the socket. */
    send({ jsonrpc: '2.0', id: probeId++, method: 'logsUnsubscribe', params: [0] });
    cancelProbe = opts.schedule(probe, opts.probeEveryMs);
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
      outages.push({ fromMs: from, toMs: atMs, detail: `trade socket was not delivering for ${atMs - from}ms (${why ?? 'cause not recorded'})` });
    }
    opts.note('trade socket live', { atMs, recoveredFromMs: from, coins: wanted.size });
    for (const coin of wanted) subscribe(coin);
    cancelProbe = opts.schedule(probe, opts.probeEveryMs);
  };

  const charge = (coin: string | undefined, n: number): void => {
    if (coin === undefined) otherBytes += n;
    else bytes.set(coin, (bytes.get(coin) ?? 0) + n);
  };

  const handle = (data: string): void => {
    const seenAt = opts.now();
    lastFrameAt = seenAt;
    if (liveAt !== null && seenAt - liveAt >= opts.healthyAfterMs) attempt = 0;
    const size = Buffer.byteLength(data);
    if (size > MAX_FRAME_BYTES) {
      const m = /"subscription":(\d+)/.exec(data.slice(-200));
      const id = m === null ? NaN : Number(m[1]);
      charge(subs.get(id) ?? retired.get(id), size);
      opts.note('oversized trade frame not read', { bytes: size });
      return;
    }
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
      otherBytes += size;
      undecodable += 1;
      return;
    }
    const id = typeof frame['id'] === 'number' ? frame['id'] : null;
    if (id !== null) {
      otherBytes += size;
      const coin = pending.get(id);
      if (coin === undefined) return; // a probe's reply, or a reply to an unsubscribe
      pending.delete(id);
      const result = frame['result'];
      if (typeof result === 'number' && wanted.has(coin)) {
        subs.set(result, coin);
        subOf.set(coin, result);
        subscribed.push({ coin, atMs: seenAt });
      } else if (typeof result === 'number') {
        /* Unwatched while the subscribe was in flight: drop it, and still charge what it sends. */
        retired.set(result, coin);
        send({ jsonrpc: '2.0', id: nextId++, method: 'logsUnsubscribe', params: [result] });
      } else {
        refused.push({ coin, detail: JSON.stringify(frame['error'] ?? null).slice(0, 200) });
      }
      return;
    }
    if (frame['method'] !== 'logsNotification') {
      otherBytes += size;
      return;
    }
    const params = (frame['params'] ?? {}) as Record<string, unknown>;
    const subId = typeof params['subscription'] === 'number' ? params['subscription'] : NaN;
    const live = subs.get(subId);
    const coin = live ?? retired.get(subId);
    charge(coin, size);
    if (live === undefined) return;
    const value = ((params['result'] ?? {}) as Record<string, unknown>)['value'] as Record<string, unknown> | undefined;
    if (value === undefined) {
      undecodable += 1;
      return;
    }
    if (value['err'] !== null && value['err'] !== undefined) {
      failedDropped += 1;
      return;
    }
    const logs = Array.isArray(value['logs']) ? value['logs'].filter((l): l is string => typeof l === 'string') : [];
    const signature = typeof value['signature'] === 'string' ? value['signature'] : '';
    const ev = curveEvents(logs);
    undecodable += ev.undecodable;
    if (ev.completed.includes(live)) completed.push({ coin: live, atMs: seenAt });
    if (ev.truncated) {
      truncated.push({ coin: live, signature, atMs: seenAt });
      return;
    }
    for (const t of ev.trades) {
      if (t.mint !== live) continue;
      if (!t.solQuoted) {
        otherQuote.push({ coin: live, atMs: seenAt });
        continue;
      }
      trades.push({ ...t, coin: live, signature, seenAtMs: seenAt });
    }
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
      cancelProbe?.();
      cancelProbe = null;
      const dying = socket;
      socket = null;
      liveAt = null;
      clearSubscriptions();
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
      if (liveAt !== null) subscribe(coin);
    },
    unwatch(coin) {
      if (!wanted.delete(coin)) return;
      const id = subOf.get(coin);
      if (id === undefined) return; // a pending subscribe is unsubscribed when its reply lands
      subOf.delete(coin);
      subs.delete(id);
      retired.set(id, coin);
      send({ jsonrpc: '2.0', id: nextId++, method: 'logsUnsubscribe', params: [id] });
    },
    watching: () => wanted,
    drain() {
      checkStale(opts.now());
      const out: TradeSocketDrain = { trades, bytes, otherBytes, subscribed, refused, truncated, completed, otherQuote, failedDropped, undecodable, outages };
      trades = [];
      bytes = new Map();
      otherBytes = 0;
      subscribed = [];
      refused = [];
      truncated = [];
      completed = [];
      otherQuote = [];
      failedDropped = 0;
      undecodable = 0;
      outages = [];
      return out;
    },
  };
}
