/**
 * THE FINDERS LOOP — the ways to find a post besides the searches, every five seconds.
 *
 * Its own supervised loop because the first of them, a new coin's links (work/coin-links.ts),
 * is only worth having within seconds of the launch, and no other loop runs that often. The
 * others ride the same loop on their own clocks: the reposts (work/reposts.ts) every
 * `finders.reposts.everyMs`, the search words and young re-reads (work/search-words.ts) on their
 * slots, and the recommendation feed (work/trending-feed.ts) on its own. With every switch off a pass does nothing and touches no table.
 *
 * What breaks if changed carelessly: a failure in one finder is logged and the others still run.
 * A loop that threw on the first would let a stalled short-link host stop the coin links, which
 * are the one finder that must not wait.
 */

import type { Loop, LoopContext, LoopCounts } from '../loop.ts';
import type { Logger } from '../log.ts';
import { errorText } from '../log.ts';
import type { CoinLinkResult } from '../work/coin-links.ts';
import type { RepostResult } from '../work/reposts.ts';
import type { SearchWordResult } from '../work/search-words.ts';
import type { TrendingFeedResult } from '../work/trending-feed.ts';

/** After the other loops' offsets, so they do not all start in the same second. */
const OFFSET_MS = 7_000;
/** How often a run of passes with no new coin says so: silence once hid an 18-hour stop. */
const QUIET_LOG_EVERY_MS = 300_000;

export interface FinderWork {
  readonly everyMs: number;
  readonly repostsEveryMs: number;
  readonly coinLinks: () => Promise<CoinLinkResult>;
  readonly reposts: () => Promise<RepostResult>;
  readonly searchWords: () => Promise<SearchWordResult>;
  readonly trendingFeed: () => Promise<TrendingFeedResult>;
  readonly log: Logger;
}

export function findersLoop(work: FinderWork): Loop {
  const log = work.log.child({ stage: 'finders' });
  let repostsAt = 0;
  let quietSaidAt = 0;
  return {
    stage: 'finders',
    everyMs: work.everyMs,
    offsetMs: OFFSET_MS,
    async run(ctx: LoopContext): Promise<LoopCounts> {
      let found = 0;
      let firstError: string | null = null;
      const step = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
        try {
          return await run();
        } catch (e) {
          firstError ??= `${name}: ${errorText(e)}`;
          log.error(`${name} failed; tried again next pass`, { err: errorText(e) });
          return null;
        }
      };
      const links = await step('coin links', work.coinLinks);
      found += links?.credited ?? 0;
      const now = ctx.now();
      /* A pass with coins logs its own line (work/coin-links.ts); one with none says so now and then. */
      if (links !== null && links.coins === 0 && now - quietSaidAt >= QUIET_LOG_EVERY_MS) {
        quietSaidAt = now;
        log.info('coins pointing to posts: no new coin with unread metadata', { coins: 0 });
      }
      if (now - repostsAt >= work.repostsEveryMs) {
        repostsAt = now;
        found += (await step('reposts', work.reposts))?.credited ?? 0;
      }
      found += (await step('search words', work.searchWords))?.stored ?? 0;
      found += (await step('recommendation feed', work.trendingFeed))?.stored ?? 0;
      return { in: links?.coins ?? 0, out: found, failed: firstError === null ? 0 : 1, firstError };
    },
  };
}
