/**
 * WHICH YES/NO CUTOFF ONE STORED ANSWER IS HELD TO: the cutoff of the model that gave it (core
 * `answerCutoff`, Policy.judge.cutoffs) — the applied block's (0086) for the model it was chosen on
 * (0094), each open model's own number until then, the block's for the main judge, rules and copies.
 * Read per answer, because every failover, and every switch of judge, puts answers from two models
 * side by side on one feed.
 *
 * Its own file because the projector's readers of the per-post bar (For You in rising.ts, the
 * board's narratives in narrative-rules.ts and narrative-frame.ts) must make the same choice, and
 * because it is the one place the projector asks the judge adapter which model an answer came from.
 *
 * ★ A CONFIDENCE IS A MODEL'S OWN SCALE (measured 2026-10-17). Nemotron's yeses on hand gold sit at a
 * median 0.88; block 10's 0.90 was chosen on Gemma 3's answers and passes 39% of gold for Nemotron
 * against 63% at its own 0.70. Holding every answer to one number would lose either the primary's
 * gold or the fallback's junk filter, and nobody would be told. Each cutoff only raises the
 * policy's own bars (core `withJudgeCutoff`), never lowers them.
 *
 * What breaks if changed carelessly: choosing by anything but the answer's own judge id (the
 * runner's current order, say) would hold every failover answer to the other model's cutoff.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { answerPolicies as cutoffPolicies, type BlockCutoff } from '@insidor/core';
import { answerSide } from '@insidor/judge-openai-compatible/setup.ts';
import { PgLearningRepo, type Db } from '@insidor/store';

export interface AnswerPolicies {
  /** The applied block's: owner calls, rules, copies, the main judge, and anything with no judge id. */
  readonly main: Policy;
  /** The policy one answer is held to, by the judge id it was filed under. */
  readonly of: (judgeId: string | null | undefined) => Policy;
}

export function answerPolicies(base: Policy, block: BlockCutoff): AnswerPolicies {
  const built = cutoffPolicies(base, block);
  return { main: built.main, of: (judgeId) => built.of(answerSide(judgeId)) };
}

/** One policy for every answer: what a caller that holds no block passes (tests, the old two-argument calls). */
export const onePolicy = (policy: Policy): AnswerPolicies => ({ main: policy, of: () => policy });

/**
 * With the applied block's cutoff and its model read from the store (0086, 0094): what a frame —
 * full or quick — holds its answers to. Read outside the frame's transaction, so a failed read
 * cannot abort it: it is said, and each model's policy number (else the policy bar) holds.
 */
export async function loadAnswerPolicies(db: Db, base: Policy): Promise<AnswerPolicies> {
  const block = await new PgLearningRepo(db).latestApplied().then(
    (b) => ({ cutoff: b?.cutoff ?? null, chosenOn: b?.cutoffModel ?? null }),
    (e: unknown) => {
      console.warn(`the applied block's cutoff could not be read; each model's own number, else the policy bar, holds: ${e instanceof Error ? e.message : String(e)}`);
      return { cutoff: null, chosenOn: null };
    },
  );
  return answerPolicies(base, block);
}

/** The policy one answer is held to, by the judge id it was filed under. */
export const policyForAnswer = (judgeId: string | null | undefined, answers: AnswerPolicies): Policy => answers.of(judgeId);
