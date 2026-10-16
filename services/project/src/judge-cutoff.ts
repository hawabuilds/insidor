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
 * What breaks if changed carelessly: choosing by anything but the answer's own judge id (the
 * policy's primary, say) would hold every failover answer to the wrong model's cutoff.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { withJudgeCutoff } from '@insidor/core';
import { isOpenJudgeId } from '@insidor/judge-openai-compatible/setup.ts';

export interface AnswerPolicies {
  /** For the main judge's answers (and copies, rules and owner calls): the block's cutoff. */
  readonly main: Policy;
  /** For the open model's answers: its own cutoff, or the block's until it has one. */
  readonly open: Policy;
}

export function answerPolicies(base: Policy, blockCutoff: number | null): AnswerPolicies {
  return { main: withJudgeCutoff(base, blockCutoff), open: withJudgeCutoff(base, base.judge.openCutoff ?? blockCutoff) };
}

/** The policy one answer is held to, by the judge id it was filed under. */
export const policyForAnswer = (judgeId: string | null | undefined, main: Policy, open: Policy = main): Policy => (isOpenJudgeId(judgeId) ? open : main);
