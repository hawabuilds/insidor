/**
 * The owner's coin labels as live checks on a feed post (rising.ts `postCoins`, `coinChecks`) and
 * the story's coin on it (story-coins.ts): "No coin is from this" shows no coin, a coin called
 * wrong for the post or its story is never shown, and "Coin for this story" outranks the
 * narrative's link but never the owner's own call.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { foldCoinCalls } from '@insidor/core';

import { coinChecks, lookupWithoutWrong, postCoins, withoutWrong, type PostLookup } from './rising.ts';
import { anchorsOf } from './story-coins.ts';
import { storyWrongCoins } from './db.ts';
import type { WireCoin, WireCoinLink } from './wire.ts';

const coin = (address: string): WireCoin => ({ coinId: `chain:${address}`, address, ticker: address }) as unknown as WireCoin;
const call = (itemId: string, verdict: string, coinAddress: string | null, atMs: number, shownCoin: string | null = null) => ({ itemId, verdict, coinAddress, shownCoin, atMs, id: atMs });

test('★ "No coin is from this" shows no coin, over the narrative\'s link and the evidence', () => {
  const calls = foldCoinCalls([call('x:p', 'none', null, 1)]);
  const check = coinChecks(['x:p'], calls, new Map()).get('x:p') ?? null;
  const proven: PostLookup = { coins: ['A'], more: false, match: { kind: 'matched', coin: coin('A'), evidence: { linksPost: true, samePicture: null, launchedAfterMs: null } } };
  assert.deepEqual(postCoins({ kind: 'one', coin: coin('S') }, proven, check).coins, { kind: 'none' });
});

test('★ a coin the owner called wrong for the post is taken off the narrative\'s link and the list', () => {
  const calls = foldCoinCalls([call('x:p', 'wrong', null, 1, 'BAD')]);
  const check = coinChecks(['x:p'], calls, new Map()).get('x:p') ?? null;
  assert.ok(check !== null);
  const one: WireCoinLink = { kind: 'one', coin: coin('BAD') };
  assert.equal(withoutWrong(one, check), undefined);
  const several: WireCoinLink = { kind: 'several', coins: [coin('BAD'), coin('B'), coin('C')] };
  assert.deepEqual(withoutWrong(several, check), { kind: 'several', coins: [coin('B'), coin('C')] });
  assert.equal(withoutWrong({ kind: 'several', coins: [coin('BAD'), coin('B')] }, check), undefined);
  const searched = lookupWithoutWrong({ coins: ['BAD', 'B'], more: false }, check);
  assert.deepEqual(postCoins(one, searched, check).coins, { kind: 'unsure', claimCount: 1 });
});

test('★ a coin called wrong on a post of the story is kept off the post; the owner\'s own coin never is', () => {
  const stories = new Map([['x:p', { coin: null, wrong: new Set(['KARL']) }], ['x:own', { coin: null, wrong: new Set(['MINE']) }]]);
  const calls = foldCoinCalls([call('x:own', 'right', 'MINE', 1)]);
  const checks = coinChecks(['x:p', 'x:own', 'x:clean'], calls, stories);
  assert.equal(checks.get('x:p')?.wrong.has('KARL'), true);
  assert.equal(checks.has('x:own'), false);
  assert.equal(checks.has('x:clean'), false);
});

test('★ "Coin for this story" outranks the narrative\'s link; the owner\'s own coin outranks both', () => {
  const story: PostLookup = { coins: [], more: false, match: { kind: 'matched', coin: coin('GTA'), evidence: { linksPost: null, samePicture: null, launchedAfterMs: 60_000, storyCoin: true }, story: true } };
  const shown = postCoins({ kind: 'one', coin: coin('OTHER') }, story);
  assert.equal(shown.fromStory, false);
  assert.deepEqual(shown.coins, { kind: 'matched', coin: coin('GTA'), evidence: { linksPost: null, samePicture: null, launchedAfterMs: 60_000, storyCoin: true } });
});

test('the anchors are every confirmed coin and every coin called wrong, the KARL retraction among them', () => {
  const calls = foldCoinCalls([call('x:gta', 'right', 'GTA', 1), call('x:karl', 'right', 'KARL', 2), call('x:karl', 'wrong', 'KARL', 3)]);
  assert.deepEqual(anchorsOf(calls), [
    { itemId: 'x:gta', coin: 'GTA', atMs: 1, kind: 'right' },
    { itemId: 'x:karl', coin: 'KARL', atMs: 3, kind: 'wrong' },
  ]);
});

test('★ a board story drops a coin the owner called wrong on any of its posts', () => {
  const calls = foldCoinCalls([call('x:karl', 'right', 'KARL', 1), call('x:karl', 'wrong', 'KARL', 2)]);
  const wrong = storyWrongCoins([{ story_id: 's1', item_id: 'x:karl' }, { story_id: 's1', item_id: 'x:other' }, { story_id: 's2', item_id: 'x:other' }], calls);
  assert.deepEqual([...(wrong.get('s1') ?? [])], ['KARL']);
  assert.equal(wrong.has('s2'), false);
});
