/**
 * THE READINGS LOOP — For You's view readings and opened sheets, every `feed.readings.everyMs`.
 *
 * ★ ITS OWN SUPERVISED LOOP. The runner was broken twice on 2026-10-16 by work that slowed a loop
 * the judge waits on. This loop shares nothing with discovery, the judge or TRACK: its pass is
 * bounded by `feed.readings.passDeadlineMs`, its money by its own lane in internal.lane_spend, and
 * when it is off (`feed.readings.on` false, the shipped value) a pass is a no-op that says so once.
 * What one pass does is work/readings.ts; this file is only the cadence.
 *
 * What breaks if changed carelessly: a pass held by its cap, the book or a source's price is
 * reported as `in` without `out`, never as failed, so the supervisor does not back off a loop that
 * did what it was told.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { ReadingsResult } from '../work/readings.ts';

/** After the refill loop's offset, so a boot's first passes do not start in the same second. */
const OFFSET_MS = 85_000;

export function readingsLoop(everyMs: number, work: () => Promise<ReadingsResult>): Loop {
  return {
    stage: 'readings',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.due, out: r.answered, failed: 0, firstError: null };
    },
  };
}
