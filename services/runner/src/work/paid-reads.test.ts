/**
 * Which posts of a source billed per run are re-read: young fast growers on every run, the
 * rest every few hours, never more than the run's cap. No database: the candidates are plain.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { growthPerMinute, pickPaidReads } from './paid-reads.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;

/** A short video posted `ageMin` ago, last read `readMin` ago at `views`. */
function video(n: number, ageMin: number, readMin: number, views: number): Item {
  const src = sourceId('tiktok');
  return {
    itemId: itemId(src, `v${n}`),
    source: src,
    sourceItemId: `v${n}`,
    origin: 'observed',
    authorKey: authorKey(src, `a${n}`),
    postedAt: (NOW - ageMin * MIN) as Millis,
    firstSeenAt: (NOW - readMin * MIN) as Millis,
    lang: 'en',
    text: `video ${n}`,
    media: [],
    counters: { reach: { value: views, fidelity: { kind: 'exact' }, observedAt: (NOW - readMin * MIN) as Millis } },
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: `t/${n}`,
  };
}

const pick = (items: readonly Item[]) => pickPaidReads(items.map((item) => ({ item, observations: [] })), NOW, P).map((i) => i.sourceItemId);

test('a young video growing fast is read on the next run, fastest first', () => {
  // 40 minutes old, read 20 minutes ago (at 20 minutes old): 26k views is 1,300 a minute.
  const fast = video(1, 40, 20, 26_000);
  // Same age, 2k views: 100 a minute, under the bar, and read too recently for the slow re-read.
  const slow = video(2, 40, 20, 2_000);
  const faster = video(3, 30, 20, 30_000);
  assert.deepEqual(pick([fast, slow, faster]), ['v3', 'v1']);
  assert.ok((growthPerMinute({ item: fast, observations: [] }) ?? 0) > P.track.paidFastMinReachPerMinute);
});

test('a fast video past the growth window is read on the slow clock like any other', () => {
  const old = video(1, P.rising.fypMaxAgeMs / MIN + 60, 20, 5_000_000);
  assert.deepEqual(pick([old]), []);
  const stale = video(2, P.rising.fypMaxAgeMs / MIN + 60, P.track.paidReadMinMinutes, 5_000_000);
  assert.deepEqual(pick([stale]), ['v2']);
});

test('a video read in the last run is not read again in this one', () => {
  assert.deepEqual(pick([video(1, 40, 2, 26_000)]), []);
});

test('★ a run never reads more than its cap, fast growers before the slow re-reads, oldest reading first', () => {
  const fast = Array.from({ length: 3 }, (_, i) => video(i, 50, 20, 40_000 + i));
  const slow = Array.from({ length: P.track.paidReadMaxPosts }, (_, i) => video(100 + i, 1_000, P.track.paidReadMinMinutes + i, 100_000));
  const picked = pick([...slow, ...fast]);
  assert.equal(picked.length, P.track.paidReadMaxPosts);
  assert.deepEqual(picked.slice(0, 3), ['v2', 'v1', 'v0']);
  // The slow ones that made it are the longest unread.
  assert.equal(picked[3], `v${100 + P.track.paidReadMaxPosts - 1}`);
});

test('★ a video asked about in the last run that never answered waits like one that did', () => {
  // Read three hours ago and never since: a deleted video, asked about in the run before this one.
  const dead = video(1, 1_000, P.track.paidReadMinMinutes, 100_000);
  const asked = (askedAt: number | null) => pickPaidReads([{ item: dead, observations: [], askedAt }], NOW, P).map((i) => i.sourceItemId);
  assert.deepEqual(asked(null), ['v1']);
  assert.deepEqual(asked(NOW - P.track.paidRunEveryMinutes * MIN), []);
  // And once its slow clock has run out since that ask, it is asked again.
  assert.deepEqual(asked(NOW - P.track.paidReadMinMinutes * MIN), ['v1']);
});

test('★ the cap and the run spacing keep re-reads inside the share of the line discovery leaves', () => {
  // $0.001 a run and $0.003 a post (the vendor's charges, adapters/platform/tiktok).
  const runsPerDay = (24 * 60) / P.track.paidRunEveryMinutes;
  const worstUsd = runsPerDay * (0.001 + P.track.paidReadMaxPosts * 0.003);
  const line = P.budget.supplierLines.video + P.budget.supplierLines.actors;
  assert.ok(worstUsd <= line * (1 - P.feed.budgetShare) + 1e-9, `re-reads could cost $${worstUsd} a day`);
});

test('★ the places beyond the slow cap are for young fast videos only', () => {
  const slow = Array.from({ length: P.track.paidReadMaxPosts + 2 }, (_, i) => video(200 + i, 1_000, P.track.paidReadMinMinutes + i, 100_000));
  assert.equal(pick(slow).length, P.track.paidReadMaxSlowPosts, 'old posts alone fill only the slow places');
  const fast = Array.from({ length: P.track.paidReadMaxPosts + 2 }, (_, i) => video(300 + i, 50, 20, 40_000 + i));
  assert.equal(pick([...slow, ...fast]).length, P.track.paidReadMaxPosts, 'young fast ones may take every place');
});
