/**
 * FOR YOU IS FRESH: the six-hour rule (fyp-freshness.ts) on its own. How the projector applies it
 * beside the News feed is in news-feed.test.ts.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { freshForYou } from './fyp-freshness.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_760_000_000_000;

test('a post under six hours old stays, however slowly it grows', () => {
  assert.equal(freshForYou([{ atMs: NOW - HOUR, reach: 50_000 }], NOW - 5 * HOUR, NOW), true);
});

test('★ an old post stays only while it is still climbing fast over its last hour of readings', () => {
  const posted = NOW - 10 * HOUR;
  const fast = [{ atMs: NOW - 50 * MIN, reach: 1_000_000 }, { atMs: NOW - 5 * MIN, reach: 1_090_000 }]; // 2,000 a minute
  const slow = [{ atMs: NOW - 50 * MIN, reach: 1_000_000 }, { atMs: NOW - 5 * MIN, reach: 1_009_000 }]; // 200 a minute
  assert.equal(freshForYou(fast, posted, NOW), true);
  assert.equal(freshForYou(slow, posted, NOW), false);
});

test('★ a stale, too-close or unread growth never keeps an old post', () => {
  const posted = NOW - 10 * HOUR;
  const stale = [{ atMs: NOW - 3 * HOUR, reach: 100_000 }, { atMs: NOW - 2 * HOUR, reach: 900_000 }];
  const tooClose = [{ atMs: NOW - 10 * MIN, reach: 100_000 }, { atMs: NOW - 5 * MIN, reach: 900_000 }];
  const unread = [{ atMs: NOW - 50 * MIN, reach: null }, { atMs: NOW - 5 * MIN, reach: null }];
  assert.equal(freshForYou(stale, posted, NOW), false, 'a reading two hours old says nothing about now');
  assert.equal(freshForYou(tooClose, posted, NOW), false, 'five minutes apart is too near for a rate');
  assert.equal(freshForYou(unread, posted, NOW), false);
  assert.equal(freshForYou([], posted, NOW), false);
});

test('a short video is held to its own, scaled growth bar', () => {
  const posted = NOW - 10 * HOUR;
  const views = [{ atMs: NOW - 50 * MIN, reach: 1_000_000 }, { atMs: NOW - 5 * MIN, reach: 1_090_000 }];
  assert.equal(freshForYou(views, posted, NOW, DEFAULT_POLICY, DEFAULT_POLICY.rising.shortVideoReachScale), false);
});

