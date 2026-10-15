/**
 * THE OPEN-MODEL JUDGE AGAINST A FAKE HOST. No test here can reach the network: every `fetch` is
 * a function this file wrote, and every `sleep` returns at once — so the whole plumbing of the
 * open-model test is proven before anyone has a key or spends a cent.
 *
 * The cases that matter: the question sent is the live judge's, part for part (compared with the
 * Anthropic adapter's own body and with what its port really sends); the reply is read by the
 * live parser; a text-only model sees no picture and is filed as text; money is checked before a
 * call and recorded after it; and the key never appears in an error.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storyId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Budget } from '@insidor/contracts/ports/meter.ts';
import type { JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { anthropicJudge, buildRequestBody, type JudgeClient, type JudgeRequest } from '@insidor/judge-anthropic';
import { inMemoryMeter } from '@insidor/meter';
import { BudgetRefused, OutOfCredit, VendorUnavailable } from '@insidor/vendor-kit';

import { buildChatBody, closestModel, keyAllowance, decodeChatReply, openChatClient, openJudge, parseModels, promptFor, unfenced, type HostModel, type OpenChatConfig } from './index.ts';

const AT = 1_800_000_000_000;
const P = DEFAULT_POLICY.judge;
const BUDGET: Budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 };
const KEY = 'sk-or-test-not-a-real-key';

const subject = (token: string, over: Partial<JudgeSubject> = {}): JudgeSubject => ({
  storyId: storyId(token),
  texts: ['porch frog gerald is back'],
  media: [],
  distinctAuthors: 1,
  distinctSources: 1,
  ...over,
});
const pictured = (token: string): JudgeSubject => subject(token, { media: [{ kind: 'image', uri: `https://pics.invalid/${token}.jpg`, width: null, height: null, durationMs: null }] });
const video = (token: string, uri = `https://pics.invalid/${token}-cover.jpg`): JudgeSubject => subject(token, { media: [{ kind: 'video', uri, width: null, height: null, durationMs: 9_000 }] });

const MODEL: HostModel = { id: 'maker/vision-27b', vision: true, usdPerInputToken: 1e-7, usdPerOutputToken: 4e-7, contextLength: 131_072 };
const TEXT_MODEL: HostModel = { ...MODEL, id: 'maker/text-8b', vision: false };

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jpeg = (): Response => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
const chat = (answers: unknown, finish = 'stop', cost: number | null = 0.0004): unknown => ({
  choices: [{ finish_reason: finish, message: { role: 'assistant', content: JSON.stringify({ answers }) } }],
  usage: { prompt_tokens: 3_000, completion_tokens: 200, ...(cost === null ? {} : { cost }) },
});
const yes = (token: string, confidence = 0.9) => ({ storyId: String(storyId(token)), coinable: true, proposedName: 'GERALD', confidence, alternateNames: ['FROG'], subjectSpans: ['gerald'] });

/** A host that answers chat calls from a script, and every picture with a tiny jpeg. */
function fakeHost(script: readonly (() => Response)[]) {
  const calls: { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }[] = [];
  let n = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://pics.invalid/')) return u.includes('dead') ? new Response('gone', { status: 404 }) : jpeg();
    calls.push({ url: u, body: init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = script[n];
    n += 1;
    if (next === undefined) throw new Error('fake host: no scripted response');
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const config = (fetch: typeof globalThis.fetch, over: Partial<OpenChatConfig> = {}): OpenChatConfig => ({
  vendor: 'router', apiKey: KEY, baseUrl: 'https://router.invalid/api/v1', model: MODEL.id, vision: true,
  maxOutputTokens: P.postBatchMaxOutputTokens, timeoutMs: P.timeoutMs, maxAttempts: 3, backoffMs: 1, maxWaitMs: 1, maxFrameBytes: P.maxFrameBytes,
  fetch, sleep: async () => {}, ...over,
});

const textParts = (content: readonly { type: string; text?: string }[]): string[] => content.filter((c) => c.type === 'text').map((c) => c.text ?? '');

/* ── the question ─────────────────────────────────────────────────────── */

test('★ the prompt is exactly what the live judge port sends, for the post question with block and precedents, and for the kind question', async () => {
  const seen: JudgeRequest[] = [];
  const capture: JudgeClient = { async judge(r) { seen.push(r); return { answers: [], usage: { inputTokens: 0, outputTokens: 0 } }; }, frame: async () => null };
  const meter = inMemoryMeter({ dailyCapUsd: 10, softStop: 1, now: () => AT });
  const precedented = subject('p', { precedents: [{ ref: 'x:1', text: 'a cat with a job', label: 'meme', why: null }] });
  await anthropicJudge({ client: capture, meter, now: () => AT, model: 'claude-haiku-4-5', policy: P, maxBatch: 10, question: 'post', examples: 'BLOCK OF EXAMPLES', precedents: true }).judge([precedented], BUDGET);
  await anthropicJudge({ client: capture, meter, now: () => AT, model: 'claude-haiku-4-5', policy: P, maxBatch: 10, question: 'kind' }).judge([subject('k')], BUDGET);
  const post = promptFor('post', 'BLOCK OF EXAMPLES', true);
  assert.equal(post.system, seen[0]?.system);
  assert.equal(post.instructions, seen[0]?.instructions);
  assert.equal(post.precedentsIntro, seen[0]?.precedentsIntro);
  const kind = promptFor('kind', 'BLOCK OF EXAMPLES', true);
  assert.equal(kind.system, seen[1]?.system);
  assert.equal(kind.instructions, seen[1]?.instructions, 'the kind question carries no block');
  assert.equal(kind.precedentsIntro, seen[1]?.precedentsIntro);
});

test('★ every text part is the live body\'s, in the same order; each picture is the same bytes as an image_url part', () => {
  const request: JudgeRequest = {
    ...promptFor('post', 'BLOCK', true),
    subjects: [subject('a', { precedents: [{ ref: 'x:9', text: 'pygmy hippo', label: 'meme', why: 'a creature' }] }), pictured('b')],
    frames: new Map([[String(storyId('b')), { mediaType: 'image/jpeg' as const, base64: 'QUJD' }]]),
  };
  const live = buildRequestBody({ model: 'claude-haiku-4-5', maxOutputTokens: P.postBatchMaxOutputTokens, effort: null }, request);
  const open = buildChatBody({ model: MODEL.id, maxOutputTokens: P.postBatchMaxOutputTokens, vision: true }, request);
  const liveContent = (live['messages'] as { content: { type: string; text?: string }[] }[])[0]?.content ?? [];
  const messages = open['messages'] as { role: string; content: unknown }[];
  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[0]?.content, request.system);
  const openContent = messages[1]?.content as { type: string; text?: string; image_url?: { url: string } }[];
  assert.deepEqual(textParts(openContent), textParts(liveContent));
  assert.deepEqual(openContent.map((c) => c.type), liveContent.map((c) => (c.type === 'image' ? 'image_url' : c.type)), 'the same parts in the same order');
  assert.equal(openContent.find((c) => c.type === 'image_url')?.image_url?.url, 'data:image/jpeg;base64,QUJD');
  assert.equal(open['temperature'], 0);
  assert.equal(open['max_tokens'], P.postBatchMaxOutputTokens);
  assert.equal((open['response_format'] as { type: string }).type, 'json_schema');
});

test('a text-only model is sent no picture, and every story says it has none', () => {
  const request: JudgeRequest = { ...promptFor('post', null, false), subjects: [pictured('b')], frames: new Map([[String(storyId('b')), { mediaType: 'image/png' as const, base64: 'QQ==' }]]) };
  const content = (buildChatBody({ model: TEXT_MODEL.id, maxOutputTokens: 100, vision: false }, request)['messages'] as { content: unknown }[])[1]?.content as { type: string; text?: string }[];
  assert.equal(content.some((c) => c.type === 'image_url'), false);
  assert.ok(content.some((c) => c.text?.includes('"frame":"none"')));
});

/* ── the reply ────────────────────────────────────────────────────────── */

test('a reply is read by the live parser: a whole answer after a normal stop, with the host\'s cost', () => {
  const r = decodeChatReply(chat([yes('a')]));
  assert.equal(r.answers.length, 1);
  assert.deepEqual(r.usage, { inputTokens: 3_000, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0 });
  assert.equal(r.costUsd, 0.0004);
  assert.equal(decodeChatReply(chat([yes('a')], 'length')).answers.length, 0, 'cut off at the limit: no answers');
  assert.equal(decodeChatReply(chat([yes('a')], 'stop', null)).costUsd, null, 'no cost given: null, priced by the caller');
  const half = { choices: [{ finish_reason: 'stop', message: { content: '{"answers": [{"storyId": "a"' } }], usage: {} };
  assert.equal(decodeChatReply(half).answers.length, 0, 'nothing half-parsed is salvaged');
  const fenced = { choices: [{ finish_reason: 'stop', message: { content: '```json\n{"answers": []}\n```' } }], usage: {} };
  assert.deepEqual(decodeChatReply(fenced).answers, []);
  assert.equal(unfenced('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(unfenced('{"a":1}'), '{"a":1}');
});

/* ── the client ───────────────────────────────────────────────────────── */

test('429 and 5xx are retried, other errors are not, 402 is out of credit, and the key is in a header only', async () => {
  const ok = fakeHost([() => json(429, {}), () => json(503, {}), () => json(200, chat([yes('a')]))]);
  const r = await openChatClient(config(ok.fetch)).judge({ ...promptFor('post', null, false), subjects: [subject('a')], frames: new Map() });
  assert.equal(r.answers.length, 1);
  assert.equal(ok.calls.length, 3);
  assert.equal(ok.calls[0]?.headers['authorization'], `Bearer ${KEY}`);
  assert.equal(ok.calls[0]?.url.includes(KEY), false);

  const bad = fakeHost([() => json(400, { error: { message: 'bad' } })]);
  await assert.rejects(openChatClient(config(bad.fetch)).judge({ ...promptFor('post', null, false), subjects: [subject('a')], frames: new Map() }), (e: unknown) => e instanceof VendorUnavailable && e.status === 400 && !e.message.includes(KEY));
  assert.equal(bad.calls.length, 1);

  const broke = fakeHost([() => json(402, { error: { message: 'Insufficient credits' } })]);
  await assert.rejects(openChatClient(config(broke.fetch)).judge({ ...promptFor('post', null, false), subjects: [subject('a')], frames: new Map() }), OutOfCredit);

  const capped = fakeHost([() => json(403, { error: { message: 'Key limit exceeded (total limit).', code: 403 } })]);
  await assert.rejects(openChatClient(config(capped.fetch)).judge({ ...promptFor('post', null, false), subjects: [subject('a')], frames: new Map() }), OutOfCredit, 'a key capped at its limit is out of credit, not a bad answer');

  const inner = fakeHost([() => json(200, { error: { code: 400, message: 'provider refused' } })]);
  await assert.rejects(openChatClient(config(inner.fetch)).judge({ ...promptFor('post', null, false), subjects: [subject('a')], frames: new Map() }), (e: unknown) => e instanceof VendorUnavailable && e.status === 400);
});

test('no key is a configuration error before anything is sent', () => {
  const host = fakeHost([]);
  assert.throws(() => openChatClient(config(host.fetch, { apiKey: '' })), /not configured/);
  assert.equal(host.calls.length, 0);
});

/* ── the port ─────────────────────────────────────────────────────────── */

test('★ the port: ten a call, pictures shown, a dead video frame never sent, the host cost recorded on the meter', async () => {
  const subjects = [...Array.from({ length: 11 }, (_, i) => pictured(`s${i}`)), video('v', 'https://pics.invalid/dead.jpg')];
  const host = fakeHost([() => json(200, chat(Array.from({ length: 10 }, (_, i) => yes(`s${i}`)))), () => json(200, chat([yes('s10', 0.5)]))]);
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const judge = openJudge({ client: openChatClient(config(host.fetch)), meter, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, question: 'post' });
  const out = await judge.judge(subjects, BUDGET);
  assert.equal(host.calls.length, 2, 'ten posts a call');
  assert.equal(out.value.length, 12);
  assert.equal(out.value[11]?.kind, 'unavailable', 'a video with no frame is not sent');
  const first = out.value[0];
  assert.ok(first?.kind === 'judged' && first.judgement.lookedAt === 'picture' && first.judgement.judgeId.startsWith('judge:router/maker/vision-27b@'));
  assert.ok(Math.abs(meter.spentUsd('router') - 0.0008) < 1e-12, 'what the host said each call cost');
  const images = (host.calls[0]?.body?.['messages'] as { content: { type: string }[] }[])[1]?.content.filter((c) => c.type === 'image_url').length;
  assert.equal(images, 10);
});

test('a text-only model is filed as reading text, and says so in its id', async () => {
  const host = fakeHost([() => json(200, chat([yes('a')]))]);
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const judge = openJudge({ client: openChatClient(config(host.fetch, { vision: false, model: TEXT_MODEL.id })), meter, now: () => AT, model: TEXT_MODEL, vendor: 'router', policy: P, maxBatch: 10, question: 'post' });
  const out = await judge.judge([video('a')], BUDGET);
  assert.ok(judge.textOnly && judge.id.includes('+text-only'));
  assert.ok(out.value[0]?.kind === 'judged' && out.value[0].judgement.lookedAt === 'text');
});

test('a call the meter cannot cover is refused before it is sent; an answered error costs nothing', async () => {
  const host = fakeHost([() => json(400, {})]);
  const tiny = inMemoryMeter({ dailyCapUsd: 1e-9, softStop: 1, now: () => AT });
  await assert.rejects(openJudge({ client: openChatClient(config(host.fetch)), meter: tiny, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, question: 'post' }).judge([subject('a')], BUDGET), BudgetRefused);
  assert.equal(host.calls.length, 0);
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const out = await openJudge({ client: openChatClient(config(host.fetch)), meter, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, question: 'post' }).judge([subject('a')], BUDGET);
  assert.equal(out.value[0]?.kind, 'unavailable');
  assert.equal(meter.spentUsd('router'), 0);
});

/* ── the model list ───────────────────────────────────────────────────── */

test('the key allowance: what the host says is left, or null for no limit', async () => {
  const at = (body: unknown) => (async () => json(200, body)) as unknown as typeof globalThis.fetch;
  assert.deepEqual(await keyAllowance(at({ data: { limit_remaining: 0 } }), 'https://router.invalid/v1', KEY, 1000), { remainingUsd: 0 });
  assert.deepEqual(await keyAllowance(at({ data: { limit_remaining: null } }), 'https://router.invalid/v1', KEY, 1000), { remainingUsd: null });
});

test('the model list: vision and prices read; a missing id falls back only within its maker', () => {
  const models = parseModels({ data: [
    { id: 'google/gemma-3-27b-it', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0.00000008', completion: '0.00000045' }, context_length: 131072 },
    { id: 'google/gemma-3-12b-it', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0.00000005', completion: '0.00000015' } },
    { id: 'google/gemma-3-27b-it:free', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'meta-llama/llama-3-8b', architecture: { input_modalities: ['text'] }, pricing: { prompt: '0.0000001', completion: '0.0000001' } },
    { noid: true },
  ] });
  assert.equal(models.length, 4);
  assert.equal(models[0]?.vision, true);
  assert.equal(models[3]?.vision, false);
  assert.equal(models[0]?.usdPerInputToken, 8e-8);
  assert.equal(closestModel('google/gemma-3-27b-it', models)?.id, 'google/gemma-3-27b-it');
  assert.equal(closestModel('google/gemma-3-27b-instruct', models)?.id, 'google/gemma-3-27b-it');
  assert.equal(closestModel('qwen/qwen2.5-vl-72b-instruct', models), null, 'never a model from another maker');
});
