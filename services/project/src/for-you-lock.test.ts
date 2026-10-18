/**
 * The full frame beside the quick one (for-you-lock.ts, rising.ts `withNewerCards`): a post that
 * changed after the full frame began is left as For You shows it now — the quick frame's card kept,
 * a card the quick frame took off kept off, its coin list not rewritten — and with nothing changed
 * the frame is written exactly as built.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY, type Millis } from '@insidor/contracts';
import type { Db } from '@insidor/store';

import { FOR_YOU_LOCK, lockForYou } from './for-you-lock.ts';
import { withNewerCards, type RisingFrame, type WireRisingPost } from './rising.ts';

const NOW = 1_800_000_000_000 as Millis;
const P = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, varietyOn: false } };
const card = (id: string, minutesAgo: number, v = 'full'): WireRisingPost => ({ id, postedAt: { at: NOW - minutesAgo * 60_000 }, v }) as unknown as WireRisingPost;
const frameOf = (fyp: readonly WireRisingPost[]): RisingFrame => ({
  fyp,
  popular: [],
  whyNot: new Map(),
  heldBy: new Map(),
  sameName: new Map(fyp.map((p) => [p.id, [`coin-of-${p.id}`]] as const)),
  sameNameEvidence: new Map(),
  members: [],
});

/** Answers the three reads `withNewerCards` makes: the changed posts, the committed cards, their times. */
function fakeDb(changed: readonly string[], committed: readonly WireRisingPost[]): Db & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    query: async (sql: string, params?: readonly unknown[]) => {
      asked.push(sql);
      if (sql.includes('from internal.post_judgement where id > $1')) return changed.map((item_id) => ({ item_id }));
      if (sql.includes("from public.rising_row where feed_id = 'fyp' and item_id = any")) {
        const ids = new Set(params?.[0] as string[]);
        return committed.filter((p) => ids.has(p.id)).map((payload) => ({ payload }));
      }
      if (sql.includes('pg_advisory_xact_lock')) return [{}];
      return [];
    },
  } as unknown as Db & { readonly asked: string[] };
}

const began = { answerId: 100, atMs: NOW - 120_000 };

test('nothing changed since the full frame began: the frame is written as built', async () => {
  const built = frameOf([card('a', 5), card('b', 10)]);
  const r = await withNewerCards(fakeDb([], []), built, began, NOW, P);
  assert.equal(r.frame, built);
  assert.deepEqual(r.deferred, []);
});

test('★ a post the quick frame put up while the full frame was building stays up, with the quick frame\'s card and list', async () => {
  const built = frameOf([card('a', 5), card('b', 10)]);
  const r = await withNewerCards(fakeDb(['n'], [card('n', 7, 'quick')]), built, began, NOW, P);
  assert.deepEqual(r.frame.fyp.map((p) => `${p.id}:${(p as unknown as { v: string }).v}`), ['a:full', 'n:quick', 'b:full']);
  assert.deepEqual(r.deferred, ['n'], 'its coin list is the quick frame\'s: not rewritten');
});

test('a changed post the quick frame took off, or has not placed yet, is not put back by the older frame', async () => {
  const built = frameOf([card('a', 5), card('b', 10)]);
  const r = await withNewerCards(fakeDb(['b'], []), built, began, NOW, P);
  assert.deepEqual(r.frame.fyp.map((p) => p.id), ['a']);
  assert.deepEqual(r.deferred, []);
});

test('a changed post on both: the committed card wins over the full frame\'s older one', async () => {
  const built = frameOf([card('a', 5), card('b', 10)]);
  const r = await withNewerCards(fakeDb(['a'], [card('a', 5, 'quick')]), built, began, NOW, P);
  assert.deepEqual(r.frame.fyp.map((p) => `${p.id}:${(p as unknown as { v: string }).v}`), ['a:quick', 'b:full']);
  assert.equal(r.frame.sameName.has('a'), false, 'the older list is not written over the quick frame\'s');
  assert.equal(r.frame.sameName.has('b'), true);
});

test('the lock is a transaction lock on one fixed key', async () => {
  const db = fakeDb([], []);
  await lockForYou(db);
  assert.match(db.asked[0] ?? '', /pg_advisory_xact_lock\(\$1\)/);
  assert.equal(typeof FOR_YOU_LOCK, 'number');
});
