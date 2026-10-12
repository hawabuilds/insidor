/**
 * Asking the judge whether two pictures show the same subject — once per pair, inside a daily
 * cap, and never in a dry run.
 *
 * GROUP's pull calls this for a borderline pair (similarity between `group.image.borderline`
 * and `.likely`) and hands the answer to core as data; core never asks anything itself.
 *
 * ★ NO ANSWER IS NOT A NO, AND NOT A YES. A dry run, the cap reached, a refused budget, an
 * unreadable picture or a garbled reply all return null: the pair simply carries no picture
 * evidence this pass. Only a stored "yes" ever counts, and the store keeps every answer so the
 * same two pictures are never paid for twice.
 */

import type { Millis } from '@insidor/contracts';
import type { JudgePort, SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgImagePairRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

export interface PairCheckDeps {
  readonly judge: JudgePort | null;
  readonly pairs: Pick<PgImagePairRepo, 'answer' | 'record' | 'countSince'>;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

const DAY_MS = 86_400_000;
/** How long one question may take before it is abandoned. */
const PAIR_DEADLINE_MS = 60_000;

export async function checkPair(deps: PairCheckDeps, itemUri: string, memberUri: string): Promise<SameSubjectAnswer | null> {
  const judge = deps.judge;
  if (judge === null || judge.sameSubject === undefined || judge.sameSubjectPromptId === undefined) return null;
  const promptId = judge.sameSubjectPromptId;

  const known = await deps.pairs.answer(itemUri, memberUri, promptId);
  if (known !== null) return known;
  if (deps.mode === 'dry') return null;

  const now = deps.now();
  const asked = await deps.pairs.countSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis);
  if (asked >= deps.policy.group.image.pairChecksPerDay) {
    deps.log.info('same-subject checks at the day\'s cap; this pair carries no picture evidence', { cap: deps.policy.group.image.pairChecksPerDay });
    return null;
  }

  try {
    const image = (uri: string) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null });
    const result = await judge.sameSubject(image(itemUri), image(memberUri), {
      capUsd: deps.policy.budget.supplierLines.judge,
      spentUsd: 0,
      maxCalls: 1,
      deadline: (now + PAIR_DEADLINE_MS) as Millis,
    });
    if (result.value !== null) {
      await deps.pairs.record(itemUri, memberUri, promptId, result.value, judge.id, now, result.spend.usd);
    }
    return result.value;
  } catch (e) {
    if (e instanceof BudgetRefused) deps.log.warn('same-subject check paused for budget', {});
    else deps.log.error('same-subject check failed', { err: errorText(e) });
    return null;
  }
}
