/**
 * THE INSTANT JUDGE: a post a new coin names, judged seconds after the coin's link is recorded
 * instead of after the next discovery pass (Policy.finders.coinLinks.instant).
 *
 * Its own step, run by the finders loop right after the coin links (loops/finders.ts), because the
 * scoring pass runs only after each discovery pass — two to six minutes apart — and the owner's bar
 * for the coin path is For You within a minute of the launch. It picks only the posts core's
 * `coinVouches` would put past For You's view bar (a young post with thousands of approvals that an
 * observed coin named), held by a lane and never answered; everything else a coin names waits for
 * the scoring pass as before.
 *
 * ★ THE SAME JUDGING, NOT A SHORTCUT. The posts are handed to `scorePosts` itself, over a queue of
 * just these posts: the same post judge (the open model while it is primary), the same precedents
 * and not-a-meme hold, the same kind question, the same reuse of an earlier answer. The only thing
 * the queue changes is the view bar before the judge, which these posts are past by the coin
 * (`backfilled` answers "all of them", the scoring pass's existing way to judge a post regardless of
 * its views). No shadow judge and no junk filter: a handful of posts a day, judged once.
 *
 * ★ BOUNDED. At most `perMinute` posts in any sixty seconds, counted here; the rest wait for the
 * next pass (five seconds later) or for the scoring pass, whichever comes first. A dry run, a dormant
 * judge or a spent line answers nothing, exactly as in the scoring pass: no answer is not a no.
 *
 * What breaks if changed carelessly: the queue must only ever hold posts the coin rule picked. Handed
 * the open queue, `backfilled` would wave every post past the view bar and the judge's line with it.
 */

import type { Item, ItemId, Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { CoinVouchRow, PgFinderRepo, PgItemRepo } from '@insidor/store';
import { coinVouches } from '@insidor/core';

import type { Logger } from '../log.ts';
import type { ScoringDeps, ScoringResult } from './score-posts.ts';

const MINUTE_MS = 60_000;
/** How many coin-named unanswered posts are read per pass for each one that may be judged: most do not pass the rule. */
const PREFETCH_FACTOR = 10;

export interface InstantDeps {
  readonly finders: Pick<PgFinderRepo, 'coinNamedUnjudged'>;
  readonly items: Pick<PgItemRepo, 'byIds'>;
  /** The scoring pass over exactly this queue (`instantItems` builds its items source). */
  readonly score: (queue: readonly Item[]) => Promise<ScoringResult>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface InstantResult {
  readonly queued: number;
  readonly scored: number;
  readonly usd: number;
}

const NONE: InstantResult = { queued: 0, scored: 0, usd: 0 };

/** The scoring pass's items source over a fixed queue: only these posts, each past the view bar. */
export function instantItems(queue: readonly Item[], items: Pick<PgItemRepo, 'reachReadings'>): ScoringDeps['items'] {
  const ids = new Set(queue.map((i) => String(i.itemId)));
  return {
    catchAllUnscored: async (_at, _limit, _minReach, lane) => (lane === null ? queue : []),
    catchAllStale: async () => [],
    reachReadings: (itemIds, at) => items.reachReadings(itemIds, at),
    backfilled: async () => ids,
  };
}

/** Which of the queue's rows the coin rule picks, newest link first, up to `room`. */
export function picked(rows: readonly CoinVouchRow[], room: number, p: Policy): readonly string[] {
  return rows.filter((r) => coinVouches(r, p)).slice(0, Math.max(0, room)).map((r) => r.itemId);
}

/** One instant judge, holding its own count of the last minute's posts. */
export function instantJudge(deps: InstantDeps): () => Promise<InstantResult> {
  let recent: number[] = [];
  return async () => {
    const c = deps.policy.finders.coinLinks;
    if (!c.on || !c.instant.on) return NONE;
    const now = deps.now();
    recent = recent.filter((at) => now - at < MINUTE_MS);
    const room = c.instant.perMinute - recent.length;
    if (room <= 0) return NONE;
    const rows = await deps.finders.coinNamedUnjudged((now - c.instant.lookbackMs) as Millis, room * PREFETCH_FACTOR);
    const ids = picked(rows, room, deps.policy);
    if (ids.length === 0) return NONE;
    const held = await deps.items.byIds(ids.map((id) => id as ItemId));
    const queue = ids.flatMap((id) => {
      const item = held.get(id as ItemId);
      return item === undefined ? [] : [item];
    });
    if (queue.length === 0) return NONE;
    for (const _ of queue) recent.push(now);
    const result = await deps.score(queue);
    const launches = new Map(rows.map((r) => [r.itemId, r.firstCoinAtMs] as const));
    deps.log.info('coin-named posts judged at once', {
      queued: queue.length,
      scored: result.scored,
      waiting: result.waiting,
      usd: Number(result.spentUsd.toFixed(6)),
      /* Seconds from each post's first coin to its answer: what "For You within a minute" spends here. */
      secondsAfterLaunch: queue.map((i) => {
        const at = launches.get(String(i.itemId));
        return at === null || at === undefined ? null : Math.round((deps.now() - at) / 1000);
      }),
    });
    return { queued: queue.length, scored: result.scored, usd: result.spentUsd };
  };
}
