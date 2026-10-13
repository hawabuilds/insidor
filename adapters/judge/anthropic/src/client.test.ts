/**
 * THE JUDGE'S HTTP EDGE, AGAINST A FAKE TRANSPORT. No test here can reach the network: every
 * `fetch` is a function this file wrote, and every `sleep` returns at once.
 *
 * The cases are the ones that decide money and honesty: a good reply, a reply that does not
 * parse, a timeout, a rate limit, a missing key, the cap reached, and a dry run.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storyId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Budget } from '@insidor/contracts/ports/meter.ts';
import type { JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { inMemoryMeter } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';

import {
  JudgeNotConfigured,
  PROMPTS,
  anthropicJudge,
  buildRequestBody,
  decodeReply,
  httpClient,
  readJudgeSetup,
  type JudgeClientConfig,
} from './index.ts';

const AT = 1_800_000_000_000;
const P = DEFAULT_POLICY.judge;
const BUDGET: Budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 };

const subject = (token: string): JudgeSubject => ({
  storyId: storyId(token),
  texts: ['porch frog gerald is back', 'gerald again tonight'],
  media: [],
  distinctAuthors: 3,
  distinctSources: 2,
});

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A transport that answers from a script, one entry per request, and records what it was sent. */
function fakeFetch(script: readonly (() => Response | Promise<Response>)[]): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = script[calls.length - 1];
    if (next === undefined) throw new Error('fake fetch: no scripted response for this call');
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const reply = (answers: unknown, stop = 'end_turn'): unknown => ({
  stop_reason: stop,
  content: [{ type: 'text', text: JSON.stringify({ answers }) }],
  usage: { input_tokens: 1_200, output_tokens: 90 },
});

function config(fetch: typeof globalThis.fetch, over: Partial<JudgeClientConfig> = {}): JudgeClientConfig {
  return {
    apiKey: 'sk-test-not-a-real-key',
    baseUrl: 'https://judge.invalid',
    model: 'claude-haiku-4-5',
    maxOutputTokens: P.maxOutputTokens,
    effort: null,
    timeoutMs: P.timeoutMs,
    maxAttempts: P.maxAttempts,
    backoffMs: P.backoffMs,
    maxWaitMs: P.maxWaitMs,
    maxFrameBytes: P.maxFrameBytes,
    fetch,
    sleep: async () => {},
    ...over,
  };
}

const REQUEST = { system: 'sys', instructions: 'ins', subjects: [subject('a')], frames: new Map() };

/* ── configuration ────────────────────────────────────────────────────── */

test('a missing key is a configuration error at construction, not a vendor failure', () => {
  const { fetch, calls } = fakeFetch([]);
  assert.throws(() => httpClient(config(fetch, { apiKey: '' })), JudgeNotConfigured);
  assert.throws(() => httpClient(config(fetch, { apiKey: 'key\n' })), JudgeNotConfigured);
  assert.throws(() => httpClient(config(fetch, { model: '  ' })), JudgeNotConfigured);
  assert.equal(calls.length, 0, 'nothing was sent');
});

test('the setup reads dormant, priced, configured or misconfigured, with no default model', () => {
  assert.deepEqual(readJudgeSetup({}), { state: 'dormant' });
  assert.deepEqual(readJudgeSetup({ JUDGE_MODEL: 'claude-haiku-4-5' }), { state: 'priced', model: 'claude-haiku-4-5' });
  assert.equal(readJudgeSetup({ ANTHROPIC_API_KEY: 'k' }).state, 'misconfigured');
  assert.equal(readJudgeSetup({ ANTHROPIC_API_KEY: 'k', JUDGE_MODEL: 'm' }).state, 'configured');
});

/* ── the request ──────────────────────────────────────────────────────── */

test('the prompt files go in exactly as loaded, and only a video story carries an image', () => {
  const body = buildRequestBody(
    { model: 'claude-haiku-4-5', maxOutputTokens: P.maxOutputTokens, effort: null },
    {
      system: PROMPTS.system.text,
      instructions: PROMPTS['coinability-core'].text,
      subjects: [subject('a'), subject('b')],
      frames: new Map([[String(storyId('b')), { mediaType: 'image/jpeg' as const, base64: 'AAAA' }]]),
    },
  );
  assert.deepEqual(body['system'], [{ type: 'text', text: PROMPTS.system.text }]);
  const content = (body['messages'] as { content: { type: string; text?: string; cache_control?: unknown }[] }[])[0]?.content ?? [];
  assert.equal(content[0]?.text, PROMPTS['coinability-core'].text);
  assert.deepEqual(content[0]?.cache_control, { type: 'ephemeral' }, 'the fixed prefix ends at the instructions, marked for the cache');
  assert.equal(content.filter((c) => c.cache_control !== undefined).length, 1, 'nothing that varies per call carries the mark');
  assert.equal(content.filter((c) => c.type === 'image').length, 1);
  for (const key of ['"views"', '"likes"', '"reach"', '"shares"']) {
    assert.equal(content[1]?.text?.includes(key), false, `no attention counts are sent (${key})`);
  }
  assert.equal('effort' in ((body['output_config'] as Record<string, unknown>) ?? {}), false, 'Haiku takes no effort field');
});

/* ── replies ──────────────────────────────────────────────────────────── */

test('cache writes and reads are read off the usage apart from fresh input', () => {
  const res = decodeReply({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"answers": []}' }],
    usage: { input_tokens: 700, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_600 },
  });
  assert.deepEqual(res.usage, { inputTokens: 700, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 1_600 });
});

test('a good reply is decoded, with the usage the vendor reported', async () => {
  const { fetch, calls } = fakeFetch([() => json(200, reply([{ storyId: 'x', coinable: true }]))]);
  const res = await httpClient(config(fetch)).judge(REQUEST);
  assert.equal(res.answers.length, 1);
  assert.deepEqual(res.usage, { inputTokens: 1_200, outputTokens: 90, cacheWriteTokens: 0, cacheReadTokens: 0 });
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'sk-test-not-a-real-key');
  assert.equal(calls[0]?.url, 'https://judge.invalid/v1/messages');
});

test('a malformed, refused or truncated reply is no answers at all, never a guess, and is still billed', () => {
  for (const body of [
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answers": [{"storyId": "x", "coin' }], usage: { input_tokens: 5, output_tokens: 5 } },
    reply([{ storyId: 'x', coinable: true }], 'refusal'),
    reply([{ storyId: 'x', coinable: true }], 'max_tokens'),
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answers": "yes"}' }], usage: { input_tokens: 5, output_tokens: 5 } },
  ]) {
    const res = decodeReply(body);
    assert.deepEqual(res.answers, []);
    assert.ok(res.usage.inputTokens > 0, 'the tokens were billed either way');
  }
});

test('a rate limit is retried with backoff, honouring retry-after up to the ceiling', async () => {
  const waits: number[] = [];
  const { fetch, calls } = fakeFetch([
    () => json(429, { type: 'error' }, { 'retry-after': '3' }),
    () => json(529, { type: 'error' }),
    () => json(200, reply([])),
  ]);
  await httpClient(config(fetch, { sleep: async (ms) => void waits.push(ms) })).judge(REQUEST);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [3_000, P.backoffMs * 2]);
});

test('retries are bounded: past maxAttempts it is unavailable, and a 400 is never retried', async () => {
  const always = fakeFetch(Array.from({ length: P.maxAttempts }, () => () => json(503, {})));
  await assert.rejects(httpClient(config(always.fetch)).judge(REQUEST), VendorUnavailable);
  assert.equal(always.calls.length, P.maxAttempts);

  const bad = fakeFetch([() => json(400, { error: 'bad request' })]);
  await assert.rejects(httpClient(config(bad.fetch)).judge(REQUEST), VendorUnavailable);
  assert.equal(bad.calls.length, 1);
});

test('a timeout is a transport failure, retried and then unavailable', async () => {
  const timeout = (): never => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const { fetch, calls } = fakeFetch(Array.from({ length: P.maxAttempts }, () => timeout));
  await assert.rejects(httpClient(config(fetch)).judge(REQUEST), /gave up after/);
  assert.equal(calls.length, P.maxAttempts);
});

test('a frame is only ever a picture: a video file or a failed fetch is no frame', async () => {
  const { fetch } = fakeFetch([
    () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }),
    () => new Response('nope', { status: 404, headers: { 'content-type': 'image/jpeg' } }),
  ]);
  const client = httpClient(config(fetch));
  assert.equal((await client.frame('https://cdn.invalid/a.jpg'))?.mediaType, 'image/jpeg');
  assert.equal(await client.frame('https://cdn.invalid/a.mp4'), null);
  assert.equal(await client.frame('https://cdn.invalid/gone.jpg'), null);
  assert.equal(await client.frame('not a url'), null);
});

test('with a picture size set, the smaller picture is asked for first and the full one is the fallback', async () => {
  const { fetch, calls } = fakeFetch([
    () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response('gone', { status: 404, headers: { 'content-type': 'text/plain' } }),
    () => new Response(new Uint8Array([2]), { headers: { 'content-type': 'image/jpeg' } }),
  ]);
  const client = httpClient(config(fetch, { pictureSize: 'small' }));
  assert.ok(await client.frame('https://pbs.twimg.com/media/A.jpg'));
  assert.equal(calls[0]?.url, 'https://pbs.twimg.com/media/A.jpg?format=jpg&name=small');
  assert.ok(await client.frame('https://pbs.twimg.com/media/B.jpg'), 'a size that does not load is not a missing picture');
  assert.deepEqual(calls.slice(1).map((c) => c.url), ['https://pbs.twimg.com/media/B.jpg?format=jpg&name=small', 'https://pbs.twimg.com/media/B.jpg']);
});

/* ── money ────────────────────────────────────────────────────────────── */

const judgeWith = (fetch: typeof globalThis.fetch, capUsd: number) =>
  anthropicJudge({
    client: httpClient(config(fetch)),
    meter: inMemoryMeter({ dailyCapUsd: capUsd, softStop: 1, now: () => AT }),
    now: () => AT,
    model: 'claude-haiku-4-5',
    policy: P,
    maxBatch: DEFAULT_POLICY.qualify.batchSize,
  });

test('a call is recorded at what the vendor billed, and answers come back judged', async () => {
  const { fetch } = fakeFetch([() => json(200, reply([{ storyId: String(storyId('a')), coinable: true, proposedName: 'gerald', confidence: 0.8 }]))]);
  const res = await judgeWith(fetch, 1).judge([subject('a')], BUDGET);
  assert.equal(res.value[0]?.kind, 'judged');
  assert.equal(res.spend.usd, (1_200 / 1e6) * 1 + (90 / 1e6) * 5);
});

test('when the cap is reached the call is not made: BudgetRefused, and nothing is sent', async () => {
  const { fetch, calls } = fakeFetch([]);
  await assert.rejects(judgeWith(fetch, 0.000_001).judge([subject('a')], BUDGET), BudgetRefused);
  assert.equal(calls.length, 0);
});

test('a dry run prices the call and sends nothing, and needs no key to do it', () => {
  const judge = anthropicJudge({
    client: { judge: () => Promise.reject(new Error('a dry run must not call')), frame: () => Promise.reject(new Error('nor fetch')) },
    meter: inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT }),
    now: () => AT,
    model: 'claude-haiku-4-5',
    policy: P,
    maxBatch: DEFAULT_POLICY.qualify.batchSize,
  });
  const est = judge.estimate(Array.from({ length: 12 }, (_, i) => subject(`s${i}`)));
  assert.equal(est.estUnits, 2, 'twelve stories at ten a call is two calls');
  assert.ok(est.usd > 0);
  /* Pessimistic: at least the full output ceiling for each call. */
  assert.ok(est.usd >= 2 * (P.maxOutputTokens / 1e6) * 5);
});

test('a model with no price cannot build a judge', () => {
  assert.throws(
    () => anthropicJudge({ client: httpClient(config(fakeFetch([]).fetch)), meter: inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT }), now: () => AT, model: 'claude-unknown', policy: P, maxBatch: 1 }),
    /no price/,
  );
});

test('an error the vendor answered is recorded at $0; a lost reply is charged the estimate', async () => {
  const answered = fakeFetch(Array.from({ length: P.maxAttempts }, () => () => json(529, { type: 'error' })));
  const meterA = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const judgeA = anthropicJudge({ client: httpClient(config(answered.fetch)), meter: meterA, now: () => AT, model: 'claude-haiku-4-5', policy: P, maxBatch: 10 });
  const a = await judgeA.judge([subject('a')], BUDGET);
  assert.equal(a.value[0]?.kind, 'unavailable');
  assert.equal(meterA.spentUsd(), 0, 'nothing was billed, so nothing is booked');

  const lost = fakeFetch(Array.from({ length: P.maxAttempts }, () => () => { throw new DOMException('timeout', 'TimeoutError'); }));
  const meterB = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const judgeB = anthropicJudge({ client: httpClient(config(lost.fetch)), meter: meterB, now: () => AT, model: 'claude-haiku-4-5', policy: P, maxBatch: 10 });
  const b = await judgeB.judge([subject('a')], BUDGET);
  assert.equal(b.value[0]?.kind, 'unavailable');
  assert.ok(meterB.spentUsd() > 0, 'a reply that may have been billed is booked at the estimate');
});
