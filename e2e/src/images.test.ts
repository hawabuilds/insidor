/**
 * The image vectors on a real schema: a picture something will read is queued once, stored
 * once — a narrative's post, a post the judge passed — while a firm "no" and an unjudged post
 * are not; and a new post's best similarity is read per candidate story from its posts' pictures.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import { PgImageEmbeddingRepo, PgImagePairRepo, PgItemRepo, PgPostJudgementRepo, PgStoryRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const SPACE = 'multimodal-3.1024';
/** The picture boost's ceiling on an unsure "no", as the runner passes it. */
const FIRM_NO_ABOVE = 0.3;
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
  await new PgItemRepo(db).upsert([
    post(1, 'https://example.invalid/raccoon.jpg'),
    post(2, 'https://example.invalid/raccoon-crop.jpg'),
    post(3, null),
    post(4, 'https://example.invalid/football.jpg'),
    post(5, 'https://example.invalid/unjudged.jpg'),
  ]);
  const answer = (coinable: boolean, confidence: number) => ({
    judgeId: 'judge:test', promptId: 'post@1', judgedAt: NOW, coinable, confidence, lookedAt: 'picture' as const,
    proposedName: coinable ? 'RACCOON' : null, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0.001,
  });
  const scores = new PgPostJudgementRepo(db);
  await scores.record(itemId(sourceId('x'), '2'), answer(true, 0.9));
  await scores.record(itemId(sourceId('x'), '4'), answer(false, 0.9));
  const stories = new PgStoryRepo(db);
  await stories.upsert({
    storyId: storyId('s1'), state: 'promoted', origin: 'observed', createdAt: NOW, promotedAt: NOW, earliestPostAt: NOW - 60_000,
    lastMemberAt: NOW, memberCount: 1, distinctAuthors: 1, distinctSources: 1, carriers: [], mergedInto: null,
  });
  await stories.addMembers([{ storyId: storyId('s1'), itemId: itemId(sourceId('x'), '1'), authorKey: authorKey(sourceId('x'), 'a1'), source: sourceId('x'), postedAt: NOW, joinedAt: NOW, evidence: { kind: 'seed' } }]);
});

test('★ a narrative\'s post and a judged post are queued once; a firm no, an unjudged post and a post with no picture are not', async () => {
  const repo = new PgImageEmbeddingRepo(db);
  const queue = await repo.unembedded(SPACE, (NOW - 3_600_000) as Millis, 10, FIRM_NO_ABOVE);
  assert.deepEqual(queue.map((q) => q.itemId).sort(), ['x:1', 'x:2']);
  assert.equal(queue.find((q) => q.itemId === 'x:1')?.inNarrative, true);
  assert.equal(queue.find((q) => q.itemId === 'x:2')?.judgement?.coinable, true);
  for (const q of queue) await repo.record('item', q.itemId, q.uri, SPACE, q.itemId === 'x:1' ? axis(0) : axis(0, 1, 0.6), NOW);
  assert.deepEqual(await repo.unembedded(SPACE, (NOW - 3_600_000) as Millis, 10, FIRM_NO_ABOVE), [], 'and never again once stored');
});

test('★ a new post\'s best similarity is read per story from that story\'s pictures', async () => {
  const best = await new PgImageEmbeddingRepo(db).bestMatches(itemId(sourceId('x'), '2'), [storyId('s1'), storyId('s-none')], SPACE);
  const match = best.get(storyId('s1'));
  assert.ok(match);
  assert.ok(Math.abs(match.similarity - 0.8) < 1e-4, `cosine ${match.similarity}`);
  assert.equal(match.memberUri, 'https://example.invalid/raccoon.jpg');
  assert.equal(best.has(storyId('s-none')), false, 'a story with no pictures is absent, never zero');
});

test('★ a pair answer is found whichever way round it is asked, and counted for the day', async () => {
  const pairs = new PgImagePairRepo(db);
  await pairs.record('https://example.invalid/b.jpg', 'https://example.invalid/a.jpg', 'same-subject@1', 'yes', 'judge:test', NOW, 0.004);
  assert.equal(await pairs.answer('https://example.invalid/a.jpg', 'https://example.invalid/b.jpg', 'same-subject@1'), 'yes');
  assert.equal(await pairs.answer('https://example.invalid/a.jpg', 'https://example.invalid/b.jpg', 'same-subject@2'), null, 'a reworded prompt asks again');
  assert.equal(await pairs.countSince((NOW - 60_000) as Millis), 1);
});
