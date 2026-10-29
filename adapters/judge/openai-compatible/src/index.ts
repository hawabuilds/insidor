/**
 * AN OPEN MODEL AS THE JUDGE, BEHIND THE SAME PORT — measured against the live judge by
 * tools/judge-open-eval.ts (and its cutoff tuning, `--tune`), and since 2026-10-16 wired into the runner
 * as the feed judge's fallback and shadow (or its primary, Policy.judge.primary).
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
 * ★ FEWER POSTS A CALL, CALLS SIDE BY SIDE, SKIPPED POSTS ASKED AGAIN (Policy.judge.open). The
 * feed still hands this port `maxBatch` posts; it asks them `perCall` at a time, `parallel` calls
 * at once, and a post a reply skipped or cut off (no answer for it, or a reply stopped at the token
 * limit) is asked again, among the skipped only, up to `reask` rounds while the batch is younger
 * than `reaskWithinMs`. Only those two outcomes are re-asked: an error already had its retries in
 * the client, and the failover answers it. A repeated answer for a post keeps the first
 * (`firstAnswers`). Measured 2026-10-16 on 58 real posts: ten a call left 4–7% skipped and some
 * repeated; five a call with one re-ask answered 116 of 116.
 *
 * What breaks if changed carelessly: the prompt must come from the Anthropic adapter's files and
 * ids, never from a copy here — a reworded copy would measure a judge nobody runs.
 */

import type { Millis } from '@insidor/contracts';
import type { JudgePolicy } from '@insidor/contracts/policy.ts';
import type { CostEstimate, Meter, Spend } from '@insidor/contracts/ports/meter.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { PRECEDENTS_PROMPT, PROMPTS, allUnavailable, estimateTokens, frameUriFor, pictureUriFor, promptId, toOutcomes, withPrecedentsUpTo, NO_FRAME, type Frame, type JudgeClient } from '@insidor/judge-anthropic';
import { mergeSpend, metered, type PriceBook } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';

import type { OpenJudgeResponse } from './client.ts';
import type { HostModel } from './models.ts';

export { CHAT_ENDPOINT, DEFAULT_BASE_URL, DEFAULT_VENDOR, OpenJudgeNotConfigured, answerCapProblem, billingReason, buildChatBody, decodeChatReply, openChatClient, rotated, routerFields, unfenced } from './client.ts';
export type { OpenChatConfig, OpenJudgeResponse } from './client.ts';
export { accountCredits, closestModel, keyAllowance, listModels, parseModels } from './models.ts';
export type { HostModel } from './models.ts';
export { OPEN_COIN_POST_ENDPOINT, OPEN_NAMES_ENDPOINT, OPEN_PAIR_ENDPOINT, OPEN_TRANSLATE_ENDPOINT, chatBodyFromMessages, coinPostText, messagesReplyOf, openCoinPostCheck, openNamer, openSameSubject, openTranslator } from './questions.ts';
export type { OpenAsk, OpenQuestionDeps, OpenSameSubject } from './questions.ts';
export { OPEN_TITLE_ENDPOINT, TITLE_PROMPT_SHA, cleanCountries, cleanTitle, openTitler, titleRequestText } from './titles.ts';
export type { OpenTitlerDeps } from './titles.ts';
export { BACKUP_VENDOR, DEFAULT_BACKUP_BASE_URL, DEFAULT_BACKUP_MODEL, DEFAULT_OPEN_MODEL, DEFAULT_OPEN_PROVIDERS, KNOWN_MODELS, OPEN_API_KEY, OPEN_BACKUP_API_KEY, OPEN_BACKUP_BASE_URL, OPEN_BACKUP_MODEL, OPEN_BASE_URL, OPEN_MODEL, OPEN_POST_FIRST, OPEN_PROVIDERS, PRIMARY_POST_MODEL, TOGETHER_API_KEY, answerSide, isOpenJudgeId, judgeModelKey, openProviders, readOpenJudgeBackupSetup, readOpenJudgeSetup, readPostFirst, vendorOfHost } from './setup.ts';
export type { OpenJudgeSetup, PostFirst } from './setup.ts';

/** The ledger's endpoint for these calls; the learning book's meter adds its own prefix. */
export const OPEN_JUDGE_ENDPOINT = 'judge-open';
/** How far over the token estimate a call may come: an open model may count a picture as more tokens than the policy's figure. */
export const ESTIMATE_MARGIN = 2;
/** Precedents dropped per post at a time while a call does not fit the model's window. */
const PRECEDENT_STEP = 5;

/**
 * ★ THE OPEN MODEL'S PRECEDENTS, FITTED TO ITS WINDOW (the owner, 2026-10-16: "Gemma gets the 30–50
 * most similar examples"). Each post keeps its closest Policy.judge.precedents.openK labelled posts;
 * while the call's pessimistic input estimate (every character at charsPerToken, every picture at
 * tokensPerFrame) is over `openMaxInputTokens`, every post keeps PRECEDENT_STEP fewer, the farthest
 * first. Measured 2026-10-16 on the router's listing: both pinned providers serve the model with a
 * 131,072-token window, so the policy's figure leaves room for the answer and the estimate's slack.
 */
export function fitPrecedents(batch: readonly JudgeSubject[], policy: JudgePolicy, tokensOf: (b: readonly JudgeSubject[]) => number): readonly JudgeSubject[] {
  const want = policy.precedents?.openK ?? policy.precedents?.k ?? 0;
  const max = policy.precedents?.openMaxInputTokens ?? Infinity;
  let k = want;
  let fitted = withPrecedentsUpTo(batch, k);
  while (k > 0 && tokensOf(fitted) > max) {
    k = Math.max(0, k - PRECEDENT_STEP);
    fitted = withPrecedentsUpTo(batch, k);
  }
  return fitted;
}

/**
 * The two questions the feed asks of a post, and QUALIFY's question about a narrative (`story`,
 * since 2026-10-16: the owner moved every question off the main judge). Each is the live judge's
 * prompt files, exactly as its port assembles them.
 */
export type OpenQuestion = 'post' | 'kind' | 'story' | 'viral';

const QUESTION: Readonly<Record<OpenQuestion, { readonly system: string; readonly instructions: string }>> = {
  post: { system: PROMPTS['post-system'].text, instructions: PROMPTS['post-coinability'].text },
  kind: { system: PROMPTS['post-veto-system'].text, instructions: PROMPTS['post-veto'].text },
  viral: { system: PROMPTS['post-viral-system'].text, instructions: PROMPTS['post-viral'].text },
  story: { system: PROMPTS.system.text, instructions: `${PROMPTS['coinability-core'].text}\n\n${PROMPTS['subject-vs-story'].text}` },
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
  /** The ledger's endpoint for these calls; OPEN_JUDGE_ENDPOINT when absent (the shadow runs under its own). */
  readonly endpoint?: string;
  /** Posts in one call; `maxBatch` (the posts one judge() takes) when absent. */
  readonly perCall?: number;
  /** Calls of one judge() in flight at once; 1 (one after another) when absent. */
  readonly parallel?: number;
  /** Rounds of asking again the posts a reply skipped or cut off; 0 when absent. */
  readonly reask?: number;
  /** A re-ask round is started only this soon after the batch began; no limit when absent. */
  readonly reaskWithinMs?: number;
}

/** What a post left without an answer by a reply that came back says: asked again (`reask`). */
const SKIPPED = new Set(['no answer for this subject', 'answer did not parse']);

/**
 * One answer per post, the first. A model that runs past the last post sometimes starts the list
 * again, and the repeat is a second, different answer to a post already answered (measured
 * 2026-10-16: a "yes, FLAVIO" followed at the end by a "no" for the same post). The parser keeps the
 * last of two, so without this the tail of a runaway list overwrote the real answer.
 */
export function firstAnswers(answers: readonly unknown[]): readonly unknown[] {
  const seen = new Set<string>();
  return answers.filter((a) => {
    const r = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>;
    const key = r['storyId'] ?? r['subjectId'];
    if (typeof key !== 'string') return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Each of `items` through `run`, at most `width` at once, in order of start. */
async function inTurns<T>(items: readonly T[], width: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, lane));
}

export function openJudge(deps: OpenJudgeDeps): JudgePort & { readonly textOnly: boolean } {
  if (deps.maxBatch < 1) throw new RangeError('open judge: batch size must be at least 1');
  if (deps.model.usdPerInputToken === null || deps.model.usdPerOutputToken === null) throw new RangeError(`open judge: the host lists no price for ${deps.model.id}, and an unpriced call is refused`);
  const examples = deps.examples ?? null;
  const precedents = deps.precedents === true && deps.question === 'post';
  const prompt = promptFor(deps.question, examples, precedents);
  const textOnly = !deps.model.vision;
  const endpoint = deps.endpoint ?? OPEN_JUDGE_ENDPOINT;
  const parallel = Math.max(1, Math.floor(deps.parallel ?? 1));
  const reask = Math.max(0, Math.floor(deps.reask ?? 0));
  const pid = promptId(deps.question, examples, precedents);
  const id = `judge:${deps.vendor}/${deps.model.id}${textOnly ? '+text-only' : ''}@${pid.split('@')[1] ?? ''}`;
  const perCall = Math.max(1, Math.floor(deps.perCall ?? deps.maxBatch));
  const batches = (xs: readonly JudgeSubject[]): JudgeSubject[][] => Array.from({ length: Math.ceil(xs.length / perCall) }, (_, k) => xs.slice(k * perCall, (k + 1) * perCall));
  /* A text-only model is asked about the words alone, and filed as such. */
  const asSent = (s: JudgeSubject): JudgeSubject => (textOnly ? { ...s, media: [] } : s);
  const inputTokens = (batch: readonly JudgeSubject[]): number => {
    const t = estimateTokens(deps.policy, batch.map(asSent), deps.question, examples, precedents);
    return t.inputTokens + (t.cacheWriteTokens ?? 0);
  };
  /* Each call's posts with their precedents cut to this judge's number and its window. */
  const fitted = (batch: readonly JudgeSubject[]): readonly JudgeSubject[] => (precedents ? fitPrecedents(batch, deps.policy, inputTokens) : batch);
  const estimateUsd = (batch: readonly JudgeSubject[]): number => {
    const t = estimateTokens(deps.policy, batch.map(asSent), deps.question, examples, precedents);
    return (usdAtListed(deps.model, t.inputTokens + (t.cacheWriteTokens ?? 0), t.outputTokens) ?? 0) * ESTIMATE_MARGIN;
  };
  const bookFor = (usd: number): PriceBook => ({
    [`${deps.vendor}:${endpoint}`]: { vendor: deps.vendor, endpoint, unit: 'per-call', usdPerUnit: usd, unitName: 'batched open-model judge call', measuredAt: 'estimated per call from the host model list prices' },
  });

  return {
    id,
    promptId: pid,
    maxBatch: deps.maxBatch,
    textOnly,

    estimate(subjects): CostEstimate {
      const parts = batches(subjects);
      return { vendor: deps.vendor, endpoint, unit: 'per-call', estUnits: parts.length, usd: parts.reduce((s, b) => s + estimateUsd(fitted(b)), 0) };
    },

    async judge(asked0, _budget) {
      const judgedAt = deps.now();
      const asked = asked0.map(asSent);
      /* Pictures first, before any money moves, by the live judge's rules — read side by side, not
         one after another: a batch of ten pictures read in turn was seconds of every shadow call. */
      const frames = new Map<string, Frame>();
      const unseen = new Set<string>();
      const pictured = new Set<string>();
      await Promise.all(asked.map(async (s) => {
        const uri = frameUriFor(s);
        if (uri === undefined) return;
        const frame = uri === null ? null : await deps.client.frame(uri);
        if (frame === null) unseen.add(String(s.storyId));
        else frames.set(String(s.storyId), frame);
      }));
      const subjects = asked.filter((s) => !unseen.has(String(s.storyId)));
      await Promise.all(subjects.map(async (s) => {
        const uri = pictureUriFor(s);
        if (uri === null) return;
        const picture = await deps.client.frame(uri);
        if (picture === null) return;
        frames.set(String(s.storyId), picture);
        pictured.add(String(s.storyId));
      }));
      const outcomes = new Map<string, JudgeOutcome>();
      for (const s of asked.filter((x) => unseen.has(String(x.storyId)))) outcomes.set(String(s.storyId), { kind: 'unavailable', storyId: s.storyId, detail: NO_FRAME });

      const spends: Spend[] = [];
      const ask = async (batch0: readonly JudgeSubject[]): Promise<void> => {
        const batch = fitted(batch0);
        const usd = estimateUsd(batch);
        const spec = { vendor: deps.vendor, endpoint, unit: 'per-call' as const, estUnits: 1, at: judgedAt };
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
          answered = toOutcomes(batch, firstAnswers(call.value.response.answers), { judgeId: id, promptId: pid, judgedAt, costUsdPerSubject: batch.length === 0 ? 0 : call.spend.usd / batch.length }, pictured);
        } catch (error) {
          if (error instanceof BudgetRefused) throw error;
          answered = allUnavailable(batch, error instanceof Error ? error.message : String(error));
        }
        batch.forEach((s, i) => {
          const o = answered[i];
          if (o !== undefined) outcomes.set(String(s.storyId), o);
        });
      };
      /* The calls of a round side by side, at most `parallel` at once; then the posts the model
         skipped or answered past the token limit asked again, alone among themselves (header). */
      let pending: readonly JudgeSubject[] = subjects;
      const began = deps.now();
      const inTime = (): boolean => deps.reaskWithinMs === undefined || deps.now() - began < deps.reaskWithinMs;
      for (let round = 0; round <= reask && pending.length > 0 && (round === 0 || inTime()); round += 1) {
        await inTurns(batches(pending), parallel, ask);
        pending = pending.filter((s) => SKIPPED.has((outcomes.get(String(s.storyId)) as { detail?: string } | undefined)?.detail ?? ''));
      }
      return {
        value: asked.map((s) => outcomes.get(String(s.storyId)) ?? { kind: 'unavailable', storyId: s.storyId, detail: 'no outcome' }),
        spend: mergeSpend(spends, { vendor: deps.vendor, endpoint, unit: 'per-call', estUnits: 1, at: judgedAt }, 'per-call'),
      };
    },
  };
}
