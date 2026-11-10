/**
 * WHETHER A COIN'S TRADING IS A VOLUME BOT (Policy.oneCoin.volumeBot; the owner, 2026-11-10, $Grok: "that's
 * clearly a scam"). A script buying and selling from a pool of wallets paints a smooth staircase on the chart
 * and makes a coin look busy: the same wallets come back minute after minute, and the minute's buy count barely
 * moves. $Grok, 9 Nov 23:44-23:48 UTC: 133, 133, 133, 129, 134 buys a minute, three in four of the buyers seen
 * before; it was picked and pushed at $99k, and it was a rug.
 *
 * A coin is a volume bot when BOTH hold, each for `minutes` minutes in a row:
 *   returning  at least `minBuyers` buyers a minute, under `newShareBelow` of them new
 *   steady     at least `steadyMinBuys` buys a minute, each within `steadyWithin` of the run's first minute
 *
 * ★ BOTH, NEVER ONE. Replayed on the 7 days to 10 Nov (minute trades): returning wallets alone marks 7-20 of the
 * 56 verified runners (real runners have traders coming back too — $COGE among them), and a steady count alone
 * marks 3-5. Together they mark none, and 8 of the coins we pushed, 7 of which rugged within six hours.
 *
 * Pure: the runner reads the minutes (internal.coin_trade_minute) and hands them over in time order.
 * What breaks if changed carelessly: the gap check. A minute with no row is not a minute like the last; a run
 * across a gap would join two quiet stretches into one steady one.
 */

export interface BotMinute {
  /** The minute's start, epoch ms. */
  readonly t: number;
  readonly buys: number;
  readonly buyers: number;
  readonly newBuyers: number;
}

export interface VolumeBotBars {
  readonly minutes: number;
  readonly minBuyers: number;
  readonly newShareBelow: number;
  readonly steadyMinBuys: number;
  readonly steadyWithin: number;
}

import { MS_PER_MINUTE as MINUTE_MS } from '../math.ts';

/** At least `bars.minutes` consecutive minutes of mostly returning buyers. */
export function returningRun(ms: readonly BotMinute[], bars: VolumeBotBars): boolean {
  let run = 0;
  let prev = -1;
  for (const m of ms) {
    const ok = m.buyers >= bars.minBuyers && m.newBuyers < bars.newShareBelow * m.buyers;
    run = ok ? (run > 0 && m.t - prev === MINUTE_MS ? run + 1 : 1) : 0;
    if (run >= bars.minutes) return true;
    prev = m.t;
  }
  return false;
}

/** At least `bars.minutes` consecutive minutes whose buy counts stay within `steadyWithin` of the run's first. */
export function steadyRun(ms: readonly BotMinute[], bars: VolumeBotBars): boolean {
  let run = 0;
  let base = -1;
  let prev = -1;
  for (const m of ms) {
    const busy = m.buys >= bars.steadyMinBuys;
    const continues = busy && run > 0 && m.t - prev === MINUTE_MS && Math.abs(m.buys - base) <= bars.steadyWithin;
    if (continues) run += 1;
    else {
      run = busy ? 1 : 0;
      base = m.buys;
    }
    if (run >= bars.minutes) return true;
    prev = m.t;
  }
  return false;
}

export function volumeBot(ms: readonly BotMinute[], bars: VolumeBotBars): boolean {
  return returningRun(ms, bars) && steadyRun(ms, bars);
}
