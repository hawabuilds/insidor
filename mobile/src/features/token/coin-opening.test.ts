/**
 * The owner's rule for a coin tap (2026-10-14): it always opens that coin's token page. A coin
 * the narrative settled on gets the narrative's page; any other its own page by id, with a grey
 * line when the post has not proven it; nothing is ever refused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import { settledCoins } from '../../shared/coin-status.ts';
import { hrefFor, parseRoute } from '../../shared/route.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { NOT_PROVEN, coinOpening, sheetCoinRoute } from './coin-opening.ts';

const story = sampleNarrativeIds().map((id) => decodeStory(fixtureStory(id))).find((s) => settledCoins(s.coins).length > 0);
assert.ok(story !== undefined, 'a sample narrative with a settled coin');
const settled = settledCoins(story.coins)[0]!;
const OTHER = 'solana:SomeOtherSameNameCoin1111111111111111pump';

test('a coin the narrative settled on opens the narrative page for it', () => {
  assert.equal(coinOpening({ state: 'ready', value: story }, settled.coinId).kind, 'narrative');
});

test('★ a coin the narrative did not settle on still opens, as itself, never a refusal', () => {
  assert.deepEqual(coinOpening({ state: 'ready', value: story }, OTHER), { kind: 'own' });
  assert.deepEqual(coinOpening({ state: 'failed' }, settled.coinId), { kind: 'own' }, 'an unreadable narrative does not block the coin');
  assert.deepEqual(coinOpening({ state: 'loading' }, settled.coinId), { kind: 'loading' });
});

test('★ every Choose coin row opens a token page; an unproven one by its own id, marked for the grey line', () => {
  assert.deepEqual(sheetCoinRoute({ coinId: OTHER, proven: false }, story.id), { screen: 'token', coinId: OTHER, unproven: true });
  assert.deepEqual(sheetCoinRoute({ coinId: OTHER, proven: false }, null), { screen: 'token', coinId: OTHER, unproven: true });
  assert.deepEqual(sheetCoinRoute({ coinId: settled.coinId, proven: true }, story.id), { screen: 'coin', storyId: story.id, coinId: settled.coinId });
  assert.deepEqual(sheetCoinRoute({ coinId: settled.coinId, proven: true }, null), { screen: 'token', coinId: settled.coinId });
  assert.deepEqual(parseRoute(hrefFor(sheetCoinRoute({ coinId: OTHER, proven: false }, story.id))), { screen: 'token', coinId: OTHER, unproven: true });
});

test('the grey line is a fact about the post, never how sure', () => {
  assert.doesNotMatch(NOT_PROVEN, /\d|%|score|confiden|sure/i);
});
