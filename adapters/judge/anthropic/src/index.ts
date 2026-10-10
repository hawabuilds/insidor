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
 *
 * ★ EVERY CALL IS METERED, AND PRICED BEFORE IT IS MADE. `estimate()` works out a
 * pessimistic cost from the prompt's length, the frames, and the output ceiling, at the
 * configured model's rates (`prices.ts`). The meter checks that estimate against the
 * daily cap and the vendor line BEFORE the request leaves; afterwards it records what the
 * vendor's token counts say the call actually cost. A call refused for money throws
 * `BudgetRefused` from `metered()` and is not made.
 */

import type { Millis } from '@insidor/contracts';
import type { JudgePolicy } from '@insidor/contracts/policy.ts';
import type { Budget, CostEstimate, Meter, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { mergeSpend, metered } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';
import type { PriceBook } from '@insidor/meter';

import type { Frame, JudgeClient, JudgeResponse, Usage } from './client.ts';
import { VENDOR } from './client.ts';
import { PROMPT_SET_SHA, PROMPTS } from './prompts.ts';
import { priceFor, usdForTokens, type ModelPrice } from './prices.ts';
import { NO_FRAME, allUnavailable, frameUriFor, lookedAtFor, toOutcomes } from './to-judgement.ts';

export { VENDOR } from './client.ts';
const ENDPOINT = 'judge';

/** The two prompt halves exactly as loaded and hashed. */
const SYSTEM = PROMPTS.system.text;
const INSTRUCTIONS = `${PROMPTS['coinability-core'].text}\n\n${PROMPTS['subject-vs-story'].text}`;

/**
 * The id recorded on every Decision this judge contributes to. It names the model
 * AND the prompt set, because a prompt edit or a model change changes the answers,
 * and an unversioned judge makes every judgement before and after look identical.
 */
export const judgeId = (model: string): string => `judge:${VENDOR}/${model}@${PROMPT_SET_SHA}`;
export const promptId = (): string => `coinability@${PROMPT_SET_SHA}`;

/** What the vendor's own token counts say a call cost. */
export const usdOf = (price: ModelPrice, usage: Usage): number => usdForTokens(price, usage.inputTokens, usage.outputTokens);

export interface AnthropicJudgeDeps {
  readonly client: JudgeClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** From JUDGE_MODEL, already checked against the price book. */
  readonly model: string;
  readonly policy: JudgePolicy;
  /** Subjects per call. A cost/latency tradeoff, so it arrives from policy. */
  readonly maxBatch: number;
}

/** A batch's result inside the meter: the reply, or the vendor error that came with a status. */
interface Attempted {
  readonly response: JudgeResponse | null;
  readonly refusedWith: VendorUnavailable | null;
}

/** A per-call price book for one batch, priced at its own estimate. */
const bookFor = (usd: number): PriceBook => ({
  [`${VENDOR}:${ENDPOINT}`]: {
    vendor: VENDOR,
    endpoint: ENDPOINT,
    unit: 'per-call',
    usdPerUnit: usd,
    unitName: 'batched judge call',
    measuredAt: 'estimated per call from token rates in prices.ts',
  },
});

/**
 * A pessimistic token estimate for one batch: every character of the request at
 * `charsPerToken`, a frame at `tokensPerFrame`, and the full output ceiling.
 */
export function estimateTokens(policy: JudgePolicy, subjects: readonly JudgeSubject[]): Usage {
  const chars = SYSTEM.length + INSTRUCTIONS.length + JSON.stringify(subjects.map((s) => s.texts)).length;
  const frames = subjects.filter((s) => lookedAtFor(s) === 'videoFrame').length;
  return {
    inputTokens: Math.ceil(chars / policy.charsPerToken) + frames * policy.tokensPerFrame,
    outputTokens: policy.maxOutputTokens,
  };
}

export function anthropicJudge(deps: AnthropicJudgeDeps): JudgePort {
  const price = priceFor(deps.model);
  if (price === null) throw new RangeError(`judge: no price for model ${deps.model} in prices.ts`);
  if (deps.maxBatch < 1) throw new RangeError('judge: batch size must be at least 1');
  const batches = (subjects: readonly JudgeSubject[]): JudgeSubject[][] => {
    const out: JudgeSubject[][] = [];
    for (let i = 0; i < subjects.length; i += deps.maxBatch) out.push(subjects.slice(i, i + deps.maxBatch));
    return out;
  };
  const estimateUsd = (batch: readonly JudgeSubject[]): number => usdOf(price, estimateTokens(deps.policy, batch));

  return {
    id: judgeId(deps.model),
    promptId: promptId(),
    maxBatch: deps.maxBatch,

    estimate(subjects): CostEstimate {
      const parts = batches(subjects);
      return {
        vendor: VENDOR,
        endpoint: ENDPOINT,
        unit: 'per-call',
        estUnits: parts.length,
        usd: parts.reduce((sum, b) => sum + estimateUsd(b), 0),
      };
    },

    async judge(asked: readonly JudgeSubject[], _budget: Budget): Promise<Metered<readonly JudgeOutcome[]>> {
      const judgedAt = deps.now();

      /* Frames first, and before any money moves. A subject whose video has no frame we
         can show is never sent, so it is never paid for: it comes back unavailable. */
      const frames = new Map<string, Frame>();
      const unseen = new Set<string>();
      for (const s of asked) {
        const uri = frameUriFor(s);
        if (uri === undefined) continue;
        const frame = uri === null ? null : await deps.client.frame(uri);
        if (frame === null) unseen.add(String(s.storyId));
        else frames.set(String(s.storyId), frame);
      }
      const subjects = asked.filter((s) => !unseen.has(String(s.storyId)));

      const outcomes = new Map<string, JudgeOutcome>();
      for (const s of asked.filter((x) => unseen.has(String(x.storyId)))) {
        outcomes.set(String(s.storyId), { kind: 'unavailable', storyId: s.storyId, detail: NO_FRAME });
      }

      const spends: Spend[] = [];
      for (const batch of batches(subjects)) {
        const usd = estimateUsd(batch);
        const spec = { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call' as const, estUnits: 1, at: judgedAt };
        let answered: readonly JudgeOutcome[];
        try {
          const call = await metered<Attempted>(deps.meter, bookFor(usd), spec, async () => {
            try {
              const response = await deps.client.judge({
                system: SYSTEM,
                instructions: INSTRUCTIONS,
                subjects: batch,
                frames,
              });
              // The vendor itemises its own charge in tokens, so the ledger records
              // what was actually spent rather than the estimate.
              return { value: { response, refusedWith: null }, units: 1, usdActual: usdOf(price, response.usage) };
            } catch (error) {
              /* ★ AN ERROR THE VENDOR ANSWERED IS NOT BILLED, AND IS RECORDED AT $0.
                 This vendor does not charge for a request it answered with an error
                 status (429, 5xx, 529, a 4xx), so charging the estimate for one would
                 book money that never left — and during an outage, enough of it to pause
                 the judge for the rest of the day. A failure with NO status (a timeout,
                 a dropped socket) is different: the request may have been processed and
                 only the reply lost, so it is rethrown and `metered` charges the
                 estimate, the safe side. */
              if (error instanceof VendorUnavailable && error.status !== undefined) {
                return { value: { response: null, refusedWith: error }, units: 0, usdActual: 0 };
              }
              throw error;
            }
          });
          spends.push(call.spend);
          if (call.value.response === null) throw call.value.refusedWith ?? new Error('judge: no reply and no error');
          answered = toOutcomes(batch, call.value.response.answers, {
            judgeId: judgeId(deps.model),
            promptId: promptId(),
            judgedAt,
            costUsdPerSubject: batch.length === 0 ? 0 : call.spend.usd / batch.length,
          });
        } catch (error) {
          /* A refusal for money is not ours to swallow: the caller records it as a pause.
             Anything else — the vendor down, out of retries — is unavailability. The
             meter has already recorded the estimate for a call that went out and failed. */
          if (error instanceof BudgetRefused) throw error;
          answered = allUnavailable(batch, error instanceof Error ? error.message : String(error));
        }
        batch.forEach((s, i) => {
          const o = answered[i];
          if (o !== undefined) outcomes.set(String(s.storyId), o);
        });
      }

      return {
        /* In the order asked, as the port promises. */
        value: asked.map(
          (s) => outcomes.get(String(s.storyId)) ?? { kind: 'unavailable', storyId: s.storyId, detail: 'no outcome' },
        ),
        spend: mergeSpend(spends, { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call', estUnits: 1, at: judgedAt }, 'per-call'),
      };
    },
  };
}

export { NO_FRAME, allUnavailable, frameUriFor, lookedAtFor, toJudgement, toOutcomes } from './to-judgement.ts';
export type { JudgementContext } from './to-judgement.ts';
export { PROMPTS, PROMPT_NAMES, PROMPT_SET_SHA } from './prompts.ts';
export type { Prompt, PromptName } from './prompts.ts';
export { ANSWER_SCHEMA, JudgeNotConfigured, buildRequestBody, decodeReply, httpClient } from './client.ts';
export type { Frame, JudgeClient, JudgeClientConfig, JudgeRequest, JudgeResponse, Usage } from './client.ts';
export { MODEL_PRICES, PRICES_READ_AT, priceFor, usdForTokens } from './prices.ts';
export type { ModelPrice } from './prices.ts';
export { API_KEY, BASE_URL, DEFAULT_BASE_URL, MODEL, readJudgeSetup } from './credentials.ts';
export type { JudgeSetup } from './credentials.ts';
