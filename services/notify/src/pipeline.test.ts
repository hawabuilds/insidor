/** The pipeline's alerts on recorded frames: only what is new to us, a narrative's first coin once, each matched coin to its watchers. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { coinEvents, newPromoted, newRising, settledCoins, type BoardStory } from './pipeline.ts';

/* Recorded from /rising/fyp and /board/default frames, trimmed to the fields the alerts read. */
const RISING = [
  { itemId: 'x:1823', payload: { sourceLabel: 'X', authorLabel: '@nordkyst_ferge', reach: { v: 2_400_000 }, storyId: 'st_ferry' } },
  { itemId: 'tiktok:77', payload: { sourceLabel: 'TikTok', authorLabel: '@parkdays', reach: { v: null }, storyId: null } },
];
const FERRY = { address: 'FerryHorn1111111111111111111111111111111pump', ticker: 'FERRY' };
const HORN = { address: 'HornHorn11111111111111111111111111111111pump', ticker: 'HORN' };

test('a rising post alerts once: the second frame with it is not news', () => {
  const first = newRising(RISING, new Set());
  assert.deepEqual(first.map((p) => [p.kind, p.subject, p.href]), [['rising_post', 'x:1823', '/#/story/st_ferry'], ['rising_post', 'tiktok:77', '/#/']]);
  assert.deepEqual(first[0]?.facts, { source: 'X', author: '@nordkyst_ferge', views: 2_400_000 });
  assert.equal(first[1]?.facts['views'], null, 'unknown views stay unknown');
  assert.deepEqual(newRising(RISING, new Set(['x:1823', 'tiktok:77'])), []);
});

test('a narrative is announced when it is promoted, not while it is a candidate, and once', () => {
  const stories: BoardStory[] = [
    { storyId: 'st_ferry', title: 'Ferry horn', promoted: true, coins: [] },
    { storyId: 'st_seal', title: 'Seal', promoted: false, coins: [] },
  ];
  assert.deepEqual(newPromoted(stories, new Set()).map((p) => p.subject), ['st_ferry']);
  assert.deepEqual(newPromoted(stories, new Set(['st_ferry'])), []);
});

test("★ a narrative's first coin goes to everyone once; every newly matched coin goes to that narrative's watchers", () => {
  const frame1: BoardStory[] = [{ storyId: 'st_ferry', title: 'Ferry horn', promoted: true, coins: [FERRY] }];
  const e1 = coinEvents(frame1, new Set());
  assert.deepEqual(e1.proposed.map((p) => [p.kind, p.audience]), [['narrative_coin', 'everyone'], ['coin_matched', { watchers: 'st_ferry' }]]);
  const seen = new Set(e1.keys);
  assert.deepEqual(coinEvents(frame1, seen).proposed, [], 'the same frame again is nothing');
  const frame2: BoardStory[] = [{ storyId: 'st_ferry', title: 'Ferry horn', promoted: true, coins: [FERRY, HORN] }];
  const e2 = coinEvents(frame2, seen);
  assert.deepEqual(e2.proposed.map((p) => [p.kind, p.facts['symbol']]), [['coin_matched', 'HORN']], 'a second coin is not a first coin');
});

test("unsure and pending carry no coin; one and several do", () => {
  assert.deepEqual(settledCoins({ kind: 'unsure' }), []);
  assert.deepEqual(settledCoins({ kind: 'pending' }), []);
  assert.deepEqual(settledCoins({ kind: 'one', coin: FERRY }), [FERRY]);
  assert.deepEqual(settledCoins({ kind: 'several', coins: [FERRY, HORN] }), [FERRY, HORN]);
});
