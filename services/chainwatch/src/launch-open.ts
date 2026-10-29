/**
 * EACH LAUNCH'S FIRST SECOND (the owner, 2026-10-29: catch a coin "as soon as it is deployed", and tell the
 * real one from its copycats). For a coin the relay shows launching, this counts the buys and the distinct
 * buyers over its first `OPEN_WINDOW_MS` of trading, and the creator's own opening buy, and hands one row
 * per launch to chart.ts to write (0150, internal.launch_open) once that second is over.
 *
 * Why this and not the team's record: replayed over a month of launches read from the chain, a launch's
 * first second predicted it (15+ buyers: 1.25% past $100k against 0.27% overall and 0.00% with the creator
 * alone), where a team's earlier hits did not (0.29% against 0.27%) — and it holds when a team uses new
 * wallets every time. Pure and in memory: chart.ts feeds it the same trades it folds into the candles, so
 * it costs no read of anything.
 *
 * ★ THE CHAIN'S CLOCK. The window is measured on the trades' own times, so a reconnect's backlog counts in
 * the second it happened in. A launch is closed when a trade more than the window after it arrives, or when
 * `CLOSE_AFTER_MS` of wall time has passed with none — a launch nobody bought after is a row too.
 * ★ COUNTED, NEVER LISTED: the buyers are a set while the second is open and only their number leaves.
 *
 * What breaks if changed carelessly: the first buy. The creator's opening buy is the launch transaction's
 * own buy, the first trade the relay gives for the coin; a window that misses it reports no dev buy.
 */

export const OPEN_WINDOW_MS = 1_000;
const CLOSE_AFTER_MS = 10_000;
/** A coin whose launch was never seen closed is forgotten after this, so the map cannot grow without end. */
const FORGET_MS = 120_000;

export interface OpenTrade {
  readonly coin: string;
  readonly side: 'buy' | 'sell';
  readonly maker: string;
  readonly usd: number | null;
  readonly atMs: number;
}

export interface LaunchOpenRow {
  readonly address: string;
  readonly launchedAtMs: number;
  readonly buyers: number;
  readonly buys: number;
  /** The creator's opening buy in dollars; null when it was unpriced or not seen. */
  readonly devBuyUsd: number | null;
}

interface Open {
  readonly atMs: number;
  readonly seenAtMs: number;
  readonly buyers: Set<string>;
  buys: number;
  devBuyUsd: number | null;
  sawFirst: boolean;
  closed: boolean;
}

export class LaunchOpens {
  readonly #open = new Map<string, Open>();
  #ready: LaunchOpenRow[] = [];

  /** The relay showed this coin launching at `atMs` (its first trade's time, or the launch's when it had none). */
  launched(coin: string, atMs: number, nowMs: number): void {
    if (this.#open.has(coin)) return;
    this.#open.set(coin, { atMs, seenAtMs: nowMs, buyers: new Set(), buys: 0, devBuyUsd: null, sawFirst: false, closed: false });
  }

  /** One trade leg of any coin; only a coin whose launch was seen and whose second is open counts it. */
  trade(t: OpenTrade): void {
    const o = this.#open.get(t.coin);
    if (o === undefined || o.closed) return;
    if (t.atMs > o.atMs + OPEN_WINDOW_MS) {
      this.#close(t.coin, o);
      return;
    }
    if (!o.sawFirst) {
      o.sawFirst = true;
      if (t.side === 'buy') o.devBuyUsd = t.usd !== null && t.usd >= 0 ? t.usd : null;
    }
    if (t.side === 'buy') {
      o.buys += 1;
      o.buyers.add(t.maker);
    }
  }

  /** The launches whose second is over: closed by a later trade, or by `CLOSE_AFTER_MS` of quiet. */
  take(nowMs: number): readonly LaunchOpenRow[] {
    for (const [coin, o] of this.#open) {
      if (!o.closed && nowMs - o.seenAtMs >= CLOSE_AFTER_MS) this.#close(coin, o);
      if (o.closed && nowMs - o.seenAtMs >= FORGET_MS) this.#open.delete(coin);
    }
    const out = this.#ready;
    this.#ready = [];
    return out;
  }

  #close(coin: string, o: Open): void {
    o.closed = true;
    this.#ready.push({ address: coin, launchedAtMs: o.atMs, buyers: o.buyers.size, buys: o.buys, devBuyUsd: o.devBuyUsd });
    o.buyers.clear();
  }
}
