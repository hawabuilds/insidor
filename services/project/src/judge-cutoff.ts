/**
 * WHICH YES/NO CUTOFF ONE STORED ANSWER IS HELD TO: the applied learned block's (tested with the
 * main judge answering, 0086) for the main judge's answers, Policy.judge.openCutoff for the open
 * model's. Read per answer, because during the 2026-10-16 switch, and after it on every failover,
 * the feed holds answers from both models side by side.
 *
 * Its own file because the projector's two readers of the per-post bar (For You in rising.ts, the
 * board's narratives in narrative-rules.ts) must make the same choice, and because it is the one
 * place the projector needs to recognise the open model's judge id.
 *
 * ★ A CONFIDENCE IS A MODEL'S OWN SCALE. The block's cutoff was chosen on the main judge's answers;
 * the open model's 0.71 is not the main judge's 0.71. Until the open model's cutoff is tuned
 * (`tools/judge-open-eval.ts --tune`) it is null and its answers are held to the block's — the only cutoff
 * measured — which is what a failover answer got before this file existed. Either cutoff only
 * raises the policy's own bars (core `withJudgeCutoff`), never lowers them.
 *
 * ★ FROM 2026-10-16 THE BLOCK'S CUTOFF IS THE OPEN JUDGE'S. The re-tune now grades with the open judge
 * alone (the owner: no Anthropic API at all), so every block applied from then on carries a cutoff
 * chosen on the open model's answers, and settings judge.openCutoff stays null so that cutoff is the
 * one its answers are held to. The main judge's answers still on the feed for a few hours after the
 * switch are held to it too: a stricter bar for them than their own, never a looser one than policy.
 *
 * What breaks if changed carelessly: choosing by anything but the answer's own judge id (the
 * policy's primary, say) would hold every failover answer to the wrong model's cutoff.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { withJudgeCutoff } from '@insidor/core';
import { isOpenJudgeId } from '@insidor/judge-openai-compatible/setup.ts';
import { PgLearningRepo, type Db } from '@insidor/store';

export interface AnswerPolicies {
  /** For the main judge's answers (and copies, rules and owner calls): the block's cutoff. */
  readonly main: Policy;
  /** For the open model's answers: its own cutoff, or the block's until it has one. */
  readonly open: Policy;
}

export function answerPolicies(base: Policy, blockCutoff: number | null): AnswerPolicies {
  return { main: withJudgeCutoff(base, blockCutoff), open: withJudgeCutoff(base, base.judge.openCutoff ?? blockCutoff) };
}

/**
 * Both, with the applied block's cutoff read from the store (0086): what a frame — full or quick —
 * holds its answers to. Read outside the frame's transaction, so a failed read cannot abort it: it
 * is said, and the policy bar holds, as before 0086.
 */
export async function loadAnswerPolicies(db: Db, base: Policy): Promise<AnswerPolicies> {
  const cutoff = await new PgLearningRepo(db).latestApplied().then((b) => b?.cutoff ?? null, (e: unknown) => {
    console.warn(`the applied block's cutoff could not be read; the policy bar holds: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });
  return answerPolicies(base, cutoff);
}

/** The policy one answer is held to, by the judge id it was filed under. */
export const policyForAnswer = (judgeId: string | null | undefined, main: Policy, open: Policy = main): Policy => (isOpenJudgeId(judgeId) ? open : main);
