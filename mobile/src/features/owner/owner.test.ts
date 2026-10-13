/** The owner's controls: who sees them, what a reply decodes to, and what the app holds after a tap. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Coin, PostCoinLink } from '../../shared/api/index.ts';
import { callsByItem, decodeCalls, decodeHidden, decodeOwner, savedCallOf } from '../../shared/api/wire/owner.ts';
import { callKey, cardOf, createOwnerStore, withoutHidden } from './owner-store.ts';
import { coinAsk, coinCallLine, hiddenAgo, nameCallLine } from './owner-view.ts';

const MINT = 'FerryHorn1111111111111111111111111111111pump';
const call = (over: Record<string, unknown> = {}) => ({ kind: 'post', itemId: 'x:1', call: 'not', coin: null, name: null, ticker: null, betterName: null, note: null, at: 1_000, ...over });

test('★ only an exact { owner: true } draws the controls', () => {
  assert.equal(decodeOwner({ owner: true }), true);
  for (const raw of [{ owner: 'true' }, { owner: 1 }, {}, null, 'yes', { error: 'Sign in first.' }]) assert.equal(decodeOwner(raw), false, JSON.stringify(raw));
});

test('a call outside its kind\'s list is dropped, never drawn as something else', () => {
  assert.equal(savedCallOf(call())?.call, 'not');
  assert.equal(savedCallOf(call({ call: 'right' })), null, 'a post is meme or not');
  assert.equal(savedCallOf(call({ kind: 'story' })), null);
  assert.equal(savedCallOf(call({ at: 'yesterday' })), null);
  assert.deepEqual(decodeCalls({ calls: [call(), call({ kind: 'coin_match', call: 'none' }), call({ kind: 'name', call: 'meh' })] }).map((c) => c.call), ['not', 'none']);
  assert.deepEqual(decodeCalls({ nope: true }), []);
});

test('★ a hidden post is drawn from its saved card, with https links only', () => {
  const [p] = decodeHidden({
    posts: [
      { itemId: 'x:1', note: 'ad', at: 5, shown: { excerpt: 'a dog', authorLabel: '@d', permalink: 'javascript:alert(1)', thumbUrl: 'https://img.example/a.jpg' } },
      { itemId: '', at: 5 },
    ],
  });
  assert.deepEqual(p, { itemId: 'x:1', note: 'ad', at: 5, card: { excerpt: 'a dog', authorLabel: '@d', sourceLabel: null, permalink: null, thumbUrl: 'https://img.example/a.jpg' } });
  assert.equal(decodeHidden({ posts: [{ itemId: 'x:2', at: 1 }] })[0]?.card.excerpt, null, 'no card saved is said as such, not invented');
});

test('the newest call per item wins; names are kept apart by name', () => {
  const calls = callsByItem([
    savedCallOf(call({ at: 1 }))!,
    savedCallOf(call({ at: 2, call: 'meme' }))!,
    savedCallOf(call({ kind: 'name', call: 'up', name: 'Dog', at: 3 }))!,
    savedCallOf(call({ kind: 'name', call: 'down', name: 'Hat', at: 4 }))!,
  ]);
  assert.equal(calls.get('x:1')?.call, 'meme');
  assert.equal(calls.size, 3);
});

test('★ a hide takes the post out at once; a refused save puts it back and says why', () => {
  const store = createOwnerStore();
  let heard = 0;
  store.subscribe(() => (heard += 1));
  store.setOwner(true);
  store.hideNow({ itemId: 'x:1', shown: {} });
  assert.deepEqual(withoutHidden([{ id: 'x:1' }, { id: 'x:2' }], store.get().hidden, (r) => r.id), [{ id: 'x:2' }]);
  assert.equal(store.get().justHidden?.itemId, 'x:1');
  store.failed('x:1', 'Only the owner can do this.');
  assert.equal(store.get().hidden.has('x:1'), false);
  assert.equal(store.get().justHidden, null);
  assert.equal(store.get().problem, 'Only the owner can do this.');
  assert.ok(heard >= 3);

  store.hideNow({ itemId: 'x:2', shown: {} });
  store.showNow('x:2');
  assert.equal(store.get().hidden.size, 0, '"Is a meme" brings it back');

  store.remember([savedCallOf(call({ kind: 'coin_match', call: 'right', coin: MINT, at: 9 }))!, savedCallOf(call({ kind: 'coin_match', call: 'wrong', at: 3 }))!]);
  assert.equal(store.get().calls.get(callKey({ kind: 'coin_match', itemId: 'x:1' }))?.call, 'right', 'an older answer arriving late does not overwrite a newer one');

  store.hideNow({ itemId: 'x:3', shown: {} });
  store.setOwner(false);
  assert.equal(store.get().hidden.size, 0, 'signing out forgets everything the owner did');
});

test('★ a coin is called only where the card shows one', () => {
  const coin = { coinId: `solana:${MINT}`, address: MINT, ticker: 'FERRY' } as unknown as Coin;
  assert.deepEqual(coinAsk({ kind: 'one', coin }), { kind: 'confirm', coin });
  assert.deepEqual(coinAsk({ kind: 'unsure', claimCount: 3 }), { kind: 'pick' });
  for (const coins of [{ kind: 'unsure', claimCount: 0 }, { kind: 'none' }, { kind: 'pending' }, { kind: 'unchecked' }, { kind: 'several', coins: [coin, coin] }] as PostCoinLink[]) {
    assert.equal(coinAsk(coins), null, coins.kind);
  }
});

test('the card says what the owner said, in words', () => {
  assert.equal(coinCallLine(undefined), null);
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'right', coin: MINT }))!), 'You said this is the coin.');
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'wrong' }))!), 'You said this is the wrong coin.');
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'wrong', coin: MINT }))!), 'You said it is another coin, and picked it.');
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'none' }))!), 'You said no coin is from this.');
  assert.equal(nameCallLine(savedCallOf(call({ kind: 'name', call: 'down', name: 'Hat', betterName: 'Hat Dog' }))!), 'You passed on this name. Better: Hat Dog.');
  assert.equal(hiddenAgo(0, 30_000), 'Hidden just now');
  assert.equal(hiddenAgo(0, 3 * 3_600_000), 'Hidden 3h ago');
});

test('the card saved with a hide is its facts and nothing more', () => {
  const card = cardOf({ excerpt: 'a dog', authorLabel: '@d', sourceLabel: 'X', permalink: null, thumbUrl: null, thumbIsVideo: false });
  assert.deepEqual(Object.keys(card).sort(), ['authorLabel', 'excerpt', 'permalink', 'sourceLabel', 'thumbIsVideo', 'thumbUrl']);
});
