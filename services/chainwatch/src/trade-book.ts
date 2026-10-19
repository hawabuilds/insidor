/**
 * A WATCHED COIN'S TRADES, KEPT WHOLE IN MEMORY, AND THE FEED'S COUNTED COST. Pure: trades and
 * byte counts in, the rows 0112 and 0114 hold out.
 *
 * WHY IN MEMORY. "New buyers" and "unique buyers" are set questions — has this wallet bought this
 * coin before — and the only complete answer is the set of every buyer since the coin's
 * subscription was confirmed. This process holds it; the tables hold its counts. So every minute
 * row and state row written is the WHOLE figure as of now, replacing the previous flush's, and a
 * restart cannot resume a coin (its set is gone and so are the trades in between): the watcher
 * records such coins as not measured instead (store's `markRestarted`).
 *
 * ★ THE COST IS COUNTED, NOT ESTIMATED FROM TRADES. Every frame's bytes (failed transactions
 * included — they are billed) and every chain call are added as they happen, and credits are
 * worked out from those counts at the billing in Policy.oneCoin.tradeFeed. A cap held against an
 * estimate of the traffic would be a cap on a guess.
 *
 * What breaks if changed carelessly: the minute's clock. Minutes are bucketed by the chain's own
 * timestamp for the trade, not by when it reached us, so a reconnect's backlog lands in the minutes
 * it happened in. A trade with no chain time falls back to its arrival.
 */

export interface BookTrade {
  readonly coin: string;
  readonly user: string;
  readonly creator: string;
  readonly isBuy: boolean;
  readonly timestampS: number;
  readonly sol: number;
  readonly mcapSol: number | null;
  readonly seenAtMs: number;
}

export interface MinuteRow {
  readonly address: string;
  readonly minuteMs: number;
  readonly buys: number;
  readonly sells: number;
  readonly buyers: number;
  readonly newBuyers: number;
  readonly buySol: number;
  readonly sellSol: number;
  readonly creatorSoldSol: number;
  readonly lastMcapSol: number;
  readonly lastMcapUsd: null;
}

export interface StateRow {
  readonly address: string;
  readonly uniqueBuyers: number;
  readonly peakMcapSol: number;
  readonly lastMcapSol: number;
  readonly creatorSold: boolean;
  readonly firstTradeMs: number;
  readonly lastTradeMs: number;
}

interface Minute {
  buys: number;
  sells: number;
  readonly buyers: Set<string>;
  newBuyers: number;
  buySol: number;
  sellSol: number;
  creatorSoldSol: number;
  lastMcap: number | null;
  lastAt: number;
}

interface Coin {
  readonly buyers: Set<string>;
  readonly minutes: Map<number, Minute>;
  readonly dirty: Set<number>;
  creatorSold: boolean;
  peak: number | null;
  last: number | null;
  lastAt: number;
  first: number | null;
  lastTrade: number | null;
  stateDirty: boolean;
}

const MS_PER_S = 1_000;
const MS_PER_MIN = 60_000;

export class TradeBook {
  readonly #coins = new Map<string, Coin>();

  #coin(address: string): Coin {
    let c = this.#coins.get(address);
    if (c === undefined) {
      c = { buyers: new Set(), minutes: new Map(), dirty: new Set(), creatorSold: false, peak: null, last: null, lastAt: 0, first: null, lastTrade: null, stateDirty: false };
      this.#coins.set(address, c);
    }
    return c;
  }

  apply(t: BookTrade): void {
    const c = this.#coin(t.coin);
    const at = t.timestampS > 0 ? t.timestampS * MS_PER_S : t.seenAtMs;
    const minuteMs = Math.floor(at / MS_PER_MIN) * MS_PER_MIN;
    let m = c.minutes.get(minuteMs);
    if (m === undefined) {
      m = { buys: 0, sells: 0, buyers: new Set(), newBuyers: 0, buySol: 0, sellSol: 0, creatorSoldSol: 0, lastMcap: null, lastAt: 0 };
      c.minutes.set(minuteMs, m);
    }
    if (t.isBuy) {
      m.buys += 1;
      m.buySol += t.sol;
      if (!c.buyers.has(t.user)) {
        c.buyers.add(t.user);
        m.newBuyers += 1;
      }
      m.buyers.add(t.user);
    } else {
      m.sells += 1;
      m.sellSol += t.sol;
      if (t.user === t.creator) {
        m.creatorSoldSol += t.sol;
        c.creatorSold = true;
      }
    }
    if (t.mcapSol !== null) {
      if (at >= m.lastAt) {
        m.lastMcap = t.mcapSol;
        m.lastAt = at;
      }
      if (at >= c.lastAt) {
        c.last = t.mcapSol;
        c.lastAt = at;
      }
      c.peak = c.peak === null ? t.mcapSol : Math.max(c.peak, t.mcapSol);
    }
    c.first = c.first === null ? at : Math.min(c.first, at);
    c.lastTrade = c.lastTrade === null ? at : Math.max(c.lastTrade, at);
    c.dirty.add(minuteMs);
    c.stateDirty = true;
  }

  /**
   * The rows changed since the last call, whole. A minute or a state with no cap yet (every trade in
   * it lacked reserves) waits: 0112 holds a cap on every row and a cap is never 0.
   */
  take(): { readonly minutes: readonly MinuteRow[]; readonly states: readonly StateRow[] } {
    const minutes: MinuteRow[] = [];
    const states: StateRow[] = [];
    for (const [address, c] of this.#coins) {
      for (const minuteMs of [...c.dirty]) {
        const m = c.minutes.get(minuteMs);
        const cap = m?.lastMcap ?? c.last;
        if (m === undefined || cap === null) continue;
        c.dirty.delete(minuteMs);
        minutes.push({ address, minuteMs, buys: m.buys, sells: m.sells, buyers: m.buyers.size, newBuyers: m.newBuyers, buySol: m.buySol, sellSol: m.sellSol, creatorSoldSol: m.creatorSoldSol, lastMcapSol: cap, lastMcapUsd: null });
      }
      if (c.stateDirty && c.peak !== null && c.last !== null && c.first !== null && c.lastTrade !== null) {
        c.stateDirty = false;
        states.push({ address, uniqueBuyers: c.buyers.size, peakMcapSol: c.peak, lastMcapSol: c.last, creatorSold: c.creatorSold, firstTradeMs: c.first, lastTradeMs: c.lastTrade });
      }
    }
    return { minutes, states };
  }

  /** Rows taken but not written: changed again, so the next `take` hands them over again (current). */
  restore(rows: { readonly minutes: readonly MinuteRow[]; readonly states: readonly StateRow[] }): void {
    for (const m of rows.minutes) this.#coins.get(m.address)?.dirty.add(m.minuteMs);
    for (const s of rows.states) {
      const c = this.#coins.get(s.address);
      if (c !== undefined) c.stateDirty = true;
    }
  }

  /** Forget a coin whose watch is over (after its last rows were taken). */
  drop(address: string): void {
    this.#coins.delete(address);
  }

  /** Coins held, and the buyers and trades counted, for the log. */
  stats(): { readonly coins: number; readonly buyers: number; readonly trades: number } {
    let buyers = 0;
    let trades = 0;
    for (const c of this.#coins.values()) {
      buyers += c.buyers.size;
      for (const m of c.minutes.values()) trades += m.buys + m.sells;
    }
    return { coins: this.#coins.size, buyers, trades };
  }
}

export interface Billing {
  readonly billedBytes: number;
  readonly creditsPerBilledBytes: number;
  readonly creditsPerCall: number;
  readonly creditsPerHistoryCall: number;
}

const MS_PER_DAY = 86_400_000;
export const dayOf = (ms: number): number => Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;

/** The day's counted cost: bytes delivered, chain calls made, and the credits they come to. */
export class FeedCost {
  dayMs: number;
  bytes = 0;
  calls = 0;
  credits = 0;
  readonly #billing: Billing;
  readonly #coinBytes = new Map<string, number>();

  constructor(billing: Billing, nowMs: number, seed: { readonly dayMs: number; readonly bytes: number; readonly rpcCalls: number; readonly credits: number } | null) {
    this.#billing = billing;
    this.dayMs = dayOf(nowMs);
    if (seed !== null && seed.dayMs === this.dayMs) {
      this.bytes = seed.bytes;
      this.calls = seed.rpcCalls;
      this.credits = seed.credits;
    }
  }

  /** A new UTC day starts the day's count again (a coin's own count runs on). */
  roll(nowMs: number): boolean {
    const d = dayOf(nowMs);
    if (d === this.dayMs) return false;
    this.dayMs = d;
    this.bytes = 0;
    this.calls = 0;
    this.credits = 0;
    return true;
  }

  addBytes(coin: string | null, n: number): void {
    if (n <= 0) return;
    this.bytes += n;
    this.credits += (n / this.#billing.billedBytes) * this.#billing.creditsPerBilledBytes;
    if (coin !== null) this.#coinBytes.set(coin, (this.#coinBytes.get(coin) ?? 0) + n);
  }

  addCalls(plain: number, history: number): void {
    this.calls += plain + history;
    this.credits += plain * this.#billing.creditsPerCall + history * this.#billing.creditsPerHistoryCall;
  }

  coinBytes(coin: string): number {
    return this.#coinBytes.get(coin) ?? 0;
  }

  forget(coin: string): void {
    this.#coinBytes.delete(coin);
  }
}
