/**
 * THE ONE-COIN LOOP — new launches matched to posts and every open post's single coin judged,
 * every `oneCoin.everyMs` (five seconds).
 *
 * Its own supervised loop because the decision is worth having within minutes of a launch and is
 * re-made on every trade update; riding the finders loop would make the coin links wait on the
 * rule's reads, and riding the universe loop (a minute) would decide a minute late. What one pass
 * does is work/one-coin.ts; this file is only the cadence and the counts.
 *
 * What breaks if changed carelessly: a pass that matched nothing and changed nothing is a quiet
 * market, not a failure; reporting it as failed would back the loop off when launches resume.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { OneCoinResult } from '../work/one-coin.ts';

/** After the finders loop's offset, so the first passes of a boot do not start in the same second. */
const OFFSET_MS = 9_000;

export function oneCoinLoop(everyMs: number, work: () => Promise<OneCoinResult>): Loop {
  return {
    stage: 'onecoin',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.launches + r.judged, out: r.candidates + r.changed, failed: 0, firstError: null };
    },
  };
}
