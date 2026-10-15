/**
 * AN OPEN MODEL AS THE JUDGE, BEHIND THE SAME PORT — for measuring one against the live judge
 * (tools/judge-open-eval.ts). Nothing live is wired to it.
 *
 * It asks the live judge's questions exactly as the live judge's port asks them: the same prompt
 * files for the post question and the kind question, the owner's learned-examples block after the
 * post rules, each post's closest labelled posts as precedent, the same posts per call, the same
 * rule for pictures (a video with no frame to show is never sent and comes back unavailable; a
 * still picture that cannot be read leaves the post judged on its words), and the answers turned
 * into judgements by the Anthropic adapter's own `toOutcomes`, with its prompt id — so an answer
 * from either judge is graded by one set of rules and says which question it answered. Only the
 * judge id differs: it names this host and model, and `+text-only` when no picture was shown.
 *
 * ★ A MODEL THAT CANNOT READ PICTURES is never sent one, and its answers are filed as read from
 * text (the text bar applies), because that is what it did. Grading it at the picture bar would
 * hold it to a standard for something it never saw.
 *
 * ★ METERED AND PRICED BEFORE EACH CALL, like the live judge: a pessimistic estimate (every
 * character at the policy's characters per token, every picture at the policy's tokens per frame,
 * the whole answer budget, times ESTIMATE_MARGIN because an open model may count a picture as more
 * tokens than the live model does) at the host's listed prices, checked against the meter before
 * the request leaves; afterwards the host's own dollar figure for the call is recorded, or its
 * token counts at the listed prices when it gave none. An error the host answered with a status
 * is booked at $0; a lost reply is booked at the estimate (it may have been billed).
 *
 * What breaks if changed carelessly: the prompt must come from the Anthropic adapter's files and
 * ids, never from a copy here — a reworded copy would measure a judge nobody runs.
 */

import type { Millis } from '@insidor/contracts';
import type { JudgePolicy } from '@insidor/contracts/policy.ts';
import type { CostEstimate, Meter, Spend } from '@insidor/contracts/ports/meter.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { PRECEDENTS_PROMPT, PROMPTS, allUnavailable, estimateTokens, frameUriFor, pictureUriFor, promptId, toOutcomes, NO_FRAME, type Frame, type JudgeClient } from '@insidor/judge-anthropic';
import { mergeSpend, metered, type PriceBook } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';

import type { OpenJudgeResponse } from './client.ts';
import type { HostModel } from './models.ts';

export { CHAT_ENDPOINT, DEFAULT_BASE_URL, DEFAULT_VENDOR, OpenJudgeNotConfigured, billingReason, buildChatBody, decodeChatReply, openChatClient, unfenced } from './client.ts';
export type { OpenChatConfig, OpenJudgeResponse } from './client.ts';
export { closestModel, keyAllowance, listModels, parseModels } from './models.ts';
export type { HostModel } from './models.ts';

/** The ledger's endpoint for these calls; the learning book's meter adds its own prefix. */
export const OPEN_JUDGE_ENDPOINT = 'judge-open';
/** How far over the token estimate a call may come: an open model may count a picture as more tokens than the policy's figure. */
export const ESTIMATE_MARGIN = 2;

/** The two questions the feed asks of a post. The narrative question is not measured here. */
export type OpenQuestion = 'post' | 'kind';

const QUESTION: Readonly<Record<OpenQuestion, { readonly system: string; readonly instructions: string }>> = {
  post: { system: PROMPTS['post-system'].text, instructions: PROMPTS['post-coinability'].text },
  kind: { system: PROMPTS['post-veto-system'].text, instructions: PROMPTS['post-veto'].text },
};

/** The system prompt, the instructions (with the learned block after the post rules) and the precedents' intro, as the live judge sends them. */
export function promptFor(question: OpenQuestion, examples: string | null, precedents: boolean): { readonly system: string; readonly instructions: string; readonly precedentsIntro?: string } {
  const q = QUESTION[question];
  const block = question === 'post' && examples !== null && examples.trim() !== '' ? examples.trim() : null;
  return {
    system: q.system,
    instructions: block === null ? q.instructions : `${q.instructions}\n\n${block}`,
    ...(precedents && question === 'post' ? { precedentsIntro: PRECEDENTS_PROMPT.text } : {}),
  };
}

/** Dollars for a token count at the host's listed prices; null when the host lists none. */
export const usdAtListed = (model: HostModel, inputTokens: number, outputTokens: number): number | null =>
  model.usdPerInputToken === null || model.usdPerOutputToken === null ? null : inputTokens * model.usdPerInputToken + outputTokens * model.usdPerOutputToken;

export interface OpenJudgeDeps {
  readonly client: JudgeClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** The host's model, from its model list: the id, whether it reads pictures, its prices. */
  readonly model: HostModel;
  readonly vendor: string;
  readonly policy: JudgePolicy;
  readonly maxBatch: number;
  readonly question: OpenQuestion;
  readonly examples?: string | null;
  readonly precedents?: boolean;
}

export function openJudge(deps: OpenJudgeDeps): JudgePort & { readonly textOnly: boolean } {
  if (deps.maxBatch < 1) throw new RangeError('open judge: batch size must be at least 1');
  if (deps.model.usdPerInputToken === null || deps.model.usdPerOutputToken === null) throw new RangeError(`open judge: the host lists no price for ${deps.model.id}, and an unpriced call is refused`);
  const examples = deps.examples ?? null;
  const precedents = deps.precedents === true && deps.question === 'post';
  const prompt = promptFor(deps.question, examples, precedents);
  const textOnly = !deps.model.vision;
  const pid = promptId(deps.question, examples, precedents);
  const id = `judge:${deps.vendor}/${deps.model.id}${textOnly ? '+text-only' : ''}@${pid.split('@')[1] ?? ''}`;
  const batches = (xs: readonly JudgeSubject[]): JudgeSubject[][] => Array.from({ length: Math.ceil(xs.length / deps.maxBatch) }, (_, k) => xs.slice(k * deps.maxBatch, (k + 1) * deps.maxBatch));
  /* A text-only model is asked about the words alone, and filed as such. */
  const asSent = (s: JudgeSubject): JudgeSubject => (textOnly ? { ...s, media: [] } : s);
  const estimateUsd = (batch: readonly JudgeSubject[]): number => {
    const t = estimateTokens(deps.policy, batch.map(asSent), deps.question, examples, precedents);
    return (usdAtListed(deps.model, t.inputTokens + (t.cacheWriteTokens ?? 0), t.outputTokens) ?? 0) * ESTIMATE_MARGIN;
  };
  const bookFor = (usd: number): PriceBook => ({
    [`${deps.vendor}:${OPEN_JUDGE_ENDPOINT}`]: { vendor: deps.vendor, endpoint: OPEN_JUDGE_ENDPOINT, unit: 'per-call', usdPerUnit: usd, unitName: 'batched open-model judge call', measuredAt: 'estimated per call from the host model list prices' },
  });

  return {
    id,
    promptId: pid,
    maxBatch: deps.maxBatch,
    textOnly,

    estimate(subjects): CostEstimate {
      const parts = batches(subjects);
      return { vendor: deps.vendor, endpoint: OPEN_JUDGE_ENDPOINT, unit: 'per-call', estUnits: parts.length, usd: parts.reduce((s, b) => s + estimateUsd(b), 0) };
    },

    async judge(asked0, _budget) {
      const judgedAt = deps.now();
      const asked = asked0.map(asSent);
      /* Pictures first, before any money moves, by the live judge's rules. */
      const frames = new Map<string, Frame>();
      const unseen = new Set<string>();
      const pictured = new Set<string>();
      for (const s of asked) {
        const uri = frameUriFor(s);
        if (uri === undefined) continue;
        const frame = uri === null ? null : await deps.client.frame(uri);
        if (frame === null) unseen.add(String(s.storyId));
        else frames.set(String(s.storyId), frame);
      }
      const subjects = asked.filter((s) => !unseen.has(String(s.storyId)));
      for (const s of subjects) {
        const uri = pictureUriFor(s);
        if (uri === null) continue;
        const picture = await deps.client.frame(uri);
        if (picture === null) continue;
        frames.set(String(s.storyId), picture);
        pictured.add(String(s.storyId));
      }
      const outcomes = new Map<string, JudgeOutcome>();
      for (const s of asked.filter((x) => unseen.has(String(x.storyId)))) outcomes.set(String(s.storyId), { kind: 'unavailable', storyId: s.storyId, detail: NO_FRAME });

      const spends: Spend[] = [];
      for (const batch of batches(subjects)) {
        const usd = estimateUsd(batch);
        const spec = { vendor: deps.vendor, endpoint: OPEN_JUDGE_ENDPOINT, unit: 'per-call' as const, estUnits: 1, at: judgedAt };
        let answered: readonly JudgeOutcome[];
        try {
          const call = await metered<{ response: OpenJudgeResponse | null; refusedWith: VendorUnavailable | null }>(deps.meter, bookFor(usd), spec, async () => {
            try {
              const response = (await deps.client.judge({ ...prompt, subjects: batch, frames })) as OpenJudgeResponse;
              const actual = response.costUsd ?? usdAtListed(deps.model, response.usage.inputTokens, response.usage.outputTokens) ?? usd;
              return { value: { response, refusedWith: null }, units: 1, usdActual: actual };
            } catch (error) {
              if (error instanceof VendorUnavailable && error.status !== undefined) return { value: { response: null, refusedWith: error }, units: 0, usdActual: 0 };
              throw error;
            }
          });
          spends.push(call.spend);
          if (call.value.response === null) throw call.value.refusedWith ?? new Error('open judge: no reply and no error');
          answered = toOutcomes(batch, call.value.response.answers, { judgeId: id, promptId: pid, judgedAt, costUsdPerSubject: batch.length === 0 ? 0 : call.spend.usd / batch.length }, pictured);
        } catch (error) {
          if (error instanceof BudgetRefused) throw error;
          answered = allUnavailable(batch, error instanceof Error ? error.message : String(error));
        }
        batch.forEach((s, i) => {
          const o = answered[i];
          if (o !== undefined) outcomes.set(String(s.storyId), o);
        });
      }
      return {
        value: asked.map((s) => outcomes.get(String(s.storyId)) ?? { kind: 'unavailable', storyId: s.storyId, detail: 'no outcome' }),
        spend: mergeSpend(spends, { vendor: deps.vendor, endpoint: OPEN_JUDGE_ENDPOINT, unit: 'per-call', estUnits: 1, at: judgedAt }, 'per-call'),
      };
    },
  };
}
