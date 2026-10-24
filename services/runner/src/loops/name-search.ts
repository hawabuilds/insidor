/**
 * THE NARRATIVE-NAME SEARCH LOOP (`feed.narrativeNames`), every `everyMs`, on its own.
 *
 * ★ ITS OWN SUPERVISED LOOP, NOT A STEP OF THE DISCOVER PASS. For You stalled twice in the week to
 * 2026-10-18 from passes that a slow source held, and the discover pass ends with the judge. This
 * one may be as slow as the source makes it (bounded by `passDeadlineMs`); its posts are stored
 * under the 'narrative_name' lane and the next discover pass's scorer reads them with the rest.
 * What one pass does is work/narrative-names.ts; this file is only the cadence. From policy.v158 the
 * loop also carries the meme-war word search (work/fight-words.ts) and turns at the faster of the two
 * cadences; the wiring runs the name search only when its own `everyMs` is due.
 *
 * What breaks if changed carelessly: a pass stopped by its cap or the posts line is reported as `in`
 * without `out`, never as failed, so the supervisor does not back off a loop that did as told.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { NarrativeNamesResult } from '../work/narrative-names.ts';

/** After the readings loop's, so a boot's first passes do not start in the same second. */
const OFFSET_MS = 105_000;

export function nameSearchLoop(everyMs: number, work: () => Promise<NarrativeNamesResult>): Loop {
  return {
    stage: 'namesearch',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.returned, out: r.fresh, failed: 0, firstError: null };
    },
  };
}
