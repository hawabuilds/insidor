/**
 * JUDGE A SET OF POSTS EXACTLY AS THE LIVE FEED DOES, AND SAY WHICH PASS — the measuring half of
 * tools/feed-pass-rates.ts (by hand) and tools/retune.ts (twice a day), in one place so the gate a
 * re-tune is held to is the same gate the owner measures by hand.
 *
 * ★ ASKED EXACTLY AS LIVE ASKS (the owner's rule, 2026-10-13): the same number of posts per call
 * (`maxBatch`, the live scorer's Policy.qualify.batchSize unless a caller measures another), the
 * same picture size, the same answer budget per call, with the posts mixed across groups by a
 * hash of their ids the way a live call mixes whatever the feed held — a test that sent one post
 * a call measured a judge that answered ten at a time in production. Measured both ways on the
 * same 218 posts, rules alone, 2026-10-13: meme gold 20/39 either way, live non-memes 7/89 at ten
 * and 8/93 at one, and one a call cost 2.6 times as much ($0.50 against $0.19) — so ten, in both
 * places. Each post is judged with
 * its text and its picture, by the feed's post question with the given learned examples, held to
 * core's `postScore`. The picture boost is applied as the projector applies it: the post's picture
 * against the coined pictures, a post never against its OWN coin's picture.
 *
 * ★ EVERY REPLY'S TOKENS ARE COUNTED, fresh input, cache writes and cache reads apart, so the
 * cost of a block of examples is measured, not guessed; prompt caching makes a long block mostly
 * cache reads after the first call.
 *
 * ★ `batch` SENDS EVERY CALL AS ONE MESSAGE BATCH, at half price: the same requests as without it, so
 * the same answers, but minutes of waiting. Right for a run nobody watches.
 *
 * ★ THE OWNER'S LABELS AS PRECEDENT, AS LIVE (`precedents`): each test post sent with its closest
 * labelled posts and held when very close to a "not a meme" one, chosen by the same core functions
 * the live scorer uses, with a test post never its own precedent.
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
import { createHash } from 'node:crypto';

import { NOT_MEME_MATCH, heldKind } from '../../core/src/qualify/kinds.ts';
import { closestNot, embedInput, heldAsNotMeme, nearestLabelled, precedentsFor, type LabelledVector } from '../../core/src/qualify/precedents.ts';
import { postScore } from '../../core/src/qualify/post-score.ts';
import { BATCH_PRICE_FRACTION, anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup, type JudgeClient, type JudgeRequest, type JudgeResponse } from '../../adapters/judge/anthropic/src/index.ts';
import { POST_SPACE, SPACE as EMBED_SPACE, voyageEmbed, httpClient as voyageClient } from '../../adapters/embed/voyage/src/index.ts';
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
  /** The post's own id when `id` is not one (a gold sheet's coin id): never its own precedent. */
  readonly itemId?: string;
}

export interface EvalRow<G extends string = string> extends EvalPost<G> {
  readonly coinable: boolean | null;
  readonly name: string | null;
  readonly confidence: number | null;
  readonly lookedAt: string | null;
  /** The picture boost's input: the post's picture against the closest other coined picture; null without one. */
  readonly similarity: number | null;
  /** The first question passed (postScore with the picture boost), before the kind question. */
  readonly firstPass: boolean;
  /** The kind question's label, upper case: asked this run, or given in `knownKinds`; null when neither. */
  readonly postKind: string | null;
  /** Shown on the memes feed: the first question passed and the kind does not hold it back. */
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
  /** Refuse to start (LineTooShort) when what is left of the line cannot cover the whole test. */
  readonly mustFit?: boolean;
  /**
   * Ask the posts the first question passes the second — which kind of post — and hold back the
   * kinds the live feed holds back (Policy.judge.heldKinds). On unless false: a re-tune graded without the
   * live feed's second question measures a gate nobody runs.
   */
  readonly kind?: boolean;
  /** Ask the kind question of these posts too, passing or not (a gold post's kind decides which gate it counts in). */
  readonly kindAlso?: (p: EvalPost<string>) => boolean;
  /**
   * ★ PRECEDENTS, AS LIVE (services/runner work/precedents.ts): the owner's labelled posts with their
   * vectors (internal.label_embedding, `PgLabelEmbeddingRepo.all(POST_SPACE)`). Each test post is
   * embedded the same way (core `embedInput`; a post that is itself a label reuses that vector, so
   * nothing is paid twice), sent with its Policy.judge.precedents.k closest labels — never itself:
   * not its id, its own picture or its own words — and a post the first question passes that is
   * `holdNotSimilarity` close to a "not a meme" label is held as NOT_MEME_MATCH, as live holds it.
   * Absent: no precedents and no hold (the judge as it ran before 2026-10-13).
   */
  readonly precedents?: { readonly labels: readonly LabelledVector[] } | null;
  /** Kind labels already known, by post id (stored answers, or an earlier grading this run): not asked again. */
  readonly knownKinds?: ReadonlyMap<string, string>;
  /** The kinds held back from the memes feed; Policy.judge.heldKinds unless a caller measures another set. */
  readonly heldKinds?: readonly string[];
  /** Posts per judge call. Defaults to the live scorer's (Policy.qualify.batchSize). */
  readonly maxBatch?: number;
  /** The coined pictures for the boost; null leaves the boost out. */
  readonly coined: readonly { readonly coinRef: string; readonly uri: string; readonly v: readonly number[] }[] | null;
  /**
   * ★ NEVER PAY TWICE FOR A PICTURE. Vectors this caller already holds for these pictures: one found
   * here is not sent to the vendor. The caller decides what is safe to hold — the re-tune holds a
   * run's own vectors only, the span over which a re-embed was measured bit-identical.
   */
  readonly vectors?: {
    readonly stored: (uris: readonly string[], space: string) => Promise<ReadonlyMap<string, readonly number[]>>;
    /** A vector the vendor just returned, kept so the next run finds it. Failing to keep it costs a re-embed later, nothing else. */
    readonly keep: (postId: string, uri: string, space: string, values: readonly number[]) => Promise<void>;
  };
}

/** The line has less left than the test's pessimistic estimate: nothing was asked. */
export class LineTooShort extends Error {
  readonly remainingUsd: number;
  readonly neededUsd: number;
  constructor(remainingUsd: number, neededUsd: number) {
    super(`the line has $${remainingUsd.toFixed(2)} left and the test needs up to $${neededUsd.toFixed(2)}`);
    this.remainingUsd = remainingUsd;
    this.neededUsd = neededUsd;
  }
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
    maxFrameBytes: P.judge.maxFrameBytes, pictureSize: o.pictureSize === undefined ? LIVE_PICTURE_SIZE : o.pictureSize, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
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
  /* The live scorer's judge (services/runner/src/wiring.ts buildJudge): its batch size, and the
     per-post answer budget as the whole call's budget. */
  const maxBatch = o.maxBatch ?? P.qualify.batchSize;
  const policy = { ...P.judge, maxOutputTokens: P.judge.postBatchMaxOutputTokens };
  const withPrecedents = o.precedents !== undefined && o.precedents !== null && P.judge.precedents.k > 0;
  const judge = anthropicJudge({ client, meter: o.meter, now: Date.now, model: setup.model, policy, maxBatch, question: 'post', examples: o.examples, batch: o.batch, precedents: withPrecedents });
  /* Graded in a fixed mixed order (a hash of the id), answered back in the caller's order. */
  const order = posts.map((p, i) => ({ i, h: createHash('sha256').update(p.id).digest('hex') })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i)).map((x) => x.i);
  const chunks = <T,>(xs: readonly T[]): T[][] => Array.from({ length: Math.ceil(xs.length / maxBatch) }, (_, k) => xs.slice(k * maxBatch, (k + 1) * maxBatch));

  /* Each post's precedents and closeness to a "not a meme" label, filled below before any judging. */
  const near = new Map<string, { readonly precedents: ReturnType<typeof precedentsFor>; readonly closestNot: number | null }>();
  const subjectOf = (p: EvalPost<G>) => {
    const precedents = near.get(p.id)?.precedents ?? [];
    return {
      storyId: storyId(`rate-${p.id.replaceAll(':', '-')}`),
      texts: p.text.trim() === '' ? [] : [p.text.slice(0, P.judge.maxCharsPerText)],
      media: o.textOnly === true || p.imageUri === null ? [] : [{ kind: 'image' as const, uri: p.imageUri, width: null, height: null, durationMs: null }],
      distinctAuthors: 1,
      distinctSources: 1,
      ...(precedents.length === 0 ? {} : { precedents }),
    };
  };
  /* `maxBatch` posts a call either way, as the live scorer asks; batched, all of them go in one
     judge() so they leave as one Message Batch of such calls. */
  const budget = () => ({ capUsd: o.meter.line().capUsd, spentUsd: o.meter.line().spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
  const outcomes: JudgeOutcome[] = [];
  /* Batched only when the whole batch's pessimistic estimate fits what is left of the line: a
     batch refused by the meter comes back unanswered whole, where single calls would get most of
     the way. */
  const whole = judge.estimate(posts.map(subjectOf));
  const remaining = Math.min(o.meter.line().remainingUsd, o.meter.line(whole.vendor).remainingUsd);
  const batched = o.batch && whole.usd * BATCH_PRICE_FRACTION <= remaining;
  /* A test the line cannot cover is not started: a run that dribbles one call at a time as the
     ledger frees a cent grades a handful of posts in an hour and says nothing. */
  /* The second question is asked only of the posts the first passes (half again over the first
     question's estimate covers it with room) — or of every post `kindAlso` names (twice). */
  const kindShare = o.kind === false ? 1 : o.kindAlso === undefined ? 1.5 : 2;
  if (o.mustFit === true && (batched ? whole.usd * BATCH_PRICE_FRACTION : whole.usd) * kindShare > remaining) {
    throw new LineTooShort(remaining, whole.usd * (o.batch ? BATCH_PRICE_FRACTION : 1) * kindShare);
  }

  /* Each post's own picture embedded, for the boost. */
  const postVectors = new Map<string, number[] | null>();
  if (o.coined !== null && o.textOnly !== true) {
    const embed = voyageEmbed({ client: voyageClient({ apiKey: (o.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: o.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter: o.meter, now: Date.now });
    const uris = [...new Set(posts.flatMap((p) => (p.imageUri === null ? [] : [p.imageUri])))];
    const stored = o.vectors === undefined ? new Map<string, readonly number[]>() : await o.vectors.stored(uris, EMBED_SPACE).catch(() => new Map<string, readonly number[]>());
    for (const [uri, v] of stored) postVectors.set(uri, [...v]);
    for (const p of posts) {
      if (p.imageUri === null || postVectors.has(p.imageUri)) continue;
      const line = o.meter.line();
      const r = await embed.embedMedia!([{ kind: 'image', uri: p.imageUri, width: null, height: null, durationMs: null }], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + 60_000 });
      const v = r.value[0];
      postVectors.set(p.imageUri, v === null || v === undefined ? null : Array.from(v.values));
      if (v !== null && v !== undefined && o.vectors !== undefined) await o.vectors.keep(p.id, p.imageUri, v.space, Array.from(v.values)).catch(() => undefined);
    }
  }
  const similarityOf = (p: EvalPost<G>): number | null => {
    const v = p.imageUri === null ? null : (postVectors.get(p.imageUri) ?? null);
    if (v === null || o.coined === null) return null;
    const others = o.coined.filter((c) => c.coinRef !== (p.coinRef ?? p.id) && c.uri !== p.imageUri);
    return others.length === 0 ? null : Math.max(...others.map((c) => c.v.reduce((s, x, i) => s + x * (v[i] ?? 0), 0)));
  };

  /* ★ PRECEDENTS, before the first call — see GradeOptions.precedents. */
  if (withPrecedents) {
    const labels = o.precedents!.labels;
    const norm = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase();
    const selfOf = (p: EvalPost<G>) => {
      const ids = new Set([p.id, p.itemId ?? p.id]);
      const words = norm(embedInput(p.text, null, P).text);
      return (l: LabelledVector): boolean => ids.has(l.itemId) || (p.imageUri !== null && l.picture === p.imageUri) || (words !== '' && norm(l.text) === words);
    };
    const inputOf = (p: EvalPost<G>) => embedInput(p.text, o.textOnly === true ? null : p.imageUri, P);
    /* A post that is itself a label, embedded from the same words and picture, has that vector. */
    const vectors = new Map<string, ArrayLike<number>>();
    for (const p of posts) {
      const input = inputOf(p);
      const own = labels.find((l) => (l.itemId === p.id || l.itemId === p.itemId) && l.text === input.text && (l.picture ?? null) === input.picture);
      if (own !== undefined) vectors.set(p.id, own.values);
    }
    const ask = posts.filter((p) => !vectors.has(p.id) && (inputOf(p).text !== '' || inputOf(p).picture !== null));
    if (ask.length > 0) {
      const embed = voyageEmbed({ client: voyageClient({ apiKey: (o.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: o.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter: o.meter, now: Date.now });
      for (let k = 0; k < ask.length; k += embed.maxBatch) {
        const part = ask.slice(k, k + embed.maxBatch);
        const line = o.meter.line();
        const r = await embed.embedPosts!(part.map(inputOf), { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
        part.forEach((p, j) => {
          const v = r.value[j];
          if (v !== null && v !== undefined && v.space === POST_SPACE) vectors.set(p.id, v.values);
        });
      }
    }
    for (const p of posts) {
      const v = vectors.get(p.id);
      if (v === undefined) continue;
      const self = selfOf(p);
      near.set(p.id, { precedents: precedentsFor(nearestLabelled(v, labels, P.judge.precedents.k, self), P), closestNot: closestNot(v, labels, self)?.similarity ?? null });
    }
  }

  const mixed = order.map((i) => posts[i]!);
  if (batched) outcomes.push(...(await judge.judge(mixed.map(subjectOf), budget())).value);
  else for (const part of chunks(mixed)) outcomes.push(...(await judge.judge(part.map(subjectOf), budget())).value);
  const outcomeOf = new Map(order.map((i, k) => [i, outcomes[k]]));
  /* ★ ASKED AGAIN ONCE, AS LIVE ASKS AGAIN NEXT PASS. A call whose answer is cut off at the output
     budget comes back unanswered whole; the live scorer leaves those posts unjudged and asks them
     on its next pass. Measured 2026-10-13 at ten a call: 14 of 218 posts came back unanswered the
     first time. Without this the test would grade an outage the feed does not have, and a re-tune
     would never apply (an unanswered post blocks it). */
  const again = order.filter((i) => outcomeOf.get(i)?.kind !== 'judged');
  if (again.length > 0) {
    const retried: JudgeOutcome[] = [];
    if (batched) retried.push(...(await judge.judge(again.map((i) => subjectOf(posts[i]!)), budget())).value);
    else for (const part of chunks(again)) retried.push(...(await judge.judge(part.map((i) => subjectOf(posts[i]!)), budget())).value);
    again.forEach((i, k) => {
      if (retried[k]?.kind === 'judged') outcomeOf.set(i, retried[k]);
    });
  }
  const rows = posts.map((p, i): EvalRow<G> => {
    const out = outcomeOf.get(i);
    const j = out?.kind === 'judged' ? out.judgement : null;
    const firstPass = j !== null && postScore(j, P, similarityOf(p)) === 'passes';
    /* Held as live holds it: a post the first question passed, close to a "not a meme" label. */
    const notMatch = firstPass && heldAsNotMeme(near.get(p.id)?.closestNot ?? null, P);
    return { ...p, coinable: j?.coinable ?? null, name: j?.proposedName ?? null, confidence: j?.confidence ?? null, lookedAt: j?.lookedAt ?? null, similarity: similarityOf(p), firstPass, postKind: notMatch ? NOT_MEME_MATCH : (o.knownKinds?.get(p.id) ?? null), passes: firstPass && !notMatch };
  });
  if (o.kind !== false) {
    const kindJudge = anthropicJudge({ client, meter: o.meter, now: Date.now, model: setup.model, policy, maxBatch, question: 'kind', batch: batched });
    const asked = order.filter((i) => {
      const r = rows[i]!;
      return r.postKind === null && r.coinable !== null && (r.firstPass || o.kindAlso?.(r) === true);
    });
    const kinds: JudgeOutcome[] = [];
    if (batched) kinds.push(...(await kindJudge.judge(asked.map((i) => subjectOf(rows[i]!)), budget())).value);
    else for (const part of chunks(asked)) kinds.push(...(await kindJudge.judge(part.map((i) => subjectOf(rows[i]!)), budget())).value);
    asked.forEach((i, k) => {
      const out = kinds[k];
      const kind = out?.kind === 'judged' ? (out.judgement.proposedName ?? '').trim().toUpperCase() : '';
      if (kind !== '') rows[i] = { ...rows[i]!, postKind: kind };
    });
    /* Held back as the live feed holds back: Policy.judge.heldKinds, or the set a caller measures. */
    rows.forEach((r, i) => {
      if (heldKind(r.postKind, o.heldKinds ?? P.judge.heldKinds) !== null) rows[i] = { ...r, passes: false };
    });
  }
  return { rows, used, batched };
}

/** Passed of tested, for one group. A post the judge could not answer is tested and did not pass. */
export const rateOf = <G extends string>(rows: readonly EvalRow<G>[], g: G): { readonly passed: number; readonly tested: number } => {
  const of = rows.filter((r) => r.group === g);
  return { passed: of.filter((r) => r.passes).length, tested: of.length };
};

/** The posts the owner put in hand gold by hand (eval/src/gold/hand-gold.json): an approved recall addition, or a post we hold. */
export const HAND_GOLD = new URL('../../eval/src/gold/hand-gold.json', import.meta.url);
export function handGoldIds(): ReadonlySet<string> {
  return new Set((JSON.parse(readFileSync(HAND_GOLD, 'utf8')) as { itemIds: string[] }).itemIds);
}

/** The live scorer's picture size (services/runner/src/wiring.ts buildJudge). */
const LIVE_PICTURE_SIZE = 'small' as const;

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
