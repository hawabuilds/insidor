/**
 * Ids are the join keys for everything, so the failures worth testing are the silent
 * ones: an empty component makes two different things equal, and a separator inside a
 * component makes one id parse as another.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { assetKey, authorKey, chainId, itemId, parseAssetKey, sourceId, venueId } from './ids.ts';

const SRC = sourceId('src-a');
const CHAIN = chainId('chain-a');

test('an id is source-qualified, so two sources cannot collide', () => {
  assert.notEqual(String(itemId(SRC, '123')), String(itemId(sourceId('src-b'), '123')));
});

test('an empty component throws rather than producing an id two things share', () => {
  assert.throws(() => itemId(SRC, ''), TypeError);
  assert.throws(() => authorKey(SRC, ''), TypeError);
});

test('a separator inside a component throws rather than producing an ambiguous id', () => {
  assert.throws(() => itemId(SRC, 'a:b'), TypeError);
  assert.throws(() => venueId(CHAIN, 'curve:v2'), TypeError);
});

test('an asset key round-trips through its parse', () => {
  const ref = { chain: CHAIN, address: 'AbCdEf' };
  const parsed = parseAssetKey(assetKey(ref));

  assert.deepEqual(parsed, ref);
});

test('a malformed asset key parses to null rather than to a half-built ref', () => {
  assert.equal(parseAssetKey('no-separator'), null);
  assert.equal(parseAssetKey(':leading'), null);
  assert.equal(parseAssetKey('trailing:'), null);
});
