import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeBoardTick, decodeStory } from '../../shared/api/decode.ts';
import { fixtureBoard, fixtureStory } from '../../shared/api/fixtures.ts';
import { NO_FILTERS, POSTED_WINDOWS, VIEW_STEPS, applyFilters } from './feed-filters.ts';
import { rowsInOrder, tabView } from './feed-tabs.ts';
import { leadPost, type LeadPost } from './lead-post.ts';

const tick = decodeBoardTick(fixtureBoard());
const rows = rowsInOrder(tick.order, tick.rows);
const NOW = Date.now();
const leads = new Map<string, LeadPost | null>(rows.map((r) => [r.id, leadPost(decodeStory(fixtureStory(r.id)).evidence)]));

test('FYP is the server order, untouched', () => {
  assert.deepEqual(tabView('fyp', rows, []).rows.map((r) => r.id), tick.order);
});

test('Popular puts the most viewed first and never sorts an unknown count as zero', () => {
  const v = tabView('popular', rows, []);
  const amounts = v.rows.map((r) => (r.reach.known ? r.reach.amount : -1));
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  assert.ok(v.rows.every((r) => r.reach.known));
  assert.ok(v.uncounted.length > 0 && v.uncounted.every((r) => !r.reach.known));
});

test('Watchlist keeps starred rows and counts the starred ones not on the board', () => {
  const v = tabView('watchlist', rows, ['st_seal', 'gone']);
  assert.deepEqual(v.rows.map((r) => r.id), ['st_seal']);
  assert.equal(v.starredOffBoard, 1);
});

test('no filter keeps everything and hides nothing', () => {
  const f = applyFilters(rows, leads, NO_FILTERS, NOW);
  assert.equal(f.rows.length, rows.length);
  assert.equal(f.unknown, 0);
});

test('a view step keeps only counted rows at or above it, and counts the uncounted as unknown', () => {
  const step = VIEW_STEPS.find((s) => s.label === '500K+') ?? null;
  const f = applyFilters(rows, leads, { ...NO_FILTERS, views: step }, NOW);
  assert.ok(f.rows.every((r) => r.reach.known && r.reach.amount >= 500_000));
  assert.equal(f.unknown, rows.filter((r) => !r.reach.known).length);
});

test('a site filter never guesses a site it has not learned', () => {
  const onlyTikTok = applyFilters(rows, leads, { ...NO_FILTERS, sites: ['tiktok'] }, NOW);
  assert.deepEqual(onlyTikTok.rows.map((r) => r.id), ['st_goose']);
  const notLoaded = applyFilters(rows, new Map(), { ...NO_FILTERS, sites: ['tiktok'] }, NOW);
  assert.equal(notLoaded.rows.length, 0);
  assert.equal(notLoaded.unknown, rows.length);
});

test('a posted window leaves out rows whose start nobody read, and says so', () => {
  const f = applyFilters(rows, leads, { ...NO_FILTERS, posted: POSTED_WINDOWS[0] ?? null }, NOW);
  assert.ok(f.rows.every((r) => r.firstSeenAt.known && NOW - r.firstSeenAt.at <= 3_600_000));
  assert.equal(f.unknown, 1);
});

test('"has a coin" includes an unsure match, "no coin yet" is only none', () => {
  const has = applyFilters(rows, leads, { ...NO_FILTERS, coin: 'has' }, NOW).rows.map((r) => r.coins.kind);
  assert.ok(has.includes('unsure') && !has.includes('none'));
  const none = applyFilters(rows, leads, { ...NO_FILTERS, coin: 'none' }, NOW).rows;
  assert.ok(none.every((r) => r.coins.kind === 'none'));
});

test('the lead post is the earliest one we can date', () => {
  const s = decodeStory(fixtureStory('nr_jimothy'));
  assert.equal(leadPost(s.evidence)?.author, 'WhiteHouse');
  assert.equal(leadPost([]), null);
});
