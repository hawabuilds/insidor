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

import { DEFAULT_OPEN_PROVIDERS, KNOWN_MODELS, accountCredits, answerCapProblem, answerSide, readPostFirst, readOpenJudgeBackupSetup, routerFields, vendorOfHost, buildChatBody, closestModel, firstAnswers, rotated, isOpenJudgeId, keyAllowance, decodeChatReply, openChatClient, openJudge, openProviders, parseModels, promptFor, readOpenJudgeSetup, unfenced, type HostModel, type OpenChatConfig } from './index.ts';

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
  assert.deepEqual(open['provider'], { require_parameters: true });
  /* Named providers: only those, in that order, and no hand-off by the router. */
  assert.deepEqual(buildChatBody({ model: MODEL.id, maxOutputTokens: 10, vision: true, providers: ['nextbit', 'deepinfra'] }, request)['provider'], { require_parameters: true, order: ['nextbit', 'deepinfra'], allow_fallbacks: false });
});

test('OPEN_JUDGE_PROVIDERS: unset is the default order, blank lets the router choose; no key is dormant', () => {
  assert.deepEqual(openProviders({}), DEFAULT_OPEN_PROVIDERS);
  /* 2026-10-20: NextBit is gone from the router's list and Crusoe takes one picture a prompt (setup.ts). */
  assert.deepEqual(DEFAULT_OPEN_PROVIDERS, ['deepinfra']);
  assert.deepEqual(openProviders({ OPEN_JUDGE_PROVIDERS: ' ' }), []);
  assert.deepEqual(openProviders({ OPEN_JUDGE_PROVIDERS: 'a, b' }), ['a', 'b']);
  assert.deepEqual(readOpenJudgeSetup({}), { state: 'dormant' });
  const s = readOpenJudgeSetup({ OPENROUTER_API_KEY: 'k' });
  assert.equal(s.state === 'configured' && s.model, 'google/gemma-3-27b-it');
  assert.equal(isOpenJudgeId('judge:openrouter/google/gemma-3-27b-it@x'), true);
  assert.equal(isOpenJudgeId('judge:anthropic/claude-haiku-4-5@x'), false);
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

test("the account's credits: bought minus spent; a missing number or a refusal throws, never $0", async () => {
  const seen: string[] = [];
  const at = (status: number, body: unknown) => (async (url: string, init?: RequestInit) => (seen.push(`${url} ${new Headers(init?.headers).get('authorization')}`), json(status, body))) as unknown as typeof globalThis.fetch;
  /* The same body answers both reads here: no key cap in it, so what can be spent is the account's. */
  assert.deepEqual(await accountCredits(at(200, { data: { total_credits: 25, total_usage: 21.75 } }), 'https://router.invalid/v1/', KEY, 1000), { totalUsd: 25, usedUsd: 21.75, remainingUsd: 3.25, keyRemainingUsd: null, spendableUsd: 3.25 });
  assert.deepEqual(seen.sort(), [`https://router.invalid/v1/credits Bearer ${KEY}`, `https://router.invalid/v1/key Bearer ${KEY}`]);
  await assert.rejects(accountCredits(at(200, { data: { total_credits: 25 } }), 'https://router.invalid/v1', KEY, 1000), /without both numbers/);
  await assert.rejects(accountCredits(at(401, {}), 'https://router.invalid/v1', KEY, 1000), /answered 401/);
});

test("★ the key's own cap binds before the account: what can be spent is the lower of the two", async () => {
  const host = (async (url: string) =>
    String(url).endsWith('/credits') ? json(200, { data: { total_credits: 10, total_usage: 3.03 } }) : json(200, { data: { limit: 5, limit_remaining: 1.97 } })) as unknown as typeof globalThis.fetch;
  const c = await accountCredits(host, 'https://router.invalid/api/v1', KEY, 1000);
  assert.ok(Math.abs(c.remainingUsd - 6.97) < 1e-9);
  assert.equal(c.keyRemainingUsd, 1.97);
  assert.equal(c.spendableUsd, 1.97);
  const keyDown = (async (url: string) => (String(url).endsWith('/credits') ? json(200, { data: { total_credits: 10, total_usage: 3 } }) : json(500, {}))) as unknown as typeof globalThis.fetch;
  const d = await accountCredits(keyDown, 'https://router.invalid/api/v1', KEY, 1000);
  assert.equal(d.keyRemainingUsd, null);
  assert.equal(d.spendableUsd, 7, 'an unread key cap leaves the account');
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

/* ── how the open judge asks (Policy.judge.open, 2026-10-16) ──────────── */

/** The story ids a chat body asks about, from its stories JSON part. */
const askedIn = (body: Record<string, unknown> | null): string[] => {
  const parts = (body?.['messages'] as { content: unknown }[])[1]?.content as { type: string; text?: string }[];
  const stories = parts.find((p) => p.type === 'text' && (p.text ?? '').startsWith('Stories to judge'))?.text ?? '';
  return (JSON.parse(stories.slice(stories.indexOf('\n') + 1)) as { storyId: string }[]).map((s) => s.storyId);
};

/** An answer for an id as the request spelt it. */
const ans = (id: string) => ({ ...yes('x'), storyId: id });

/** A host that answers each chat call from what it was asked, and counts how many were open at once. */
function answeringHost(answer: (ids: string[], n: number) => Response) {
  const calls: { body: Record<string, unknown> | null }[] = [];
  let open = 0;
  let widest = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://pics.invalid/')) return jpeg();
    const body = init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>);
    const n = calls.length;
    calls.push({ body });
    open += 1;
    widest = Math.max(widest, open);
    await new Promise((r) => setTimeout(r, 5));
    open -= 1;
    return answer(askedIn(body), n);
  }) as typeof globalThis.fetch;
  return { fetch, calls, widest: () => widest };
}

test('★ a batch of ten goes as two calls of five side by side, and the posts a reply skipped are asked again once', async () => {
  const subjects = Array.from({ length: 10 }, (_, i) => subject(`p${i}`));
  /* The first replies skip the second post of each call, as Gemma skipped text posts among pictured ones. */
  const host = answeringHost((ids, n) => json(200, chat((n < 2 ? ids.filter((_, k) => k !== 1) : ids).map(ans))));
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const judge = openJudge({ client: openChatClient(config(host.fetch, { answerTokensPerSubject: 150 })), meter, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, perCall: 5, parallel: 4, reask: 1, question: 'post' });
  assert.equal(judge.maxBatch, 10, 'the feed still hands it ten');
  const out = await judge.judge(subjects, BUDGET);
  assert.equal(host.calls.length, 3, 'two calls of five, then one for the two skipped');
  assert.equal(host.widest(), 2, 'the two calls of the first round were in flight together');
  assert.deepEqual(askedIn(host.calls[2]!.body), [String(storyId('p1')), String(storyId('p6'))]);
  assert.ok(out.value.every((o) => o.kind === 'judged'), 'every post answered');
  assert.equal(host.calls[0]?.body?.['max_tokens'], 900, '150 a post, one post spare');
  assert.equal(host.calls[2]?.body?.['max_tokens'], 450);
});

test('a re-ask round is not started once the batch is past reaskWithinMs; without reask a skipped post stays unanswered', async () => {
  let t = AT;
  const host = answeringHost((ids) => {
    t += 60_000;
    return json(200, chat(ids.slice(1).map(ans)));
  });
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const late = openJudge({ client: openChatClient(config(host.fetch)), meter, now: () => t as never, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, perCall: 5, reask: 1, reaskWithinMs: 45_000, question: 'post' });
  const out = await late.judge([subject('a'), subject('b')], BUDGET);
  assert.equal(host.calls.length, 1);
  assert.equal(out.value[0]?.kind === 'unavailable' && out.value[0].detail, 'no answer for this subject');
  const none = openJudge({ client: openChatClient(config(host.fetch)), meter, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, question: 'post' });
  await none.judge([subject('a'), subject('b')], BUDGET);
  assert.equal(host.calls.length, 2, 'reask absent: one call only');
});

test('★ a repeated answer for a post does not overwrite its first one', async () => {
  const host = answeringHost((ids) => json(200, chat([...ids.map(ans), { ...ans(ids[0]!), coinable: false, proposedName: null, confidence: 0.1 }])));
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const out = await openJudge({ client: openChatClient(config(host.fetch)), meter, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, question: 'post' }).judge([subject('a'), subject('b')], BUDGET);
  assert.ok(out.value[0]?.kind === 'judged' && out.value[0].judgement.coinable === true);
  assert.deepEqual(firstAnswers([{ storyId: 'x', n: 1 }, { storyId: 'x', n: 2 }, 'junk', { storyId: 'y' }]), [{ storyId: 'x', n: 1 }, 'junk', { storyId: 'y' }]);
});

test('★ each retry asks the next pinned provider first; the router may still move down the list', async () => {
  assert.deepEqual(rotated(['nextbit', 'deepinfra'], 0), ['nextbit', 'deepinfra']);
  assert.deepEqual(rotated(['nextbit', 'deepinfra'], 1), ['deepinfra', 'nextbit']);
  assert.deepEqual(rotated(['a', 'b', 'c'], 4), ['b', 'c', 'a']);
  assert.deepEqual(rotated([], 3), []);
  const host = fakeHost([() => json(429, { error: { message: 'rate-limited upstream' } }), () => json(200, chat([yes('a')]))]);
  const client = openChatClient(config(host.fetch, { providers: ['nextbit', 'deepinfra'] }));
  await client.judge({ system: 's', instructions: 'i', subjects: [subject('a')], frames: new Map() });
  const order = (n: number) => (host.calls[n]?.body?.['provider'] as { order: string[] }).order;
  assert.deepEqual(order(0), ['nextbit', 'deepinfra']);
  assert.deepEqual(order(1), ['deepinfra', 'nextbit']);
});

/* ── the backup judge (2026-10-16) ────────────────────────────────────── */

test('★ the backup: its own key (or TOGETHER_API_KEY) on its own host, never the router; no key, no backup', () => {
  assert.deepEqual(readOpenJudgeBackupSetup({ OPENROUTER_API_KEY: 'or-key' }), { state: 'dormant' }, 'the router key alone is no backup');
  const together = readOpenJudgeBackupSetup({ OPENROUTER_API_KEY: 'or-key', TOGETHER_API_KEY: 'tg-key' });
  assert.ok(together.state === 'configured');
  assert.equal(together.apiKey, 'tg-key');
  assert.equal(together.baseUrl, 'https://api.together.xyz/v1');
  assert.equal(together.vendor, 'together');
  assert.equal(together.model, 'nvidia/NVIDIA-Nemotron-3.5-Super-VL');
  assert.equal(together.router, false);
  assert.deepEqual(together.providers, []);
  assert.ok(KNOWN_MODELS.some((m) => m.id === together.model && m.vision), 'the default backup is priced and reads pictures');
  const own = readOpenJudgeBackupSetup({ TOGETHER_API_KEY: 'tg-key', OPEN_JUDGE_BACKUP_API_KEY: 'own', OPEN_JUDGE_BACKUP_BASE_URL: 'https://api.deepinfra.com/v1/openai', OPEN_JUDGE_BACKUP_MODEL: 'google/gemma-3-27b-it' });
  assert.ok(own.state === 'configured' && own.apiKey === 'own' && own.vendor === 'deepinfra' && own.model === 'google/gemma-3-27b-it');
  assert.equal(vendorOfHost('not a url'), 'backup');
});

test('★ the second host answers the post question first unless told the router; each model keeps its cutoff place either way', () => {
  assert.equal(readPostFirst({}), 'second');
  assert.equal(readPostFirst({ OPEN_JUDGE_POST_FIRST: ' Router ' }), 'router');
  assert.equal(readPostFirst({ OPEN_JUDGE_POST_FIRST: 'anything else' }), 'second');
  assert.deepEqual(answerSide('judge:together/nvidia/NVIDIA-Nemotron-3.5-Super-VL+text-only@p1'), { model: 'judge:together/nvidia/NVIDIA-Nemotron-3.5-Super-VL', place: 'primary' });
  assert.deepEqual(answerSide('judge:openrouter/google/gemma-3-27b-it@p1'), { model: 'judge:openrouter/google/gemma-3-27b-it', place: 'fallback' });
  assert.deepEqual(answerSide('judge:together/google/gemma-4-31B-it@p1'), { model: 'judge:together/google/gemma-4-31B-it', place: null });
  assert.deepEqual(answerSide('rule:not-meme-match@0.67'), { model: null, place: null });
  assert.equal(isOpenJudgeId('judge:together/nvidia/NVIDIA-Nemotron-3.5-Super-VL@p1'), true);
});

test('a host of its own is sent the plain chat body: no provider pin, no usage request, the same answer shape', () => {
  const req: JudgeRequest = { system: 's', instructions: 'i', subjects: [subject('a')], frames: new Map() };
  const routed = buildChatBody({ model: 'm', maxOutputTokens: 100, vision: true, providers: ['p'] }, req);
  assert.ok('provider' in routed && 'usage' in routed);
  const own = buildChatBody({ model: 'm', maxOutputTokens: 100, vision: true, providers: [], router: false }, req);
  assert.ok(!('provider' in own) && !('usage' in own));
  assert.deepEqual(own['response_format'], routed['response_format']);
  /* Its one field: thinking off, or a thinking model spends the answer budget before it answers. */
  assert.deepEqual(routerFields(false, ['p']), { reasoning: { enabled: false } });
  assert.ok(!('reasoning' in routed));
});

/* ── the answer cap ───────────────────────────────────────────────────── */

test('★ a body with no answer cap, or one above the client\'s budget, is refused before anything is sent', async () => {
  assert.equal(answerCapProblem({ max_tokens: 1_200 }, 1_200), null);
  assert.match(answerCapProblem({}, 1_200) ?? '', /not set/);
  assert.match(answerCapProblem({ max_tokens: 0 }, 1_200) ?? '', /is 0/);
  assert.match(answerCapProblem({ max_tokens: 2.5 }, 1_200) ?? '', /whole number/);
  assert.match(answerCapProblem({ max_tokens: 1_201 }, 1_200) ?? '', /over this client's 1200/);
  const host = fakeHost([() => json(200, chat([]))]);
  const client = openChatClient(config(host.fetch, { maxOutputTokens: 300 }));
  await assert.rejects(client.send({ model: MODEL.id, messages: [] }), /refused before sending: max_tokens is not set/);
  await assert.rejects(client.send({ model: MODEL.id, max_tokens: 301, messages: [] }), /over this client's 300/);
  assert.equal(host.calls.length, 0, 'nothing reached the host');
});

test('★ every post-judge call carries a cap no bigger than the client\'s, sized to the batch', async () => {
  const host = answeringHost((ids) => json(200, chat(ids.map(ans))));
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const judge = openJudge({ client: openChatClient(config(host.fetch, { answerTokensPerSubject: P.open.answerTokensPerPost })), meter, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, perCall: 10, question: 'post' });
  await judge.judge(Array.from({ length: 10 }, (_, i) => subject(`c${i}`)), BUDGET);
  await judge.judge([subject('one')], BUDGET);
  const caps = host.calls.map((c) => c.body?.['max_tokens']);
  assert.deepEqual(caps, [Math.min(P.postBatchMaxOutputTokens, P.open.answerTokensPerPost * 11), P.open.answerTokensPerPost * 2]);
});

test('★ an answer cut off at the cap is no verdict: its posts are asked again, then left unavailable, and the call is still booked', async () => {
  /* A cut-off reply whose text happens to parse: the stop reason alone decides, so nothing half-written is filed. */
  const host = answeringHost((ids) => json(200, chat(ids.map(ans), 'length', 0.0006)));
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const judge = openJudge({ client: openChatClient(config(host.fetch)), meter, now: () => AT, model: MODEL, vendor: 'router', policy: P, maxBatch: 10, perCall: 5, reask: 1, question: 'post' });
  const out = await judge.judge([subject('a'), subject('b')], BUDGET);
  assert.equal(host.calls.length, 2, 'asked, then asked again once');
  assert.ok(out.value.every((o) => o.kind === 'unavailable'), 'no post was judged from a cut-off answer');
  assert.ok(Math.abs(out.spend.usd - 0.0012) < 1e-9, 'both calls were billed and both are booked');
});

test('★ with linkPictures a public X picture is checked by its first byte and sent as its address; any other host still as bytes', async () => {
  const asked: { url: string; range: string | null }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), range: new Headers(init?.headers).get('range') });
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }) as typeof globalThis.fetch;
  const base = { vendor: 'router', apiKey: 'k', baseUrl: 'https://router.invalid/api/v1', model: 'm', vision: true, maxOutputTokens: 100, timeoutMs: 1_000, maxAttempts: 1, backoffMs: 1, maxWaitMs: 1, maxFrameBytes: 1_000_000, fetch, sleep: async () => {} };
  const linked = openChatClient({ ...base, linkPictures: true });
  const x = await linked.frame('https://pbs.twimg.com/media/abc.jpg');
  assert.equal(x?.url, 'https://pbs.twimg.com/media/abc.jpg');
  assert.equal(x?.base64, '');
  assert.equal(asked[0]?.range, 'bytes=0-0', 'only the first byte is read to check it');
  const other = await linked.frame('https://p16-sign.tiktokcdn.com/obj/cover.jpg?x-expires=1');
  assert.equal(other?.url, undefined, 'a signed address is sent as bytes');
  assert.notEqual(other?.base64, '');
  const plain = await openChatClient(base).frame('https://pbs.twimg.com/media/abc.jpg');
  assert.equal(plain?.url, undefined, 'off by default');
});
