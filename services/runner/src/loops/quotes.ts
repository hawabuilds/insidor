/**
 * THE QUOTE SEARCH LOOP (`feed.reproductions`), every `everyMs`, on its own.
 *
 * ★ ITS OWN SUPERVISED LOOP, for the reason in loops/name-search.ts: nothing it waits on may hold
 * the discover pass or the judge. Most passes ask nothing (no big post is at an asking age) and
 * cost one database read. What one pass does is work/quote-search.ts; this file is only the cadence.
 *
 * What breaks if changed carelessly: an `everyMs` longer than `askGraceMin` lets a post pass an
 * asking age between two passes and never be asked at it.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { QuoteSearchResult } from '../work/quote-search.ts';

/** After the name search's, for the same reason. */
const OFFSET_MS = 115_000;

export function quotesLoop(everyMs: number, work: () => Promise<QuoteSearchResult>): Loop {
  return {
    stage: 'quotes',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.returned, out: r.fresh, failed: 0, firstError: null };
    },
  };
}
