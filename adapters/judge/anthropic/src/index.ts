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
 *
 * ★ BATCH MODE IS FOR JOBS, NEVER THE LIVE FEED. With `batch: true` every call of one
 * `judge()` goes to the vendor as ONE Message Batch, billed at half price and answered in
 * minutes rather than seconds. The whole batch is checked against the meter as one call at
 * its (halved) estimate, then recorded at what the replies say it cost. Only one-off tools
 * (re-scoring, pass-rate tests) set it; the runner's wiring does not, and must not — a post
 * waiting on a batch is a post the feed shows late.
 */

import type { Millis } from '@insidor/contracts';
import type { JudgePolicy } from '@insidor/contracts/policy.ts';
import type { Budget, CostEstimate, Meter, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject, SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { mergeSpend, metered } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';
import type { PriceBook } from '@insidor/meter';

import type { BatchAnswer, Frame, JudgeClient, JudgeRequest, JudgeResponse, Usage } from './client.ts';
import { VENDOR } from './client.ts';
import { createHash } from 'node:crypto';

import { POST_PROMPT_SET_SHA, PROMPT_SET_SHA, PROMPTS, SAME_SUBJECT_PROMPT, VETO_PROMPT_SET_SHA } from './prompts.ts';
import { BATCH_PRICE_FRACTION, priceFor, usdForTokens, type ModelPrice } from './prices.ts';
import { NO_FRAME, allUnavailable, frameUriFor, lookedAtFor, pictureUriFor, toOutcomes } from './to-judgement.ts';

export { VENDOR } from './client.ts';
const ENDPOINT = 'judge';
/** The same-subject question, booked under its own endpoint so a day's pair checks are countable. */
const PAIR_ENDPOINT = 'same-subject';

/** The two prompt halves exactly as loaded and hashed. */
const SYSTEM = PROMPTS.system.text;
const INSTRUCTIONS = `${PROMPTS['coinability-core'].text}\n\n${PROMPTS['subject-vs-story'].text}`;

/**
 * Which question a judge asks. `story` (the default): does this GROUP of posts share one subject —
 * QUALIFY's question about a narrative. `post`: could people make a coin about this ONE post — the
 * feed's question, with its own prompt set and ids (POST_PROMPT_SET_SHA), so the two never mix.
 */
export type JudgeQuestion = 'story' | 'post' | 'kind';
const QUESTION: Readonly<Record<JudgeQuestion, { system: string; instructions: string; sha: () => string; label: string }>> = {
  story: { system: SYSTEM, instructions: INSTRUCTIONS, sha: () => PROMPT_SET_SHA, label: 'coinability' },
  post: { system: PROMPTS['post-system'].text, instructions: PROMPTS['post-coinability'].text, sha: () => POST_PROMPT_SET_SHA, label: 'post-coinability' },
  /* The feed's second question: which kind of post (AD, SPORT, FANDOM, SHOWBIZ, POLITICS, OTHER),
     answered in the same fields — coinable is "kind is OTHER", proposedName is the kind. */
  kind: { system: PROMPTS['post-veto-system'].text, instructions: PROMPTS['post-veto'].text, sha: () => VETO_PROMPT_SET_SHA, label: 'post-kind' },
};

/**
 * The id recorded on every Decision this judge contributes to. It names the model
 * AND the prompt set, because a prompt edit or a model change changes the answers,
 * and an unversioned judge makes every judgement before and after look identical.
 */
/**
 * ★ LEARNED EXAMPLES. The post question can carry a block of labelled posts after its rules —
 * the owner's own "is a meme" / "not a meme" calls, built by tools/judge-examples.ts and
 * re-tuned hourly. The rules stay a reviewed file; the examples are data. They change the
 * prompt, so they change its hash: an answer always names the exact examples it saw.
 */
interface PromptSet { readonly system: string; readonly instructions: string; readonly sha: string; readonly label: string }
function promptFor(question: JudgeQuestion, examples: string | null): PromptSet {
  const q = QUESTION[question];
  if (examples === null || examples.trim() === '' || question !== 'post') return { system: q.system, instructions: q.instructions, sha: q.sha(), label: q.label };
  const sha = createHash('sha256').update(`${q.sha()}|${examples}`).digest('hex').slice(0, 8);
  return { system: q.system, instructions: `${q.instructions}\n\n${examples.trim()}`, sha, label: q.label };
}

export const judgeId = (model: string, question: JudgeQuestion = 'story', examples: string | null = null): string => `judge:${VENDOR}/${model}@${promptFor(question, examples).sha}`;
export const promptId = (question: JudgeQuestion = 'story', examples: string | null = null): string => {
  const p = promptFor(question, examples);
  return `${p.label}@${p.sha}`;
};

/** What the vendor's own token counts say a call cost. */
export const usdOf = (price: ModelPrice, usage: Usage): number =>
  usdForTokens(price, usage.inputTokens, usage.outputTokens, usage.cacheWriteTokens ?? 0, usage.cacheReadTokens ?? 0);

export interface AnthropicJudgeDeps {
  readonly client: JudgeClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** From JUDGE_MODEL, already checked against the price book. */
  readonly model: string;
  readonly policy: JudgePolicy;
  /** Subjects per call. A cost/latency tradeoff, so it arrives from policy. */
  readonly maxBatch: number;
  /** Which question this judge asks; `story` when absent. See JudgeQuestion. */
  readonly question?: JudgeQuestion;
  /** Send each `judge()` as one Message Batch, at half price. Jobs only; see the header. */
  readonly batch?: boolean;
  /** Labelled examples after the post question's rules; ignored for the story question. */
  readonly examples?: string | null;
}

/** A batch's result inside the meter: the reply, or the vendor error that came with a status. */
interface Attempted {
  readonly response: JudgeResponse | null;
  readonly refusedWith: VendorUnavailable | null;
}

/** A per-call price book for one batch, priced at its own estimate. */
const bookFor = (usd: number, endpoint: string = ENDPOINT): PriceBook => ({
  [`${VENDOR}:${endpoint}`]: {
    vendor: VENDOR,
    endpoint,
    unit: 'per-call',
    usdPerUnit: usd,
    unitName: endpoint === ENDPOINT ? 'batched judge call' : 'same-subject question',
    measuredAt: 'estimated per call from token rates in prices.ts',
  },
});

/**
 * A pessimistic token estimate for one batch: every character of the request at
 * `charsPerToken`, a frame at `tokensPerFrame`, and the full output ceiling. The fixed prefix
 * (system prompt and instructions) is counted as a cache WRITE, the dearest way it can be
 * billed now that it carries the cache mark — so the estimate stays an upper bound.
 */
export function estimateTokens(policy: JudgePolicy, subjects: readonly JudgeSubject[], question: JudgeQuestion = 'story', examples: string | null = null): Usage {
  const set = promptFor(question, examples);
  const prefixChars = set.system.length + set.instructions.length;
  const chars = JSON.stringify(subjects.map((s) => s.texts)).length;
  const frames = subjects.filter((s) => lookedAtFor(s) === 'videoFrame' || pictureUriFor(s) !== null).length;
  return {
    inputTokens: Math.ceil(chars / policy.charsPerToken) + frames * policy.tokensPerFrame,
    outputTokens: policy.maxOutputTokens,
    cacheWriteTokens: Math.ceil(prefixChars / policy.charsPerToken),
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
  const question = deps.question ?? 'story';
  const examples = deps.examples ?? null;
  const prompt = promptFor(question, examples);
  const estimateUsd = (batch: readonly JudgeSubject[]): number => usdOf(price, estimateTokens(deps.policy, batch, question, examples));
  /** Two pictures, the prompt, and the small answer budget — the most a pair can cost. */
  const pairEstimateUsd = (): number =>
    usdOf(price, {
      inputTokens: 2 * deps.policy.tokensPerFrame + Math.ceil(SAME_SUBJECT_PROMPT.text.length / deps.policy.charsPerToken),
      outputTokens: deps.policy.pairMaxOutputTokens,
    });

  return {
    id: judgeId(deps.model, question, examples),
    promptId: promptId(question, examples),
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

    sameSubjectPromptId: `same-subject@${SAME_SUBJECT_PROMPT.sha}`,

    estimateSameSubject(): CostEstimate {
      return { vendor: VENDOR, endpoint: PAIR_ENDPOINT, unit: 'per-call', estUnits: 1, usd: pairEstimateUsd() };
    },

    /**
     * Both pictures read first, before any money moves: a pair with an unreadable picture is
     * never sent and comes back null. Billed on the tokens the vendor reports; an error the
     * vendor answered with a status is booked at $0, as `judge` books it.
     */
    async sameSubject(a: MediaRef, b: MediaRef, _budget: Budget): Promise<Metered<SameSubjectAnswer | null>> {
      const at = deps.now();
      const spec = { vendor: VENDOR, endpoint: PAIR_ENDPOINT, unit: 'per-call' as const, estUnits: 1, at };
      const nothing = { value: null, spend: mergeSpend([], spec, 'per-call') };
      const ask = deps.client.sameSubject;
      if (ask === undefined || a.kind !== 'image' || b.kind !== 'image') return nothing;
      const [fa, fb] = [await deps.client.frame(a.uri), await deps.client.frame(b.uri)];
      if (fa === null || fb === null) return nothing;
      const call = await metered<SameSubjectAnswer | null>(deps.meter, bookFor(pairEstimateUsd(), PAIR_ENDPOINT), spec, async () => {
        try {
          const reply = await ask.call(deps.client, {
            a: fa,
            b: fb,
            prompt: SAME_SUBJECT_PROMPT.text,
            maxOutputTokens: deps.policy.pairMaxOutputTokens,
          });
          return { value: reply.answer, units: 1, usdActual: usdOf(price, reply.usage) };
        } catch (error) {
          if (error instanceof VendorUnavailable && error.status !== undefined) return { value: null, units: 0, usdActual: 0 };
          throw error;
        }
      });
      return call;
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

      /* A still picture, for a subject with no video: shown when it can be fetched, and the
         subject judged on its text alone when it cannot — a dead picture is not a dead post. */
      const pictured = new Set<string>();
      for (const s of subjects) {
        const uri = pictureUriFor(s);
        if (uri === null) continue;
        const picture = await deps.client.frame(uri);
        if (picture === null) continue;
        frames.set(String(s.storyId), picture);
        pictured.add(String(s.storyId));
      }

      const outcomes = new Map<string, JudgeOutcome>();
      for (const s of asked.filter((x) => unseen.has(String(x.storyId)))) {
        outcomes.set(String(s.storyId), { kind: 'unavailable', storyId: s.storyId, detail: NO_FRAME });
      }

      const spends: Spend[] = [];
      const judgeBatch = deps.client.judgeBatch;
      if (deps.batch === true && judgeBatch !== undefined && subjects.length > 0) {
        const parts = batches(subjects);
        const requests: JudgeRequest[] = parts.map((batch) => ({
          system: prompt.system,
          instructions: prompt.instructions,
          subjects: batch,
          frames,
        }));
        const usd = parts.reduce((sum, b) => sum + estimateUsd(b), 0) * BATCH_PRICE_FRACTION;
        const spec = { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call' as const, estUnits: 1, at: judgedAt };
        let replies: readonly BatchAnswer[] | null = null;
        let failure = 'no reply';
        try {
          const call = await metered<readonly BatchAnswer[] | null>(deps.meter, bookFor(usd), spec, async () => {
            try {
              const answers = await judgeBatch.call(deps.client, requests);
              const billed = answers.reduce((sum, a) => sum + (a.kind === 'answered' ? usdOf(price, a.response.usage) : 0), 0);
              return { value: answers, units: answers.filter((a) => a.kind === 'answered').length, usdActual: billed * BATCH_PRICE_FRACTION };
            } catch (error) {
              /* As below: a create the vendor refused with a status made nothing and is $0.
                 A batch that was created and then lost is rethrown without one (client.ts),
                 and `metered` charges the estimate. */
              if (error instanceof VendorUnavailable && error.status !== undefined) {
                failure = error.message;
                return { value: null, units: 0, usdActual: 0 };
              }
              throw error;
            }
          });
          spends.push(call.spend);
          replies = call.value;
        } catch (error) {
          if (error instanceof BudgetRefused) throw error;
          failure = error instanceof Error ? error.message : String(error);
        }
        parts.forEach((batch, i) => {
          const reply = replies?.[i];
          const answered =
            reply?.kind === 'answered'
              ? toOutcomes(batch, reply.response.answers, {
                  judgeId: judgeId(deps.model, question, examples),
                  promptId: promptId(question, examples),
                  judgedAt,
                  costUsdPerSubject: (usdOf(price, reply.response.usage) * BATCH_PRICE_FRACTION) / batch.length,
                }, pictured)
              : allUnavailable(batch, reply?.kind === 'failed' ? reply.note : failure);
          batch.forEach((s, j) => {
            const o = answered[j];
            if (o !== undefined) outcomes.set(String(s.storyId), o);
          });
        });
      }
      for (const batch of deps.batch === true && judgeBatch !== undefined ? [] : batches(subjects)) {
        const usd = estimateUsd(batch);
        const spec = { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call' as const, estUnits: 1, at: judgedAt };
        let answered: readonly JudgeOutcome[];
        try {
          const call = await metered<Attempted>(deps.meter, bookFor(usd), spec, async () => {
            try {
              const response = await deps.client.judge({
                system: prompt.system,
                instructions: prompt.instructions,
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
            judgeId: judgeId(deps.model, question, examples),
            promptId: promptId(question, examples),
            judgedAt,
            costUsdPerSubject: batch.length === 0 ? 0 : call.spend.usd / batch.length,
          }, pictured);
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

export { NO_FRAME, allUnavailable, frameUriFor, lookedAtFor, pictureUriFor, toJudgement, toOutcomes } from './to-judgement.ts';
export type { JudgementContext } from './to-judgement.ts';
export { PROMPTS, PROMPT_NAMES, PROMPT_SET_SHA } from './prompts.ts';
export type { Prompt, PromptName } from './prompts.ts';
export { ANSWER_SCHEMA, JudgeNotConfigured, buildRequestBody, decodeReply, httpClient, usageOf } from './client.ts';
export type { BatchAnswer, Frame, JudgeClient, JudgeClientConfig, JudgeRequest, JudgeResponse, Usage } from './client.ts';
export { sizedPictureUri } from './pictures.ts';
export type { PictureSize } from './pictures.ts';
export { BATCH_PRICE_FRACTION, MODEL_PRICES, PRICES_READ_AT, priceFor, usdForTokens } from './prices.ts';
export type { ModelPrice } from './prices.ts';
export { API_KEY, BASE_URL, DEFAULT_BASE_URL, MODEL, readJudgeSetup } from './credentials.ts';
export type { JudgeSetup } from './credentials.ts';
