/**
 * THE NARRATIVE TITLER AGAINST A FAKE HOST. No test reaches the network. What matters: words only,
 * one narrative a call, the answer read as a title or refused, the money metered under its own
 * endpoint, and a refused call leaving the narrative `absent` to be asked again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Budget } from '@insidor/contracts/ports/meter.ts';
import { inMemoryMeter } from '@insidor/meter';

import { OPEN_TITLE_ENDPOINT, cleanTitle, openTitler, titleRequestText } from './titles.ts';
import { openChatClient, type HostModel } from './index.ts';

const AT = 1_800_000_000_000;
const BUDGET: Budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 };
const MODEL: HostModel = { id: 'maker/vision-27b', vision: true, usdPerInputToken: 1e-7, usdPerOutputToken: 4e-7, contextLength: 131_072 };
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const reply = (title: unknown): unknown => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ title }) } }], usage: { prompt_tokens: 300, completion_tokens: 10, cost: 0.00003 } });

function setup(script: readonly (() => Response)[]) {
  const calls: Record<string, unknown>[] = [];
  let n = 0;
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = script[n];
    n += 1;
    if (next === undefined) throw new Error('fake host: no scripted response');
    return next();
  }) as typeof globalThis.fetch;
  const meter = inMemoryMeter({ dailyCapUsd: 5, softStop: 1, now: () => AT });
  const client = openChatClient({ vendor: 'router', apiKey: 'sk-test', baseUrl: 'https://router.invalid/api/v1', model: MODEL.id, vision: true, maxOutputTokens: 40, timeoutMs: 1_000, maxAttempts: 1, backoffMs: 1, maxWaitMs: 1, maxFrameBytes: 1_000_000, fetch, sleep: async () => {} });
  const titler = openTitler({ client, meter, now: () => AT as never, model: MODEL, vendor: 'router', providers: ['first'], charsPerToken: 3, maxOutputTokens: 40, maxTitleChars: 60 });
  return { calls, meter, titler };
}

test('a title is asked on the words alone, one narrative a call, and metered under its own endpoint', async () => {
  const { calls, titler } = setup([() => json(200, reply('GTA 6 Trailer Two Drops')), () => json(200, reply('Altai the Tiger Cub'))]);
  const out = await titler.title([
    { ref: 'n-1', posts: ['GTA 6 trailer two is out', 'rockstar dropped it'], names: ['GTA 6'] },
    { ref: 'n-2', posts: ['a tiger cub named Altai'], names: ['ALTAI'] },
  ], BUDGET);
  assert.deepEqual(out.value, [{ kind: 'titled', ref: 'n-1', title: 'GTA 6 Trailer Two Drops' }, { kind: 'titled', ref: 'n-2', title: 'Altai the Tiger Cub' }]);
  assert.equal(calls.length, 2);
  const messages = calls[0]?.['messages'] as { role: string; content: unknown }[];
  assert.equal(typeof messages[1]?.content, 'string', 'words only: no picture parts');
  assert.match(String(messages[1]?.content), /1\. GTA 6 trailer two is out/);
  assert.equal(out.spend.endpoint, OPEN_TITLE_ENDPOINT);
  assert.ok(out.spend.usd > 0);
});

test('a refused call or an unusable answer is absent, never a placeholder', async () => {
  const { titler } = setup([() => json(429, { error: 'busy' }), () => json(200, reply('#gta6 $GTA to the moon'))]);
  const out = await titler.title([{ ref: 'a', posts: ['x'], names: [] }, { ref: 'b', posts: ['y'], names: [] }], BUDGET);
  assert.deepEqual(out.value.map((o) => o.kind), ['absent', 'absent']);
});

test('a title is cleaned of quotes and refused when it is a hashtag, a ticker, a link or too long', () => {
  assert.equal(cleanTitle('"Altai the Tiger Cub."', 60), 'Altai the Tiger Cub');
  assert.equal(cleanTitle('#altai', 60), null);
  assert.equal(cleanTitle('$ALTAI pumps', 60), null);
  assert.equal(cleanTitle('x'.repeat(61), 60), null);
  assert.equal(cleanTitle('', 60), null);
  assert.equal(titleRequestText({ ref: 'r', posts: ['a\n b'], names: ['N'] }), 'Posts:\n1. a b\nNames people gave it: N');
});
