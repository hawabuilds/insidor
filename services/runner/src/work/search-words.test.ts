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
import { inMemoryMeter } from '@insidor/meter';

import type { Logger } from '../log.ts';
import { learnWords, searchWordClock, searchWordsPass, wordsForSlot } from './search-words.ts';

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
      finders: { searchWords: async () => { calls += 1; return []; }, replaceSearchWords: async () => {}, searchWordsAt: async () => null, coinedPosts: async () => [], youngPosts: async () => ['1'] },
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
