/**
 * The owner's screen: a batch checked and merged per post, the phone's clock clamped, a 404 before
 * 0098, and an upsert that only ever moves a time earlier. The owner check itself is owner.test.ts's.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Person } from '@insidor/contracts/ports/people.ts';

import { ownerRoute } from './owner.ts';
import { MAX_AGE_MS, ownerSeenRoute, parseSeen } from './owner-seen.ts';

const NOW = 1_800_000_000_000;

function fakeDb(ready: boolean) {
  const writes: { sql: string; params: readonly unknown[] }[] = [];
  return {
    writes,
    db: {
      async query<R>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
        if (sql.includes('to_regclass')) return [{ ok: ready }] as R[];
        if (sql.includes('insert into internal.owner_seen')) {
          writes.push({ sql, params });
          return [] as R[];
        }
        throw new Error(`unexpected ${sql}`);
      },
    },
  };
}

test('a batch is checked: ids, surfaces, and a time for each post', () => {
  assert.equal(typeof parseSeen({}, NOW), 'string');
  assert.equal(typeof parseSeen({ posts: [{ itemId: 'x 1', surface: 'fyp', onScreenAt: NOW }] }, NOW), 'string');
  assert.equal(typeof parseSeen({ posts: [{ itemId: 'x:1', surface: 'home', onScreenAt: NOW }] }, NOW), 'string');
  assert.equal(typeof parseSeen({ posts: [{ itemId: 'x:1', surface: 'fyp' }] }, NOW), 'string');
  assert.equal(typeof parseSeen({ posts: Array.from({ length: 201 }, () => ({ itemId: 'x:1', surface: 'fyp', onScreenAt: NOW })) }, NOW), 'string');
});

test('★ the phone\'s clock: a future time is now, one older than two days is refused', () => {
  assert.deepEqual(parseSeen({ posts: [{ itemId: 'x:1', surface: 'fyp', onScreenAt: NOW + 60_000 }] }, NOW), [{ itemId: 'x:1', surface: 'fyp', onScreenAt: NOW, openedAt: null }]);
  assert.equal(typeof parseSeen({ posts: [{ itemId: 'x:1', surface: 'fyp', onScreenAt: NOW - MAX_AGE_MS - 1 }] }, NOW), 'string');
});

test('one post twice in a batch is one entry with the earliest of each time', () => {
  const p = parseSeen({ posts: [{ itemId: 'x:1', surface: 'fyp', onScreenAt: NOW - 5000 }, { itemId: 'x:1', surface: 'sheet', openedAt: NOW - 1000 }, { itemId: 'x:1', surface: 'fyp', onScreenAt: NOW - 9000 }] }, NOW);
  assert.deepEqual(p, [{ itemId: 'x:1', surface: 'fyp', onScreenAt: NOW - 9000, openedAt: NOW - 1000 }]);
});

test('★ the write keeps the earliest time: least(), never a plain overwrite', async () => {
  const f = fakeDb(true);
  const r = await ownerSeenRoute('POST', { posts: [{ itemId: 'x:1', surface: 'narrative', onScreenAt: NOW - 2000 }] }, 'wallet:abc', f.db, NOW);
  assert.equal(r.status, 200);
  assert.match(f.writes[0]?.sql ?? '', /least\(internal\.owner_seen\.first_seen_on_screen_at, excluded\.first_seen_on_screen_at\)/);
  assert.deepEqual(f.writes[0]?.params, ['wallet:abc', ['x:1'], [NOW - 2000], [null], ['narrative']]);
});

test('before 0098 the route is a 404 and nothing is written; a GET is refused', async () => {
  const f = fakeDb(false);
  assert.equal((await ownerSeenRoute('POST', { posts: [{ itemId: 'x:1', surface: 'fyp', onScreenAt: NOW }] }, 'wallet:abc', f.db, NOW)).status, 404);
  assert.equal(f.writes.length, 0);
  assert.equal((await ownerSeenRoute('GET', null, 'wallet:abc', f.db, NOW)).status, 405);
});

test('★ only the owner reaches it: signed out is 401, anyone else 403, and nothing is written', async () => {
  const W = 'A1e82D9Lw4irgKMpXRpJbvLw8c7xCCyA42NdcxzKvvdL';
  const f = fakeDb(true);
  const ask = { method: 'POST', seg: ['owner', 'seen'], query: new URLSearchParams(), body: { posts: [{ itemId: 'x:1', surface: 'fyp', onScreenAt: Date.now() }] } };
  const someone: Person = { userId: 'u', handle: 'someone', name: null, pictureUrl: null, wallets: [{ address: 'B1e82D9Lw4irgKMpXRpJbvLw8c7xCCyA42NdcxzKvvdL', kind: 'embedded' }] };
  const deps = { db: f.db, owner: { wallets: [W], xHandles: [] } };
  assert.equal((await ownerRoute(ask, null, deps))?.status, 401);
  assert.equal((await ownerRoute(ask, someone, deps))?.status, 403);
  assert.equal(f.writes.length, 0);
  assert.equal((await ownerRoute(ask, { ...someone, wallets: [{ address: W, kind: 'embedded' }] }, deps))?.status, 200);
  assert.equal(f.writes[0]?.params[0], `wallet:${W}`);
});
