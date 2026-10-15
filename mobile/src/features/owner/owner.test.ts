/** The owner's controls: who sees them, what a reply decodes to, and what the app holds after a tap. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Coin, PostCoinLink, RisingPost } from '../../shared/api/index.ts';
import { callsByItem, decodeCalls, decodeHidden, decodeOwner, savedCallOf } from '../../shared/api/wire/owner.ts';
import { KEEP_MS, callKey, cardOf, createOwnerStore, readKept, withoutHidden, type KeptStorage } from './owner-store.ts';
import { withOlder } from '../feed/older-feed.ts';
import { merge, reconcile } from '../feed/live-feed.ts';
import { coinAsk, coinCallLine, hiddenAgo, launchLine, nameCallLine } from './owner-view.ts';

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
  const store = createOwnerStore({ storage: null });
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

test('★ a coin is called on every post line; a narrative\'s several coins ask nothing', () => {
  const coin = { coinId: `solana:${MINT}`, address: MINT, ticker: 'FERRY' } as unknown as Coin;
  assert.deepEqual(coinAsk({ kind: 'one', coin }), { kind: 'confirm', coin });
  assert.deepEqual(coinAsk({ kind: 'matched', coin, evidence: { linksPost: true, samePicture: null, launchedAfterMs: null } }), { kind: 'confirm', coin });
  for (const coins of [{ kind: 'unsure', claimCount: 3 }, { kind: 'unsure', claimCount: 0 }, { kind: 'none' }, { kind: 'pending' }, { kind: 'unchecked' }] as PostCoinLink[]) {
    assert.deepEqual(coinAsk(coins), { kind: 'pick' }, `${coins.kind}: a pasted address is always an answer`);
  }
  assert.equal(coinAsk({ kind: 'several', coins: [coin, coin] }), null, "a narrative's coins are the narrative's");
  assert.deepEqual(launchLine(18 * 60_000), { line: 'Launched 18m after the post', older: false });
  assert.deepEqual(launchLine(-3 * 3_600_000), { line: 'Launched 3h before the post', older: true });
  assert.equal(launchLine(null).older, false);
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'cleared' }))!), null, 'a removed label says nothing');
});

test('the card says what the owner said, in words', () => {
  assert.equal(coinCallLine(undefined), null);
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'right', coin: MINT }))!), 'Your coin');
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'wrong' }))!), 'Wrong coin');
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'wrong', coin: MINT }))!), 'Your coin', 'wrong with a coin picked names the right one');
  assert.equal(coinCallLine(savedCallOf(call({ kind: 'coin_match', call: 'none' }))!), 'No coin');
  assert.equal(nameCallLine(savedCallOf(call({ kind: 'name', call: 'down', name: 'Hat', betterName: 'Hat Dog' }))!), 'You passed on this name. Better: Hat Dog.');
  assert.equal(hiddenAgo(0, 30_000), 'Hidden just now');
  assert.equal(hiddenAgo(0, 3 * 3_600_000), 'Hidden 3h ago');
});

test('the card saved with a hide is its facts and nothing more', () => {
  const card = cardOf({ excerpt: 'a dog', authorLabel: '@d', sourceLabel: 'X', permalink: null, thumbUrl: null, thumbIsVideo: false });
  assert.deepEqual(Object.keys(card).sort(), ['authorLabel', 'excerpt', 'permalink', 'sourceLabel', 'thumbIsVideo', 'thumbUrl']);
});

/** A device's storage, kept between "reloads" (two stores made on the same one). */
function device(): KeptStorage & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return { kept, getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v), removeItem: (k) => void kept.delete(k) };
}

test('★ a hide survives a reload, a reconnect and a server still serving the post', () => {
  const phone = device();
  let t = 1_000_000;
  const first = createOwnerStore({ storage: phone, now: () => t });
  first.setOwner(true);
  first.hideNow({ itemId: 'x:1', shown: {} });
  t += 60_000;
  const reloaded = createOwnerStore({ storage: phone, now: () => t });
  assert.equal(reloaded.get().owner, null, 'not known yet after a reload');
  assert.ok(reloaded.get().hidden.has('x:1'), 'held before the services have said who this is');
  reloaded.setOwner(null);
  assert.ok(reloaded.get().hidden.has('x:1'), 'a wallet reconnecting passes through "not known" and must not bring it back');
  reloaded.setOwner(true);
  const served = [{ id: 'x:2' }, { id: 'x:1' }];
  assert.deepEqual(withoutHidden(served, reloaded.get().hidden, (r) => r.id), [{ id: 'x:2' }]);
});

test('★ "Is a meme" takes it out of the set, on the device too', () => {
  const phone = device();
  let t = 1_000_000;
  const store = createOwnerStore({ storage: phone, now: () => t });
  store.setOwner(true);
  store.hideNow({ itemId: 'x:1', shown: {} });
  t += 1;
  store.showNow('x:1');
  assert.equal(store.get().hidden.size, 0);
  assert.equal(createOwnerStore({ storage: phone, now: () => t }).get().hidden.size, 0, 'and still out after a reload');
  store.hideNow({ itemId: 'x:1', shown: {} });
  assert.ok(store.get().hidden.has('x:1'), 'hidden again after an undo, even within the same millisecond');
});

test('★ the server\'s own list seeds the set; a newer call on the device wins', () => {
  let t = 5_000;
  const store = createOwnerStore({ storage: device(), now: () => t });
  store.setOwner(true);
  store.showNow('x:2');
  store.seed([
    { itemId: 'x:1', at: 1_000 },
    { itemId: 'x:2', at: 4_000 },
  ]);
  assert.deepEqual([...store.get().hidden], ['x:1'], 'hidden on another device; brought back here after the server list was read');
  t = 9_000;
  store.seed([{ itemId: 'x:2', at: 8_000 }]);
  assert.ok(store.get().hidden.has('x:2'), 'a later Not a meme on the server is newer than the device\'s undo');
  store.remember([savedCallOf(call({ itemId: 'x:2', call: 'meme', at: 8_500 }))!]);
  assert.equal(store.get().hidden.has('x:2'), false, 'a saved call is a call like any other');
});

test('a held call is kept a day, a "not the owner" forgets it, and storage that throws changes nothing', () => {
  const phone = device();
  let t = 1_000_000;
  const store = createOwnerStore({ storage: phone, now: () => t });
  store.setOwner(true);
  store.hideNow({ itemId: 'x:1', shown: {} });
  t += KEEP_MS + 1;
  assert.equal(createOwnerStore({ storage: phone, now: () => t }).get().hidden.size, 0, 'a day later the projection has long caught up');
  assert.equal(readKept('[["x:1","not",5],["x:2","maybe",5],[3,"not",5],"junk"]', 5).size, 1);
  assert.equal(readKept('{not json', 5).size, 0);

  store.hideNow({ itemId: 'x:3', shown: {} });
  store.setOwner(false);
  assert.equal(store.get().hidden.size, 0);
  assert.equal(phone.kept.size, 0, 'someone else signed in: nothing of the owner\'s is left on the device');

  const broken: KeptStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  const held = createOwnerStore({ storage: broken });
  held.hideNow({ itemId: 'x:4', shown: {} });
  assert.ok(held.get().hidden.has('x:4'), 'held for the session when storage refuses');
});

test('★ every list path leaves a hidden post out: live merge, rebuild, older pages', () => {
  const p = (id: string) => ({ id }) as unknown as RisingPost;
  const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);
  const hidden = new Set(['x:h']);
  const m = merge([p('a')], [p('x:h'), p('b'), p('a')], hidden);
  assert.deepEqual(m.arrived, ['b'], 'a hidden post never slides in as new');
  assert.deepEqual(ids(withoutHidden(m.rows, hidden, (r) => r.id)), ['b', 'a']);
  const held = merge([p('x:h'), p('a')], [p('a')], hidden);
  assert.deepEqual(ids(withoutHidden(held.rows, hidden, (r) => r.id)), ['a'], 'a card held before the hide leaves too');
  const rebuilt = reconcile([p('x:h'), p('a')]);
  assert.deepEqual(ids(withoutHidden(rebuilt.rows, hidden, (r) => r.id)), ['a'], 'pull to refresh and coming back rebuild from the server');
  assert.deepEqual(ids(withoutHidden(withOlder([p('a')], [p('x:h'), p('c')]), hidden, (r) => r.id)), ['a', 'c'], 'an older page');
});
