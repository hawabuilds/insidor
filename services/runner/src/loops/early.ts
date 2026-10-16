/**
 * THE EARLY JUDGING LOOP — the likeliest catch-all posts judged before their views clear the bar,
 * every `judge.early.everyMs`.
 *
 * ★ ITS OWN SUPERVISED LOOP, for the reason the readings loop is one: the feed stalled twice on
 * 2026-10-16 from slow work inside the discovery pass, whose last steps judge the posts that cleared
 * the bar. A slow or hung judge here holds back only the next early pass, never discovery, the
 * normal judging or TRACK. What one pass does is work/early-judge.ts; this file is only the cadence.
 * Off (`judge.early.on` false), a pass reads nothing and returns.
 *
 * What breaks if changed carelessly: a pass held by its cap or the ledger is reported as `in`
 * without `out`, never as failed, so the supervisor does not back off a loop that did what it was
 * told.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { EarlyResult } from '../work/early-judge.ts';

/** After the readings loop's offset, so a boot's first passes do not start in the same second. */
const OFFSET_MS = 95_000;

export function earlyLoop(everyMs: number, work: () => Promise<EarlyResult>): Loop {
  return {
    stage: 'early',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.queued, out: r.scored, failed: 0, firstError: null };
    },
  };
}
