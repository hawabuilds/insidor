/**
 * EACH LAUNCH'S FIRST SECOND (the owner, 2026-10-29: catch a coin "as soon as it is deployed", and tell the
 * real one from its copycats). For a coin the relay shows launching, this counts the buys and the distinct
 * buyers over its first `openWindowMs` of trading, and the creator's own opening buy, and hands one row
 * per launch to chart.ts to write (0150, internal.launch_open) once that second is over.
 *
 * Why this and not the team's record: replayed over a month of launches read from the chain, a launch's
 * first second predicted it (15+ buyers: 1.25% past $100k against 0.27% overall and 0.00% with the creator
 * alone), where a team's earlier hits did not (0.29% against 0.27%) — and it holds when a team uses new
 * wallets every time. Pure and in memory: chart.ts feeds it the same trades it folds into the candles, so
 * it costs no read of anything.
 *
 * ★ AND ITS FIRST MINUTE (policy.v214, 0154; the owner, 2026-10-30: "beat the runner"). The same row now
 * also carries what the research found lifts the odds before a coin runs: the share of supply bought in
 * the launch block, the dev buy in SOL, the first-second buyers' wallets (at most `firstBuyersKept`, to
 * match the nightly smart wallet list against), the pool it launched in (how a later graduation is told),
 * and whether the creator sold within `devSellWindowMs`. So the row is handed over when that MINUTE is
 * over, not the second: one insert a launch rather than an insert and an update. Recorded only — nothing
 * decides on these until a week of rows has been replayed.
 *
 * ★ THE CHAIN'S CLOCK. Both windows are measured on the trades' own times, so a reconnect's backlog counts
 * in the second it happened in. A launch is closed when a trade more than the dev's minute after it
 * arrives, or when that minute and `CLOSE_GRACE_MS` of wall time have passed — a launch nobody traded
 * after is a row too. The stream carries no block number, so "the launch block" is the buys within
 * `blockWindowMs` of the launch: an approximation, named so in 0154.
 *
 * What breaks if changed carelessly: the first buy. The creator's opening buy is the launch transaction's
 * own buy, the first trade the relay gives for the coin; a window that misses it reports no dev buy, and
 * then no dev to watch selling (`devSold` null, never false).
 */

import { DEFAULT_POLICY, type LaunchSignalsPolicy } from '@insidor/contracts/policy.ts';

/** The research's "first second"; exported for the tests. */
export const OPEN_WINDOW_MS = DEFAULT_POLICY.launchSignals.openWindowMs;
/** Wall time past the dev's minute after which a launch with no later trade is closed anyway. */
const CLOSE_GRACE_MS = 10_000;
/** A closed launch is forgotten this long after it closed, so a late duplicate of its launch is not a second row. */
const FORGET_AFTER_CLOSE_MS = 60_000;

export interface OpenTrade {
  readonly coin: string;
  readonly side: 'buy' | 'sell';
  readonly maker: string;
  readonly usd: number | null;
  /** SOL paid or received; null when the trade was quoted in another token. */
  readonly sol: number | null;
  readonly tokens: number;
  /** The pool it traded in; '' when the relay named none. */
  readonly pool: string;
  readonly atMs: number;
}

export interface LaunchOpenRow {
  readonly address: string;
  readonly launchedAtMs: number;
  readonly buyers: number;
  readonly buys: number;
  /** The creator's opening buy in dollars; null when it was unpriced or not seen. */
  readonly devBuyUsd: number | null;
  /** The same in SOL; null when it was quoted in another token or not seen. */
  readonly devBuySol: number | null;
  /** The pool the launch first traded in; null when no trade named one. */
  readonly pool: string | null;
  /** Tokens bought in the launch block over the supply, dev included; null when no trade was seen or it came to over 1 (another supply). */
  readonly blockShare: number | null;
  /** The first-second buyers in buying order, at most `firstBuyersKept`. */
  readonly firstBuyers: readonly string[];
  /** The creator sold within the dev's minute; null when no opening buy was seen (no dev to watch). */
  readonly devSold: boolean | null;
}

interface Open {
  readonly atMs: number;
  readonly seenAtMs: number;
  readonly buyers: Set<string>;
  readonly firstBuyers: string[];
  buys: number;
  devBuyUsd: number | null;
  devBuySol: number | null;
  dev: string | null;
  devSold: boolean;
  pool: string | null;
  blockTokens: number;
  sawFirst: boolean;
  closedAtMs: number | null;
}

export class LaunchOpens {
  readonly #open = new Map<string, Open>();
  readonly #p: LaunchSignalsPolicy;
  #ready: LaunchOpenRow[] = [];

  constructor(policy: LaunchSignalsPolicy = DEFAULT_POLICY.launchSignals) {
    this.#p = policy;
  }

  /** The relay showed this coin launching at `atMs` (its first trade's time, or the launch's when it had none). */
  launched(coin: string, atMs: number, nowMs: number): void {
    if (this.#open.has(coin)) return;
    this.#open.set(coin, { atMs, seenAtMs: nowMs, buyers: new Set(), firstBuyers: [], buys: 0, devBuyUsd: null, devBuySol: null, dev: null, devSold: false, pool: null, blockTokens: 0, sawFirst: false, closedAtMs: null });
  }

  /** One trade leg of any coin; only a coin whose launch was seen and whose minute is open counts it. */
  trade(t: OpenTrade, nowMs: number): void {
    const o = this.#open.get(t.coin);
    if (o === undefined || o.closedAtMs !== null) return;
    const since = t.atMs - o.atMs;
    if (since > this.#p.devSellWindowMs) {
      this.#close(t.coin, o, nowMs);
      return;
    }
    if (since > this.#p.openWindowMs) {
      /* Past the first second only the dev's own sell is still news. */
      if (t.side === 'sell' && o.dev !== null && t.maker === o.dev) o.devSold = true;
      return;
    }
    if (!o.sawFirst) {
      o.sawFirst = true;
      if (t.pool !== '') o.pool = t.pool;
      if (t.side === 'buy') {
        o.dev = t.maker;
        o.devBuyUsd = t.usd !== null && t.usd >= 0 ? t.usd : null;
        o.devBuySol = t.sol !== null && t.sol >= 0 ? t.sol : null;
      }
    }
    if (t.side === 'sell') {
      if (o.dev !== null && t.maker === o.dev) o.devSold = true;
      return;
    }
    o.buys += 1;
    if (since <= this.#p.blockWindowMs && t.tokens > 0) o.blockTokens += t.tokens;
    if (!o.buyers.has(t.maker)) {
      o.buyers.add(t.maker);
      if (o.firstBuyers.length < this.#p.firstBuyersKept) o.firstBuyers.push(t.maker);
    }
  }

  /** The launches whose minute is over: closed by a later trade, or by the minute and a grace of quiet. */
  take(nowMs: number): readonly LaunchOpenRow[] {
    for (const [coin, o] of this.#open) {
      if (o.closedAtMs === null && nowMs - o.seenAtMs >= this.#p.devSellWindowMs + CLOSE_GRACE_MS) this.#close(coin, o, nowMs);
      if (o.closedAtMs !== null && nowMs - o.closedAtMs >= FORGET_AFTER_CLOSE_MS) this.#open.delete(coin);
    }
    const out = this.#ready;
    this.#ready = [];
    return out;
  }

  #close(coin: string, o: Open, nowMs: number): void {
    o.closedAtMs = nowMs;
    const share = o.sawFirst ? o.blockTokens / this.#p.supplyTokens : null;
    this.#ready.push({
      address: coin,
      launchedAtMs: o.atMs,
      buyers: o.buyers.size,
      buys: o.buys,
      devBuyUsd: o.devBuyUsd,
      devBuySol: o.devBuySol,
      pool: o.pool,
      blockShare: share === null || share > 1 ? null : share,
      firstBuyers: [...o.firstBuyers],
      devSold: o.dev === null ? null : o.devSold,
    });
    o.buyers.clear();
    o.firstBuyers.length = 0;
  }
}
