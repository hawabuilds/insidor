/**
 * The short-video search's extra words: the learned list counts only the searched source's coined
 * posts (a text post's tags are its promoters'), drops the skip list and bare numbers, and keeps a
 * tag only at `minPosts` coined posts; the asks walk the list a slot at a time; a learned sound is
 * asked on the sound endpoint once a slot, credited to the trend lane; and with every switch off a
 * pass asks nothing and spends nothing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { laneJudgeUsd } from '@insidor/core';
import { inMemoryMeter } from '@insidor/meter';

import type { Logger } from '../log.ts';
import { memoryLaneLedger, type LaneLedger } from './lane-ledger.ts';
import { learnedTagWords, learnWords, searchWordClock, searchWordsPass, wordsForSlot } from './search-words.ts';

const NOW = 1_800_000_000_000 as Millis;
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;

test('learned words: the searched source only, the skip list and numbers dropped, a tag at minPosts', () => {
  const posts = [
    { source: 'vid', handle: 'buddy', body: '#raccoon #fyp #1', formatIds: ['vid:sound:9'] },
    { source: 'vid', handle: 'buddy', body: '#raccoon #cute', formatIds: ['vid:sound:9'] },
    { source: 'txt', handle: 'shill', body: '#raccoon #solana', formatIds: [] },
  ];
  const words = learnWords(posts, 'vid', DEFAULT_POLICY);
  assert.deepEqual(words.filter((w) => w.kind === 'tag').map((w) => [w.value, w.facts?.['coinedPosts']]), [['raccoon', 2]]);
  assert.deepEqual(words.filter((w) => w.kind === 'sound').map((w) => w.value), ['vid:sound:9']);
  assert.deepEqual(words.filter((w) => w.kind === 'creator').map((w) => w.value), ['buddy']);
});

test('the asks walk the list a slot at a time, never more words than it holds', () => {
  assert.deepEqual(wordsForSlot(['a', 'b', 'c'], 2, 0), ['a', 'b']);
  assert.deepEqual(wordsForSlot(['a', 'b', 'c'], 2, 1), ['c', 'a']);
  assert.deepEqual(wordsForSlot(['a'], 3, 5), ['a']);
  assert.deepEqual(wordsForSlot([], 2, 0), []);
});

test('★ every part switched off: a pass asks nothing and spends nothing', async () => {
  const off: Policy = {
    ...DEFAULT_POLICY,
    finders: {
      ...DEFAULT_POLICY.finders,
      trends: { ...DEFAULT_POLICY.finders.trends, on: false },
      learned: { ...DEFAULT_POLICY.finders.learned, on: false },
      creators: { ...DEFAULT_POLICY.finders.creators, on: false },
      young: { ...DEFAULT_POLICY.finders.young, on: false },
      sounds: { ...DEFAULT_POLICY.finders.sounds, on: false },
    },
  };
  let calls = 0;
  const source = { id: 'vid', capabilities: { discovery: ['keyword', 'account'] }, discover: async () => { calls += 1; throw new Error('asked'); }, lookup: async () => { calls += 1; throw new Error('read'); } } as unknown as PlatformAdapter;
  const r = await searchWordsPass(
    {
      finders: { searchWords: async () => { calls += 1; return []; }, replaceSearchWords: async () => {}, searchWordsAt: async () => null, coinedPosts: async () => [], youngPosts: async () => ['1'], postsTurning: async () => ['2'] },
      sources: () => [source],
      store: async () => 0,
      meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: {}, softStop: 1, now: () => NOW }),
      mode: 'live',
      policy: off,
      log: quiet,
      now: () => NOW,
    },
    searchWordClock(),
  );
  assert.equal(calls, 0);
  assert.equal(r.usd, 0);
});

test('the learned sounds: asked on the sound endpoint, once a slot, their posts on the trend lane', async () => {
  const only: Policy = {
    ...DEFAULT_POLICY,
    finders: {
      ...DEFAULT_POLICY.finders,
      trends: { ...DEFAULT_POLICY.finders.trends, on: false },
      learned: { ...DEFAULT_POLICY.finders.learned, on: false },
      creators: { ...DEFAULT_POLICY.finders.creators, on: false },
      young: { ...DEFAULT_POLICY.finders.young, on: false },
      sounds: { on: true, askEveryMs: 3_600_000, perAsk: 2 },
    },
  };
  const asked: string[] = [];
  const lanes: unknown[] = [];
  const source = {
    id: 'vid',
    capabilities: { discovery: ['keyword', 'account'] },
    estimateSoundPosts: () => ({ vendor: 'v', usd: 0.002 }),
    soundPosts: async (sound: string) => {
      asked.push(sound);
      return { value: { items: [], authors: [] }, spend: { usd: 0.002 } };
    },
  } as unknown as PlatformAdapter;
  const deps = {
    finders: {
      searchWords: async () => [
        { origin: 'coined' as const, kind: 'sound' as const, source: 'vid', value: 'vid:sound:9', rank: 1, facts: {} },
        { origin: 'coined' as const, kind: 'tag' as const, source: 'vid', value: 'raccoon', rank: 1, facts: {} },
      ],
      replaceSearchWords: async () => {},
      searchWordsAt: async () => null,
      coinedPosts: async () => [],
      youngPosts: async () => [],
      postsTurning: async () => [],
    },
    sources: () => [source],
    store: async (_i: unknown, _a: unknown, lane: unknown) => (lanes.push(lane), 0),
    meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: {}, softStop: 1, now: () => NOW }),
    mode: 'live' as const,
    policy: only,
    log: quiet,
    now: () => NOW,
  };
  const clock = searchWordClock();
  await searchWordsPass(deps, clock);
  await searchWordsPass(deps, clock);
  assert.deepEqual(asked, ['vid:sound:9']);
  assert.deepEqual(lanes, ['trend']);
});

test('young re-reads: the fastest, then every video turning 6 and 50 minutes, each once, in one read', async () => {
  const young: Policy = {
    ...DEFAULT_POLICY,
    finders: {
      ...DEFAULT_POLICY.finders,
      trends: { ...DEFAULT_POLICY.finders.trends, on: false },
      learned: { ...DEFAULT_POLICY.finders.learned, on: false },
      creators: { ...DEFAULT_POLICY.finders.creators, on: false },
      sounds: { ...DEFAULT_POLICY.finders.sounds, on: false },
      young: { ...DEFAULT_POLICY.finders.young, on: true, runEveryMinutes: 10, atAges: { on: true, ages: [6, 50], maxPosts: 10 }, late: { on: false, ageMin: 300, minReach: 20_000, maxPosts: 10 } },
    },
  };
  const windows: [number, number][] = [];
  const reads: string[][] = [];
  const source = {
    id: 'vid',
    capabilities: { discovery: ['keyword', 'account'] },
    estimate: () => ({ vendor: 'v', usd: 0.002 }),
    lookup: async (ids: readonly string[]) => {
      reads.push([...ids]);
      return { value: { items: [], authors: [] }, spend: { usd: 0.002 } };
    },
  } as unknown as PlatformAdapter;
  await searchWordsPass(
    {
      finders: {
        searchWords: async () => [],
        replaceSearchWords: async () => {},
        searchWordsAt: async () => null,
        coinedPosts: async () => [],
        youngPosts: async () => ['fast'],
        postsTurning: async (_s: string, from: Millis, to: Millis) => (windows.push([NOW - to, to - from]), to === NOW - 6 * 60_000 ? ['six', 'fast'] : ['fifty']),
      },
      sources: () => [source],
      store: async () => 0,
      meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: {}, softStop: 1, now: () => NOW }),
      mode: 'live',
      policy: young,
      log: quiet,
      now: () => NOW,
    },
    searchWordClock(),
  );
  assert.deepEqual(windows, [[360_000, 600_000], [3_000_000, 600_000]]);
  assert.deepEqual(reads, [['fast'], ['six', 'fifty']]);
});

/* ── the learned-tag lane (`finders.learnedTags`, 0088) ─────────────────────────────────────── */

const tagsOnly: Policy = {
  ...DEFAULT_POLICY,
  finders: {
    ...DEFAULT_POLICY.finders,
    trends: { ...DEFAULT_POLICY.finders.trends, on: false },
    learned: { ...DEFAULT_POLICY.finders.learned, on: false },
    creators: { ...DEFAULT_POLICY.finders.creators, on: false },
    young: { ...DEFAULT_POLICY.finders.young, on: false },
    sounds: { ...DEFAULT_POLICY.finders.sounds, on: false },
    learnedTags: { ...DEFAULT_POLICY.finders.learnedTags, on: true },
  },
};
const LT = tagsOnly.finders.learnedTags;

function tagSource(asks: (readonly string[])[], videos: number, usd = 0.03): PlatformAdapter {
  return {
    id: 'vid',
    capabilities: { discovery: ['keyword', 'account'] },
    estimate: () => ({ vendor: 'v', usd: 0.041 }),
    discover: async (q: { terms?: readonly string[] }) => {
      asks.push(q.terms ?? []);
      const items = Array.from({ length: videos }, (_v, i) => ({ itemId: `vid:${i}`, postedAt: NOW - 30 * 60_000 }));
      return { value: { items, authors: [] }, spend: { usd } };
    },
  } as unknown as PlatformAdapter;
}

const tagDeps = (src: PlatformAdapter, policy: Policy, ledger: LaneLedger, lanes: unknown[], tags: readonly string[], fresh = 4) => ({
  finders: { searchWords: async () => [], replaceSearchWords: async () => {}, searchWordsAt: async () => null, coinedPosts: async () => [], youngPosts: async () => [], postsTurning: async () => [] },
  sources: () => [src],
  store: async (_i: unknown, _a: unknown, lane: unknown) => (lanes.push(lane), 0),
  meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: {}, softStop: 1, now: () => NOW }),
  mode: 'live' as const,
  policy,
  log: quiet,
  now: () => NOW,
  learnedTags: { tags: async () => tags, ledger, uncredited: async () => fresh },
});

test("★ the learned tags: newest-first words walked a slot at a time, the owner's words and the skip list left out, stored as learned_tag", async () => {
  const asks: (readonly string[])[] = [];
  const lanes: unknown[] = [];
  const ledger = memoryLaneLedger();
  const clock = searchWordClock();
  const deps = tagDeps(tagSource(asks, 10), tagsOnly, ledger, lanes, ['meme', 'Animals', '#cat', 'fyp', 'memecut', 'blowthisup']);
  await searchWordsPass(deps, clock);
  await searchWordsPass(deps, clock);
  assert.equal(asks.length, 1, 'once a slot');
  assert.deepEqual(asks[0], wordsForSlot(['animals', 'cat', 'memecut', 'blowthisup'], LT.wordsPerAsk, Math.floor(NOW / LT.askEveryMs)));
  assert.ok(!asks[0]!.includes('meme') && !asks[0]!.includes('fyp'));
  assert.deepEqual(lanes, ['learned_tag']);
  const spent = (await ledger.spent('learned_tag', NOW)) ?? 0;
  assert.ok(Math.abs(spent - (0.03 + laneJudgeUsd(4, LT.cap))) < 1e-12, 'its run bill plus the judging of the 4 new videos');
  await searchWordsPass({ ...deps, now: () => (NOW + LT.askEveryMs) as Millis }, clock);
  assert.equal(asks.length, 2, 'the next slot asks again');
});

test('★ its day spent, or its ledger unreadable: not asked', async () => {
  const asks: (readonly string[])[] = [];
  await searchWordsPass(tagDeps(tagSource(asks, 10), tagsOnly, memoryLaneLedger({ learned_tag: LT.cap.dailyUsd - 0.01 }), [], ['cat']), searchWordClock());
  await searchWordsPass(tagDeps(tagSource(asks, 10), tagsOnly, { spent: async () => null, add: async () => {} }, [], ['cat']), searchWordClock());
  assert.equal(asks.length, 0);
});

test('no learned tags yet, the lane switched off, or no lane deps: nothing asked', async () => {
  const asks: (readonly string[])[] = [];
  await searchWordsPass(tagDeps(tagSource(asks, 10), tagsOnly, memoryLaneLedger(), [], ['meme']), searchWordClock());
  const off: Policy = { ...tagsOnly, finders: { ...tagsOnly.finders, learnedTags: { ...LT, on: false } } };
  await searchWordsPass(tagDeps(tagSource(asks, 10), off, memoryLaneLedger(), [], ['cat']), searchWordClock());
  const { learnedTags: _gone, ...without } = tagDeps(tagSource(asks, 10), tagsOnly, memoryLaneLedger(), [], ['cat']);
  await searchWordsPass(without, searchWordClock());
  assert.equal(asks.length, 0);
});

test("at most topTags words, in the re-tune's order", () => {
  const many = Array.from({ length: 15 }, (_v, i) => `tag${String.fromCharCode(97 + i)}`);
  assert.deepEqual(learnedTagWords(many, tagsOnly), many.slice(0, LT.topTags));
});
