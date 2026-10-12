/**
 * THE COIN UNIVERSE LOOP — every new coin's metadata read and its origin checked, once a minute.
 *
 * Its own supervised loop rather than a step after discovery, because its free half reads a
 * public gateway that can stall: a slow pass here must never delay the search that finds
 * posts. What one pass does is work/universe.ts; this file is only the cadence and the record.
 *
 * What breaks if changed carelessly: a pass reports every paid step it priced but did not run
 * as `pending`, not as failed. A dry run is the system working, and failing the run row for it
 * would back the loop off and page somebody about a setting.
 */

import type { Loop, LoopContext, LoopCounts } from '../loop.ts';
import { universePass, type UniverseDeps } from '../work/universe.ts';

/** Once a minute: a document is a few hundred bytes, and the launchpad mints all day. */
const EVERY_MS = 60_000;
/** After discovery's offset, so the two do not start in the same second. */
const OFFSET_MS = 50_000;

export function universeLoop(deps: Omit<UniverseDeps, 'now'>): Loop {
  const log = deps.log.child({ stage: 'universe' });
  return {
    stage: 'universe',
    everyMs: EVERY_MS,
    offsetMs: OFFSET_MS,
    async run(ctx: LoopContext): Promise<LoopCounts> {
      const result = await universePass({ ...deps, log, now: ctx.now });
      return { in: result.metadataRead + result.checked, out: result.checked - result.pending, failed: 0, firstError: null };
    },
  };
}
