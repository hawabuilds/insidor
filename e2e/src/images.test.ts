/**
 * The image vectors on a real schema: each post's first picture is queued once, stored once,
 * and a new post's best similarity is read per candidate story from its posts' pictures.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import { PgImageEmbeddingRepo, PgItemRepo, PgStoryRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const SPACE = 'multimodal-3.1024';
let db: Db;

function post(n: number, uri: string | null): Item {
  const x = sourceId('x');
  return {
    itemId: itemId(x, `${n}`), source: x, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(x, `a${n}`),
    postedAt: NOW - n * 60_000, firstSeenAt: NOW - n * 60_000, lang: 'en', text: `post ${n}`,
    media: uri === null ? [] : [{ kind: 'image', uri, width: null, height: null, durationMs: null }],
    counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`,
  };
}

/** A unit vector along one axis, padded to the space's width. */
const axis = (i: number, j = i, mix = 0): Float32Array => {
  const v = new Float32Array(1024);
  v[i] = Math.sqrt(1 - mix * mix);
  v[j] = (v[j] ?? 0) + mix;
  return v;
};

before(async () => {
  db = await migratedDb();
  await new PgItemRepo(db).upsert([post(1, 'https://example.invalid/raccoon.jpg'), post(2, 'https://example.invalid/raccoon-crop.jpg'), post(3, null)]);
  const stories = new PgStoryRepo(db);
  await stories.upsert({
    storyId: storyId('s1'), state: 'promoted', origin: 'observed', createdAt: NOW, promotedAt: NOW, earliestPostAt: NOW - 60_000,
    lastMemberAt: NOW, memberCount: 1, distinctAuthors: 1, distinctSources: 1, carriers: [], mergedInto: null,
  });
  await stories.addMembers([{ storyId: storyId('s1'), itemId: itemId(sourceId('x'), '1'), authorKey: authorKey(sourceId('x'), 'a1'), source: sourceId('x'), postedAt: NOW, joinedAt: NOW, evidence: { kind: 'seed' } }]);
});

test('★ each post with a picture is queued once; a post with none is never queued', async () => {
  const repo = new PgImageEmbeddingRepo(db);
  const queue = await repo.unembedded(SPACE, (NOW - 3_600_000) as Millis, 10);
  assert.deepEqual(queue.map((q) => q.itemId).sort(), ['x:1', 'x:2']);
  for (const q of queue) await repo.record('item', q.itemId, q.uri, SPACE, q.itemId === 'x:1' ? axis(0) : axis(0, 1, 0.6), NOW);
  assert.deepEqual(await repo.unembedded(SPACE, (NOW - 3_600_000) as Millis, 10), [], 'and never again once stored');
});

test('★ a new post\'s best similarity is read per story from that story\'s pictures', async () => {
  const best = await new PgImageEmbeddingRepo(db).bestMatches(itemId(sourceId('x'), '2'), [storyId('s1'), storyId('s-none')], SPACE);
  const match = best.get(storyId('s1'));
  assert.ok(match);
  assert.ok(Math.abs(match.similarity - 0.8) < 1e-4, `cosine ${match.similarity}`);
  assert.equal(match.memberUri, 'https://example.invalid/raccoon.jpg');
  assert.equal(best.has(storyId('s-none')), false, 'a story with no pictures is absent, never zero');
});
