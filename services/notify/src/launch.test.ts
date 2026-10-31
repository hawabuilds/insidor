/** The one push (launch.ts): a post's first pick only, only a coin launched after For You showed it, each coin once, strongest first. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { postOfRow } from './faces.ts';
import { isRevival, launchEvents, launchHref, onLaunchpad, pvpSwitchDue, type Picked } from './launch.ts';

const L = DEFAULT_POLICY.notify.launch;
const MIN = 60_000;
const NOW = 1_792_500_000_000;
const ON_FYP = NOW - 60 * MIN;

const pick = (key: string, address: string, over: Partial<Picked> = {}): Picked => ({
  key, address, ticker: address.slice(0, 4), onForYouMs: ON_FYP, launchedMs: ON_FYP + 30 * MIN, capUsd: 50_000,
  itemId: key.slice(2), excerpt: 'words', author: '@a', image: null, logo: null, ...over,
});

test('★ a coin launched after the post was on For You, picked as its first coin, is pushed once', () => {
  const first = launchEvents([pick('p:x:1', 'PUMPKIN')], [], new Set(), NOW, L);
  assert.deepEqual(first.due.map((d) => d.address), ['PUMPKIN']);
  assert.deepEqual(first.keys, ['p:x:1', 'c:PUMPKIN']);
  const again = launchEvents([pick('p:x:1', 'PUMPKIN')], [], new Set(first.keys), NOW, L);
  assert.deepEqual(again.due, [], 'the same pick next pass is nothing');
});

test('★ never a hand-over: a post whose first pick was not pushed stays spent for every later coin', () => {
  /* First pick: a coin older than the post on For You (the owner: "idc about the coins that come after" is the other half). */
  const older = launchEvents([pick('p:x:2', 'OLDKIM', { launchedMs: ON_FYP - 120 * MIN })], [], new Set(), NOW, L);
  assert.deepEqual(older.due, [], 'launched before For You showed the post: not "caught early"');
  assert.deepEqual(older.keys, ['p:x:2'], 'the post is spent all the same');
  const handover = launchEvents([pick('p:x:2', 'NEWKIM')], [], new Set(older.keys), NOW, L);
  assert.deepEqual(handover.due, [], 'its later coin is a hand-over, never news');
});

test('★ the runner hand-over is pushed past rule 1, once a runner — every new runner of the post', () => {
  /* 24 Oct: $CAT, launched before the cat post was on For You, never pushed; baldcat ran 73 minutes after its launch. */
  const older = launchEvents([pick('p:x:cat', 'CAT', { launchedMs: ON_FYP - 120 * MIN })], [], new Set(), NOW, L);
  const runners = new Map([['x:cat', 'BALDCAT']]);
  const r = launchEvents([pick('p:x:cat', 'BALDCAT')], [], new Set(older.keys), NOW, L, runners);
  assert.deepEqual(r.due.map((d) => [d.address, d.runner]), [['BALDCAT', true]]);
  assert.deepEqual(r.keys, ['h:x:cat|BALDCAT', 'c:BALDCAT']);
  const back = launchEvents([pick('p:x:cat', 'CAT', { launchedMs: ON_FYP - 120 * MIN })], [], new Set([...older.keys, ...r.keys]), NOW, L, new Map([['x:cat', 'CAT']]));
  assert.deepEqual(back.due, [], 'handed back to a coin launched before For You: not "caught early"');
  /* A third coin runs past baldcat later: pushed too (the owner, 2026-10-24: "notify on every new runner"). */
  const third = launchEvents([pick('p:x:cat', 'NEXT')], [], new Set([...older.keys, ...r.keys]), NOW, L, new Map([['x:cat', 'NEXT']]));
  assert.deepEqual(third.due.map((d) => [d.address, d.runner]), [['NEXT', true]]);
  /* Handed back to baldcat: already pushed, nothing again. */
  const again = launchEvents([pick('p:x:cat', 'BALDCAT')], [], new Set([...older.keys, ...r.keys, ...third.keys]), NOW, L, runners);
  assert.deepEqual(again.due, []);
  const notYet = launchEvents([pick('p:x:cat', 'CAT', { launchedMs: ON_FYP - 120 * MIN })], [], new Set(older.keys), NOW, L, runners);
  assert.deepEqual(notYet, { due: [], keys: [] }, 'the card not yet showing the new coin: waits, nothing spent');
  const ordinary = launchEvents([pick('p:x:cat', 'BALDCAT')], [], new Set(older.keys), NOW, L);
  assert.deepEqual(ordinary.due, [], 'a hand-over by the one-coin rule is still never news');
});

test('a runner hand-over keeps rules 2-4: after For You, just launched, a coin pushed once', () => {
  const runners = new Map([['x:r', 'RUN']]);
  assert.deepEqual(launchEvents([pick('p:x:r', 'RUN', { launchedMs: ON_FYP - 1 })], [], new Set(['p:x:r']), NOW, L, runners).due, [], 'before For You showed the post');
  assert.deepEqual(launchEvents([pick('p:x:r', 'RUN', { launchedMs: NOW - L.maxLaunchAgeMs - 1 })], [], new Set(['p:x:r']), NOW, L, runners).due, [], 'not just launched');
  assert.deepEqual(launchEvents([pick('p:x:r', 'RUN')], [], new Set(['p:x:r', 'c:RUN']), NOW, L, runners).due, [], 'the coin was pushed before');
  assert.equal(launchEvents([pick('p:x:r', 'RUN')], [], new Set(), NOW, L, runners).due.length, 1, 'a post never seen: its runner is its one push');
});

test('a coin launched between the post and its first showing on For You, or of unknown launch, is not pushed', () => {
  assert.deepEqual(launchEvents([pick('p:x:3', 'A', { launchedMs: ON_FYP - 1 })], [], new Set(), NOW, L).due, []);
  assert.deepEqual(launchEvents([pick('p:x:3', 'A', { launchedMs: null })], [], new Set(), NOW, L).due, [], 'an unknown launch is no claim it came after');
  assert.equal(launchEvents([pick('p:x:3', 'A', { launchedMs: ON_FYP })], [], new Set(), NOW, L).due.length, 1, 'the same minute counts');
});

test('a pick seen long after its launch is not "just launched"', () => {
  const late = pick('p:x:4', 'BENNY', { onForYouMs: NOW - 3_000 * MIN, launchedMs: NOW - L.maxLaunchAgeMs - 1 });
  assert.deepEqual(launchEvents([late], [], new Set(), NOW, L).due, []);
  assert.equal(launchEvents([{ ...late, launchedMs: NOW - L.maxLaunchAgeMs }], [], new Set(), NOW, L).due.length, 1);
});

test('★ one coin, one push: two posts, or a post and its narrative, picking the same coin push once — the post first', () => {
  const r = launchEvents([pick('p:x:5', 'SPACEX'), pick('p:x:6', 'SPACEX')], [pick('n:n-x:5', 'SPACEX', { itemId: 'x:7' })], new Set(), NOW, L);
  assert.deepEqual(r.due.map((d) => d.key), ['p:x:5']);
  assert.deepEqual(r.keys, ['p:x:5', 'c:SPACEX', 'p:x:6', 'n:n-x:5'], 'every subject is spent, the coin once');
  const later = launchEvents([], [pick('n:n-x:9', 'SPACEX')], new Set(r.keys), NOW, L);
  assert.deepEqual(later.due, [], 'a coin pushed on an earlier pass is never pushed again');
});

test('a narrative\'s first coin is pushed when no post pushed it, about its first post on For You', () => {
  const r = launchEvents([], [pick('n:n-x:8', 'KOHEN', { itemId: 'x:8' })], new Set(), NOW, L);
  assert.deepEqual(r.due.map((d) => [d.key, d.itemId]), [['n:n-x:8', 'x:8']]);
});

test('★ the strongest first: a pass queues its coins highest market cap first, an unknown cap last', () => {
  const r = launchEvents([pick('p:a', 'SMALL', { capUsd: 18_000 }), pick('p:b', 'NONE', { capUsd: null }), pick('p:c', 'BIG', { capUsd: 1_400_000 })], [], new Set(), NOW, L);
  assert.deepEqual(r.due.map((d) => d.address), ['BIG', 'SMALL', 'NONE']);
});

test('★ a coin-first post: its coin came first, and its first pick is pushed, even when a dud copycat linked it first', () => {
  const before = { launchedMs: ON_FYP - 10 * MIN };
  const first = launchEvents([pick('p:x:9', 'LAURA', { ...before, coinFirst: { firstCoinAddress: 'LAURA' } })], [], new Set(), NOW, L);
  assert.deepEqual(first.due.map((d) => d.address), ['LAURA'], 'the first coin that launched and is running');
  const copycatFirst = launchEvents([pick('p:x:9', 'LAURA', { ...before, coinFirst: { firstCoinAddress: 'COPYCAT' } })], [], new Set(), NOW, L);
  assert.deepEqual(copycatFirst.due.map((d) => d.address), ['LAURA'], 'a dud linked first; the first coin to run is still the news');
  const later = launchEvents([pick('p:x:9', 'OTHER', { ...before, coinFirst: { firstCoinAddress: 'LAURA' } })], [], new Set(['p:x:9']), NOW, L);
  assert.deepEqual(later.due, [], 'a post already picked once is spent: no later coin is pushed');
  const notRoute = launchEvents([pick('p:x:9', 'LAURA', before)], [], new Set(), NOW, L);
  assert.deepEqual(notRoute.due, [], 'a post For You took on its views keeps rule 2');
  const stale = launchEvents([pick('p:x:9', 'LAURA', { launchedMs: NOW - L.maxLaunchAgeMs - 1, coinFirst: { firstCoinAddress: 'LAURA' } })], [], new Set(), NOW, L);
  assert.deepEqual(stale.due, [], 'still only a coin that just launched');
});

test('★ a tap on a launch push opens the coin\'s chart, and the list still draws the post as its card', () => {
  const p = pick('p:x:2113437949748785214', 'GhCkyzX8ngPeC4Anq66khJb2jaSPf13T2DSE4bdkpump');
  const href = launchHref(p);
  assert.equal(href, '/#/token/solana%3AGhCkyzX8ngPeC4Anq66khJb2jaSPf13T2DSE4bdkpump', 'the token page, as the app routes it');
  assert.equal(postOfRow({ kind: 'coin_launched', subject: p.address, href, facts: { item: p.itemId } }), 'x:2113437949748785214', 'the post rides in the facts');
  assert.equal(postOfRow({ kind: 'coin_launched', subject: 'x:1', href: '/#/post/x%3A9' }), 'x:9', 'a row from before still finds its post by its link');
});

test('★ only a launchpad coin is pushed: the stored row decides, and launch timing stays rule 2\'s', () => {
  const f = { venueId: 'solana:pumpfun', origin: 'live_stream', launchedMs: ON_FYP, hadPostMs: ON_FYP };
  assert.equal(onLaunchpad(f), true);
  assert.equal(onLaunchpad({ ...f, launchedMs: ON_FYP - 1 }), true, 'a coin-first post\'s coin came first: rule 2, not the venue, decides it');
  assert.equal(onLaunchpad({ ...f, venueId: null, origin: null }), false, 'no row: not placed on the launchpad');
  assert.equal(onLaunchpad({ ...f, origin: 'paired_token' }), false);
  assert.equal(onLaunchpad(undefined), false);
});

test('★ a coin picked late is pushed while it runs, up to a day old; quiet, its post waits unspent; a day old, it is spent', () => {
  /* Launched 6 hours ago, after the post was on For You (baldcat was picked 5h50m after its launch). */
  const late = { onForYouMs: NOW - 8 * 60 * MIN, launchedMs: NOW - 6 * 60 * MIN };
  const quiet = launchEvents([pick('p:x:late', 'BALD', { ...late, runningNow: false })], [], new Set(), NOW, L);
  assert.deepEqual(quiet.due, []);
  assert.deepEqual(quiet.keys, [], 'not spent: looked at again next pass');
  /* It dies and runs again inside the day: pushed then. */
  const running = launchEvents([pick('p:x:late', 'BALD', { ...late, runningNow: true })], [], new Set(quiet.keys), NOW, L);
  assert.deepEqual(running.due.map((d) => d.address), ['BALD']);
  /* Past a day: spent, never pushed. */
  const old = { onForYouMs: NOW - 30 * 60 * MIN, launchedMs: NOW - 25 * 60 * MIN };
  const gone = launchEvents([pick('p:x:old', 'OLD', { ...old, runningNow: true })], [], new Set(), NOW, L);
  assert.deepEqual(gone.due, []);
  assert.deepEqual(gone.keys, ['p:x:old']);
  /* Launched before For You showed the post: still not "caught early", late or not. */
  const before = launchEvents([pick('p:x:b', 'B', { onForYouMs: NOW - 5 * 60 * MIN, launchedMs: NOW - 6 * 60 * MIN, runningNow: true })], [], new Set(), NOW, L);
  assert.deepEqual(before.due, []);
});

test('★ the Light Baby case: an old original brought back by its promotion coin is pushed once, past rules 1 and 2', () => {
  /* 24 Oct: $BI launched 12:27 for @Infinitidigits' quote of @prtygal777's 6-day-old post; the original came back with it. */
  const revived = pick('p:x:lightbaby', 'BI', { revival: true, runningNow: true, onForYouMs: NOW - 6 * 24 * 60 * MIN, launchedMs: NOW - 60 * MIN });
  const first = launchEvents([revived], [], new Set(['p:x:lightbaby']), NOW, L);
  assert.deepEqual(first.due.map((d) => d.address), ['BI'], 'the post spent long ago and the coin older than this For You: pushed all the same');
  assert.deepEqual(first.keys, ['v:x:lightbaby', 'c:BI']);
  assert.deepEqual(launchEvents([revived], [], new Set(['p:x:lightbaby', ...first.keys]), NOW, L).due, [], 'once per post');
  assert.deepEqual(launchEvents([{ ...revived, itemId: 'x:other', key: 'p:x:other' }], [], new Set(first.keys), NOW, L).due, [], 'once per coin');
});

test('a revival waits, unspent, while its coin is quiet, and is never pushed past a day after the launch', () => {
  const quiet = pick('p:x:old', 'OLD', { revival: true, runningNow: false, launchedMs: NOW - 60 * MIN });
  assert.deepEqual(launchEvents([quiet], [], new Set(), NOW, L), { due: [], keys: [] });
  const stale = pick('p:x:old', 'OLD', { revival: true, runningNow: true, launchedMs: NOW - L.lateRunningMs - 1 });
  assert.deepEqual(launchEvents([stale], [], new Set(), NOW, L), { due: [], keys: [] });
});

test('a revival is a picked coin that is not the post own pick and launched past the coin-link age after it', () => {
  const day = 24 * 60 * MIN;
  assert.equal(isRevival({ launchedMs: 6 * day, postedMs: 0, ownPick: false }), true);
  assert.equal(isRevival({ launchedMs: 6 * day, postedMs: 0, ownPick: true }), false, 'the post own pick keeps the ordinary rules');
  assert.equal(isRevival({ launchedMs: 2 * day, postedMs: 0, ownPick: false }), false, 'a young original is pushed by the ordinary rules');
  assert.equal(isRevival({ launchedMs: null, postedMs: 0, ownPick: false }), false);
});

test('★ a PvP alert only when the new coin is another coin, both caps read, past the floor and above the first', () => {
  const first = { address: 'FIRST', symbol: 'KIJ', capUsd: 12_000 };
  assert.equal(pvpSwitchDue({ address: 'NEW', capUsd: 51_000 }, first, 25_000), true);
  assert.equal(pvpSwitchDue({ address: 'NEW', capUsd: 11_000 }, { ...first, capUsd: 10_000 }, 25_000), false, 'under the floor');
  assert.equal(pvpSwitchDue({ address: 'NEW', capUsd: 30_000 }, { ...first, capUsd: 40_000 }, 25_000), false, 'not ahead of the first');
  assert.equal(pvpSwitchDue({ address: 'NEW', capUsd: 51_000 }, { ...first, capUsd: null }, 25_000), false, 'an unread first cap is no claim');
  assert.equal(pvpSwitchDue({ address: 'FIRST', capUsd: 51_000 }, first, 25_000), false, 'the same coin');
  assert.equal(pvpSwitchDue({ address: 'NEW', capUsd: 51_000 }, undefined, 25_000), false, 'no first push to anyone');
});
