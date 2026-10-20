/**
 * THE ACCOUNT WATCH LOOP (`feed.accountWatch`), every `everyMs`, on its own.
 *
 * ★ ITS OWN SUPERVISED LOOP, for the reason in loops/name-search.ts: nothing it waits on may hold the
 * discover pass or the judge, and its cadence (minutes) is its own, faster than any search beside it.
 * Its posts are stored under the 'account' lane and the next discover pass's scorer reads them with
 * the rest. What one pass does is work/account-watch.ts; this file is only the cadence.
 *
 * What breaks if changed carelessly: a pass stopped by its cap or the posts line is reported as `in`
 * without `out`, never as failed, so the supervisor does not back off a loop that did as told.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { AccountWatchResult } from '../work/account-watch.ts';

/** After the quote search's, so a boot's first passes do not start in the same second. */
const OFFSET_MS = 125_000;

export function accountWatchLoop(everyMs: number, work: () => Promise<AccountWatchResult>): Loop {
  return {
    stage: 'accountwatch',
    everyMs,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.returned, out: r.fresh, failed: 0, firstError: null };
    },
  };
}
