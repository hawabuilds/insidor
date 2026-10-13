/**
 * An older coin's run against a post: the bars, the edges either side of the post, and the
 * cut history that must read as "could not tell" rather than a quiet day.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';

import { olderCoinRun, type OlderRunBars, type VolumeBucket } from './older-coin.ts';

const Q = 15 * 60_000;
const H = 3_600_000;
const POST = (100 * H) as Millis;
const LAUNCH = 0 as Millis;
const BARS: OlderRunBars = { baselineMs: 24 * H, watchMs: 6 * H, volumeMultiple: 5, priceMultiple: 2, minHourUsd: 1_000 };
const at = (ms: number, c: number, v: number): VolumeBucket => ({ t: ms as Millis, c, v });

/** A quiet day: $50 in one bucket every hour, at price 1. */
const quietDay = (): VolumeBucket[] => Array.from({ length: 24 }, (_, i) => at(POST - (i + 1) * H, 1, 50));

test('★ the Goliath shape: volume eight times the usual hour since the post is a run, even as the price falls', () => {
  const run = olderCoinRun([...quietDay(), at(POST + Q, 0.8, 900), at(POST + 2 * Q, 0.75, 300)], Q, POST, LAUNCH, true, BARS);
  assert.equal(run.hourBeforeUsd, 50);
  assert.equal(run.peakHourUsd, 1_200);
  assert.equal(run.priceAtPost, 1);
  assert.equal(run.priceSince, 0.75);
  assert.equal(run.running, true);
});

test('a jump under the dollar floor is not a run, however many times the usual hour', () => {
  const run = olderCoinRun([at(POST - H, 1, 1), at(POST + Q, 1, 600)], Q, POST, LAUNCH, true, BARS);
  assert.equal(run.running, false);
  assert.equal(run.peakHourUsd, 600);
});

test('a busy coin staying busy is not a run: the busiest hour must be several times the usual one', () => {
  const busy = Array.from({ length: 24 }, (_, i) => at(POST - (i + 1) * H, 1, 4_000));
  assert.equal(olderCoinRun([...busy, at(POST + Q, 1.1, 8_000)], Q, POST, LAUNCH, true, BARS).running, false);
});

test('a doubled price on real volume is a run without a volume jump', () => {
  const busy = Array.from({ length: 24 }, (_, i) => at(POST - (i + 1) * H, 1, 4_000));
  assert.equal(olderCoinRun([...busy, at(POST + Q, 2.1, 5_000)], Q, POST, LAUNCH, true, BARS).running, true);
});

test('★ the post\'s own bucket is on neither side: trading in it is not "since"', () => {
  const straddle = at(POST - Q / 2, 1, 50_000);
  const run = olderCoinRun([...quietDay(), straddle], Q, POST, LAUNCH, true, BARS);
  assert.equal(run.peakHourUsd, null);
  assert.equal(run.hourBeforeUsd, 50);
  assert.equal(run.running, false);
});

test('trading after the watch is not "since this post"', () => {
  assert.equal(olderCoinRun([...quietDay(), at(POST + 7 * H, 1, 50_000)], Q, POST, LAUNCH, true, BARS).running, false);
});

test('a day with no trades at all, then a real hour, is a run; the usual hour is a true zero', () => {
  const run = olderCoinRun([at(POST + Q, 1, 2_000)], Q, POST, LAUNCH, true, BARS);
  assert.equal(run.hourBeforeUsd, 0);
  assert.equal(run.running, true);
});

test('★ a cut history, or a bucket without its volume, is unread — never a quiet day', () => {
  const unread = { hourBeforeUsd: null, peakHourUsd: null, priceAtPost: null, priceSince: null, running: false };
  assert.deepEqual(olderCoinRun([at(POST + Q, 1, 2_000)], Q, POST, LAUNCH, false, BARS), unread);
  assert.deepEqual(olderCoinRun([{ t: (POST + Q) as Millis, c: 1, v: null }], Q, POST, LAUNCH, true, BARS), unread);
});

test('a coin launched inside the baseline is averaged over the hours it existed', () => {
  const launch = (POST - 2 * H) as Millis;
  const run = olderCoinRun([at(POST - H, 1, 100)], Q, POST, launch, true, BARS);
  assert.equal(run.hourBeforeUsd, 50);
});
