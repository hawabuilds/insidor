/**
 * THE PER-POST SCORE: each post the catch-all search found, judged alone, once.
 *
 * Its own step, run after each discovery pass, because a post's score decides whether it
 * reaches the For You feed — a different question from QUALIFY's, which judges a group of
 * posts. It uses the same judge and the same ported prompt (with its news rules), shown one
 * post. The bar the answer is held to is core's `postScore`.
 *
 * ★ ONLY CATCH-ALL POSTS, ONLY OBSERVED ONES, AND EACH ONCE. The queue is
 * `PgItemRepo.catchAllUnscored`: found by a catch-all lane (or fetched by a story's backfill,
 * for GROUP's name-plus-picture join), not yet scored, newest first, inside the feed's window. An answer is recorded the moment it arrives, so a restart does
 * not pay for it twice.
 *
 * ★ FREE CHECKS FIRST. A catch-all post goes to the paid judge only once its reach clears For
 * You's bar (core's `clearsReachBar`) — a post that cannot show is not worth a judgement yet. One
 * that has not cleared it waits, unscored and off the feed, and is checked again after its next
 * re-read. A post a story's backfill fetched is judged regardless: GROUP needs its name.
 *
 * ★ NO ANSWER IS NOT A NO. A dry run prices the batch and sends nothing; a budget pause or
 * an unavailable answer records nothing. Each leaves the post waiting — off the feed, and
 * back in the queue next pass — and none is ever read as a pass.
 *
 * What breaks if changed carelessly: the subject id below is a key the judge echoes back to
 * match answers to posts. It is derived from the post id, so two posts never share one; a
 * subject id that collided would file one post's answer under another.
 */

import type { Item, Millis } from '@insidor/contracts';
import { storyId, type ItemId, type StoryId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PgItemRepo, PgPostJudgementRepo } from '@insidor/store';
import { clearsReachBar } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

/** How many unscored posts are read per pass for each one that may be judged: the rest are below the bar. */
const PREFETCH_FACTOR = 5;

import { errorText, type Logger } from '../log.ts';

export interface ScoringDeps {
  /** null when the judge is dormant: nothing is asked and every post waits. */
  readonly judge: JudgePort | null;
  readonly items: Pick<PgItemRepo, 'catchAllUnscored' | 'reachReadings' | 'backfilled'>;
  readonly scores: Pick<PgPostJudgementRepo, 'record'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface ScoringResult {
  readonly queued: number;
  readonly scored: number;
  readonly waiting: number;
  /** Priced and not sent, on a dry run. */
  readonly wouldSpendUsd: number;
  readonly spentUsd: number;
}

/** The key the judge echoes back for one post. Unique per post, never a real story id. */
function subjectIdFor(item: Item): StoryId {
  return storyId(`post-${String(item.itemId).replaceAll(':', '-').replaceAll('|', '-')}`);
}

function subjectFor(item: Item, p: Policy): JudgeSubject {
  const text = item.text.trim().slice(0, p.judge.maxCharsPerText);
  return {
    storyId: subjectIdFor(item),
    texts: text === '' ? [] : [text],
    media: item.media,
    distinctAuthors: 1,
    distinctSources: 1,
  };
}

export async function scorePosts(deps: ScoringDeps): Promise<ScoringResult> {
  const now = deps.now();
  const r = deps.policy.rising;
  const since = (now - r.windowMs) as Millis;
  /* The database narrows to posts some reading has put at the lowest reach any path to the feed
     starts from; core then holds each to the exact bar. Fetched wide, so posts still below it
     cannot crowd out the ones above it. */
  const wide = await deps.items.catchAllUnscored(since, r.postsPerPass * PREFETCH_FACTOR, Math.min(r.fypFastReachPerMinute, r.fypEarlyReach, r.fypMinReach));
  const readings = await deps.items.reachReadings(wide.map((i) => i.itemId), since);
  const backfilled = await deps.items.backfilled(wide.map((i) => i.itemId));
  const queue = wide
    .filter((item) => backfilled.has(String(item.itemId)) || clearsReachBar('fyp', readings.get(String(item.itemId)) ?? [], item.postedAt, deps.policy))
    .slice(0, r.postsPerPass);
  const empty = { queued: queue.length, scored: 0, waiting: queue.length, wouldSpendUsd: 0, spentUsd: 0 };
  if (queue.length === 0 || deps.judge === null) return empty;
  const judge = deps.judge;

  let scored = 0;
  let wouldSpendUsd = 0;
  let spentUsd = 0;
  for (let i = 0; i < queue.length; i += judge.maxBatch) {
    const batch = queue.slice(i, i + judge.maxBatch);
    const subjects = batch.map((item) => subjectFor(item, deps.policy));
    const byKey = new Map<string, ItemId>(batch.map((item) => [String(subjectIdFor(item)), item.itemId]));
    const estimate = judge.estimate(subjects);

    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.warn('post scoring paused for budget; these posts wait', { posts: batch.length, wouldSpendUsd: estimate.usd });
      break;
    }
    if (deps.mode === 'dry') {
      wouldSpendUsd += estimate.usd;
      continue;
    }

    const line = deps.meter.line(estimate.vendor);
    try {
      const result = await judge.judge(subjects, {
        capUsd: line.capUsd,
        spentUsd: line.spentUsd,
        maxCalls: null,
        deadline: (now + deps.policy.judge.timeoutMs * deps.policy.judge.maxAttempts) as Millis,
      });
      spentUsd += result.spend.usd;
      /* Answers come back parallel to the subjects sent, as QUALIFY's judging reads them. */
      for (const [index, outcome] of result.value.entries()) {
        if (outcome.kind !== 'judged') continue;
        const itemId = byKey.get(String(subjects[index]?.storyId));
        if (itemId === undefined) continue;
        await deps.scores.record(itemId, outcome.judgement);
        scored += 1;
      }
    } catch (e) {
      if (e instanceof BudgetRefused) {
        deps.log.warn('post scoring paused for budget at the vendor edge; these posts wait', { posts: batch.length });
        break;
      }
      deps.log.error('post scoring failed; these posts wait', { posts: batch.length, err: errorText(e) });
    }
  }

  if (deps.mode === 'dry') {
    deps.log.info('DRY RUN — posts priced for scoring, not sent', { posts: queue.length, wouldSpendUsd: Number(wouldSpendUsd.toFixed(6)) });
  } else {
    deps.log.info('posts scored', { queued: queue.length, scored, waiting: queue.length - scored, usd: Number(spentUsd.toFixed(6)) });
  }
  return { queued: queue.length, scored, waiting: queue.length - scored, wouldSpendUsd, spentUsd };
}
