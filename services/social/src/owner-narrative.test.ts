/**
 * The owner's narrative calls: the body checked, the narrative's posts read by the server and
 * stored with the call, a split's posts checked and its new narrative named once, and a 404 before
 * 0093 (or before the database takes a split) so the app says the call was not saved.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ownerNarrativeRoute, parseNarrativeCall } from './owner-narrative.ts';

const COIN = '6omoGgUH5zDgd5Xwf3K7u56qn1JgMnV9njaNCAejpump';

function fakeDb(ready: boolean, members: Record<string, string[]>, taken: readonly string[] = [], refuseSplit = false) {
  const inserts: unknown[][] = [];
  const titles: unknown[][] = [];
  return {
    inserts,
    titles,
    db: {
      async query<R>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
        if (sql.includes('to_regclass')) return [{ ok: ready }] as R[];
        if (sql.includes('from internal.narrative_member')) return (members[String(params[0])] ?? []).map((item_id) => ({ item_id })) as R[];
        if (sql.includes('union select other_id')) return taken.filter((id) => (params[0] as string[]).includes(id)).map((id) => ({ id })) as R[];
        if (sql.includes('insert into internal.owner_feedback')) {
          if (refuseSplit && (params[3] === 'split' || params[3] === 'rename')) throw Object.assign(new Error('violates check constraint'), { code: '23514' });
          inserts.push([...params]);
          return [{ id: 1, call: params[3] }] as R[];
        }
        if (sql.includes('update internal.narrative set title')) {
          titles.push([...params]);
          return [] as R[];
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
  assert.equal(typeof parseNarrativeCall({ action: 'split', storyId: 'n-x:1' }), 'string');
  assert.equal(typeof parseNarrativeCall({ action: 'split', storyId: 'n-x:1', itemIds: ['x:1', 'bad id'] }), 'string');
  assert.deepEqual(parseNarrativeCall({ action: 'coin_wrong', storyId: 'n-x:1', coin: `solana:${COIN}` }), { action: 'coin_wrong', storyId: 'n-x:1', intoStoryId: null, itemId: null, itemIds: [], coin: COIN, title: null, note: null });
});

test('★ the server reads the posts and stores them with the call; a merge stores both sides', async () => {
  const f = fakeDb(true, { 'n-x:1': ['x:1', 'x:2'], 'n-x:3': ['x:3'] });
  const merge = await ownerNarrativeRoute('POST', { action: 'merge', storyId: 'n-x:1', intoStoryId: 'n-x:3' }, 'u1', 'wallet:abc', f.db);
  assert.equal(merge.status, 201);
  assert.deepEqual(f.inserts[0], ['wallet:abc', 'u1', 'n-x:1', 'merge', null, null, 'n-x:3', ['x:1', 'x:2'], ['x:3'], null]);
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

test('★ a split moves some posts, never none or all, and names a new narrative no state has used', async () => {
  const f = fakeDb(true, { 'n-x:1': ['x:1', 'x:2', 'x:3', 'x:4'] }, ['n-x:1', 'n-x:3', 'n-x:4']);
  const r = await ownerNarrativeRoute('POST', { action: 'split', storyId: 'n-x:1', itemIds: ['x:4', 'x:3', 'x:3'] }, 'u1', 'wallet:abc', f.db);
  assert.equal(r.status, 201);
  assert.deepEqual(f.inserts[0], ['wallet:abc', 'u1', 'n-x:1', 'split', null, null, 'n-x:3-1', ['x:4', 'x:3'], ['x:1', 'x:2'], null], 'n-x:3 and n-x:4 are taken, so the first post\'s -1');
  const all = await ownerNarrativeRoute('POST', { action: 'split', storyId: 'n-x:1', itemIds: ['x:1', 'x:2', 'x:3', 'x:4'] }, 'u1', 'wallet:abc', f.db);
  assert.equal(all.status, 400);
  const stranger = await ownerNarrativeRoute('POST', { action: 'split', storyId: 'n-x:1', itemIds: ['x:9'] }, 'u1', 'wallet:abc', f.db);
  assert.equal(stranger.status, 400);
  assert.equal(f.inserts.length, 1);
});

test('before the database takes a split, it is a 404: "not set up yet", nothing saved', async () => {
  const f = fakeDb(true, { 'n-x:1': ['x:1', 'x:2'] }, [], true);
  const r = await ownerNarrativeRoute('POST', { action: 'split', storyId: 'n-x:1', itemIds: ['x:2'] }, 'u1', 'wallet:abc', f.db);
  assert.equal(r.status, 404);
});

test('a rename needs a title, folded and at most 80 characters', () => {
  assert.equal(typeof parseNarrativeCall({ action: 'rename', storyId: 'n-x:1' }), 'string');
  assert.equal(typeof parseNarrativeCall({ action: 'rename', storyId: 'n-x:1', title: '   ' }), 'string');
  assert.equal(typeof parseNarrativeCall({ action: 'rename', storyId: 'n-x:1', title: 'x'.repeat(81) }), 'string');
  const ok = parseNarrativeCall({ action: 'rename', storyId: 'n-x:1', title: '  Twitter   World War ' });
  assert.equal(typeof ok === 'string' ? ok : ok.title, 'Twitter World War');
  const other = parseNarrativeCall({ action: 'not_narrative', storyId: 'n-x:1', title: 'ignored' });
  assert.equal(typeof other === 'string' ? other : other.title, null, 'only a rename carries a title');
});

test('★ a rename is saved as a call AND written as the narrative\'s title, marked as the owner\'s', async () => {
  const f = fakeDb(true, { 'n-x:1': ['x:1', 'x:2', 'x:3'] });
  const r = await ownerNarrativeRoute('POST', { action: 'rename', storyId: 'n-x:1', title: 'Twitter World War' }, 'u1', 'wallet:abc', f.db);
  assert.equal(r.status, 201);
  assert.deepEqual(f.inserts[0], ['wallet:abc', 'u1', 'n-x:1', 'rename', null, null, null, ['x:1', 'x:2', 'x:3'], null, 'Twitter World War']);
  assert.deepEqual(f.titles[0], ['n-x:1', 'Twitter World War', 'owner', 3], 'title_model owner: the titler never writes over it');
});

test('before 0127 a rename is a 404 "not set up yet", and no title is written', async () => {
  const f = fakeDb(true, { 'n-x:1': ['x:1'] }, [], true);
  const r = await ownerNarrativeRoute('POST', { action: 'rename', storyId: 'n-x:1', title: 'New name' }, 'u1', 'wallet:abc', f.db);
  assert.equal(r.status, 404);
  assert.equal(f.titles.length, 0);
});
