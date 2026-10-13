/**
 * The newest-first search actor's input and its entries, read into the same Items as the first
 * scraper's. The entry below is a real one from the run of 2026-10-13 16:11 UTC, trimmed to the
 * fields read (and its cover address shortened), so a change in what we read shows here first.
 * No network: the client is a plain object.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { searchActorCostUsd, searchActorQuoteUsd } from './capabilities.ts';
import type { RunResult, TikTokClient } from './client.ts';
import { discoverRun, wordsOf } from './discover.ts';
import { tiktokPlatform } from './index.ts';
import { fromSearchActor, SEARCH_ACTOR_RESULTS_PER_WORD, toSearchActorInput } from './search-actor.ts';
import { toAuthor, toItem } from './to-item.ts';

const AT = 1_791_910_930_000;

const ENTRY = {
  aweme_id: '7696177940781944085',
  desc: 'Relatable #tiktok #trending #funny #comedyvideo #viral ',
  create_time: 1791906070,
  desc_language: 'en',
  author: {
    uid: '6977076764012315653',
    unique_id: 'fardeenkimastiyan',
    nickname: 'Fardeen ki Mastiyan',
    follower_count: 816,
    avatar_thumb: { url_list: ['https://p19-common-sign.tiktokcdn-us.com/avt/a~tplv-tiktokx-cropcenter:100:100.webp?x-expires=1&x-signature=a'] },
    avatar_300x300: { url_list: ['https://p16-common-sign.tiktokcdn-us.com/avt/a~tplv-tiktokx-cropcenter:300:300.webp?x-expires=1&x-signature=b'] },
  },
  statistics: { aweme_id: '7696177940781944085', collect_count: 8, comment_count: 6, digg_count: 93, download_count: 2, play_count: 1957, share_count: 3 },
  video: { duration: 64388, width: 576, height: 1024, cover: { height: 720, width: 720, url_list: ['https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/cover.jpeg?x-expires=1&x-signature=a'] } },
  music: { id: 7696178768922037000, id_str: '7696178768922037123', mid: '7696178768922037123', title: 'original sound - fardeenkimastiyan' },
  text_extra: [{ hashtag_name: 'tiktok', type: 1 }, { hashtag_name: 'funny', type: 1 }],
  __search_terms: { keyword: 'funny', sort_type: 'Most recent', publish_time: 'YESTERDAY', region: 'US' },
};

test('the actor is asked newest first, over the past day, every word in one run, 30 a word for the run', () => {
  assert.deepEqual(toSearchActorInput(['meme', 'funny']), {
    keywords: ['meme', 'funny'],
    limit: 2 * SEARCH_ACTOR_RESULTS_PER_WORD,
    sortType: 2,
    publishTime: 'YESTERDAY',
    includeSearchTerms: true,
    fetchUserBio: false,
  });
});

test('★ an entry reads into the same Item the first scraper gives: id, time, counts, cover, sound, tags', () => {
  const item = toItem(fromSearchActor(ENTRY), AT as never);
  assert.equal(item.sourceItemId, '7696177940781944085');
  assert.equal(item.postedAt, 1791906070_000);
  assert.equal(item.lang, 'en');
  assert.equal(item.counters.reach?.value, 1957);
  assert.equal(item.counters.approval?.value, 93);
  assert.equal(item.counters.conversation?.value, 6);
  assert.equal(item.counters.rebroadcast?.value, 3);
  assert.equal(item.counters.retention?.value, 8);
  assert.equal('reproduction' in item.counters, false, 'this source has no reproduction count, from either actor');
  assert.equal(item.media[0]?.uri, ENTRY.video.cover.url_list[0]);
  assert.ok(Math.abs((item.media[0]?.durationMs ?? 0) - 64388) < 0.001, 'the actor sends milliseconds; the Item holds milliseconds');
  assert.deepEqual(item.formatIds, ['tiktok:sound:7696178768922037123'], 'the sound id from its string form, never the rounded number');
  assert.ok(item.fingerprints.some((f) => f.kind === 'entitySpan' && f.key.includes('funny')));
  assert.equal(String(item.authorKey), 'tiktok:6977076764012315653');
  assert.equal(toAuthor(fromSearchActor(ENTRY), AT as never)?.handle, 'fardeenkimastiyan');
});

test("★ the account's name, follower count and 300px picture are kept from the same entry", () => {
  const a = toAuthor(fromSearchActor(ENTRY), AT as never);
  assert.equal(a?.displayName, 'Fardeen ki Mastiyan');
  assert.equal(a?.audience?.value, 816);
  assert.equal(a?.pictureUri, ENTRY.author.avatar_300x300.url_list[0]);
  const bare = toAuthor(fromSearchActor({ ...ENTRY, author: { uid: '1', unique_id: 'someone' } }), AT as never);
  assert.equal(bare?.audience, null, 'no count is no counter, never zero');
  assert.equal(bare?.pictureUri, null);
  assert.equal(bare?.displayName, null);
});

test("'un' is no language, and a missing count is unread rather than zero", () => {
  const item = toItem(fromSearchActor({ ...ENTRY, desc_language: 'un', statistics: { digg_count: 5 } }), AT as never);
  assert.equal(item.lang, null);
  assert.equal(item.counters.reach?.value, null);
  assert.equal(item.counters.approval?.value, 5);
});

const query = (over: Partial<DiscoveryQuery> = {}): DiscoveryQuery => ({
  mode: 'keyword', term: 'meme', terms: ['meme', ' funny ', '', 'meme'], sinceMs: null, untilMs: null, limit: 20, cursor: null, ...over,
});

const searching = (result: RunResult, seen: unknown[] = []): TikTokClient => ({
  runDiscovery: async () => {
    throw new Error('a keyword ask must go to the search actor when one is configured');
  },
  runObserve: async () => {
    throw new Error('not used');
  },
  runSearch: async (input) => {
    seen.push(input);
    return result;
  },
});

test('★ a keyword ask goes to the search actor, one run a word, and keeps every video it was billed for', async () => {
  const seen: unknown[] = [];
  const many = Array.from({ length: 25 }, (_, k) => ({ ...ENTRY, aweme_id: `76961779407819440${10 + k}` }));
  const run = await discoverRun(searching({ items: [...many, { desc: 'no id' }], runId: 'r1' }, seen), query(), AT as never);
  assert.deepEqual(seen.map((s) => (s as { keywords: string[] }).keywords), [['meme'], ['funny']], 'one run a word');
  assert.equal(run.items.length, 25, 'not sliced to the ask of 20; the entry with no id skipped; each video once');
  assert.equal(run.billedPosts, 52);
  assert.equal(run.searchWords, 2);
});

test('the cutoff is refused on the search actor too', async () => {
  await assert.rejects(discoverRun(searching({ items: [], runId: null }), query({ untilMs: 1 as never }), AT as never), NotImplemented);
});

test('words: terms when given, trimmed, no repeats; else the term', () => {
  assert.deepEqual(wordsOf(query()), ['meme', 'funny']);
  const { terms: _none, ...single } = query();
  assert.deepEqual(wordsOf(single), ['meme']);
});

test('★ an ask is quoted by its words and recorded at what the actor billed', async () => {
  const spends: { usd: number }[] = [];
  const meter: Meter = {
    record: (s) => void spends.push(s),
    spentUsd: () => 0,
    mayspend: () => true,
    line: () => ({ capUsd: 3, spentUsd: 0, remainingUsd: 3, unrecordedUsd: 0 }) as never,
  };
  const platform = tiktokPlatform({ client: searching({ items: [ENTRY, { ...ENTRY, aweme_id: '7696177940781944999' }], runId: 'r' }), meter, now: () => AT as never, handleOf: () => null });
  const quote = platform.estimate({ kind: 'discover', query: query({ terms: ['a', 'b', 'c', 'd'] }) });
  assert.ok(Math.abs(quote.usd - searchActorQuoteUsd(4, 30)) < 1e-9);
  assert.ok(Math.abs(quote.usd - 0.0546) < 1e-5, 'four words: 4 × ($0.00022 + $0.00233 + 30 × $0.00037)');
  const out = await platform.discover(query(), { remainingUsd: 3 } as never);
  assert.equal(out.value.items.length, 2, 'the same two videos found by both words are one video each');
  assert.ok(Math.abs(out.spend.usd - searchActorCostUsd(2, 4)) < 1e-9);
});

test('★ a word whose run fails loses only its own videos; every word failing is an outage', async () => {
  let k = 0;
  const half: TikTokClient = { ...searching({ items: [], runId: null }), runSearch: async () => {
    k += 1;
    if (k === 1) throw new Error('vendor down');
    return { items: [ENTRY], runId: 'r2' };
  } };
  const run = await discoverRun(half, query(), AT as never);
  assert.equal(run.items.length, 1);
  assert.equal(run.billedPosts, 1 + SEARCH_ACTOR_RESULTS_PER_WORD, 'the failed run recorded at its quote');
  const none: TikTokClient = { ...half, runSearch: async () => { throw new Error('vendor down'); } };
  await assert.rejects(discoverRun(none, query(), AT as never), /vendor down/);
});

test('the watch list asks as many words as policy says, and the ask stays inside the line', () => {
  const perDay = (DEFAULT_POLICY.feed.budgetShare * 3) / searchActorQuoteUsd(DEFAULT_POLICY.feed.watchWordsPerAsk, 30);
  assert.ok(perDay >= 30, `${perDay.toFixed(1)} asks a day`);
});
