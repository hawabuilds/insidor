/**
 * THE TRADE WATCHER: the coins on internal.coin_watch, subscribed one by one, their trades kept
 * per minute and per coin (0112), their coverage kept on the watch row (0114), and the feed's cost
 * held under a per-coin and a per-day cap — so the one-coin rule judges on who is actually buying.
 *
 * One pass every `flushMs`:
 *   reread  (every `rereadMs`) the watch list. A coin whose watch ended is let go. A new coin's
 *           curve is checked first (one chain read per hundred coins): on the curve it is
 *           subscribed; graduated or with no curve it is recorded not measured, because its trades
 *           happen where this feed does not look. A new coin with no opening buy on its row gets
 *           one read of its launch transaction, within the day's allowance.
 *   drain   the socket: trades into the book, bytes against each coin and the day, confirmations
 *           as measured_from, and every way measurement ends (below).
 *   write   the changed minute and state rows whole, each measured coin's heartbeat (only while
 *           the socket is live), the coverage changes and the day's counted cost.
 *
 * ★ EVERY END OF MEASUREMENT IS RECORDED, AND NONE IS A ZERO. A coin is marked not measured from
 * an instant, for a reason, and unsubscribed: its own byte cap (`coin_cap`), the day's credit cap
 * (`day_cap`, every coin, and no new ones until the next UTC day), an outage of the socket while it
 * was measured (`outage`, from the outage's start), a refused subscription, a completed curve, a
 * trade in another token, or a cut log that could not be read whole (`truncated`). The rule then
 * reads it as unknown. The process starting again marks the previous process's coins (`restart`).
 *
 * The socket, the chain reads and the tables are ports declared here in this service's words;
 * wiring.ts binds them to the venue adapter and the store. Nothing here names a vendor.
 *
 * What breaks if changed carelessly: the order inside a drain. Outages are applied before
 * confirmations, so a coin re-subscribed after a reconnect is not taken as measured across the
 * hole; trades are applied before a completed curve ends a coin, so the graduating trade counts.
 */

import type { OneCoinPolicy } from '@insidor/contracts/policy.ts';

import { FeedCost, TradeBook, type BookTrade, type MinuteRow, type StateRow } from './trade-book.ts';

export type EndReason = 'coin_cap' | 'day_cap' | 'outage' | 'restart' | 'refused' | 'graduated' | 'no_curve' | 'other_quote' | 'truncated' | 'feed_off';

export interface SocketTrade {
  readonly coin: string;
  readonly user: string;
  readonly creator: string;
  readonly isBuy: boolean;
  readonly timestampS: number;
  readonly sol: number | null;
  readonly mcapSol: number | null;
  readonly seenAtMs: number;
}

export interface SocketDrain {
  readonly trades: readonly SocketTrade[];
  readonly bytes: ReadonlyMap<string, number>;
  readonly otherBytes: number;
  readonly subscribed: readonly { readonly coin: string; readonly atMs: number }[];
  readonly refused: readonly { readonly coin: string; readonly detail: string }[];
  readonly truncated: readonly { readonly coin: string; readonly signature: string; readonly atMs: number }[];
  readonly completed: readonly { readonly coin: string; readonly atMs: number }[];
  readonly otherQuote: readonly { readonly coin: string; readonly atMs: number }[];
  readonly failedDropped: number;
  readonly undecodable: number;
  readonly outages: readonly { readonly fromMs: number; readonly toMs: number; readonly detail: string }[];
}

/** The push side: one subscription per coin. */
export interface TradeSocketPort {
  live(): boolean;
  watch(coin: string): void;
  unwatch(coin: string): void;
  drain(): SocketDrain;
}

/** The chain reads, each saying how many plain and history calls it cost. Throwing means "could not ask". */
export interface ChainPort {
  places(coins: readonly string[]): Promise<{ readonly places: ReadonlyMap<string, 'curve' | 'graduated' | 'no_curve'>; readonly calls: number }>;
  /** A whole transaction's trades of `coin`; null when the chain does not have it whole. One history call. */
  transactionTrades(signature: string, coin: string): Promise<readonly Omit<SocketTrade, 'seenAtMs'>[] | null>;
  /** The coin's opening buy from its launch transaction; null: not recorded. */
  opening(coin: string): Promise<{ readonly opening: { readonly creatorBuyTokens: number; readonly creatorBuySol: number; readonly launchMcapSol: number | null } | null; readonly historyCalls: number }>;
}

export interface CoverChange {
  readonly address: string;
  readonly measuredFromMs: number | null;
  readonly measuredToMs: number | null;
  readonly unmeasured: { readonly fromMs: number; readonly reason: EndReason } | null;
  readonly addBytes: number;
}

export interface TradeStorePort {
  watchList(nowMs: number, defaultWatchMs: number): Promise<readonly { readonly address: string; readonly untilMs: number; readonly measuredFromMs: number | null; readonly unmeasured: boolean }[]>;
  missingOpenings(addresses: readonly string[]): Promise<ReadonlySet<string>>;
  day(nowMs: number): Promise<{ readonly dayMs: number; readonly bytes: number; readonly rpcCalls: number; readonly credits: number } | null>;
  markRestarted(nowMs: number): Promise<number>;
  write(w: {
    readonly minutes: readonly MinuteRow[];
    readonly states: readonly StateRow[];
    readonly cover: readonly CoverChange[];
    readonly openings: readonly { readonly address: string; readonly creatorBuyTokens: number; readonly creatorBuySol: number; readonly launchMcapSol: number | null }[];
    readonly day: { readonly dayMs: number; readonly bytes: number; readonly rpcCalls: number; readonly credits: number } | null;
    readonly nowMs: number;
  }): Promise<void>;
}

export interface TradeWatchDeps {
  readonly socket: TradeSocketPort;
  readonly chain: ChainPort;
  readonly store: TradeStorePort;
  readonly policy: Pick<OneCoinPolicy, 'watchMs' | 'tradeFeed'>;
  readonly now: () => number;
  readonly note: (level: 'info' | 'warn', msg: string, fields: Readonly<Record<string, unknown>>) => void;
}

/** What one pass did, for the log and the dry run. */
export interface PassTotals {
  trades: number;
  failedDropped: number;
  undecodable: number;
  truncated: number;
  truncatedRead: number;
  ended: Partial<Record<EndReason, number>>;
  openings: number;
}

export interface TradeWatch {
  /** Once, before the first pass: the previous process's coins, and the day's cost so far. */
  boot(): Promise<void>;
  pass(): Promise<PassTotals>;
  /** The day's counted cost, and the coins measured now. */
  status(): { readonly dayMs: number; readonly bytes: number; readonly calls: number; readonly credits: number; readonly measuring: number; readonly watching: number; readonly dayCapped: boolean; readonly book: ReturnType<TradeBook['stats']> };
}

interface Held {
  readonly address: string;
  untilMs: number;
  /** Confirmed by the socket in this process. */
  measuredFromMs: number | null;
  ended: boolean;
}

export function createTradeWatch(deps: TradeWatchDeps): TradeWatch {
  const F = deps.policy.tradeFeed;
  const book = new TradeBook();
  let cost: FeedCost | null = null;
  const held = new Map<string, Held>();
  /** Coins this process has decided about (subscribed, or recorded not measured): never looked at again. */
  const decided = new Set<string>();
  const openingDone = new Set<string>();
  let lastReread = Number.NEGATIVE_INFINITY;
  let dayCapped = false;
  let openingsToday = 0;
  let truncatedToday = 0;

  let cover = new Map<string, { measuredFromMs: number | null; measuredToMs: number | null; unmeasured: { fromMs: number; reason: EndReason } | null; addBytes: number }>();
  let openings: { address: string; creatorBuyTokens: number; creatorBuySol: number; launchMcapSol: number | null }[] = [];

  const coverOf = (address: string) => {
    let c = cover.get(address);
    if (c === undefined) {
      c = { measuredFromMs: null, measuredToMs: null, unmeasured: null, addBytes: 0 };
      cover.set(address, c);
    }
    return c;
  };

  const costNow = (): FeedCost => {
    if (cost === null) throw new Error('trade watch used before boot');
    return cost;
  };

  const end = (address: string, fromMs: number, reason: EndReason, totals: PassTotals): void => {
    const h = held.get(address);
    if (h !== undefined && h.ended) return;
    const c = coverOf(address);
    if (c.unmeasured === null) c.unmeasured = { fromMs, reason };
    if (h !== undefined) {
      h.ended = true;
      deps.socket.unwatch(address);
    }
    decided.add(address);
    totals.ended[reason] = (totals.ended[reason] ?? 0) + 1;
  };

  const reread = async (now: number, totals: PassTotals): Promise<void> => {
    const list = await deps.store.watchList(now, deps.policy.watchMs);
    const open = new Map(list.map((w) => [w.address, w] as const));
    /* Watches that ended (or that another writer marked): let go, with a last heartbeat. */
    for (const [address, h] of held) {
      const w = open.get(address);
      if (w !== undefined && !w.unmeasured && !h.ended) {
        h.untilMs = w.untilMs;
        continue;
      }
      if (!h.ended) deps.socket.unwatch(address);
      if (h.measuredFromMs !== null && !h.ended && deps.socket.live()) coverOf(address).measuredToMs = Math.min(now, h.untilMs);
      held.delete(address);
      costNow().forget(address);
    }
    const fresh = list.filter((w) => !w.unmeasured && !decided.has(w.address) && !held.has(w.address) && w.measuredFromMs === null);
    if (fresh.length === 0) return;
    if (dayCapped) {
      for (const w of fresh) end(w.address, now, 'day_cap', totals);
      return;
    }
    const room = Math.max(0, F.maxCoins - held.size);
    const batch = fresh.slice(0, room);
    if (batch.length === 0) return;
    const { places, calls } = await deps.chain.places(batch.map((w) => w.address));
    costNow().addCalls(calls, 0);
    for (const w of batch) {
      const place = places.get(w.address);
      if (place === undefined) continue; // not answered: looked at again next time, still not measured
      if (place !== 'curve') {
        end(w.address, now, place === 'graduated' ? 'graduated' : 'no_curve', totals);
        continue;
      }
      held.set(w.address, { address: w.address, untilMs: w.untilMs, measuredFromMs: null, ended: false });
      decided.add(w.address);
      deps.socket.watch(w.address);
    }
    /* The opening buy, for the coins whose row lacks it, within the day's allowance. */
    const want = batch.map((w) => w.address).filter((a) => held.has(a) && !openingDone.has(a));
    const missing = await deps.store.missingOpenings(want);
    for (const a of want) {
      if (!missing.has(a)) {
        openingDone.add(a);
        continue;
      }
      if (openingsToday >= F.openingLookupsPerDay || costNow().credits >= F.dayCapCredits) break;
      openingDone.add(a);
      openingsToday += 1;
      try {
        const r = await deps.chain.opening(a);
        costNow().addCalls(0, r.historyCalls);
        if (r.opening !== null) {
          openings.push({ address: a, ...r.opening });
          totals.openings += 1;
        }
      } catch (e) {
        deps.note('warn', 'trade feed: opening buy not read', { coin: a, err: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  const toBook = (t: SocketTrade): BookTrade | null => (t.sol === null ? null : { coin: t.coin, user: t.user, creator: t.creator, isBuy: t.isBuy, timestampS: t.timestampS, sol: t.sol, mcapSol: t.mcapSol, seenAtMs: t.seenAtMs });

  const applyDrain = async (d: SocketDrain, now: number, totals: PassTotals): Promise<void> => {
    const c = costNow();
    for (const [coin, n] of d.bytes) {
      c.addBytes(coin, n);
      coverOf(coin).addBytes += n;
    }
    c.addBytes(null, d.otherBytes);
    totals.failedDropped += d.failedDropped;
    totals.undecodable += d.undecodable;

    /* Outages first: every coin measured when one began is not measured from its start. */
    for (const o of d.outages) {
      for (const h of held.values()) if (h.measuredFromMs !== null && h.measuredFromMs <= o.toMs && !h.ended) end(h.address, Math.max(o.fromMs, h.measuredFromMs), 'outage', totals);
      deps.note('warn', 'trade feed outage: the coins it covered are recorded not measured', { fromMs: o.fromMs, toMs: o.toMs, detail: o.detail });
    }
    for (const s of d.subscribed) {
      const h = held.get(s.coin);
      if (h === undefined || h.ended || h.measuredFromMs !== null) continue;
      h.measuredFromMs = s.atMs;
      coverOf(s.coin).measuredFromMs = s.atMs;
    }
    for (const r of d.refused) end(r.coin, now, 'refused', totals);

    for (const t of d.trades) {
      const h = held.get(t.coin);
      const b = toBook(t);
      if (h === undefined || h.ended || h.measuredFromMs === null || b === null) continue;
      book.apply(b);
      totals.trades += 1;
    }
    for (const cut of d.truncated) {
      totals.truncated += 1;
      const h = held.get(cut.coin);
      if (h === undefined || h.ended) continue;
      if (truncatedToday >= F.truncatedLookupsPerDay || c.credits >= F.dayCapCredits) {
        end(cut.coin, cut.atMs, 'truncated', totals);
        continue;
      }
      truncatedToday += 1;
      try {
        const whole = await deps.chain.transactionTrades(cut.signature, cut.coin);
        c.addCalls(0, 1);
        if (whole === null) {
          end(cut.coin, cut.atMs, 'truncated', totals);
          continue;
        }
        for (const t of whole) {
          const b = toBook({ ...t, seenAtMs: cut.atMs });
          if (b !== null && h.measuredFromMs !== null) {
            book.apply(b);
            totals.trades += 1;
          }
        }
        totals.truncatedRead += 1;
      } catch {
        end(cut.coin, cut.atMs, 'truncated', totals);
      }
    }
    for (const q of d.otherQuote) end(q.coin, q.atMs, 'other_quote', totals);
    for (const g of d.completed) end(g.coin, g.atMs, 'graduated', totals);
  };

  return {
    async boot() {
      const now = deps.now();
      const seed = await deps.store.day(now);
      cost = new FeedCost(F, now, seed);
      const restarted = await deps.store.markRestarted(now);
      dayCapped = cost.credits >= F.dayCapCredits;
      deps.note('info', 'trade feed starting', { restartedCoins: restarted, dayCredits: Math.round(cost.credits), dayCapped });
    },

    async pass() {
      const now = deps.now();
      const totals: PassTotals = { trades: 0, failedDropped: 0, undecodable: 0, truncated: 0, truncatedRead: 0, ended: {}, openings: 0 };
      const c = costNow();
      if (c.roll(now)) {
        dayCapped = false;
        openingsToday = 0;
        truncatedToday = 0;
      }
      /* Asked before the drain, as the launch stream's supervisor does: a silence is noticed now. */
      const live = deps.socket.live();
      await applyDrain(deps.socket.drain(), now, totals);
      if (now - lastReread >= F.rereadMs) {
        lastReread = now;
        try {
          await reread(now, totals);
        } catch (e) {
          deps.note('warn', 'trade feed: watch list or curve read failed; new coins wait, not measured', { err: e instanceof Error ? e.message : String(e) });
        }
      }

      /* The caps. */
      for (const h of held.values()) if (!h.ended && c.coinBytes(h.address) > F.coinCapBytes) end(h.address, now, 'coin_cap', totals);
      if (!dayCapped && c.credits >= F.dayCapCredits) {
        dayCapped = true;
        for (const h of held.values()) if (!h.ended) end(h.address, now, 'day_cap', totals);
        deps.note('warn', 'trade feed: the day\'s credit cap is reached; every coin is recorded not measured until the next UTC day', { credits: Math.round(c.credits), cap: F.dayCapCredits });
      }

      /* The heartbeat: only while the socket is live, only for coins still measured. */
      if (live && deps.socket.live()) {
        for (const h of held.values()) if (!h.ended && h.measuredFromMs !== null) coverOf(h.address).measuredToMs = now;
      }
      const rows = book.take();
      const changes = [...cover].map(([address, v]) => ({ address, ...v }));
      try {
        await deps.store.write({ minutes: rows.minutes, states: rows.states, cover: changes, openings, day: { dayMs: c.dayMs, bytes: c.bytes, rpcCalls: c.calls, credits: c.credits }, nowMs: now });
      } catch (e) {
        /* Nothing written: the rows go back to wait for the next pass, and so do the coverage changes. */
        book.restore(rows);
        throw e;
      }
      cover = new Map();
      openings = [];
      for (const [address, h] of held) {
        if (h.ended) {
          held.delete(address);
          c.forget(address);
        }
      }
      for (const a of [...decided]) if (!held.has(a)) book.drop(a);
      return totals;
    },

    status() {
      const c = costNow();
      let measuring = 0;
      for (const h of held.values()) if (!h.ended && h.measuredFromMs !== null) measuring += 1;
      return { dayMs: c.dayMs, bytes: c.bytes, calls: c.calls, credits: c.credits, measuring, watching: held.size, dayCapped, book: book.stats() };
    },
  };
}
