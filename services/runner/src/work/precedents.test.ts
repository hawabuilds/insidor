/**
 * The precedents source keeps every vector it pays for (0074): each judged post's vector reaches
 * the post-embedding store, and a store that fails loses only the kept copy, never the judging.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';

import { createLogger } from '../log.ts';
import { precedentSource } from './precedents.ts';

const SPACE = 'post-space';
const unit = (i: number): Float32Array => {
  const v = new Float32Array(4);
  v[i % 4] = 1;
  return v;
};
const embed = {
  id: 'fake', space: 'pic', dimensions: 4, maxBatch: 10, postSpace: SPACE,
  embedText: async () => ({ value: [], spend: { usd: 0 } }),
  embedPosts: async (posts: readonly unknown[]) => ({ value: posts.map((_, i) => ({ space: SPACE, dimensions: 4, values: unit(i) })), spend: { usd: 0 } }),
} as unknown as EmbedPort;
const meter = { line: () => ({ capUsd: 1, spentUsd: 0 }) } as unknown as Meter;
const labels = {
  version: async () => 'v1',
  all: async () => [{ itemId: 'x:label', label: 'meme' as const, kind: 'tap' as const, text: 'a label', why: null, picture: null, values: unit(0) }],
  put: async () => true,
  relabel: async () => {},
  fromDatabase: async () => [],
};
const items = [{ itemId: 'x:1', text: 'one', media: [] }, { itemId: 'x:2', text: 'two', media: [] }] as unknown as Item[];
const log = createLogger({ test: 'precedents' });

test('★ every judged post\'s vector is kept for the story coins, in the post space', async () => {
  const kept: { itemId: string; space: string }[] = [];
  const src = precedentSource({
    embed, labels, meter, mode: 'live', policy: DEFAULT_POLICY, log, now: () => 0 as Millis,
    posts: { putMany: async (rows, space) => { for (const r of rows) kept.push({ itemId: r.itemId, space }); return true; } },
  });
  const near = await src.forPosts(items);
  assert.equal(near.size, 2);
  assert.deepEqual(kept, [{ itemId: 'x:1', space: SPACE }, { itemId: 'x:2', space: SPACE }]);
});

test('a store that fails loses the kept copy and nothing else', async () => {
  const src = precedentSource({
    embed, labels, meter, mode: 'live', policy: DEFAULT_POLICY, log, now: () => 0 as Millis,
    posts: { putMany: async () => { throw new Error('down'); } },
  });
  assert.equal((await src.forPosts(items)).size, 2);
});
