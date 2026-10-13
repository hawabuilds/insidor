/**
 * The missed-post diagnosis on recorded facts: each gate in its order, the recall model's reason
 * for a post never found, and the suggestion only when most were never found. That the lists are
 * 0055's CHECK lists is tested in services/runner (core may not read a file).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { diagnoseMissed, missedSuggestion, type MissedCase, type MissedContext } from './missed.ts';
import type { DiscoverySettings } from '../sources/recall.ts';

const POSTED = 1_800_000_000_000;
const MIN = 60_000;
const at = (minutes: number) => POSTED + minutes * MIN;

const SETTINGS: DiscoverySettings = {
  langs: ['en', 'zxx'],
  excludeReplies: false,
  excludeRebroadcasts: true,
  tauMin: 60,
  lanes: [
    { lane: 'all', floor: 60, reachMin: 10, everyMin: 2, mediaOnly: false },
    { lane: 'media', floor: 60, reachMin: 10, everyMin: 2, mediaOnly: true },
    { lane: 'slow', floor: 500, reachMin: 45, everyMin: 15, mediaOnly: false },
  ],
};
const CTX: MissedContext = { settings: SETTINGS, watchTags: ['meme', 'cat'] };

const YES = { coinable: true, confidence: 0.9, lookedAt: 'text' as const, proposedName: 'Chill Guy', alternateNames: [], judgedAtMs: at(20) };

/* A post found by the main lane at 8 minutes, judged a meme, read at 50k views, not shown. */
const base: MissedCase = {
  search: 'floor',
  postedAtMs: POSTED,
  post: { approvals: 5_000, lang: 'en', hasMedia: true, isReply: false, isRebroadcast: false, tags: [] },
  held: { firstSeenAtMs: at(8), foundBy: { lane: 'all', atMs: at(8) } },
  judgement: YES,
  reach: [{ atMs: at(30), reach: 50_000 }],
  shownAtMs: null,
  firstCoinAtMs: null,
};

test('never found, in a language the search leaves out: the filter is named', () => {
  const d = diagnoseMissed({ ...base, held: null, post: { ...base.post, lang: 'es' } }, CTX, P);
  assert.equal(d.diagnosis, 'never_found');
  assert.equal(d.detail['why'], 'not_in_search');
  assert.equal(d.detail['filter'], 'language');
  assert.equal(d.detail['lang'], 'es');
});

test('never found, a repost: the repost filter, before any floor', () => {
  const d = diagnoseMissed({ ...base, held: null, post: { ...base.post, isRebroadcast: true, approvals: 1e6 } }, CTX, P);
  assert.deepEqual([d.detail['why'], d.detail['filter']], ['not_in_search', 'repost']);
});

test('never found: under the floor, and between checks, as the recall model says', () => {
  assert.equal(diagnoseMissed({ ...base, held: null, post: { ...base.post, approvals: 40 } }, CTX, P).detail['why'], 'under_floor');
  const late = diagnoseMissed({ ...base, held: null, post: { ...base.post, approvals: 100 } }, CTX, P);
  assert.equal(late.detail['why'], 'between_checks');
  assert.equal(typeof late.detail['crossedFloorMinutes'], 'number');
});

test('★ never found though the model says it would have been caught: unexplained, not a reason picked to fit', () => {
  const d = diagnoseMissed({ ...base, held: null, post: { ...base.post, approvals: 1e6 } }, CTX, P);
  assert.equal(d.detail['why'], 'unexplained');
});

test('held by another route, never from the catch-all: still never found, and says it was held', () => {
  const d = diagnoseMissed({ ...base, held: { firstSeenAtMs: at(40), foundBy: null }, post: { ...base.post, approvals: 40 } }, CTX, P);
  assert.equal(d.diagnosis, 'never_found');
  assert.equal(d.detail['held'], true);
});

test('no growth curve yet: never found, and unsure why', () => {
  assert.equal(diagnoseMissed({ ...base, held: null }, { ...CTX, settings: null }, P).detail['why'], 'unsure');
});

test('the watch-list source: no watched tag is not in the search; a watched tag is between checks', () => {
  const tagless = diagnoseMissed({ ...base, search: 'watch', held: null, post: { ...base.post, tags: ['dance'] } }, CTX, P);
  assert.deepEqual([tagless.detail['why'], tagless.detail['filter']], ['not_in_search', 'tag']);
  assert.equal(diagnoseMissed({ ...base, search: 'watch', held: null, post: { ...base.post, tags: ['cat'] } }, CTX, P).detail['why'], 'between_checks');
});

test('found, no answer from the judge: not judged', () => {
  assert.equal(diagnoseMissed({ ...base, judgement: null }, CTX, P).diagnosis, 'not_judged');
});

test('found and judged no: rejected, with the judge answer beside it', () => {
  const d = diagnoseMissed({ ...base, judgement: { ...YES, coinable: false, proposedName: null } }, CTX, P);
  assert.equal(d.diagnosis, 'rejected');
  assert.equal((d.detail['judge'] as { said: string }).said, 'not_memeable');
  const long = diagnoseMissed({ ...base, judgement: { ...YES, proposedName: 'a very long proposed name' } }, CTX, P);
  assert.equal((long.detail['judge'] as { said: string }).said, 'name_test');
});

test('found and passed, under the view bar: under reach bar, with the most read', () => {
  const d = diagnoseMissed({ ...base, reach: [{ atMs: at(600), reach: 12_000 }] }, CTX, P);
  assert.equal(d.diagnosis, 'under_reach_bar');
  assert.equal(d.detail['mostReach'], 12_000);
});

test('★ shown after the first coin of its name launched: shown late, by how much; before it: shown', () => {
  const late = diagnoseMissed({ ...base, shownAtMs: at(90), firstCoinAtMs: at(45) }, CTX, P);
  assert.equal(late.diagnosis, 'shown_late');
  assert.equal(late.detail['afterCoinMinutes'], 45);
  assert.equal(late.detail['crossedBarMinutes'], 30);
  assert.equal(late.detail['barToShownMinutes'], 60);
  assert.equal(diagnoseMissed({ ...base, shownAtMs: at(40), firstCoinAtMs: at(45) }, CTX, P).diagnosis, 'shown');
  assert.equal(diagnoseMissed({ ...base, shownAtMs: at(40) }, CTX, P).diagnosis, 'shown');
});

test('every gate passed and never recorded as shown: unsure', () => {
  assert.equal(diagnoseMissed(base, CTX, P).diagnosis, 'unsure');
});

test('the suggestion: none when most were found; when most were never found, a floor change with its cost', () => {
  const found = { search: 'floor' as const, diagnosis: 'rejected', detail: {} };
  const under = { search: 'floor' as const, diagnosis: 'never_found', detail: { why: 'under_floor', approvals: 300 } };
  assert.equal(missedSuggestion({ rows: [found, found, under], settings: SETTINGS, searchUsdPerDay: 2, usdPerPost: 0.00015 }, P).text, null);
  const s = missedSuggestion({ rows: [found, under, under], settings: SETTINGS, searchUsdPerDay: 2, usdPerPost: 0.00015 }, P);
  assert.ok(s.text !== null);
  assert.match(s.text, /2 of 3 missed posts were never found/);
  assert.match(s.text, /a floor of \d+ would have caught them/);
  assert.match(s.text, /\$\d+\.\d\d a day more/);
});

test('the suggestion for languages and tags names them', () => {
  const es = { search: 'floor' as const, diagnosis: 'never_found', detail: { why: 'not_in_search', filter: 'language', lang: 'es' } };
  const tag = { search: 'watch' as const, diagnosis: 'never_found', detail: { why: 'not_in_search', filter: 'tag', tags: ['dance', 'fyp'] } };
  const s = missedSuggestion({ rows: [es, tag, tag], settings: SETTINGS, searchUsdPerDay: 1, usdPerPost: 0.00015 }, P);
  assert.match(s.text ?? '', /add 'es' to feed\.langs/);
  assert.match(s.text ?? '', /#dance, #fyp/);
});

test('never found while discovery was down: the outage, before any search reason', () => {
  const outages = [{ fromMs: null, toMs: at(-600) }, { fromMs: at(-5), toMs: at(60) }];
  const d = diagnoseMissed({ ...base, held: null, post: { ...base.post, lang: 'es' } }, { ...CTX, outages }, P);
  assert.deepEqual([d.diagnosis, d.detail['why'], d.detail['notRunningYet']], ['never_found', 'discovery_down', false]);
  const early = diagnoseMissed({ ...base, held: null, postedAtMs: at(-700) }, { ...CTX, outages }, P);
  assert.deepEqual([early.detail['why'], early.detail['notRunningYet']], ['discovery_down', true]);
  /* Up for part of the window: the search's own reason, with the minutes it was up beside it. */
  const partly = diagnoseMissed({ ...base, held: null, postedAtMs: at(-8) }, { ...CTX, outages: [{ fromMs: null, toMs: at(-600) }, { fromMs: at(-5), toMs: at(0) }] }, P);
  assert.notEqual(partly.detail['why'], 'discovery_down');
  assert.equal(partly.detail['upMinutes'], P.feed.windowMin - 5);
});

test('posts made while discovery was down do not drive a search change', () => {
  const down = { search: 'floor' as const, diagnosis: 'never_found', detail: { why: 'discovery_down' } };
  const s = missedSuggestion({ rows: [down, down, down, { search: 'floor', diagnosis: 'rejected', detail: {} }], settings: SETTINGS, searchUsdPerDay: 4, usdPerPost: 0.00015 }, P);
  assert.equal(s.text, null);
  assert.equal(s.facts['discoveryDown'], 3);
});
