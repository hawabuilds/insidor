/**
 * THE COIN-AND-POST CHECK LOOP — name-only coins on screen put to the judge, every
 * `oneCoin.postCheck.everyMs` (twenty seconds).
 *
 * ★ ITS OWN SUPERVISED LOOP, apart from the one-coin loop it feeds: that loop matches a launch within
 * seconds, and a judge call takes seconds of its own. A slow host here delays only the next answer.
 * What one pass does is work/coin-post-check.ts; this file is only the cadence and the counts.
 *
 * What breaks if changed carelessly: a pass held by its cap, a dry run or nothing due is reported as
 * nothing done, never as failed, so the supervisor does not back off a loop that did what it was told.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { CoinPostCheckResult } from '../work/coin-post-check.ts';

/** After the one-coin loop's offset, so a boot's first passes do not start in the same second. */
const OFFSET_MS = 41_000;

export function coinPostCheckLoop(everyMs: number, work: () => Promise<CoinPostCheckResult>): Loop {
  return {
    stage: 'postcheck',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.asked, out: r.no, failed: 0, firstError: null };
    },
  };
}
