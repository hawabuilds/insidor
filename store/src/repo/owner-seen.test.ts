/** ★ The owner's explicit calls win over a keep, the 24 h window decides the rest, and before 0098 nothing is seen. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgOwnerSeenRepo, seenOutcome } from './owner-seen.ts';

const H = 3_600_000;
const W = 24 * H;

test('★ "Not a meme" whenever tapped is not; a meme call, gold or the missed list is an explicit meme', () => {
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: 'not', listed: true }, W, 48 * H), 'not');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: 'not', listed: false }, W, H), 'not');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: 'meme', listed: false }, W, H), 'meme');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: null, listed: true }, W, 48 * H), 'meme');
});

test('a post with no call is waiting inside the window and kept once it closes', () => {
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: null, listed: false }, W, W - 1), 'waiting');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: null, listed: false }, W, W), 'kept');
});

test('before 0098 the table is missing: nothing seen, never a failed run', async () => {
  const db: Db = { query: () => Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' })) };
  const q = { since: new Date(0), until: new Date(W), keepWindowMs: W, now: new Date(2 * W) };
  assert.deepEqual(await new PgOwnerSeenRepo(db).seen(q), []);
  const broken: Db = { query: () => Promise.reject(Object.assign(new Error('reset'), { code: '08006' })) };
  await assert.rejects(new PgOwnerSeenRepo(broken).seen(q));
});

test('rows read back with their outcome as of now', async () => {
  const db = { query: async () => [{ item_id: 'x:1', first_at: new Date(0), on_screen: true, opened: false, call: null, listed: false, not_in_window: false }] } as unknown as Db;
  const [r] = await new PgOwnerSeenRepo(db).seen({ since: new Date(0), until: new Date(W), keepWindowMs: W, now: new Date(2 * W) });
  assert.equal(r?.outcome, 'kept');
  assert.equal((await new PgOwnerSeenRepo(db).keptIds({ since: new Date(0), until: new Date(W), keepWindowMs: W, now: new Date(2 * W) })).get('x:1'), 0);
});
