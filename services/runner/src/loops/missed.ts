/**
 * THE MISSED-POSTS LOOP — the owner's pasted links read and diagnosed within a minute of the paste.
 *
 * Its own supervised loop rather than a step after discovery, because the owner is waiting on it
 * with the app open: it must run every half minute whether discovery is on, paused or slow. What
 * one pass does is work/missed-posts.ts; this file is only the cadence and the record. A quiet pass
 * is one query (`queued` returns nothing) and opens no meter.
 *
 * What breaks if changed carelessly: rows left waiting (spending off, a learning line spent for
 * today) are reported as `in` but not `out`, never as failed. Failing the run row for them would
 * back the loop off and delay the next paste the owner makes.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { MissedResult } from '../work/missed-posts.ts';

/** Every half minute: "within a minute" of a paste, at worst. */
const EVERY_MS = 30_000;
/** After the universe loop's offset, so the three do not start in the same second. */
const OFFSET_MS = 55_000;

export function missedLoop(work: () => Promise<MissedResult>): Loop {
  return {
    stage: 'missed',
    everyMs: EVERY_MS,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.done + r.failed + r.waiting, out: r.done, failed: 0, firstError: null };
    },
  };
}
