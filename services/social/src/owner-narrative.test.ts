/**
 * The owner's narrative calls: the body checked, the narrative's posts read by the server and
 * stored with the call, and a 404 before 0093 so the app says the call was not saved.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ownerNarrativeRoute, parseNarrativeCall } from './owner-narrative.ts';

const COIN = '6omoGgUH5zDgd5Xwf3K7u56qn1JgMnV9njaNCAejpump';

function fakeDb(ready: boolean, members: Record<string, string[]>) {
  const inserts: unknown[][] = [];
  return {
    inserts,
    db: {
      async query<R>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
        if (sql.includes('to_regclass')) return [{ ok: ready }] as R[];
        if (sql.includes('from internal.narrative_member')) return (members[String(params[0])] ?? []).map((item_id) => ({ item_id })) as R[];
        if (sql.includes('insert into internal.owner_feedback')) {
          inserts.push([...params]);
          return [{ id: 1, call: params[3] }] as R[];
        }
        throw new Error(`unexpected ${sql}`);
      },
    },
  };
}

test('a call is checked: the action, the narrative, and what each action needs', () => {
  assert.equal(typeof parseNarrativeCall({ action: 'hide', storyId: 'n-x:1' }), 'string');
  assert.equal(typeof parseNarrativeCall({ action: 'merge', storyId: 'n-x:1' }), 'string');
  assert.equal(typeof parseNarrativeCall({ action: 'remove_post', storyId: 'n-x:1' }), 'string');
  assert.equal(typeof parseNarrativeCall({ action: 'coin_right', storyId: 'n-x:1', coin: 'nope' }), 'string');
  assert.deepEqual(parseNarrativeCall({ action: 'coin_wrong', storyId: 'n-x:1', coin: `solana:${COIN}` }), { action: 'coin_wrong', storyId: 'n-x:1', intoStoryId: null, itemId: null, coin: COIN, note: null });
});

test('★ the server reads the posts and stores them with the call; a merge stores both sides', async () => {
  const f = fakeDb(true, { 'n-x:1': ['x:1', 'x:2'], 'n-x:3': ['x:3'] });
  const merge = await ownerNarrativeRoute('POST', { action: 'merge', storyId: 'n-x:1', intoStoryId: 'n-x:3' }, 'u1', 'wallet:abc', f.db);
  assert.equal(merge.status, 201);
  assert.deepEqual(f.inserts[0], ['wallet:abc', 'u1', 'n-x:1', 'merge', null, null, 'n-x:3', ['x:1', 'x:2'], ['x:3']]);
  const right = await ownerNarrativeRoute('POST', { action: 'coin_right', storyId: 'n-x:1', coin: COIN }, 'u1', 'wallet:abc', f.db);
  assert.equal(right.status, 201);
  assert.equal(f.inserts[1]?.[3], 'right');
  const wrongPost = await ownerNarrativeRoute('POST', { action: 'remove_post', storyId: 'n-x:1', itemId: 'x:9' }, 'u1', 'wallet:abc', f.db);
  assert.equal(wrongPost.status, 400);
  const gone = await ownerNarrativeRoute('POST', { action: 'not_narrative', storyId: 'n-x:404' }, 'u1', 'wallet:abc', f.db);
  assert.equal(gone.status, 400);
});

test('★ before 0093 the route is a 404: "not supported yet", nothing saved', async () => {
  const f = fakeDb(false, {});
  const r = await ownerNarrativeRoute('POST', { action: 'not_narrative', storyId: 'n-x:1' }, 'u1', 'wallet:abc', f.db);
  assert.equal(r.status, 404);
  assert.equal(f.inserts.length, 0);
});
