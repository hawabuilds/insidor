/**
 * Reused per-post answers on a real schema (0053): the answer a repost or a same-picture post may
 * reuse is found only for the same judge and prompt, inside the window, and — for a picture —
 * only when the judge was shown it; a copy is filed as the post's newest answer and names the
 * original, even when it is copied again.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { PgItemRepo, PgPostJudgementRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const HOUR = 3_600_000;
const x = sourceId('x');
let db: Db;

function post(n: number, uri: string | null): Item {
  return {
    itemId: itemId(x, `${n}`), source: x, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(x, `a${n}`),
    postedAt: NOW - n * 60_000, firstSeenAt: NOW - n * 60_000, lang: 'en', text: `post ${n}`,
    media: uri === null ? [] : [{ kind: 'image', uri, width: null, height: null, durationMs: null }],
    counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`,
  };
}

const answer = (over: Partial<Judgement> = {}): Judgement => ({
  judgeId: 'judge:test@1', promptId: 'post@1', judgedAt: NOW - HOUR, coinable: true, confidence: 0.9, lookedAt: 'picture',
  proposedName: 'HIPPO', alternateNames: ['baby hippo'], subjectSpans: [], rationaleRef: null, costUsd: 0.003, ...over,
});

before(async () => {
  db = await migratedDb();
  await new PgItemRepo(db).upsert([post(1, 'https://example.invalid/hippo.jpg'), post(2, 'https://example.invalid/words.jpg'), post(3, null), post(4, null), post(5, null)]);
  const scores = new PgPostJudgementRepo(db);
  await scores.record(itemId(x, '1'), answer());
  /* Judged on its words alone: says nothing about its picture. */
  await scores.record(itemId(x, '2'), answer({ lookedAt: 'text' }));
  /* Another prompt's answer is not this prompt's. */
  await scores.record(itemId(x, '3'), answer({ promptId: 'post@0' }));
});

const ask = (over: Partial<Parameters<PgPostJudgementRepo['reusable']>[0]> = {}) =>
  new PgPostJudgementRepo(db).reusable({
    itemIds: [itemId(x, '1'), itemId(x, '3')],
    imageUris: ['https://example.invalid/hippo.jpg', 'https://example.invalid/words.jpg'],
    judgeId: 'judge:test@1',
    promptId: 'post@1',
    since: (NOW - 2 * HOUR) as Millis,
    ...over,
  });

test('★ only this judge and prompt\'s answers, inside the window, and a picture only when the judge saw it', async () => {
  const found = await ask();
  assert.deepEqual([...found.byItem.keys()], ['x:1']);
  assert.deepEqual([...found.byImage.keys()], ['https://example.invalid/hippo.jpg']);
  assert.equal(found.byImage.get('https://example.invalid/hippo.jpg')?.judgement.proposedName, 'HIPPO');
  assert.deepEqual([...(await ask({ since: NOW })).byItem.keys()], [], 'older than the window: judged again');
});

test('★ a copy is the post\'s newest answer, at no cost, and a copy of a copy names the original', async () => {
  const scores = new PgPostJudgementRepo(db);
  const original = (await ask()).byItem.get('x:1');
  assert.ok(original);
  await scores.recordCopy(itemId(x, '4'), { ...original.judgement, judgedAt: NOW, costUsd: 0 }, original.sourceId);
  const latest = await scores.latest([itemId(x, '4')]);
  assert.equal(latest.get(itemId(x, '4'))?.costUsd, 0);
  assert.deepEqual(latest.get(itemId(x, '4'))?.alternateNames, ['baby hippo']);
  const again = (await ask({ itemIds: [itemId(x, '4')] })).byItem.get('x:4');
  assert.equal(again?.sourceId, 'x:1');
  const rows = await db.query<{ copied_from: string | null }>(`select copied_from from internal.post_judgement where item_id = $1`, ['x:4']);
  assert.deepEqual(rows.map((r) => r.copied_from), ['x:1']);
});
