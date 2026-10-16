/**
 * THE MIDDLE LOOP — the middle lane's search (`feed.middle`), every `feed.middle.everyMs`, on its own.
 *
 * ★ ITS OWN SUPERVISED LOOP, NOT A PART OF THE DISCOVER PASS. It rode that pass from 2026-10-16
 * 08:53 UTC, and the discover pass ends with the steps that judge what it found (score-posts
 * first). The lane pages a three-hour window on the posts supplier, up to `maxPages` pages, and
 * with the supplier slow and refusing calls for credit the pass went from 1.5-5 minutes to 15-26:
 * every new post waited that long to be judged, and a restart mid-pass skipped judging altogether.
 * Here it can be as slow as the supplier makes it and the judge does not wait. Its posts are stored
 * as the 'middle' lane through the same store as the discover pass, and the next discover pass's
 * score-posts reads them with every other lane's unscored posts.
 *
 * Its money is unchanged: the same cap and ledger (0088), read before every page and added to
 * after, so a restart's extra pass is inside its day. One pass is also bounded in time
 * (`feed.middle.passDeadlineMs`, checked in work/discover.ts before each further page).
 *
 * What breaks if changed carelessly: awaiting this from the discover loop (or its `afterPass`)
 * brings the judge's wait back. Off (`feed.middle.on` false, or no ledger wired): a pass asks
 * nothing and says so once.
 */

import type { Policy } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import type { Loop, LoopContext, LoopCounts } from '../loop.ts';
import { discoverPass, type DiscoverDeps, type DiscoverMode } from '../work/discover.ts';

/** After discover's 45 seconds, so a boot's first discover pass is not sharing the supplier with it. */
const OFFSET_MS = 75_000;

export interface MiddleLoopDeps {
  readonly platforms: PlatformRegistry;
  readonly store: DiscoverDeps['store'];
  readonly policy: Policy;
  readonly meter: Meter;
  readonly mode: DiscoverMode;
  readonly log: Logger;
  readonly floors: DiscoverDeps['floors'];
  readonly dailyCapUsd: number;
  /** Its ledger and new-post count (0088). Absent: the lane is never asked. */
  readonly middle: DiscoverDeps['middle'];
}

export function middleLoop(deps: MiddleLoopDeps): Loop {
  const log = deps.log.child({ stage: 'middle' });
  let offSaid = false;
  return {
    stage: 'middle',
    everyMs: deps.policy.feed.middle.everyMs,
    offsetMs: OFFSET_MS,
    async run(ctx: LoopContext): Promise<LoopCounts> {
      const middle = deps.middle;
      if (!deps.policy.feed.middle.on || middle === undefined) {
        if (!offSaid) log.info('the middle lane is off; nothing is asked', { on: deps.policy.feed.middle.on, ledger: middle !== undefined });
        offSaid = true;
        return { in: 0, out: 0, failed: 0, firstError: null };
      }
      const started = ctx.now();
      const result = await discoverPass({
        platforms: deps.platforms,
        store: deps.store,
        /* No term: the middle pass asks only the middle lane. The cadence feeds nothing here. */
        plan: { terms: [], cadenceMs: deps.policy.feed.middle.everyMs },
        policy: deps.policy,
        meter: deps.meter,
        mode: deps.mode,
        log,
        now: ctx.now,
        signal: ctx.signal,
        floors: deps.floors,
        dailyCapUsd: deps.dailyCapUsd,
        middle,
        only: 'middle',
      });
      log.info('middle pass', {
        mode: deps.mode,
        answered: result.answered,
        failed: result.failed,
        paused: result.paused,
        unasked: result.unasked,
        itemsSeen: result.itemsSeen,
        itemsStored: result.itemsStored,
        ms: ctx.now() - started,
      });
      return { in: result.itemsSeen, out: result.itemsStored, failed: result.failed, firstError: result.firstError };
    },
  };
}
