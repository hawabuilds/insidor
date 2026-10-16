/**
 * THE NARRATIVES LOOP — the posts the judge passed, regrouped into narratives every couple of
 * minutes (Policy.narrative.everyMs).
 *
 * Its own supervised loop rather than a step after discovery, because the owner's calls on a
 * narrative ("Not a narrative", "Merge with…", "Remove this post") must take effect within a pass
 * whether discovery is on, paused or slow, and because the projector must never wait on it: the
 * board reads what the last pass wrote. What one pass does is work/narratives.ts; this file is only
 * the cadence and the record.
 *
 * What breaks if changed carelessly: a skipped pass (switched off, a dry run, 0093 not applied) is
 * reported as `in` with nothing `out`, never as failed. Failing the run row for it would back the
 * loop off, and the owner's next call would wait for the back-off.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { NarrativeResult } from '../work/narratives.ts';

/** After the missed-posts loop's offset, so the loops do not start in the same second. */
const OFFSET_MS = 65_000;

export function narrativesLoop(everyMs: number, work: () => Promise<NarrativeResult>): Loop {
  return {
    stage: 'narratives',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.good, out: r.shown, failed: 0, firstError: null };
    },
  };
}
