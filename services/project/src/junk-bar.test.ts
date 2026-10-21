/**
 * For You's junk bar (junk-bar.ts): a post about to join stays off only when the applied fit, at the
 * bar its own held-out table chose, is sure enough; no fit, no qualifying row, no vector, the switch
 * off or a failed read let every post join, and a failed read never aborts the frame's transaction.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { Db } from '@insidor/store';

import { overJunkBar } from './junk-bar.ts';

/* One weight: a post's probability is logistic(-3 + 4x) for its one-number vector [x]. */
const FIT = { id: '9', space: 'post', intercept: -3, weights: [4], threshold: 0.97 };
const groups = (gold: number, missed: number, meme: number) => ({ gold: { tested: 146, dropped: gold }, missed: { tested: 37, dropped: missed }, meme: { tested: 15, dropped: meme } });
/* At 0.8 the owner's memeable posts lose 13 of 198 (93%); at 0.9, 4 (98%): the bar is 0.9. */
const TABLE = [{ threshold: 0.8, dropped: groups(6, 2, 5) }, { threshold: 0.9, dropped: groups(1, 1, 2) }];
const VECTORS: Record<string, number> = { junky: 1.5, fine: 1, edge: (Math.log(9) + 3) / 4 };

function fakeDb(opts: { readonly fit?: boolean; readonly table?: unknown; readonly fail?: boolean } = {}): Db & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    query: async (sql: string, params?: readonly unknown[]) => {
      asked.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.startsWith('savepoint') || sql.startsWith('release') || sql.startsWith('rollback')) return [];
      if (opts.fail === true) throw new Error('connection reset');
      if (sql.includes('from internal.junk_filter')) return opts.fit === false ? [] : [{ ...FIT, held_out: { table: opts.table ?? TABLE } }];
      if (sql.includes('from internal.post_embedding')) {
        const ids = params?.[0] as string[];
        /* One row shape for the words read, the version read and the vector read (store post-vectors.ts). */
        return ids.filter((id) => id in VECTORS).map((item_id) => ({ item_id, text: '', embedding: `[${VECTORS[item_id]}]`, v: `[${VECTORS[item_id]}]`, at: 'v1' }));
      }
      return [];
    },
  } as Db & { readonly asked: string[] };
}

test('a joining post at or over the bar its fit chose stays off; under it, or with no vector, it joins', async () => {
  // junky: logistic(3) = 0.95; fine: logistic(1) = 0.73; edge: exactly 0.9; unseen: no vector.
  const off = await overJunkBar(fakeDb(), ['junky', 'fine', 'edge', 'unseen'], DEFAULT_POLICY);
  assert.deepEqual([...off].sort(), ['edge', 'junky']);
});

test("the bar is the fit's held-out choice, not its own skip threshold", async () => {
  // Under the skip's 0.97, 0.95 would join; the For You bar of 0.9 keeps it off.
  assert.ok((await overJunkBar(fakeDb(), ['junky'], DEFAULT_POLICY)).has('junky'));
});

test('no applied fit, or no row that keeps enough memeable posts: every post joins', async () => {
  assert.equal((await overJunkBar(fakeDb({ fit: false }), ['junky'], DEFAULT_POLICY)).size, 0);
  assert.equal((await overJunkBar(fakeDb({ table: [{ threshold: 0.8, dropped: groups(6, 2, 5) }] }), ['junky'], DEFAULT_POLICY)).size, 0);
  assert.equal((await overJunkBar(fakeDb({ table: 'not a table' }), ['junky'], DEFAULT_POLICY)).size, 0);
});

test('off: nothing is read and every post joins', async () => {
  const off: Policy = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, junkBar: { ...DEFAULT_POLICY.rising.junkBar, on: false } } };
  const db = fakeDb();
  assert.equal((await overJunkBar(db, ['junky'], off)).size, 0);
  assert.deepEqual(db.asked, []);
});

test('a failed read lets every post join and rolls back only its own savepoint', async () => {
  const db = fakeDb({ fail: true });
  assert.equal((await overJunkBar(db, ['junky'], DEFAULT_POLICY)).size, 0);
  assert.equal(db.asked[0], 'savepoint junk_bar');
  assert.equal(db.asked.at(-1), 'rollback to savepoint');
});

test('ships on, keeping 95% of the hand gold, missed and Meme-tapped posts, coined posts not counted', () => {
  assert.equal(DEFAULT_POLICY.rising.junkBar.on, true);
  assert.equal(DEFAULT_POLICY.rising.junkBar.keepShare, 0.95);
  assert.deepEqual([...DEFAULT_POLICY.rising.junkBar.keepGroups], ['gold', 'missed', 'meme']);
});
