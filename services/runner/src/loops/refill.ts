/**
 * THE POST-REFILL LOOP — older feed posts' video files read again, every half minute.
 *
 * Its own supervised loop rather than a step after discovery, because a person may be looking at
 * the post: the post sheet opens only posts a feed holds, every one of those is in this step's
 * queue, so a post opened with no playable file is read again within a minute of being on a feed,
 * with no request path from the read service and no table. After discovery it would wait on the
 * whole paid pass. What one pass does is work/post-refill.ts; this file is only the cadence.
 *
 * What breaks if changed carelessly: a quiet pass is one query and opens no meter; a pass that
 * reads nothing because the day's cap or the budget says wait is reported as `in` but not `out`,
 * never as failed, so the loop is not backed off for doing what it was told.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { RefillResult } from '../work/post-refill.ts';

/** Every half minute: a post on a feed is read again within a minute, at worst. */
const EVERY_MS = 30_000;
/** After the missed loop's offset, so they do not start in the same second. */
const OFFSET_MS = 65_000;

export function refillLoop(work: () => Promise<RefillResult>): Loop {
  return {
    stage: 'refill',
    everyMs: EVERY_MS,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.due, out: r.filled, failed: 0, firstError: null };
    },
  };
}
