/**
 * The meme-war word search (fight-words.ts) against a fake source: each side of a live war is asked
 * in its own language for the other country's name at the floor; a seed still waiting for the titler
 * is not asked; the X search day's pace and the lane's own day stop it; posts are stored under
 * 'narrative_name' and charged to 'search:fight_words'. A live war's phrases are asked with all
 * their words, and the owner's named wars are asked before any narrative holds them (policy.v175).
 * No outside call.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import type { StoredNarrative } from '@insidor/store';

import { createLogger } from '../log.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { FIGHT_WORDS_LANE, fightWarsToAsk, fightWords, fightWordsPass, forgetFirstLooks, type FightWordsDeps } from './fight-words.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { NOW, openMeter, pagingSource } from './lane-search-fakes.ts';

const war = (id: string, fight: readonly string[], extra: Partial<StoredNarrative> = {}): StoredNarrative => ({
  id, members: ['a', 'b', 'c'], anchor: 'a', shown: true, firstShownAtMs: NOW - 3_600_000, postsChangedAtMs: NOW, title: 'War', titlePosts: 3,
  fight, fightModel: 'm', newestPostAtMs: NOW - 3_600_000, early: [], ...extra,
});

/* The policy with no war named by the owner, for the tests about live wars alone. */
const LIVE_ONLY: Policy = { ...P, narrative: { ...P.narrative, fight: { ...P.narrative.fight, native: { ...P.narrative.fight.native, named: [] } } } };

function setup(wars: readonly StoredNarrative[], opts: { daySpent?: number | null; posts?: number; laneSpent?: number; policy?: Policy } = {}) {
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
    policy: opts.policy ?? LIVE_ONLY,
    log: createLogger({ test: 'fight-words' }),
    now: () => NOW as Millis,
  };
  return { deps, seen, stored, ledger };
}

test('a war is searched in each side\'s own language for the other country, the titler\'s spelling read as ours', () => {
  const ct = fightWords({ id: 'n-ct', countries: ['China', 'Türkiye'] }, P).map((w) => `${w.lang}:${w.word}`);
  assert.deepEqual(ct, ['zh:土耳其', 'tr:çin', 'tr:çinli']);
  const fj = fightWords({ id: 'n-fj', countries: ['France', 'Japan'] }, P).map((w) => `${w.lang}:${w.word}`);
  assert.deepEqual(fj, ['fr:japon', 'fr:japonais', 'ja:フランス', 'ja:フランス人', 'ja:仏人', 'ja:アルジェリア人', 'ja:ベジータ アルジェリア', 'ja:日仏', 'ja:フランス人 日本人', 'ja:悪口合戦', 'ja:レスバ']);
  assert.deepEqual(fightWords({ id: 'n-fj', countries: ['France', 'Japan'] }, P, { phrases: false }).map((w) => w.word), ['japon', 'japonais', 'フランス', 'フランス人', '仏人']);
  assert.deepEqual(fightWords({ id: 'n-x', countries: ['China', 'Argentina'] }, P), [], 'no language is home to one and names the other: nothing to ask');
});

test('★ each word one language at the floor over the last 90 minutes; posts credited to narrative_name, charged to its own day; a waiting seed is not asked', async () => {
  const s = setup([war('n-ct', ['China', 'Turkey']), war('n-seed', ['France', 'Japan'], { shown: false, fightModel: 'native-names' })]);
  const r = await fightWordsPass(s.deps);
  assert.equal(r.wars, 1);
  assert.deepEqual(s.seen.map((q) => `${q.filter?.langs.join()}:${q.term}`), ['zh:土耳其', 'tr:çin', 'tr:çinli']);
  for (const q of s.seen) {
    assert.equal(q.mode, 'keyword');
    const lang = q.filter?.langs[0] ?? '';
    assert.equal(q.filter?.minApproval, P.feed.fightWords.byLang[lang]?.minApproval ?? P.feed.fightWords.minApproval, 'the language\'s own floor (Turkish 150, policy.v178), else the search\'s');
    assert.equal(q.sinceMs, NOW - P.feed.fightWords.lookbackMs);
  }
  assert.ok(s.stored.every((l) => l === 'narrative_name'));
  assert.ok(([...s.ledger.totals.entries()].find(([k]) => k.endsWith(FIGHT_WORDS_LANE))?.[1] ?? 0) > 0);
});

test('★ a language with its own bar is asked at it: Japanese at 100 likes and three words, French at 300 and two', async () => {
  const s = setup([war('n-fj', ['France', 'Japan'])]);
  await fightWordsPass(s.deps);
  assert.deepEqual(s.seen.slice(0, 5).map((q) => `${q.filter?.langs.join()}:${q.term}:${q.filter?.minApproval}`), ['fr:japon:300', 'fr:japonais:300', 'ja:フランス:100', 'ja:フランス人:100', 'ja:仏人:100']);
  assert.equal(P.feed.fightWords.byLang.ja?.minApproval, 100);
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

test('★ a war phrase is one ask holding all its words, at the language\'s floor; a one-word phrase is a plain word', async () => {
  const s = setup([war('n-fj', ['France', 'Japan'])]);
  await fightWordsPass(s.deps);
  const phrases = s.seen.slice(5);
  assert.deepEqual(phrases.map((q) => [q.term, q.allWords ?? null, q.filter?.langs.join(), q.filter?.minApproval]), [
    ['アルジェリア人', null, 'ja', 100],
    ['ベジータ アルジェリア', ['ベジータ', 'アルジェリア'], 'ja', 100],
    ['日仏', null, 'ja', 100],
    ['フランス人 日本人', ['フランス人', '日本人'], 'ja', 100],
    ['悪口合戦', null, 'ja', 100],
    ['レスバ', null, 'ja', 100],
  ]);
  assert.equal(P.feed.fightWords.byLang.ja?.phrasesPerSide, 6);
  const two: Policy = { ...LIVE_ONLY, feed: { ...P.feed, fightWords: { ...P.feed.fightWords, byLang: { ja: { minApproval: 100, wordsPerSide: 3 } } } } };
  assert.equal(fightWords({ id: 'n-fj', countries: ['France', 'Japan'] }, two).filter((w) => w.lang === 'ja').length, 3 + P.feed.fightWords.phrasesPerSide, 'the default count when the language sets none');
});

test('★ a named war with no narrative looks back two days on its first pass, then ninety minutes like every war', async () => {
  forgetFirstLooks();
  const back = (q: DiscoveryQuery) => NOW - (q.sinceMs ?? NOW);
  const first = setup([], { policy: P });
  await fightWordsPass(first.deps);
  assert.ok(first.seen.length > 0);
  assert.ok(first.seen.every((q) => back(q) === P.narrative.fight.native.lookbackMs), 'its first look reads the regroup\'s two days');
  const next = setup([], { policy: P });
  await fightWordsPass(next.deps);
  assert.ok(next.seen.every((q) => back(q) === P.feed.fightWords.lookbackMs), 'then its own ninety minutes, never two days every pass');
  forgetFirstLooks();
  const live = setup([war('n-fj', ['France', 'Japan'])]);
  await fightWordsPass(live.deps);
  assert.ok(live.seen.every((q) => back(q) === P.feed.fightWords.lookbackMs), 'a live war is never asked back');
});

test('★ the owner\'s named wars are asked before any narrative holds them, in both sides\' languages; Arabic only against the war\'s other side', async () => {
  const s = setup([], { policy: P });
  const r = await fightWordsPass(s.deps);
  assert.equal(r.wars, 3);
  assert.deepEqual(s.seen.map((q) => `${q.filter?.langs.join()}:${q.term}:${q.filter?.minApproval}`), [
    'ar:الأرجنتين:200', 'ar:الارجنتين:200', 'es:saudí:200', 'es:saudi:200',
    'ar:البرازيل:200', 'pt:egito:200',
    'ko:베트남:300', 'vi:hàn quốc:100',
  ], 'eight asks a pass for the three named wars; no phrase for a war with no narrative');
  /* A named war a live narrative holds (in the titler's spelling) is asked once, as that narrative, with its phrases. */
  const asked = fightWarsToAsk([war('n-sa', ['KSA', 'Argentina'])], P);
  assert.deepEqual(asked.map((w) => [w.id, w.phrases]), [['n-sa', true], ['named:Brazil|Egypt', false], ['named:South Korea|Vietnam', false]]);
  /* A waiting seed of a named pair does not stand for it: the named war is still asked. */
  assert.ok(fightWarsToAsk([war('n-seed', ['Argentina', 'Saudi Arabia'], { shown: false, fightModel: 'native-names' })], P).some((w) => w.id === 'named:Argentina|Saudi Arabia'));
});
