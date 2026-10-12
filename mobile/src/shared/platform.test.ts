import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FILTER_PLATFORMS, platformOf, siteList } from './platform.ts';

test('a known label maps to its mark, whatever its case', () => {
  assert.equal(platformOf('TikTok'), 'tiktok');
  assert.equal(platformOf(' x '), 'x');
});

test('an unknown label is null, never the nearest-looking mark', () => {
  assert.equal(platformOf('Twitch'), null);
  assert.equal(platformOf('Twitter'), null);
});

test('each site is named once, in the order first seen', () => {
  assert.equal(siteList(['X', 'TikTok', 'X', 'Instagram', 'TikTok']), 'X, TikTok, Instagram');
});

test('the filters offer X and TikTok only, while a post from a hidden platform still gets its mark', () => {
  assert.deepEqual(FILTER_PLATFORMS.map((p) => p.label), ['X', 'TikTok']);
  assert.equal(platformOf('Reddit'), 'reddit', 'hidden from the filters, not forgotten');
});
