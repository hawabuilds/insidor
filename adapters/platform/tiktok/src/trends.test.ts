/**
 * The trend list: only two-capital regions are asked (the ranking has no worldwide list), the
 * input is the actor's own family, and "rising" is the ranking's own "up" — never read from rank.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromTrendsRows, toTrendsInput, trendRegions, trendsRunUsd } from './trends.ts';

test('regions: two capitals only, upper-cased, no repeats; an empty one is never sent', () => {
  assert.deepEqual(trendRegions({ regions: ['US', 'gb', '', 'US', 'WORLD'], perRegion: 10 }), ['US', 'GB']);
});

test('the input asks hashtags over the shortest period, capped', () => {
  assert.deepEqual(toTrendsInput('US', 500), { trendType: 'hashtags', maxItems: 50, countryCode: 'US', hashtagPeriod: '7', industryId: '', saveMedia: false });
});

test('rows: the tag without its #, rising only when the ranking says up, a row with no tag skipped', () => {
  const words = fromTrendsRows(
    [
      { Rank: 1, Hashtag: '#hurricane', 'Trend Direction': 'stable', 'Video Views': 10, Posts: 2, Period: '7 days' },
      { Rank: 2, Hashtag: '#raccoon', 'Trend Direction': 'up' },
      { Rank: 3 },
    ],
    'US',
  );
  assert.deepEqual(words.map((w) => [w.value, w.rank, w.rising]), [['hurricane', 1, false], ['raccoon', 2, true]]);
  assert.equal(trendsRunUsd(20), 0.025 + 20 * 0.001);
});
