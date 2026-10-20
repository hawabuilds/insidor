/**
 * THE ONE-COIN RULE REPLAYED over stored trade minutes and readings: what the card would have
 * shown, and when, for posts whose real coin we know — the owner's coin calls and pasted addresses,
 * else the biggest candidate an hour after its launch.
 *
 * Its own file because two tools read it and must agree: tools/onecoin-replay.ts prints it, and the
 * weekly refit (tools/onecoin-refit.ts) proposes the bars that score best on it, applied only when
 * they beat the bars in force on the same cases. Both feed `pickOneCoin` itself, step by step, so a
 * replayed pick is the live rule's pick on the same facts.
 *
 * ★ A MINUTE IS KNOWN AT ITS END. A trade minute is read only from the moment it closed, and a
 * reading only from when it was taken, so a replay at launch + T never sees what came after T.
 *
 * What breaks if changed carelessly: the order of events. Each judgement reads the holder the last
 * one left; replaying the times out of order would hand coins over on facts not yet known.
 */

import { MS_PER_MINUTE } from '../math.ts';
import { pickOneCoin, type Contender, type Holder, type MarketFacts, type MatchEvidence, type OneCoinBars, type TradeFacts } from './one-coin.ts';

/** One closed minute of a coin's trading (internal.coin_trade_minute). */
export interface TradeMinute {
  readonly atMs: number;
  readonly newBuyers: number;
  readonly netBuy: number;
  readonly creatorSold: number;
  readonly cap: number | null;
  readonly capUsd: number | null;
}

export interface ReplayCoin {
  readonly address: string;
  readonly launchedAtMs: number | null;
  readonly existingSinceMs?: number | null;
  readonly evidence: readonly MatchEvidence[];
  readonly minutes: readonly TradeMinute[];
  /** Each reading's cap, and its pool when the reading gave one (absent or null: unknown). */
  readonly readings: readonly { readonly atMs: number; readonly capUsd: number; readonly liquidityUsd?: number | null }[];
}

/** The card's coin from each moment on: null is no pick (Create). */
export type Timeline = readonly (readonly [number, string | null])[];

/** A coin's trading as known at `t`; `quiet` when watched and no minute closed yet. */
export function tradesAt(c: ReplayCoin, t: number): TradeFacts | 'quiet' {
  let uniqueBuyers = 0;
  let netBuy = 0;
  let cap: number | null = null;
  let capUsd: number | null = null;
  let peakCap: number | null = null;
  let creatorSold = false;
  let any = false;
  for (const m of c.minutes) {
    if (m.atMs + MS_PER_MINUTE > t) continue;
    any = true;
    uniqueBuyers += m.newBuyers;
    netBuy += m.netBuy;
    if (m.creatorSold > 0) creatorSold = true;
    if (m.cap !== null) {
      cap = m.cap;
      peakCap = peakCap === null ? m.cap : Math.max(peakCap, m.cap);
    }
    if (m.capUsd !== null) capUsd = m.capUsd;
  }
  return any ? { uniqueBuyers, netBuy, cap, capUsd, peakCap, creatorSold } : 'quiet';
}

function marketAt(c: ReplayCoin, t: number): MarketFacts | null {
  let last: number | null = null;
  let liquidityUsd: number | null = null;
  let peak = 0;
  for (const r of c.readings) {
    if (r.atMs > t) continue;
    last = r.capUsd;
    liquidityUsd = r.liquidityUsd ?? null;
    peak = Math.max(peak, r.capUsd);
  }
  return last === null ? null : { capUsd: last, peakCapUsd: peak, liquidityUsd };
}

/**
 * The rule run at every moment something new became known, up to `untilMs`. `useTrades`: judge on
 * the minutes (the coins were watched); false: on the readings, as the fallback does.
 */
export function replayTimeline(coins: readonly ReplayCoin[], bars: OneCoinBars, untilMs: number, useTrades: boolean): Timeline {
  const times = new Set<number>();
  for (const c of coins) {
    const from = c.existingSinceMs ?? (c.launchedAtMs === null ? null : c.launchedAtMs + bars.judgeFromMs);
    if (from !== null) times.add(from);
    if (useTrades) for (const m of c.minutes) times.add(m.atMs + MS_PER_MINUTE);
    else for (const r of c.readings) times.add(r.atMs);
  }
  const out: [number, string | null][] = [];
  let holder: Holder | null = null;
  for (const t of [...times].filter((x) => x <= untilMs).sort((a, b) => a - b)) {
    const contenders: Contender[] = coins.map((c) => ({
      address: c.address,
      launchedAtMs: c.launchedAtMs,
      existingSinceMs: c.existingSinceMs ?? null,
      evidence: c.evidence,
      trades: useTrades ? tradesAt(c, t) : null,
      market: marketAt(c, t),
    }));
    const o = pickOneCoin(contenders, holder, t, useTrades, bars);
    const now = o.kind === 'picked' ? o.address : null;
    holder = o.kind === 'picked' ? { address: o.address, sinceMs: o.sinceMs, underShareSinceMs: o.underShareSinceMs } : null;
    const prev = out[out.length - 1];
    if (prev === undefined ? now !== null : prev[1] !== now) out.push([t, now]);
  }
  return out;
}

/** The card's coin at `t` by a timeline. */
export function coinAt(timeline: Timeline, t: number): string | null {
  let w: string | null = null;
  for (const [at, a] of timeline) if (at <= t) w = a;
  return w;
}

/** A post replayed: its candidates, and the real coin (null: nothing ran, the case for false picks). */
export interface ReplayCase {
  readonly subject: string;
  readonly coins: readonly ReplayCoin[];
  readonly truth: string | null;
}

export interface ReplayScore {
  /** Cases with a real coin. */
  readonly withCoin: number;
  readonly right: number;
  readonly wrong: number;
  readonly noPick: number;
  /** Cases where nothing ran, and how many of them got a pick anyway. */
  readonly nothingRan: number;
  readonly falsePick: number;
}

/**
 * Right, wrong or no pick at the real coin's launch + `atMs` (the owner's "within minutes": +10 min
 * by default in the tools), and false picks by `untilMs` after the post's first candidate where
 * nothing ran. A real coin that was not a candidate counts as no pick: the matcher missed it.
 */
export function scoreReplay(cases: readonly ReplayCase[], bars: OneCoinBars, atMs: number, untilMs: number, useTrades: boolean): ReplayScore {
  let withCoin = 0;
  let right = 0;
  let wrong = 0;
  let noPick = 0;
  let nothingRan = 0;
  let falsePick = 0;
  for (const k of cases) {
    const firstLaunch = Math.min(...k.coins.map((c) => c.existingSinceMs ?? c.launchedAtMs ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(firstLaunch)) continue;
    const timeline = replayTimeline(k.coins, bars, firstLaunch + untilMs, useTrades);
    if (k.truth === null) {
      nothingRan += 1;
      if (timeline.some(([, a]) => a !== null)) falsePick += 1;
      continue;
    }
    withCoin += 1;
    const real = k.coins.find((c) => c.address === k.truth);
    const at = (real?.existingSinceMs ?? real?.launchedAtMs ?? firstLaunch) + atMs;
    const shown = coinAt(timeline, at);
    if (shown === k.truth) right += 1;
    else if (shown === null) noPick += 1;
    else wrong += 1;
  }
  return { withCoin, right, wrong, noPick, nothingRan, falsePick };
}

/** One number to compare bars by: right picks less wrong ones and false ones. Higher is better. */
export const replayMerit = (s: ReplayScore): number => s.right - s.wrong - s.falsePick;
