/**
 * The meme-war word search (fight-words.ts) against a fake source: each side of a live war is asked
 * in its own language for the other country's name at the floor; a seed still waiting for the titler
 * is not asked; the X search day's pace and the lane's own day stop it; posts are stored under
 * 'narrative_name' and charged to 'search:fight_words'. No outside call.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import type { StoredNarrative } from '@insidor/store';

import { createLogger } from '../log.ts';
import { FIGHT_WORDS_LANE, fightWords, fightWordsPass, type FightWordsDeps } from './fight-words.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { NOW, openMeter, pagingSource } from './lane-search-fakes.ts';

const war = (id: string, fight: readonly string[], extra: Partial<StoredNarrative> = {}): StoredNarrative => ({
  id, members: ['a', 'b', 'c'], anchor: 'a', shown: true, firstShownAtMs: NOW - 3_600_000, postsChangedAtMs: NOW, title: 'War', titlePosts: 3,
  fight, fightModel: 'm', newestPostAtMs: NOW - 3_600_000, early: [], ...extra,
});

function setup(wars: readonly StoredNarrative[], opts: { daySpent?: number | null; posts?: number; laneSpent?: number } = {}) {
  const seen: DiscoveryQuery[] = [];
  const stored: (string | null | undefined)[] = [];
  const ledger = memoryLaneLedger({ [FIGHT_WORDS_LANE]: opts.laneSpent ?? 0 });
  const deps: FightWordsDeps = {
    sources: () => [pagingSource(seen, () => opts.posts ?? 2)],
    narratives: { fights: async () => wars },
    store: async (items, _a, lane) => (stored.push(lane), items.length),
    uncredited: async (ids) => ids.length,
    ledger,
    searchDay: { spent: async () => (opts.daySpent === undefined ? 0 : opts.daySpent) },
    meter: openMeter,
    mode: 'live',
    policy: P,
    log: createLogger({ test: 'fight-words' }),
    now: () => NOW as Millis,
  };
  return { deps, seen, stored, ledger };
}

test('a war is searched in each side\'s own language for the other country, the titler\'s spelling read as ours', () => {
  const ct = fightWords({ id: 'n-ct', countries: ['China', 'Türkiye'] }, P).map((w) => `${w.lang}:${w.word}`);
  assert.deepEqual(ct, ['zh:土耳其', 'tr:çin', 'tr:çinli']);
  const fj = fightWords({ id: 'n-fj', countries: ['France', 'Japan'] }, P).map((w) => `${w.lang}:${w.word}`);
  assert.deepEqual(fj, ['fr:japon', 'fr:japonais', 'ja:フランス']);
  assert.deepEqual(fightWords({ id: 'n-x', countries: ['Brazil', 'Argentina'] }, P), [], 'no home language for either: nothing to ask');
});

test('★ each word one language at the floor over the last 90 minutes; posts credited to narrative_name, charged to its own day; a waiting seed is not asked', async () => {
  const s = setup([war('n-ct', ['China', 'Turkey']), war('n-seed', ['France', 'Japan'], { shown: false, fightModel: 'native-names' })]);
  const r = await fightWordsPass(s.deps);
  assert.equal(r.wars, 1);
  assert.deepEqual(s.seen.map((q) => `${q.filter?.langs.join()}:${q.term}`), ['zh:土耳其', 'tr:çin', 'tr:çinli']);
  for (const q of s.seen) {
    assert.equal(q.mode, 'keyword');
    assert.equal(q.filter?.minApproval, P.feed.fightWords.minApproval);
    assert.equal(q.sinceMs, NOW - P.feed.fightWords.lookbackMs);
  }
  assert.ok(s.stored.every((l) => l === 'narrative_name'));
  assert.ok(([...s.ledger.totals.entries()].find(([k]) => k.endsWith(FIGHT_WORDS_LANE))?.[1] ?? 0) > 0);
});

test('★ the X search day\'s pace stops it before any ask; an unreadable bill asks nothing', async () => {
  const spent = setup([war('n-ct', ['China', 'Turkey'])], { daySpent: P.feed.searchDay.dailyUsd });
  assert.equal((await fightWordsPass(spent.deps)).stopped, 'day');
  assert.equal(spent.seen.length, 0);
  const unread = setup([war('n-ct', ['China', 'Turkey'])], { daySpent: null });
  assert.equal((await fightWordsPass(unread.deps)).stopped, 'day');
  assert.equal(unread.seen.length, 0);
});

test('its own day spent: nothing is asked', async () => {
  const s = setup([war('n-ct', ['China', 'Turkey'])], { laneSpent: P.feed.fightWords.cap.dailyUsd });
  assert.equal((await fightWordsPass(s.deps)).stopped, 'capped');
  assert.equal(s.seen.length, 0);
});
