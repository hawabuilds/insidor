/**
 * EVERY TRADE OF THE COINS ON SCREEN, AS IT LANDS (the owner, 2026-10-26: "every price, mc, trade
 * should be instant using the fastest on chain data"): one EventSource to the read service's
 * GET /live/coins for every coin any mounted screen follows, and each trade handed to the shared
 * price store (coin-cap.ts) and to whoever listens for that coin's trades (the token page's chart and
 * Trades list).
 *
 * ★ ONE LINE FOR THE WHOLE APP. Screens `follow` coins; the set is gathered for `REOPEN_MS` and the
 * line re-opened with the new set, so a page of cards mounting at once is one connection, not forty.
 * A coin leaves when its last follower unmounts.
 *
 * ★ A NUMBER WITH AN AGE, NEVER A STALE ONE PASSING AS LIVE. The store keeps each trade's time; a
 * price older than coin-cap.ts `LIVE_KEEP_MS` is not shown as live. While the line is down
 * (`liveUp()` false) screens may say how old their number is.
 *
 * What breaks if changed carelessly: the coin limit. The service takes at most `MAX_COINS`; past it
 * the newest-followed coins wait, rather than the line being refused.
 */

import { openLiveCoins } from './api/client.ts';
import { noteLiveTrade } from './coin-cap.ts';
import { createTickGuard } from './tick-guard.ts';

/** One trade as the service sends it (services/chainwatch live.ts `WireTick`). */
export interface LiveTrade {
  readonly a: string;
  readonly s: 'b' | 's';
  readonly q: number;
  readonly k: number;
  readonly w: string;
  readonly c: number | null;
  readonly p: number | null;
  readonly cq: number | null;
  readonly t: number;
  readonly x: string;
  readonly o: string;
}

const MAX_COINS = 60;
const REOPEN_MS = 300;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

const followers = new Map<string, number>();
const tradeListeners = new Map<string, Set<(t: LiveTrade) => void>>();
const upListeners = new Set<() => void>();
let close: (() => void) | null = null;
let openSet = '';
let reopenTimer: ReturnType<typeof setTimeout> | null = null;
let up = false;
/* One odd trade never moves a price on screen: a jump waits for a second trade (tick-guard.ts). */
const guard = createTickGuard<LiveTrade>();

const setUp = (v: boolean): void => {
  if (up === v) return;
  up = v;
  for (const l of upListeners) l();
};

function reopen(): void {
  reopenTimer = null;
  const coins = [...followers.keys()].slice(0, MAX_COINS).sort();
  const next = coins.join(',');
  if (next === openSet) return;
  close?.();
  close = null;
  openSet = next;
  setUp(false);
  close = openLiveCoins(coins, {
    onReady: setUp,
    onError: () => setUp(false),
    onData: (data) => {
      let msg: { ticks?: LiveTrade[] };
      try {
        msg = JSON.parse(data) as typeof msg;
      } catch {
        return;
      }
      setUp(true);
      const now = Date.now();
      for (const t of guard.pass(msg.ticks ?? [], now)) {
        noteLiveTrade(t.a, t.p, t.c, now);
        const ls = tradeListeners.get(t.a);
        if (ls !== undefined) for (const l of ls) l(t);
      }
    },
  });
}

const reopenSoon = (): void => {
  if (reopenTimer === null) reopenTimer = setTimeout(reopen, REOPEN_MS);
};

/** Follow a coin's trades while the caller is mounted; returns the unfollow. */
export function followCoin(address: string): () => void {
  if (!ADDRESS.test(address)) return () => undefined;
  const first = !followers.has(address);
  followers.set(address, (followers.get(address) ?? 0) + 1);
  if (first) reopenSoon();
  return () => {
    const n = (followers.get(address) ?? 1) - 1;
    if (n > 0) followers.set(address, n);
    else {
      followers.delete(address);
      reopenSoon();
    }
  };
}

/** Hear each trade of a coin (the coin must be followed too); returns the stop. */
export function onCoinTrade(address: string, listener: (t: LiveTrade) => void): () => void {
  const set = tradeListeners.get(address) ?? new Set();
  set.add(listener);
  tradeListeners.set(address, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) tradeListeners.delete(address);
  };
}

/** Whether the live line is open and delivering. */
export const liveUp = (): boolean => up;
export const liveUpStore = {
  subscribe(l: () => void): () => void {
    upListeners.add(l);
    return () => upListeners.delete(l);
  },
};
