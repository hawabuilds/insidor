/**
 * The same-subject question, through the real client with a reply in the Messages API's
 * shape: both pictures are shown, only yes / no / unsure come back, an unreadable picture
 * means nothing is sent, and a refused request is booked at $0.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Meter, Spend } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';

import { decodeSameSubject, httpClient } from './client.ts';
import { anthropicJudge } from './index.ts';

const P = DEFAULT_POLICY.judge;
const image = (uri: string): MediaRef => ({ kind: 'image', uri, width: null, height: null, durationMs: null });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function judgeWith(reply: () => Response, frames = true) {
  const sent: { url: string; body: string | undefined }[] = [];
  const spends: Spend[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://img.invalid/')) {
      return frames ? new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }) : new Response('', { status: 404 });
    }
    sent.push({ url: u, body: typeof init?.body === 'string' ? init.body : undefined });
    return reply();
  }) as typeof globalThis.fetch;
  const meter = {
    record: (s: Spend) => void spends.push(s),
    spentUsd: () => 0,
    mayspend: () => true,
    line: () => ({ capUsd: 6, spentUsd: 0, stopAtUsd: 6, remainingUsd: 6, unrecordedUsd: 0 }),
  } as unknown as Meter;
  const client = httpClient({
    apiKey: 'sk-test-not-a-real-key', baseUrl: 'https://judge.invalid', model: 'claude-haiku-4-5', maxOutputTokens: P.maxOutputTokens,
    effort: null, timeoutMs: P.timeoutMs, maxAttempts: 1, backoffMs: P.backoffMs, maxWaitMs: P.maxWaitMs, maxFrameBytes: P.maxFrameBytes,
    fetch, sleep: async () => {},
  });
  const judge = anthropicJudge({ client, meter, now: () => 0, model: 'claude-haiku-4-5', policy: P, maxBatch: 10 });
  return { judge, sent, spends };
}

const reply = (text: string, status = 200) =>
  new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 3_300, output_tokens: 8 } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const BUDGET = { capUsd: 6, spentUsd: 0, maxCalls: null, deadline: 60_000 };

test('★ both pictures are shown with the question, and "yes" comes back', async () => {
  const { judge, sent, spends } = judgeWith(() => reply('{"answer":"yes"}'));
  const result = await judge.sameSubject!(image('https://img.invalid/a.jpg'), image('https://img.invalid/b.jpg'), BUDGET);
  assert.equal(result.value, 'yes');
  const body = JSON.parse(sent[0]?.body ?? '{}') as { max_tokens: number; messages: { content: { type: string }[] }[] };
  assert.equal(body.messages[0]?.content.filter((c) => c.type === 'image').length, 2);
  assert.equal(body.max_tokens, P.pairMaxOutputTokens);
  assert.ok((spends[0]?.usd ?? 0) > 0, 'billed on the tokens reported');
});

test('★ an unreadable picture means nothing is sent and nothing is learned', async () => {
  const { judge, sent } = judgeWith(() => reply('{"answer":"yes"}'), false);
  const result = await judge.sameSubject!(image('https://img.invalid/a.jpg'), image('https://img.invalid/b.jpg'), BUDGET);
  assert.equal(result.value, null);
  assert.equal(sent.length, 0);
});

test('a reply that is not one of the three words is no answer', () => {
  assert.equal(decodeSameSubject({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"probably"}' }] }).answer, null);
  assert.equal(decodeSameSubject({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"answer":"yes"}' }] }).answer, null);
});

test('a request the vendor refused with a status is no answer, booked at $0', async () => {
  const { judge, spends } = judgeWith(() => new Response('{"error":"overloaded"}', { status: 400 }));
  const result = await judge.sameSubject!(image('https://img.invalid/a.jpg'), image('https://img.invalid/b.jpg'), BUDGET);
  assert.equal(result.value, null);
  assert.equal(spends[0]?.usd, 0);
});
