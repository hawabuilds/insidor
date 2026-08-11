/**
 * The coinability judge.
 *
 * The judge returns evidence and nothing else. It does not know what a story is
 * worth, what the bar is, or what happens next — those are product judgements
 * and they live in core/qualify, where they are testable and where the
 * deterministic caps run AFTER the model and can only lower its score.
 *
 * A call that fails produces `unavailable` outcomes, never negative ones. The
 * stage abstains on those with a named reason rather than deciding blind, and
 * "we did not ask" stays distinguishable from "the answer was no".
 */

import type { Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { Price, PriceBook } from '@insidor/meter';

import type { JudgeClient, Usage } from './client.ts';
import { PROMPT_SET_SHA, PROMPTS } from './prompts.ts';
import { allUnavailable, toOutcomes } from './to-judgement.ts';

export const VENDOR = 'anthropic';
export const MODEL = 'claude-haiku-4-5';
const ENDPOINT = 'judge';

/**
 * Published rates, in dollars per million tokens. Vendor facts, so they live in
 * the vendor's folder — and they carry the date they were checked, because the
 * constants they replace were stale in the expensive direction and paused work
 * at a third of affordable throughput.
 */
export const RATES = {
  usdPerMillionInput: 1.0,
  usdPerMillionOutput: 5.0,
  measuredAt: '2026-08-05',
} as const;

export const usdOf = (usage: Usage): number =>
  (usage.inputTokens / 1e6) * RATES.usdPerMillionInput +
  (usage.outputTokens / 1e6) * RATES.usdPerMillionOutput;

/**
 * A per-call price is still declared, even though every call reports its own
 * exact cost: the meter refuses an unpriced call rather than estimating one,
 * and the recorded average is what a budget projection can be built from.
 */
const price: Price = {
  vendor: VENDOR,
  endpoint: ENDPOINT,
  unit: 'per-call',
  usdPerUnit: 0.00127,
  unitName: 'batched call',
  measuredAt: RATES.measuredAt,
};

export const PRICES: PriceBook = { [`${VENDOR}:${ENDPOINT}`]: price };

export interface AnthropicJudgeDeps {
  readonly client: JudgeClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** Subjects per call. A cost/latency tradeoff, so it arrives from policy. */
  readonly maxBatch: number;
  readonly prices?: PriceBook;
}

/**
 * The id recorded on every Decision this judge contributes to. It names the
 * model AND the prompt set, because a prompt edit changes the answers and an
 * unversioned prompt makes every judgement before and after it look identical
 * in the log.
 */
export const judgeId = (): string => `judge:${VENDOR}/${MODEL}@${PROMPT_SET_SHA}`;
export const promptId = (): string => `coinability@${PROMPT_SET_SHA}`;

export function anthropicJudge(deps: AnthropicJudgeDeps): JudgePort {
  const prices = deps.prices ?? PRICES;
  if (deps.maxBatch < 1) throw new RangeError('judge: batch size must be at least 1');

  return {
    id: judgeId(),
    promptId: promptId(),
    maxBatch: deps.maxBatch,

    async judge(subjects: readonly JudgeSubject[], _budget: Budget): Promise<Metered<readonly JudgeOutcome[]>> {
      const judgedAt = deps.now();
      const outcomes: JudgeOutcome[] = [];
      const spends = [];

      for (let i = 0; i < subjects.length; i += deps.maxBatch) {
        const batch = subjects.slice(i, i + deps.maxBatch);

        const call = await metered(
          deps.meter,
          prices,
          { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call', estUnits: 1, at: judgedAt },
          async () => {
            const response = await deps.client.judge({
              system: PROMPTS.system.text,
              instructions: `${PROMPTS['coinability-core'].text}\n\n${PROMPTS['subject-vs-story'].text}`,
              payload: batch,
            });
            return {
              value: response,
              units: 1,
              // The vendor itemises its own charge in tokens, so the ledger
              // records what was actually spent rather than an average.
              usdActual: usdOf(response.usage),
            };
          },
        );

        spends.push(call.spend);
        outcomes.push(
          ...toOutcomes(batch, call.value.answers, {
            judgeId: judgeId(),
            promptId: promptId(),
            judgedAt,
            costUsdPerSubject: batch.length === 0 ? 0 : call.spend.usd / batch.length,
          }),
        );
      }

      return {
        value: outcomes,
        spend: mergeSpend(
          spends,
          { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call', estUnits: 1, at: judgedAt },
          'per-call',
        ),
      };
    },
  };
}

export { allUnavailable, toJudgement, toOutcomes } from './to-judgement.ts';
export type { JudgementContext } from './to-judgement.ts';
export { PROMPTS, PROMPT_NAMES, PROMPT_SET_SHA } from './prompts.ts';
export type { Prompt, PromptName } from './prompts.ts';
export { httpClient } from './client.ts';
export type { JudgeClient, JudgeClientConfig, JudgeResponse, Usage } from './client.ts';
