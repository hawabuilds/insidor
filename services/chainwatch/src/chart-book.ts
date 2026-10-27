/**
 * OUR OWN CANDLES AND LATEST TRADES, BUILT FROM EVERY TRADE THE RELAY CARRIES (the owner, 2026-10-27:
 * "build our own candles" — the token page waited seconds on the market source). Pure: trades in, the
 * rows 0144 holds and each coin's latest trades out. chart.ts runs it; this file decides.
 *
 * ★ ONLY A COIN WORTH CHARTING IS WRITTEN. Most launches trade a handful of times and die, and a
 * minute row for each would be most of the table. A coin is charted once it has `GATE_TRADES` trades
 * within `GATE_WINDOW_MS`, or once it is `listed` (a coin the product is watching, which may be
 * quiet). Before that its trades are HELD here, at most `HELD_MAX`, and when it passes they are all
 * written, so its chart still starts at its first trade. A coin held but never charted is forgotten
 * after `IDLE_UNCHARTED_MS` of quiet. Measured on 15 minutes of the relay on 2026-10-27, see chart.ts.
 *
 * ★ PRICES IN DOLLARS AT THE TRADE'S OWN MOMENT. A trade priced in SOL becomes dollars at the SOL
 * price the caller gives with it (live.ts's median of the last minute), so a candle is what a buyer
 * paid in dollars then. A trade with no dollar price — no fresh SOL price, or a quote token we cannot
 * price — is left out of the candle, never drawn at zero; `unpriced` counts them.
 *
 * ★ DELTAS, NOT WHOLE ROWS. `take` hands over only the trades since the last take for each bucket; the
 * table merges them (0144). So a restart mid-minute adds to the minute rather than replacing it.
 *
 * ★ THE LATEST TRADES ARE KEPT IN MEMORY ONLY, `RECENT_MAX` a coin. Written to the database they
 * would be about 30 million rows a day; a token page wants the last few hundred. `recent` says
 * whether the list is WHOLE — it began at the coin's launch, or it has filled — so the read service
 * can tell "these are all its trades" from "this process started a minute ago".
 *
 * What breaks if changed carelessly: the bucket clock. Buckets are the chain's time of the trade, not
 * when it reached us, so a reconnect's backlog lands in the minutes it happened in.
 */

/** A trade as chart.ts hands it over, already priced. */
export interface ChartTrade {
  readonly coin: string;
  readonly tx: string;
  readonly side: 'buy' | 'sell';
  readonly tokens: number;
  /** Dollars traded; null when it could not be priced. */
  readonly usd: number | null;
  /** The coin's price in dollars after the trade; null when it could not be priced. */
  readonly priceUsd: number | null;
  readonly maker: string;
  readonly atMs: number;
  readonly pool: string;
  readonly poolAddress: string | null;
  readonly quoteMint: string;
}

/** One trade as the token page lists it. */
export interface RecentTrade {
  readonly tx: string;
  readonly side: 'buy' | 'sell';
  readonly tokenAmount: number;
  readonly usd: number | null;
  readonly priceUsd: number | null;
  readonly at: number;
  readonly maker: string;
}

/** A bucket's trades since the last take; merged into the row by the table. */
export interface CandleDelta {
  readonly address: string;
  readonly bucketMs: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly oMs: number;
  readonly cMs: number;
  readonly volumeUsd: number;
  readonly buys: number;
  readonly sells: number;
}

export interface ChartCoinRow {
  readonly address: string;
  readonly recordedFromMs: number;
  readonly fromLaunch: boolean;
  readonly lastTradeMs: number;
  readonly pool: string;
  readonly poolAddress: string | null;
  readonly quoteMint: string;
}

export interface ChartTake {
  readonly coins: readonly ChartCoinRow[];
  readonly minutes: readonly CandleDelta[];
  readonly hours: readonly CandleDelta[];
}

/** A coin is charted at this many trades inside the window. */
export const GATE_TRADES = 20;
export const GATE_WINDOW_MS = 30 * 60_000;
/** Trades held for a coin not yet charted; past this the oldest go, and its chart no longer starts at launch. */
const HELD_MAX = 60;
/** A coin held but never charted is forgotten after this much quiet. */
const IDLE_UNCHARTED_MS = 60 * 60_000;
/** A charted coin's memory (its latest trades) is let go after this much quiet; it stays charted. */
const IDLE_CHARTED_MS = 6 * 3_600_000;
/** A charted coin quiet this long is no longer remembered as charted (its rows stay). */
const FORGET_CHARTED_MS = 7 * 86_400_000;
/** The latest trades kept per charted coin. */
export const RECENT_MAX = 200;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

interface Bucket {
  o: number;
  h: number;
  l: number;
  c: number;
  oAt: number;
  cAt: number;
  volumeUsd: number;
  buys: number;
  sells: number;
}

interface Coin {
  charted: boolean;
  fromLaunch: boolean;
  recordedFromMs: number;
  lastTradeMs: number;
  lastSeenMs: number;
  /** Before charting: every trade held. After: empty. */
  held: ChartTrade[];
  /** Newest last. */
  recent: RecentTrade[];
  /** How many trades `recent` has been offered since it began. */
  seen: number;
  pool: string;
  poolAddress: string | null;
  quoteMint: string;
  rowDirty: boolean;
  /** The last trade time the table holds for it: moved on only once a minute, not every flush. */
  writtenLastMs: number;
  readonly minutes: Map<number, Bucket>;
  readonly hours: Map<number, Bucket>;
}

const bucketOf = (atMs: number, size: number): number => Math.floor(atMs / size) * size;

function fold(map: Map<number, Bucket>, bucketMs: number, at: number, price: number | null, usd: number | null, side: 'buy' | 'sell'): void {
  if (price === null) return;
  const b = map.get(bucketMs);
  if (b === undefined) {
    map.set(bucketMs, { o: price, h: price, l: price, c: price, oAt: at, cAt: at, volumeUsd: usd ?? 0, buys: side === 'buy' ? 1 : 0, sells: side === 'sell' ? 1 : 0 });
    return;
  }
  if (price > b.h) b.h = price;
  if (price < b.l) b.l = price;
  if (at < b.oAt) {
    b.o = price;
    b.oAt = at;
  }
  if (at >= b.cAt) {
    b.c = price;
    b.cAt = at;
  }
  b.volumeUsd += usd ?? 0;
  if (side === 'buy') b.buys += 1;
  else b.sells += 1;
}

/** Two deltas of one bucket as one, the same merge the table does. */
function merge(a: Bucket, b: Bucket): Bucket {
  return {
    o: b.oAt < a.oAt ? b.o : a.o,
    oAt: Math.min(a.oAt, b.oAt),
    c: b.cAt >= a.cAt ? b.c : a.c,
    cAt: Math.max(a.cAt, b.cAt),
    h: Math.max(a.h, b.h),
    l: Math.min(a.l, b.l),
    volumeUsd: a.volumeUsd + b.volumeUsd,
    buys: a.buys + b.buys,
    sells: a.sells + b.sells,
  };
}

const priced = (t: ChartTrade): number | null => (t.priceUsd !== null && Number.isFinite(t.priceUsd) && t.priceUsd > 0 ? t.priceUsd : null);

export class ChartBook {
  readonly #coins = new Map<string, Coin>();
  /** Coins charted and gone quiet: their last trade, so a trade wakes them straight into the chart. */
  readonly #asleep = new Map<string, number>();
  #listed: ReadonlySet<string> = new Set();
  #unpriced = 0;

  /** Coins charted by an earlier process, from the table: charted again on their next trade. */
  remember(coins: readonly { readonly address: string; readonly lastTradeMs: number }[]): void {
    for (const c of coins) if (!this.#coins.has(c.address)) this.#asleep.set(c.address, c.lastTradeMs);
  }

  /** Coins the product is watching: charted on their first trade, however quiet. */
  list(addresses: ReadonlySet<string>): void {
    this.#listed = addresses;
  }

  apply(t: ChartTrade, launch: boolean, nowMs: number): void {
    let c = this.#coins.get(t.coin);
    if (c === undefined) {
      const wasCharted = this.#asleep.has(t.coin);
      this.#asleep.delete(t.coin);
      c = {
        charted: false,
        fromLaunch: launch,
        recordedFromMs: t.atMs,
        lastTradeMs: t.atMs,
        lastSeenMs: nowMs,
        held: [],
        recent: [],
        seen: 0,
        pool: t.pool,
        poolAddress: t.poolAddress,
        quoteMint: t.quoteMint,
        rowDirty: false,
        writtenLastMs: Number.NEGATIVE_INFINITY,
        minutes: new Map(),
        hours: new Map(),
      };
      this.#coins.set(t.coin, c);
      if (wasCharted || this.#listed.has(t.coin)) this.#chart(c);
    }
    c.lastSeenMs = nowMs;
    if (priced(t) === null) this.#unpriced += 1;
    if (!c.charted) {
      c.held.push(t);
      if (c.held.length > HELD_MAX) {
        c.held.shift();
        c.fromLaunch = false;
        c.recordedFromMs = c.held[0]!.atMs;
      }
      const recent = c.held.filter((h) => t.atMs - h.atMs <= GATE_WINDOW_MS).length;
      if (recent >= GATE_TRADES || this.#listed.has(t.coin)) this.#chart(c);
      return;
    }
    this.#add(c, t);
  }

  /** A launch with no trade in its frame: the coin's recording begins at its launch. */
  launched(coin: string, atMs: number, nowMs: number): void {
    if (this.#coins.has(coin) || this.#asleep.has(coin)) return;
    this.#coins.set(coin, { charted: false, fromLaunch: true, recordedFromMs: atMs, lastTradeMs: atMs, lastSeenMs: nowMs, held: [], recent: [], seen: 0, pool: '', poolAddress: null, quoteMint: '', rowDirty: false, writtenLastMs: Number.NEGATIVE_INFINITY, minutes: new Map(), hours: new Map() });
  }

  #chart(c: Coin): void {
    c.charted = true;
    c.rowDirty = true;
    const held = c.held;
    c.held = [];
    for (const t of held) this.#add(c, t);
  }

  #add(c: Coin, t: ChartTrade): void {
    const p = priced(t);
    fold(c.minutes, bucketOf(t.atMs, MINUTE_MS), t.atMs, p, t.usd, t.side);
    fold(c.hours, bucketOf(t.atMs, HOUR_MS), t.atMs, p, t.usd, t.side);
    if (t.atMs < c.recordedFromMs) {
      c.recordedFromMs = t.atMs;
      c.rowDirty = true;
    }
    if (t.atMs >= c.lastTradeMs) {
      c.lastTradeMs = t.atMs;
      if (t.pool !== '' && (t.pool !== c.pool || t.poolAddress !== c.poolAddress)) {
        c.pool = t.pool;
        c.poolAddress = t.poolAddress;
        c.quoteMint = t.quoteMint;
        c.rowDirty = true;
      }
      if (t.atMs - c.writtenLastMs >= MINUTE_MS) c.rowDirty = true;
    }
    c.recent.push({ tx: t.tx, side: t.side, tokenAmount: t.tokens, usd: t.usd, priceUsd: t.priceUsd, at: t.atMs, maker: t.maker });
    c.seen += 1;
    if (c.recent.length > RECENT_MAX) c.recent.shift();
  }

  /** The rows changed since the last take. Hand them back with `restore` if they were not written. */
  take(): ChartTake {
    const coins: ChartCoinRow[] = [];
    const minutes: CandleDelta[] = [];
    const hours: CandleDelta[] = [];
    for (const [address, c] of this.#coins) {
      if (!c.charted) continue;
      if (c.rowDirty && c.pool !== '') {
        coins.push({ address, recordedFromMs: c.recordedFromMs, fromLaunch: c.fromLaunch, lastTradeMs: c.lastTradeMs, pool: c.pool, poolAddress: c.poolAddress, quoteMint: c.quoteMint });
        c.rowDirty = false;
        c.writtenLastMs = c.lastTradeMs;
      }
      for (const [bucketMs, b] of c.minutes) minutes.push(delta(address, bucketMs, b));
      for (const [bucketMs, b] of c.hours) hours.push(delta(address, bucketMs, b));
      c.minutes.clear();
      c.hours.clear();
    }
    return { coins, minutes, hours };
  }

  restore(t: ChartTake): void {
    for (const r of t.coins) {
      const c = this.#coins.get(r.address);
      if (c !== undefined) c.rowDirty = true;
    }
    const back = (rows: readonly CandleDelta[], pick: (c: Coin) => Map<number, Bucket>): void => {
      for (const d of rows) {
        const c = this.#coins.get(d.address);
        if (c === undefined) continue;
        const map = pick(c);
        const b: Bucket = { o: d.o, h: d.h, l: d.l, c: d.c, oAt: d.bucketMs + d.oMs, cAt: d.bucketMs + d.cMs, volumeUsd: d.volumeUsd, buys: d.buys, sells: d.sells };
        const now = map.get(d.bucketMs);
        map.set(d.bucketMs, now === undefined ? b : merge(b, now));
      }
    };
    back(t.minutes, (c) => c.minutes);
    back(t.hours, (c) => c.hours);
  }

  /** A charted coin's latest trades, newest first, and whether that is all of them; null when not held. */
  recent(coin: string): { readonly whole: boolean; readonly trades: readonly RecentTrade[] } | null {
    const c = this.#coins.get(coin);
    if (c === undefined || !c.charted) return null;
    return { whole: c.fromLaunch || c.seen >= RECENT_MAX, trades: [...c.recent].reverse() };
  }

  /** Let go of quiet coins. Call after a take, so nothing unwritten is dropped. */
  sweep(nowMs: number): void {
    for (const [address, c] of this.#coins) {
      const quiet = nowMs - c.lastSeenMs;
      if (!c.charted && quiet > IDLE_UNCHARTED_MS) this.#coins.delete(address);
      else if (c.charted && quiet > IDLE_CHARTED_MS && c.minutes.size === 0 && !c.rowDirty) {
        this.#coins.delete(address);
        this.#asleep.set(address, c.lastTradeMs);
      }
    }
    for (const [address, last] of this.#asleep) if (nowMs - last > FORGET_CHARTED_MS) this.#asleep.delete(address);
  }

  stats(): { readonly held: number; readonly charted: number; readonly asleep: number; readonly unpriced: number } {
    let charted = 0;
    for (const c of this.#coins.values()) if (c.charted) charted += 1;
    const unpriced = this.#unpriced;
    this.#unpriced = 0;
    return { held: this.#coins.size - charted, charted, asleep: this.#asleep.size, unpriced };
  }
}

function delta(address: string, bucketMs: number, b: Bucket): CandleDelta {
  return { address, bucketMs, o: b.o, h: b.h, l: b.l, c: b.c, oMs: b.oAt - bucketMs, cMs: b.cAt - bucketMs, volumeUsd: b.volumeUsd, buys: b.buys, sells: b.sells };
}
