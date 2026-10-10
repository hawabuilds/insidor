/**
 * THE JUDGING STEP: which promoted stories get a paid judge call this pass, and what each
 * story hands QUALIFY — a judgement, or the reason it has none.
 *
 * Split from `stages.ts` so it is testable against ports — a judgement record, a judge, a
 * meter — with no database and no network. Everything here is I/O orchestration; every
 * product rule it applies is called from somewhere else:
 *
 *   - whether a story is worth asking   `worthJudging` in core/qualify, the SAME gates
 *                                       QUALIFY applies, so a story qualify would drop
 *                                       anyway is never paid for
 *   - whether to ask again              `Policy.judge.rejudgeGrowth`, against the member
 *                                       count on record
 *   - whether money allows it           the meter, consulted BEFORE the call
 *
 * ★ FOUR WAYS A STORY ENDS UP WITHOUT A JUDGEMENT, AND EACH IS SAID. Never asked (not worth
 * it, a fiction, or no judge configured), unavailable (asked, nothing usable), budget (the
 * call was not made), dry run (priced and not sent). QUALIFY abstains on all four with its
 * own reason. None is ever a "no".
 *
 * ★ A SEEDED STORY IS NEVER SENT. `origin: 'fixture'` is a story somebody wrote by hand; a
 * paid call about it buys a judgement of a fiction. It reaches QUALIFY unasked.
 *
 * ★ EACH STORY IS JUDGED ONCE. An answer is written to the judgement record the moment it
 * arrives, and read back on every later pass — including the first pass after a restart —
 * so the only stories asked again are the ones that have grown by `rejudgeGrowth`.
 */

import type { JudgeAbsence, Judgement, Millis } from '@insidor/contracts';
import type { StoryId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Budget, Meter } from '@insidor/contracts/ports/meter.ts';
import type { JudgementRepo } from '@insidor/contracts/ports/store.ts';
import type { Item, Story, StoryMember } from '@insidor/contracts';
import { worthJudging } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

import type { Logger } from '../log.ts';

export interface JudgingDeps {
  /** null when the judge is dormant: nothing is asked, every story is `not_asked`. */
  readonly judge: JudgePort | null;
  readonly judgements: JudgementRepo;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
}

export interface StoryToJudge {
  readonly story: Story;
  readonly members: readonly StoryMember[];
}

/** What QUALIFY is handed for one story. */
export interface JudgedStory {
  readonly judgement: Judgement | null;
  readonly unjudged: JudgeAbsence;
  /** What THIS pass spent on this story. A judgement read back from the record cost nothing now. */
  readonly judgeCostUsd: number;
}

const NOT_ASKED: JudgedStory = { judgement: null, unjudged: 'not_asked', judgeCostUsd: 0 };

/** A story asked about before is asked again only once it has grown by the policy share. */
export function needsRejudge(recordedMembers: number, membersNow: number, growth: number): boolean {
  return membersNow >= Math.ceil(recordedMembers * (1 + growth)) && membersNow > recordedMembers;
}

/** What the judge is shown about a story: its members' text and media, bounded by policy. */
export function subjectFor(story: Story, members: readonly StoryMember[], items: ReadonlyMap<string, Item>, p: Policy): JudgeSubject {
  const own = members.map((m) => items.get(String(m.itemId))).filter((i): i is Item => i !== undefined);
  return {
    storyId: story.storyId,
    texts: own
      .map((i) => i.text.trim())
      .filter((t) => t !== '')
      .slice(0, p.judge.maxTextsPerStory)
      .map((t) => t.slice(0, p.judge.maxCharsPerText)),
    media: own.flatMap((i) => i.media),
    distinctAuthors: new Set(members.map((m) => m.authorKey)).size,
    distinctSources: new Set(members.map((m) => m.source)).size,
  };
}

/**
 * One pass of judging. Returns an entry for every story it was handed.
 *
 * `items` is a lookup the caller fills from the store: the member items' text and media.
 */
export async function judgeStories(
  stories: readonly StoryToJudge[],
  items: (storyIds: readonly StoryToJudge[]) => Promise<ReadonlyMap<string, Item>>,
  deps: JudgingDeps,
  now: Millis,
): Promise<ReadonlyMap<StoryId, JudgedStory>> {
  const out = new Map<StoryId, JudgedStory>();
  const ctx = { now, policyHash: '', seed: '' };

  /* Who is even eligible: worth asking by qualify's own cheap gates, and not a fiction. */
  const eligible = stories.filter(
    (s) => s.story.origin === 'observed' && worthJudging({ story: s.story, members: s.members }, deps.policy, ctx),
  );
  for (const s of stories) out.set(s.story.storyId, NOT_ASKED);
  if (eligible.length === 0) return out;

  /* What is already on record. A story with an answer and no meaningful growth uses it. */
  const recorded = await deps.judgements.latest(eligible.map((s) => s.story.storyId));
  const toAsk: StoryToJudge[] = [];
  for (const s of eligible) {
    const prior = recorded.get(s.story.storyId);
    if (prior !== undefined && !needsRejudge(prior.memberCount, s.members.length, deps.policy.judge.rejudgeGrowth)) {
      out.set(s.story.storyId, { judgement: prior.judgement, unjudged: 'not_asked', judgeCostUsd: 0 });
    } else {
      toAsk.push(s);
    }
  }
  if (toAsk.length === 0 || deps.judge === null) return out;
  const judge = deps.judge;

  const lookup = await items(toAsk);
  const chunks: StoryToJudge[][] = [];
  for (let i = 0; i < toAsk.length; i += judge.maxBatch) chunks.push(toAsk.slice(i, i + judge.maxBatch));

  let wouldSpendUsd = 0;
  for (const chunk of chunks) {
    const subjects = chunk.map((s) => subjectFor(s.story, s.members, lookup, deps.policy));
    const estimate = judge.estimate(subjects);
    const absent = (why: JudgeAbsence): void => {
      for (const s of chunk) out.set(s.story.storyId, { judgement: null, unjudged: why, judgeCostUsd: 0 });
    };

    /* The budget is consulted BEFORE the dry-run return, so a dry run reports the same
       pauses a live run would. Only the request is missing. */
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      const line = deps.meter.line(estimate.vendor);
      deps.log.warn('judge paused for budget; the call was not made', {
        stories: chunk.length,
        wouldSpendUsd: estimate.usd,
        remainingUsd: line.remainingUsd,
        spentUsd: line.spentUsd,
        capUsd: line.capUsd,
      });
      absent('budget');
      continue;
    }
    if (deps.mode === 'dry') {
      wouldSpendUsd += estimate.usd;
      absent('dry_run');
      continue;
    }

    const line = deps.meter.line(estimate.vendor);
    const budget: Budget = {
      capUsd: line.capUsd,
      spentUsd: line.spentUsd,
      maxCalls: null,
      deadline: now + deps.policy.judge.timeoutMs * deps.policy.judge.maxAttempts,
    };
    try {
      const result = await judge.judge(subjects, budget);
      /* ★ THE COST OF EVERY CALL, LOGGED, so a day's spend says how much went on judging.
         The ledger already has the row (vendor and endpoint `judge`); this is the line a
         person reads. */
      deps.log.info('judge call', {
        stories: chunk.length,
        usd: result.spend.usd,
        estimatedUsd: estimate.usd,
        spentTodayOnThisVendorUsd: deps.meter.spentUsd(estimate.vendor),
      });
      for (const [i, outcome] of result.value.entries()) {
        const s = chunk[i];
        if (s === undefined) continue;
        if (outcome.kind === 'judged') {
          await deps.judgements.record(s.story.storyId, s.members.length, outcome.judgement);
          out.set(s.story.storyId, { judgement: outcome.judgement, unjudged: 'not_asked', judgeCostUsd: outcome.judgement.costUsd });
        } else {
          out.set(s.story.storyId, { judgement: null, unjudged: 'unavailable', judgeCostUsd: 0 });
        }
      }
    } catch (error) {
      if (error instanceof BudgetRefused) {
        deps.log.warn('judge paused for budget at the vendor edge', { stories: chunk.length, reason: error.reason });
        absent('budget');
        continue;
      }
      deps.log.error('judge call failed; these stories are unavailable this pass', {
        stories: chunk.length,
        err: error instanceof Error ? error.message : String(error),
      });
      absent('unavailable');
    }
  }

  if (deps.mode === 'dry') {
    deps.log.info('DRY RUN — the judge was not contacted', {
      storiesPriced: toAsk.length,
      wouldSpendUsdThisPass: Number(wouldSpendUsd.toFixed(6)),
    });
  }
  return out;
}
