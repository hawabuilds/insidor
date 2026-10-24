/**
 * A page names the countries of its meme war only while the war is still being posted
 * (Policy.narrative.fight.activeMs), only for two or more countries, and never for an unknown post time.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { countriesOf } from './narrative-frame.ts';

const NOW = 1_800_000_000_000;
const WEEK = P.narrative.fight.activeMs;

const POSTS = P.narrative.fight.minPosts;

test('★ the countries while a post went up inside the week, and not after', () => {
  assert.deepEqual(countriesOf(['China', 'Turkey'], NOW - WEEK + 1, NOW, P, POSTS), ['China', 'Turkey']);
  assert.equal(countriesOf(['China', 'Turkey'], NOW - WEEK - 1, NOW, P, POSTS), null, 'a war nobody posts to any more leaves the umbrella');
  assert.equal(countriesOf(['China', 'Turkey'], null, NOW, P, POSTS), null, 'an unknown post time is never "still going"');
});

test('★ too few posts to read it as a war: not said', () => {
  assert.equal(countriesOf(['China', 'United States'], NOW, NOW, P, POSTS - 1), null);
});

test('not a war, never asked, or switched off: nothing said', () => {
  assert.equal(countriesOf([], NOW, NOW, P, POSTS), null);
  assert.equal(countriesOf(null, NOW, NOW, P, POSTS), null);
  assert.equal(countriesOf(['China', 'Turkey'], NOW, NOW, { ...P, narrative: { ...P.narrative, fight: { ...P.narrative.fight, on: false } } }, POSTS), null);
});
