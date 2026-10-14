/**
 * The namer step: off asks nothing; on, the owner's new pairs are written before any post is
 * guessed, only posts that pass the feed's bar are asked, each with its nearest examples, and a
 * post with no answer is left unguessed rather than stored with no names.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { NamePort, NameSubject } from '@insidor/contracts/ports/names.ts';
import type { NameCandidate, NamePair } from '@insidor/store';

import { createLogger } from '../log.ts';
import { nameGuesser } from './name-guesses.ts';

const SPACE = 'post-space';
const ON: Policy = { ...DEFAULT_POLICY, names: { ...DEFAULT_POLICY.names, on: true } };
const meter = { line: () => ({ capUsd: 1, spentUsd: 0 }) } as unknown as Meter;
const embed = { id: 'fake', space: 'pic', dimensions: 2, maxBatch: 10, postSpace: SPACE, embedText: async () => ({ value: [] }), embedPosts: async () => ({ value: [] }) } as unknown as EmbedPort;
const log = createLogger({ test: 'name-guesses' });

const post = (itemId: string, over: Partial<NameCandidate> = {}): NameCandidate => ({ itemId, text: `post ${itemId}`, media: [], coinable: true, confidence: 0.9, lookedAt: 'text', proposedName: 'Tiger', kind: 'OTHER', postedAtMs: 0, ...over });

function setup(policy: Policy, answer: (s: readonly NameSubject[]) => 'ok' | 'none') {
  const order: string[] = [];
  const stored = new Map<string, readonly { name: string; ticker: string }[]>();
  const asked: NameSubject[] = [];
  const namer: NamePort = {
    id: 'names:test', promptId: 'names@t', model: 'm',
    guess: async (subjects) => {
      order.push('guess');
      asked.push(...subjects);
      return {
        value: subjects.map((s) => (answer(subjects) === 'ok' ? { kind: 'guessed' as const, ref: s.ref, guesses: [{ name: '$Altai', ticker: 'altai' }], seen: 'a tiger' } : { kind: 'absent' as const, ref: s.ref, detail: 'down' })),
        spend: { vendor: 'v', endpoint: 'names', unit: 'per-call', units: 1, usd: 0.01, at: 0 as Millis },
      };
    },
  };
  const step = nameGuesser({
    namer, embed, meter, mode: 'live', policy, log, now: () => 0 as Millis,
    examples: {
      fromDatabase: async () => { order.push('sync'); return [] as NamePair[]; },
      put: async () => 1,
      copyKnownVectors: async () => 0,
      needingVectors: async () => [],
      putVectors: async () => true,
      version: async () => 'v',
      all: async () => [{ itemId: 'x:ex', text: 'a tiger called Altai', seen: null, coins: [{ name: 'Altai', ticker: 'ALTAI' }], postedAtMs: 0, values: Float32Array.from([1, 0]) }],
      postVectors: async (ids) => new Map(ids.map((id) => [id, Float32Array.from([1, 0])] as const)),
    },
    guesses: {
      candidates: async () => [post('x:1'), post('x:low', { confidence: 0.1 }), post('x:ad', { kind: 'AD' })],
      put: async (id, g) => { stored.set(id, g); return true; },
    },
  });
  return { step, order, stored, asked };
}

test('switched off, nothing is read or asked', async () => {
  const { step, order } = setup(DEFAULT_POLICY, () => 'ok');
  const r = await step.pass();
  assert.notEqual(r.skipped, null);
  assert.deepEqual(order, []);
});

test('★ the owner\'s pairs are synced first; only a post over the bar is asked, with its examples; guesses are stored clean', async () => {
  const { step, order, stored, asked } = setup(ON, () => 'ok');
  const r = await step.pass();
  assert.deepEqual(order, ['sync', 'guess']);
  assert.deepEqual(asked.map((s) => s.ref), ['x:1']);
  assert.equal(asked[0]?.examples[0]?.coins[0]?.ticker, 'ALTAI');
  assert.deepEqual(stored.get('x:1'), [{ name: 'Altai', ticker: 'ALTAI' }]);
  assert.equal(r.guessed, 1);
});

test('no answer is not "no names": nothing is stored and the post waits', async () => {
  const { step, stored } = setup(ON, () => 'none');
  const r = await step.pass();
  assert.equal(stored.size, 0);
  assert.equal(r.absent, 1);
});
