/** Which model judges the feed: the policy's primary when both can run, the main judge alone without the open model's key, and a model list that cannot be read never turns the open judge off. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { KNOWN_MODELS } from '@insidor/judge-openai-compatible';

import { describeRoles, openHostModel, postJudgeOrder, postsPerCall, rolesFor, sideName, type OpenSide } from './feed-judges.ts';
import type { Logger } from './log.ts';

const lines: string[] = [];
const log: Logger = { info: (m) => void lines.push(m), warn: (m) => void lines.push(m), error: (m) => void lines.push(m), child: () => log };
const configured = { state: 'configured', apiKey: 'k', baseUrl: 'https://host.test/api/v1', model: 'google/gemma-3-27b-it', vendor: 'openrouter', providers: ['nextbit'] } as const;

test('the primary answers first and the other stands behind it; without the open model the main judge is alone', () => {
  assert.deepEqual(rolesFor('main', true), { primary: 'main', other: 'open' });
  assert.deepEqual(rolesFor('open', true), { primary: 'open', other: 'main' });
  assert.deepEqual(rolesFor('open', false), { primary: 'main', other: null });
  assert.deepEqual(rolesFor('main', false), { primary: 'main', other: null });
  /* No main key: the open model alone, whatever the policy wanted. */
  assert.deepEqual(rolesFor('main', true, false), { primary: 'open', other: null });
  assert.deepEqual(rolesFor('open', true, false), { primary: 'open', other: null });
  assert.match(describeRoles('main', rolesFor('main', true, false), { configured: true, model: 'm' }).message, /open model alone/);
  assert.match(describeRoles('open', rolesFor('open', false), { configured: false, model: null }).message, /cannot run/);
  assert.equal(describeRoles('main', rolesFor('main', false), { configured: false, model: null }).fields['why'], 'OPENROUTER_API_KEY is not set');
});

test('the open model is read from the host list, falls back to the recorded listing, and is null when dormant', async () => {
  assert.equal(await openHostModel({ state: 'dormant' }, 1000, log), null);
  const listing = { data: [{ id: 'google/gemma-3-27b-it', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0.0000001', completion: '0.0000005' } }] };
  const ok = (async () => new Response(JSON.stringify(listing), { status: 200 })) as unknown as typeof fetch;
  const listed = await openHostModel(configured, 1000, log, ok);
  assert.equal(listed?.id, 'google/gemma-3-27b-it');
  assert.equal(listed?.usdPerInputToken, 0.0000001);
  const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  const recorded = await openHostModel(configured, 1000, log, down);
  assert.equal(recorded?.id, 'google/gemma-3-27b-it');
  assert.equal(recorded?.vision, true);
  assert.equal(await openHostModel({ ...configured, model: 'nobody/unknown-model' }, 1000, log, down), null);
});

test('★ Nemotron on the second host asks the post question first with Gemma 3 behind it; turned round, or with one host, as said', () => {
  const model = (id: string) => KNOWN_MODELS.find((m) => m.id === id)!;
  const router: OpenSide = { setup: configured, model: model('google/gemma-3-27b-it') };
  const second: OpenSide = { setup: { state: 'configured', apiKey: 't', baseUrl: 'https://api.together.xyz/v1', model: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL', vendor: 'together', providers: [], router: false }, model: model('nvidia/NVIDIA-Nemotron-3.5-Super-VL') };
  assert.deepEqual(postJudgeOrder('second', router, second), { first: second, behind: router });
  assert.deepEqual(postJudgeOrder('router', router, second), { first: router, behind: second });
  assert.deepEqual(postJudgeOrder('second', router, null), { first: router, behind: null });
  assert.deepEqual(postJudgeOrder('router', null, second), { first: second, behind: null });
  assert.deepEqual(postJudgeOrder('second', null, null), { first: null, behind: null });
  assert.equal(sideName(second), 'together/nvidia/NVIDIA-Nemotron-3.5-Super-VL');
  /* Ten posts a call for the primary model, five for Gemma, whichever order they are asked in. */
  assert.equal(postsPerCall(second, DEFAULT_POLICY), DEFAULT_POLICY.judge.open.primaryBatchSize);
  assert.equal(postsPerCall(router, DEFAULT_POLICY), DEFAULT_POLICY.judge.open.batchSize);
});
