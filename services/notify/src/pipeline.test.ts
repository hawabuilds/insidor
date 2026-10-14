/** The pipeline's alerts on recorded frames: only what is new to us, a narrative's first coin once, each matched coin to its watchers. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { coinEvents, fypCoinEvents, newPromoted, newRising, settledCoins, viewGain, type BoardStory, type RisingRow } from './pipeline.ts';

/* Recorded from /rising/fyp and /board/default frames, trimmed to the fields the alerts read. */
const RISING = [
  { itemId: 'x:1823', payload: { sourceLabel: 'X', authorLabel: '@nordkyst_ferge', reach: { v: 2_400_000 }, storyId: 'st_ferry' } },
  { itemId: 'tiktok:77', payload: { sourceLabel: 'TikTok', authorLabel: '@parkdays', reach: { v: null }, storyId: null } },
];
const FERRY = { address: 'FerryHorn1111111111111111111111111111111pump', ticker: 'FERRY' };
const HORN = { address: 'HornHorn11111111111111111111111111111111pump', ticker: 'HORN' };

test('a rising post alerts once: the second frame with it is not news', () => {
  const first = newRising(RISING, new Set());
  assert.deepEqual(first.map((p) => [p.kind, p.subject, p.href]), [['rising_post', 'x:1823', '/#/post/x%3A1823'], ['rising_post', 'tiktok:77', '/#/post/tiktok%3A77']], 'a new post opens its own sheet');
  assert.deepEqual(first[0]?.facts, { source: 'X', author: '@nordkyst_ferge', views: 2_400_000, excerpt: '', gain: null, gainMinutes: null, image: null });
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

test('+change in 5m is the newest reading against the one nearest five minutes before; none without such a pair', () => {
  const t = 1_791_989_000_000;
  assert.deepEqual(viewGain([{ atMs: t, value: 713_000 }, { atMs: t + 300_000, value: 751_000 }]), { gain: 38_000, minutes: 5 });
  assert.deepEqual(viewGain([{ atMs: t, value: 1 }, { atMs: t + 60_000, value: 700_000 }, { atMs: t + 360_000, value: 751_000 }]), { gain: 51_000, minutes: 5 });
  assert.equal(viewGain([{ atMs: t, value: 91_883 }]), null, 'one reading: no change is claimed');
  assert.equal(viewGain([{ atMs: t, value: null }, { atMs: t + 300_000, value: 91_883 }]), null, 'an unread view count is not 0');
  assert.equal(viewGain([{ atMs: t, value: 5 }, { atMs: t + 30 * 60_000, value: 9 }]), null, 'thirty minutes back is not five');
});

const coinLine = (address: string, ev: Record<string, unknown>) => ({ kind: 'matched', coin: { address, ticker: 'GTA', name: 'GTA memes', marketCapUsd: { v: 410_000 }, imageUrl: null, mintedAt: { at: 1 } }, evidence: ev });
const post = (itemId: string, coins: unknown): RisingRow => ({ itemId, payload: { authorLabel: '@a', coins } });
const NONE = { coin: new Set<string>(), proven: new Set<string>(), story: new Set<string>() };

test("★ a For You post's coins: the first coin once, a proven coin as proven, a story's coin as the story's", () => {
  const rows = [
    post('x:1', coinLine('Proven1111111111111111111111111111111pump', { linksPost: true, launchedAfterMs: 120_000 })),
    post('x:2', coinLine('Story11111111111111111111111111111111pump', { storyCoin: true })),
    post('x:3', { kind: 'unsure', claimCount: 3 }),
    post('x:4', { kind: 'none' }),
  ];
  const listed = new Map([['x:3', { address: 'Listed1111111111111111111111111111111pump', launchedAfterMs: 33 * 60_000 }]]);
  const r = fypCoinEvents(rows, listed, NONE);
  assert.deepEqual(r.events.map((e) => [e.kind, e.itemId, e.launchedAfterMs]), [['fyp_proven', 'x:1', 120_000], ['story_post', 'x:2', null], ['fyp_coin', 'x:3', 33 * 60_000]]);
  assert.deepEqual(r.coinKeys, ['x:1', 'x:2', 'x:3'], 'a proven or story coin spends the post\'s "coin found"');
  const again = fypCoinEvents(rows, listed, { coin: new Set(r.coinKeys), proven: new Set(r.provenKeys), story: new Set(r.storyKeys) });
  assert.deepEqual(again.events, [], 'never twice');
  const later = fypCoinEvents([post('x:3', coinLine('Listed1111111111111111111111111111111pump', { linksPost: true }))], listed, { coin: new Set(r.coinKeys), proven: new Set(r.provenKeys), story: new Set() });
  assert.deepEqual(later.events.map((e) => e.kind), ['fyp_proven'], 'a coin found earlier and proven later is news once more, as proven');
});

test("★ a coin the poster's profile proves LATER (the profile was read again after the post first showed) is pushed as proven once, then never again", () => {
  const A = 'AMQ8BusAhpwbt3ufSCTi4k3BEQ7AecX9u12Jnk6Spump';
  /* First frame: the post's coin is only in its list ("See 2 coins"): a coin found. */
  const first = fypCoinEvents([post('tiktok:1', { kind: 'unsure', claimCount: 2 })], new Map([['tiktok:1', { address: A, launchedAfterMs: 46 * 3_600_000 }]]), NONE);
  assert.deepEqual(first.events.map((e) => e.kind), ['fyp_coin']);
  /* Later frame: the profile now names A, the projector proves it, the line says posterBioNamesCoin. */
  const proven = post('tiktok:1', coinLine(A, { linksPost: false, samePicture: null, launchedAfterMs: 46 * 3_600_000, posterBioNamesCoin: true }));
  const seen = { coin: new Set(first.coinKeys), proven: new Set(first.provenKeys), story: new Set(first.storyKeys) };
  const later = fypCoinEvents([proven], new Map(), seen);
  assert.deepEqual(later.events.map((e) => [e.kind, e.key, e.bio]), [['fyp_proven', `tiktok:1|${A}`, true]]);
  const again = fypCoinEvents([proven], new Map(), { ...seen, proven: new Set([...seen.proven, ...later.provenKeys]) });
  assert.deepEqual(again.events, [], 'deduplicated per post and coin');
});

test('a watched post whose coin the profile proves later: the line carries it, so the watch loop ties it ("Watchlist: coin found", once per person, post and coin)', async () => {
  const { lineCoin } = await import('./post-watch.ts');
  const A = 'AMQ8BusAhpwbt3ufSCTi4k3BEQ7AecX9u12Jnk6Spump';
  const line = lineCoin({ coins: coinLine(A, { linksPost: null, launchedAfterMs: 1, posterBioNamesCoin: true }) });
  assert.equal(line?.address, A);
  assert.equal(line?.posterBio, true);
  assert.equal(line?.linksPost, false);
});
