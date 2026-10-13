/**
 * "See 3 coins": the list's decoder, its default order (earliest launch first, market cap one
 * tap away) and its title, which counts what is shown and says "newest" when there were more.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeSameNameCoins } from '../../shared/api/decode.ts';
import { orderCoins } from '../search/search-view.ts';
import { sameNameTitle } from './same-name-view.ts';

const coin = (address: string, cap: number | null, at: number | null, extra: Record<string, unknown> = {}) => ({
  coinId: `solana:${address}`, address, name: 'Jimothy', ticker: 'JIM', imageUrl: null,
  marketCapUsd: cap === null ? { v: null, why: 'no_market' } : { v: cap },
  launchedAt: at === null ? { at: null, why: 'not_reported' } : { at },
  venue: 'curve', curveProgress: { v: 0.42 }, matched: null, ...extra,
});

const list = decodeSameNameCoins({
  kind: 'read', more: false, sourcesMissing: 0,
  items: [coin('A', 5_000, 300), coin('B', 900_000, 100, { venue: 'pool', curveProgress: null }), coin('C', null, 200), coin('D', 70, null)],
});

test('★ earliest launch first by default; an unknown launch sorts last, never first', () => {
  assert.deepEqual(orderCoins(list.items, 'first').map((c) => c.address), ['B', 'C', 'A', 'D']);
});

test('★ the market cap toggle: biggest first, an unread cap last and never as zero', () => {
  assert.deepEqual(orderCoins(list.items, 'cap').map((c) => c.address), ['B', 'A', 'D', 'C']);
});

test('each coin decodes as Search draws it, and none is ever "matched" here', () => {
  const r = decodeSameNameCoins({ kind: 'read', more: true, sourcesMissing: 1, items: [coin('A', 1, 1, { matched: { storyId: 's', title: 'x' } })] });
  assert.equal(r.items[0]?.matched, null, 'this list never says which coin is the post\'s');
  assert.equal(r.items[0]?.curveProgress?.known, true);
  assert.equal(r.more, true);
  assert.equal(r.sourcesMissing, 1);
  assert.equal(list.items[1]?.curveProgress, null, 'a bonded coin has no curve');
});

test('the title counts the list shown, and says "newest" rather than a total we do not have', () => {
  assert.equal(sameNameTitle(3, false), '3 coins with this name');
  assert.equal(sameNameTitle(1, false), '1 coin with this name');
  assert.equal(sameNameTitle(10, true), 'The 10 newest coins with this name');
  assert.equal(sameNameTitle(0, false), 'Coins with this name');
});
