/**
 * THE OPEN MODEL'S NAMER, TRANSLATOR AND SAME-SUBJECT QUESTION AGAINST A FAKE HOST. No test here
 * reaches the network. What matters: the words sent are the main adapter's own (its body,
 * re-wrapped), pictures go as data URLs, the reply is read by the main adapter's decoders, money is
 * metered under each question's endpoint, and a failed call says so the way the failover reads it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Budget } from '@insidor/contracts/ports/meter.ts';
import { NAME_INSTRUCTIONS, NAME_PROMPT_SHA, NAME_SYSTEM } from '@insidor/judge-anthropic/name-guess.ts';
import { SAME_SUBJECT_PROMPT } from '@insidor/judge-anthropic/prompts.ts';
import { TRANSLATE_INSTRUCTIONS, TRANSLATE_PROMPT_SHA } from '@insidor/judge-anthropic/translate.ts';
import { inMemoryMeter } from '@insidor/meter';
import { VendorUnavailable } from '@insidor/vendor-kit';

import { unchanged } from './questions.ts';
import { chatBodyFromMessages, messagesReplyOf, openChatClient, openNamer, openSameSubject, openTranslator, type HostModel } from './index.ts';

const AT = 1_800_000_000_000;
const P = DEFAULT_POLICY;
const BUDGET: Budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 };
const MODEL: HostModel = { id: 'maker/vision-27b', vision: true, usdPerInputToken: 1e-7, usdPerOutputToken: 4e-7, contextLength: 131_072 };

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const reply = (content: unknown, finish = 'stop'): unknown => ({ choices: [{ finish_reason: finish, message: { role: 'assistant', content: JSON.stringify(content) } }], usage: { prompt_tokens: 1_000, completion_tokens: 100, cost: 0.0002 } });

function fakeHost(script: readonly (() => Response)[]) {
  const calls: Record<string, unknown>[] = [];
  let n = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://pics.invalid/')) return u.includes('dead') ? new Response('gone', { status: 404 }) : new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = script[n];
    n += 1;
    if (next === undefined) throw new Error('fake host: no scripted response');
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const deps = (fetch: typeof globalThis.fetch, model: HostModel = MODEL) => {
  const meter = inMemoryMeter({ dailyCapUsd: 5, softStop: 1, now: () => AT });
  const client = openChatClient({ vendor: 'router', apiKey: 'sk-test', baseUrl: 'https://router.invalid/api/v1', model: model.id, vision: model.vision, maxOutputTokens: 500, timeoutMs: 1_000, maxAttempts: 1, backoffMs: 1, maxWaitMs: 1, maxFrameBytes: 1_000_000, fetch, sleep: async () => {} });
  return { meter, base: { client, meter, now: () => AT as never, model, vendor: 'router', providers: ['first'], judge: P.judge } };
};

type Msg = { role: string; content: unknown };
const userParts = (body: Record<string, unknown>) => ((body['messages'] as Msg[]).find((m) => m.role === 'user')?.content ?? []) as { type: string; text?: string; image_url?: { url: string } }[];

test('a Messages body becomes a chat body: one system message, text parts, pictures as data URLs, the schema forced, providers pinned', () => {
  const body = chatBodyFromMessages(
    {
      max_tokens: 99,
      system: [{ type: 'text', text: 'sys' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }] }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    },
    { model: 'm', vision: true, providers: ['p1'], schemaName: 'x' },
  );
  assert.deepEqual(body['messages'], [{ role: 'system', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }] }]);
  assert.equal(body['max_tokens'], 99);
  assert.equal(body['temperature'], 0);
  assert.deepEqual(body['response_format'], { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: { type: 'object' } } });
  assert.deepEqual(body['provider'], { require_parameters: true, order: ['p1'], allow_fallbacks: false });
  /* A text-only model is sent no picture. */
  const text = chatBodyFromMessages({ messages: [{ role: 'user', content: [{ type: 'image', source: { media_type: 'image/png', data: 'x' } }] }] }, { model: 'm', vision: false, providers: [], schemaName: 'x' });
  assert.deepEqual((text['messages'] as Msg[])[0]?.content, []);
});

test('a chat reply is read in the Messages shape: a normal stop is end_turn, a fence is unwrapped, the cost is the host\'s', () => {
  const r = messagesReplyOf({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{"a":1}\n```' } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.5 } });
  assert.equal(r.reply['stop_reason'], 'end_turn');
  assert.deepEqual(r.reply['content'], [{ type: 'text', text: '{"a":1}' }]);
  assert.equal(r.costUsd, 0.5);
  assert.equal(messagesReplyOf({ choices: [{ finish_reason: 'length', message: { content: '' } }] }).reply['stop_reason'], 'length');
});

test('★ the namer asks one post a call (several at once), with the main namer\'s words and the post\'s picture, reads the answer by ref, and books it under names', async () => {
  const answer = (body: string) => (body.includes('gerald') ? reply({ answers: [{ ref: 'P1', seen: 'a frog', guesses: [{ name: 'Gerald ($GERALD)', ticker: 'GERALD' }] }] }) : reply({ answers: [] }));
  const calls: Record<string, unknown>[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://pics.invalid/')) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return json(200, answer(String(init?.body)));
  }) as typeof globalThis.fetch;
  const { meter, base } = deps(fetch);
  const namer = openNamer({ ...base, names: P.names });
  assert.equal(namer.promptId, `names@${NAME_PROMPT_SHA}`);
  assert.equal(namer.model, MODEL.id);
  const r = await namer.guess([
    { ref: 'a', text: 'nothing', picture: null, examples: [] },
    { ref: 'b', text: 'porch frog gerald', picture: 'https://pics.invalid/b.jpg', examples: [] },
  ], BUDGET);
  assert.equal(calls.length, 2);
  const body = calls.find((c) => JSON.stringify(c).includes('gerald'))!;
  assert.equal((body['messages'] as Msg[])[0]?.content, NAME_SYSTEM);
  const parts = userParts(body);
  assert.equal(parts[0]?.text, NAME_INSTRUCTIONS);
  assert.ok(parts.some((p) => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/jpeg;base64,')));
  /* The ticker it copied after the name from the examples' format is taken off the name. */
  assert.deepEqual(r.value[1], { kind: 'guessed', ref: 'b', guesses: [{ name: 'Gerald', ticker: 'GERALD' }], seen: 'a frog' });
  assert.equal(r.value[0]?.kind, 'absent');
  assert.equal(meter.spentUsd('router'), 0.0004);
  assert.equal(r.spend.endpoint, 'names');
});

test('a namer call the host refused is absent for every post, booked at $0', async () => {
  const host = fakeHost([() => json(400, { error: { message: 'bad' } })]);
  const { meter, base } = deps(host.fetch);
  const r = await openNamer({ ...base, names: P.names }).guess([{ ref: 'a', text: 'x', picture: null, examples: [] }], BUDGET);
  assert.equal(r.value[0]?.kind, 'absent');
  assert.equal(meter.spentUsd('router'), 0);
});

test('★ the translator sends the main translator\'s words and reads languages and English by ref', async () => {
  const host = fakeHost([() => json(200, reply({ answers: [{ ref: 'P1', language: 'pt', english: 'I love this video' }, { ref: 'P2', language: 'en', english: '' }] }))]);
  const { base } = deps(host.fetch);
  const t = openTranslator({ ...base, translate: P.translate });
  assert.equal(t.promptId, `translate@${TRANSLATE_PROMPT_SHA}`);
  const r = await t.translate([{ ref: 'a', text: 'eu amo esse vídeo' }, { ref: 'b', text: 'hello' }], BUDGET);
  assert.equal(userParts(host.calls[0]!)[0]?.text, TRANSLATE_INSTRUCTIONS);
  assert.equal(host.calls[0]!['model'], MODEL.id);
  assert.deepEqual(r.value, [{ kind: 'translated', ref: 'a', from: 'pt', text: 'I love this video' }, { kind: 'kept', ref: 'b', from: 'en' }]);
});

test('★ the same-subject question shows both pictures as data URLs with the prompt file, and answers the word', async () => {
  const host = fakeHost([() => json(200, reply({ answer: 'yes' }))]);
  const { base } = deps(host.fetch);
  const q = openSameSubject(base);
  assert.equal(q.sameSubjectPromptId, `same-subject@${SAME_SUBJECT_PROMPT.sha}`);
  const img = (u: string) => ({ kind: 'image' as const, uri: u, width: null, height: null, durationMs: null });
  const r = await q.sameSubject(img('https://pics.invalid/a.jpg'), img('https://pics.invalid/b.jpg'), BUDGET);
  assert.equal(r.value, 'yes');
  const parts = userParts(host.calls[0]!);
  assert.deepEqual(parts.map((p) => p.type), ['image_url', 'image_url', 'text']);
  assert.equal(parts[2]?.text, SAME_SUBJECT_PROMPT.text);
  /* An unreadable picture: null, and no call. */
  assert.equal((await q.sameSubject(img('https://pics.invalid/dead.jpg'), img('https://pics.invalid/b.jpg'), BUDGET)).value, null);
  assert.equal(host.calls.length, 1);
});

test('a same-subject question the host refused THROWS (after booking $0), so the failover can tell it from "no answer"', async () => {
  const host = fakeHost([() => json(400, { error: { message: 'bad' } })]);
  const { meter, base } = deps(host.fetch);
  const img = (u: string) => ({ kind: 'image' as const, uri: u, width: null, height: null, durationMs: null });
  await assert.rejects(openSameSubject(base).sameSubject(img('https://pics.invalid/a.jpg'), img('https://pics.invalid/b.jpg'), BUDGET), VendorUnavailable);
  assert.equal(meter.spentUsd('router'), 0);
});

test('a model that reads no pictures is never asked the same-subject question', async () => {
  const host = fakeHost([]);
  const { base } = deps(host.fetch, { ...MODEL, vision: false });
  const img = (u: string) => ({ kind: 'image' as const, uri: u, width: null, height: null, durationMs: null });
  assert.equal((await openSameSubject(base).sameSubject(img('https://pics.invalid/a.jpg'), img('https://pics.invalid/b.jpg'), BUDGET)).value, null);
  assert.equal(host.calls.length, 0);
});

test('the narrative question is the main judge\'s, word for word, and its answers are filed under its prompt id', async () => {
  const { promptFor, openJudge } = await import('./index.ts');
  const { PROMPTS, promptId } = await import('@insidor/judge-anthropic');
  const p = promptFor('story', 'ignored: examples are the post question\'s', true);
  assert.equal(p.system, PROMPTS.system.text);
  assert.equal(p.instructions, `${PROMPTS['coinability-core'].text}\n\n${PROMPTS['subject-vs-story'].text}`);
  assert.equal(p.precedentsIntro, undefined);
  const host = fakeHost([]);
  const { meter } = deps(host.fetch);
  const j = openJudge({ client: { judge: async () => ({ answers: [], usage: { inputTokens: 0, outputTokens: 0 } }), frame: async () => null }, meter, now: () => AT as never, model: MODEL, vendor: 'router', policy: P.judge, maxBatch: 10, question: 'story' });
  assert.equal(j.promptId, promptId('story'));
});

test('a translation that is the words back is kept, not shown as translated', () => {
  assert.deepEqual(unchanged('Eu/acc', { kind: 'translated', ref: 'a', from: 'pt', text: 'Eu/acc ' }), { kind: 'kept', ref: 'a', from: 'pt' });
  assert.deepEqual(unchanged('oi', { kind: 'translated', ref: 'a', from: 'pt', text: 'hi' }), { kind: 'translated', ref: 'a', from: 'pt', text: 'hi' });
});
