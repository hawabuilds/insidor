/**
 * THE OWNER'S CALLS AGAINST THE REAL SCHEMA (0054): only the person policy names as the owner can
 * save one, every call is a new row with its date, the newest is the current call, and the
 * "Hidden by me" list is the posts whose current call is "Not a meme".
 *
 * Driven through services/social's own `handle` with a stand-in sign-in, as social.test.ts is;
 * the signed-token check itself is tested in the identity adapter. What the projector does with
 * these rows is asserted in pipeline.test.ts.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import { forgetKept, handle, type Db } from '@insidor/social';

import { migratedDb } from './db.ts';

const OWNER_WALLET = 'A1e82D9Lw4irgKMpXRpJbvLw8c7xCCyA42NdcxzKvvdL';
const MINT = 'FerryHorn1111111111111111111111111111111pump';
const owner: Person = { userId: 'did:privy:owner', handle: 'someone', name: null, pictureUrl: null, wallets: [{ address: OWNER_WALLET, kind: 'linked' }] };
const stranger: Person = { userId: 'did:privy:2', handle: 'stranger', name: null, pictureUrl: null, wallets: [{ address: 'B'.repeat(44), kind: 'embedded' }] };
const byHandle: Person = { userId: 'did:privy:3', handle: 'TheOwner', name: null, pictureUrl: null, wallets: [] };

async function setup() {
  const db = (await migratedDb()) as unknown as Db;
  const people = new Map<string, Person>([owner, stranger, byHandle].map((p) => [p.userId, p]));
  const deps = {
    db,
    identity: { verify: async (token: string) => people.get(token) ?? null },
    chain: null,
    policy: DEFAULT_POLICY.social,
    owner: { wallets: [OWNER_WALLET], xHandles: ['theowner'] },
    now: () => Date.UTC(2026, 9, 13, 12),
    pace: () => true,
  };
  const as = (p: Person | null) => async (method: string, url: string, body: unknown = null) => {
    const r = await handle({ method, url, body, token: p?.userId ?? null, client: 'test' }, deps);
    return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
  };
  return { db, as };
}

beforeEach(() => forgetKept());

test('★ only the owner can save or read a call; everyone else is refused, and the app is told who is', async () => {
  const { db, as } = await setup();
  const call = { kind: 'post', itemId: 'x:1', call: 'not' };
  assert.equal((await as(null)('POST', '/owner/feedback', call)).status, 401);
  assert.equal((await as(stranger)('POST', '/owner/feedback', call)).status, 403);
  assert.equal((await as(stranger)('GET', '/owner/hidden')).status, 403);
  assert.equal((await as(stranger)('GET', '/owner/feedback?kind=post&items=x:1')).status, 403);
  assert.equal((await db.query('select 1 from internal.owner_feedback')).length, 0, 'nothing was written for them');

  assert.deepEqual((await as(null)('GET', '/me/owner')).body, { owner: false });
  assert.deepEqual((await as(stranger)('GET', '/me/owner')).body, { owner: false });
  assert.deepEqual((await as(owner)('GET', '/me/owner')).body, { owner: true });
  assert.deepEqual((await as(byHandle)('GET', '/me/owner')).body, { owner: true }, 'an X handle in policy counts, whatever its capitals');

  const saved = await as(owner)('POST', '/owner/feedback', call);
  assert.equal(saved.status, 201);
  const [row] = await db.query<{ owner_ref: string; user_id: string }>('select owner_ref, user_id from internal.owner_feedback');
  assert.deepEqual(row, { owner_ref: `wallet:${OWNER_WALLET}`, user_id: owner.userId }, 'saved with who signed in');
});

test('★ every call is a new row with its date; the newest is the call, and "Hidden by me" lists the hidden', async () => {
  const { db, as } = await setup();
  const me = as(owner);
  const shown = { excerpt: 'a dog in a hat', authorLabel: '@dogs', sourceLabel: 'X', permalink: 'https://x.com/dogs/status/1', thumbUrl: 'javascript:alert(1)', secret: 'dropped' };
  assert.equal((await me('POST', '/owner/feedback', { kind: 'post', itemId: 'x:1', call: 'not', note: 'ad', shown })).status, 201);
  assert.equal((await me('POST', '/owner/feedback', { kind: 'post', itemId: 'x:2', call: 'not' })).status, 201);

  const hidden = (await me('GET', '/owner/hidden')).body['posts'] as { itemId: string; note: string | null; shown: Record<string, unknown> | null }[];
  assert.deepEqual(hidden.map((h) => h.itemId).sort(), ['x:1', 'x:2']);
  const first = hidden.find((h) => h.itemId === 'x:1');
  assert.equal(first?.note, 'ad');
  assert.deepEqual(first?.shown, { excerpt: 'a dog in a hat', authorLabel: '@dogs', sourceLabel: 'X', permalink: 'https://x.com/dogs/status/1' }, 'only card facts are kept, and only https links');

  assert.equal((await me('POST', '/owner/feedback', { kind: 'post', itemId: 'x:1', call: 'meme' })).status, 201);
  const after = (await me('GET', '/owner/hidden')).body['posts'] as { itemId: string }[];
  assert.deepEqual(after.map((h) => h.itemId), ['x:2'], '"Is a meme" brings it back');
  const calls = (await me('GET', '/owner/feedback?kind=post&items=x:1,x:2')).body['calls'] as { itemId: string; call: string }[];
  assert.deepEqual(calls.map((c) => [c.itemId, c.call]), [['x:1', 'meme'], ['x:2', 'not']]);
  assert.equal((await db.query('select 1 from internal.owner_feedback')).length, 3, 'all three calls are kept');
  await assert.rejects(db.query(`delete from internal.owner_feedback where item_id = 'x:1'`), 'and none can be deleted');
});

test('coin match and name calls: checked, and current per item (and per name)', async () => {
  const { as } = await setup();
  const me = as(owner);
  assert.equal((await me('POST', '/owner/feedback', { kind: 'coin_match', itemId: 'x:1', call: 'right' })).status, 400, '"Right coin" names the coin');
  assert.equal((await me('POST', '/owner/feedback', { kind: 'coin_match', itemId: 'x:1', call: 'none', coin: MINT })).status, 400);
  assert.equal((await me('POST', '/owner/feedback', { kind: 'coin_match', itemId: 'x:1', call: 'wrong', coin: 'not-a-mint' })).status, 400);
  assert.equal((await me('POST', '/owner/feedback', { kind: 'coin_match', itemId: 'x:1', call: 'wrong', coin: `solana:${MINT}` })).status, 201);
  assert.equal((await me('POST', '/owner/feedback', { kind: 'post', itemId: 'x:1', call: 'right' })).status, 400, 'a post call is meme or not');

  assert.equal((await me('POST', '/owner/feedback', { kind: 'name', itemId: 'x:1', call: 'up' })).status, 400, 'a name call says which name');
  assert.equal((await me('POST', '/owner/feedback', { kind: 'name', itemId: 'x:1', call: 'up', name: 'Dog Hat', ticker: 'DOGHAT' })).status, 201);
  assert.equal((await me('POST', '/owner/feedback', { kind: 'name', itemId: 'x:1', call: 'down', name: 'Hat', betterName: 'Hat Dog' })).status, 201);
  assert.equal((await me('POST', '/owner/feedback', { kind: 'name', itemId: 'x:1', call: 'down', name: 'Dog Hat', note: 'too long' })).status, 201);

  const match = (await me('GET', '/owner/feedback?kind=coin_match&items=x:1')).body['calls'] as { call: string; coin: string }[];
  assert.deepEqual(match.map((c) => [c.call, c.coin]), [['wrong', MINT]], 'the picked coin is saved as its address');
  const names = (await me('GET', '/owner/feedback?kind=name&items=x:1')).body['calls'] as { name: string; call: string; betterName: string | null }[];
  assert.deepEqual(names.map((n) => [n.name, n.call, n.betterName]), [['Dog Hat', 'down', null], ['Hat', 'down', 'Hat Dog']]);
});
