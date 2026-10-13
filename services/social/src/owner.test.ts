import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Person } from '@insidor/contracts/ports/people.ts';

import { ownerRefOf, parseFeedback } from './owner.ts';

const W = 'A1e82D9Lw4irgKMpXRpJbvLw8c7xCCyA42NdcxzKvvdL';
const person = (wallets: string[], handle: string | null): Person => ({ userId: 'u', handle, name: null, pictureUrl: null, wallets: wallets.map((address) => ({ address, kind: 'embedded' as const })) });

test('★ the owner is whoever policy lists, by signed wallet or X handle; an empty list is nobody', () => {
  const owner = { wallets: [W], xHandles: ['boss'] };
  assert.equal(ownerRefOf(person([W], null), owner), `wallet:${W}`);
  assert.equal(ownerRefOf(person([W.toLowerCase()], null), owner), null, 'a wallet is case-sensitive');
  assert.equal(ownerRefOf(person([], '@Boss'), owner), 'x:boss', 'a handle is not');
  assert.equal(ownerRefOf(person([W], 'boss'), { wallets: [], xHandles: [] }), null);
  assert.equal(ownerRefOf(person([W], 'boss'), undefined), null, 'no owner policy means nobody');
});

test('a call is checked before it is saved', () => {
  assert.equal(typeof parseFeedback(null), 'string');
  assert.equal(typeof parseFeedback({ kind: 'story', itemId: 'x:1', call: 'not' }), 'string');
  assert.equal(typeof parseFeedback({ kind: 'post', itemId: 'x 1', call: 'not' }), 'string');
  assert.equal(typeof parseFeedback({ kind: 'post', itemId: 'x:1', call: 'not', note: 'x'.repeat(201) }), 'string');
  const ok = parseFeedback({ kind: 'post', itemId: 'x:1', call: 'not', note: '  sports  ' });
  assert.ok(typeof ok !== 'string');
  assert.equal(ok.note, 'sports');
  assert.equal(ok.coin, null);
});
