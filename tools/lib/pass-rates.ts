/**
 * JUDGE A SET OF POSTS EXACTLY AS THE LIVE FEED DOES, AND SAY WHICH PASS — the measuring half of
 * tools/feed-pass-rates.ts (by hand) and tools/retune.ts (twice a day), in one place so the gate a
 * re-tune is held to is the same gate the owner measures by hand.
 *
 * Each post is judged alone (one post a call, as the live scorer asks), with its text and its
 * picture, by the feed's post question with the given learned examples, and held to core's
 * `postScore`. The picture boost is applied as the projector applies it: the post's picture
 * against the coined pictures, a post never against its OWN coin's picture.
 *
 * ★ EVERY REPLY'S TOKENS ARE COUNTED, fresh input, cache writes and cache reads apart, so the
 * cost of a block of examples is measured, not guessed; prompt caching makes a long block mostly
 * cache reads after the first call.
 *
 * ★ `batch` SENDS EVERY POST AS ONE MESSAGE BATCH, at half price: the same request per post, so
 * the same answers, but minutes of waiting. Right for a run nobody watches.
 *
 * What breaks if changed carelessly: the judge must be the live one's question and output budget
 * (`post`, postBatchMaxOutputTokens). Grading with a different prompt than the feed's measures a
 * judge nobody runs.
 */

import { existsSync, readFileSync } from 'node:fs';

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import { storyId } from '../../contracts/src/ids.ts';
import type { JudgeOutcome } from '../../contracts/src/ports/judge.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import { postScore } from '../../core/src/qualify/post-score.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup, type JudgeClient, type JudgeRequest, type JudgeResponse } from '../../adapters/judge/anthropic/src/index.ts';
import { voyageEmbed, httpClient as voyageClient } from '../../adapters/embed/voyage/src/index.ts';
import { tuning } from '../../eval/src/gold/coin-origins.ts';
import { loadEvidence } from '../../eval/src/gold/coin-evidence.ts';

const P = DEFAULT_POLICY;

/** A post to grade. `group` is the caller's own name for the set it belongs to. */
export interface EvalPost<G extends string = string> {
  readonly group: G;
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly imageUri: string | null;
  /** The coin this post is the origin of, when it is one: its own picture is never its boost. Defaults to `id`. */
  readonly coinRef?: string;
}

export interface EvalRow<G extends string = string> extends EvalPost<G> {
  readonly coinable: boolean | null;
  readonly name: string | null;
  readonly confidence: number | null;
  readonly lookedAt: string | null;
  readonly passes: boolean;
}

export interface Usage {
  calls: number;
  pictures: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  inputWithPicture: number;
  inputWithout: number;
}

export interface GradeOptions {
  readonly env: Record<string, string | undefined>;
  readonly meter: Meter;
  readonly examples: string | null;
  readonly batch: boolean;
  /** Withhold the pictures (what the judge did before it was shown them). */
  readonly textOnly?: boolean;
  readonly pictureSize?: 'small' | '360x360' | null;
  /** The coined pictures for the boost; null leaves the boost out. */
  readonly coined: readonly { readonly coinRef: string; readonly uri: string; readonly v: readonly number[] }[] | null;
}

/** The judge as configured in this environment; throws when it is not. */
export function judgeSetup(env: Record<string, string | undefined>) {
  const setup = readJudgeSetup(env);
  if (setup.state !== 'configured') throw new Error(`the judge is ${setup.state}`);
  const price = priceFor(setup.model);
  if (price === null) throw new Error(`JUDGE_MODEL ${setup.model} has no price`);
  return { setup, price };
}

export async function gradePosts<G extends string>(posts: readonly EvalPost<G>[], o: GradeOptions): Promise<{ readonly rows: readonly EvalRow<G>[]; readonly used: Usage; readonly batched: boolean }> {
  const { setup, price } = judgeSetup(o.env);
  const http = judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.postBatchMaxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, pictureSize: o.pictureSize ?? null, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  /* Every reply's usage, summed, for the report. Read through, never changed. */
  const used: Usage = { calls: 0, pictures: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, inputWithPicture: 0, inputWithout: 0 };
  const count = (request: JudgeRequest, reply: JudgeResponse): void => {
    const pictured = request.subjects.filter((x) => request.frames.has(String(x.storyId))).length;
    const all = reply.usage.inputTokens + (reply.usage.cacheWriteTokens ?? 0) + (reply.usage.cacheReadTokens ?? 0);
    used.calls += 1;
    used.pictures += pictured;
    if (pictured > 0) used.inputWithPicture += all;
    else used.inputWithout += all;
    used.input += reply.usage.inputTokens;
    used.cacheWrite += reply.usage.cacheWriteTokens ?? 0;
    used.cacheRead += reply.usage.cacheReadTokens ?? 0;
    used.output += reply.usage.outputTokens;
  };
  const client: JudgeClient = {
    ...http,
    async judge(request) {
      const reply = await http.judge(request);
      count(request, reply);
      return reply;
    },
    async judgeBatch(requests) {
      const answers = await http.judgeBatch!(requests);
      answers.forEach((a, i) => {
        const request = requests[i];
        if (a.kind === 'answered' && request !== undefined) count(request, a.response);
      });
      return answers;
    },
  };
  const judge = anthropicJudge({ client, meter: o.meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1, question: 'post', examples: o.examples, batch: o.batch });

  /* Each post's own picture embedded, for the boost. */
  const postVectors = new Map<string, number[] | null>();
  if (o.coined !== null && o.textOnly !== true) {
    const embed = voyageEmbed({ client: voyageClient({ apiKey: (o.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: o.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter: o.meter, now: Date.now });
    for (const p of posts) {
      if (p.imageUri === null || postVectors.has(p.imageUri)) continue;
      const line = o.meter.line();
      const r = await embed.embedMedia!([{ kind: 'image', uri: p.imageUri, width: null, height: null, durationMs: null }], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + 60_000 });
      const v = r.value[0];
      postVectors.set(p.imageUri, v === null || v === undefined ? null : Array.from(v.values));
    }
  }
  const similarityOf = (p: EvalPost<G>): number | null => {
    const v = p.imageUri === null ? null : (postVectors.get(p.imageUri) ?? null);
    if (v === null || o.coined === null) return null;
    const others = o.coined.filter((c) => c.coinRef !== (p.coinRef ?? p.id) && c.uri !== p.imageUri);
    return others.length === 0 ? null : Math.max(...others.map((c) => c.v.reduce((s, x, i) => s + x * (v[i] ?? 0), 0)));
  };

  const subjectOf = (p: EvalPost<G>) => ({
    storyId: storyId(`rate-${p.id.replaceAll(':', '-')}`),
    texts: p.text.trim() === '' ? [] : [p.text.slice(0, P.judge.maxCharsPerText)],
    media: o.textOnly === true || p.imageUri === null ? [] : [{ kind: 'image' as const, uri: p.imageUri, width: null, height: null, durationMs: null }],
    distinctAuthors: 1,
    distinctSources: 1,
  });
  /* One post a call either way (maxBatch 1), as the live scorer asks; batched, all of them go in
     one judge() so they leave as one Message Batch. */
  const budget = () => ({ capUsd: o.meter.line().capUsd, spentUsd: o.meter.line().spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
  const outcomes: JudgeOutcome[] = [];
  /* Batched only when the whole batch's pessimistic estimate fits what is left of the line: a
     batch refused by the meter comes back unanswered whole, where single calls would get most of
     the way. */
  const whole = judge.estimate(posts.map(subjectOf));
  const batched = o.batch && whole.usd <= Math.min(o.meter.line().remainingUsd, o.meter.line(whole.vendor).remainingUsd);
  if (batched) outcomes.push(...(await judge.judge(posts.map(subjectOf), budget())).value);
  else for (const p of posts) outcomes.push(...(await judge.judge([subjectOf(p)], budget())).value);
  const rows = posts.map((p, i): EvalRow<G> => {
    const out = outcomes[i];
    const j = out?.kind === 'judged' ? out.judgement : null;
    return { ...p, coinable: j?.coinable ?? null, name: j?.proposedName ?? null, confidence: j?.confidence ?? null, lookedAt: j?.lookedAt ?? null, passes: j !== null && postScore(j, P, similarityOf(p)) === 'passes' };
  });
  return { rows, used, batched };
}

/** Passed of tested, for one group. A post the judge could not answer is tested and did not pass. */
export const rateOf = <G extends string>(rows: readonly EvalRow<G>[], g: G): { readonly passed: number; readonly tested: number } => {
  const of = rows.filter((r) => r.group === g);
  return { passed: of.filter((r) => r.passes).length, tested: of.length };
};

/** Each gold origin post's picture as the feed shows it, re-read by feed-pass-rates --refresh-pictures. */
export const GOLD_PICTURES = new URL('../../eval/src/feed/gold-origin-pictures.json', import.meta.url);

/**
 * The committed gold set's origin posts (eval/src/gold), each with the picture the feed would show.
 * The test for "yes": these should pass. Never the prompt's own examples.
 */
export function goldOriginPosts(): readonly EvalPost<'gold'>[] {
  const evidence = loadEvidence();
  const recorded = existsSync(GOLD_PICTURES) ? (JSON.parse(readFileSync(GOLD_PICTURES, 'utf8')) as { pictures: Record<string, string | null> }).pictures : {};
  return tuning().flatMap((c) => {
    const post = evidence.get(c.id)?.origin?.post ?? null;
    return post === null ? [] : [{ group: 'gold' as const, id: c.id, kind: 'origin', text: post.text, imageUri: recorded[post.postId] ?? post.imageUri }];
  });
}
