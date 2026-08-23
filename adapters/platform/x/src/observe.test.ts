/**
 * The tracking path: batching, keying, and the absence rule.
 *
 * ★ THE ONE PROPERTY WORTH THE WHOLE FILE: an id the vendor did not answer is ABSENT
 * from the result map, never present with zeros. This is where most of this source's
 * money is spent and where deleted posts are ordinary, so it is also where a zeroed
 * counter set would be produced most often — and a zeroed counter set is a
 * measurement saying "this post lost all its engagement", which is dramatic, precise
 * and false.
 *
 * The client here is a plain object. No network, no key, no charge.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { XClient } from './client.ts';
import { chunk, observeBatch } from './observe.ts';

const AT = 1_800_000_000_000;

const clientReturning = (items: readonly unknown[]): XClient => ({
  search: async () => ({ items: [], cursor: null, hasMore: false }),
  lookup: async () => items,
});

test('chunk splits a list and refuses a batch size of nothing', () => {
  assert.deepEqual(chunk(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(chunk([], 5), []);
  assert.throws(() => chunk(['a'], 0), RangeError);
});

test('★ an id the vendor did not answer is ABSENT from the map, not zeroed', async () => {
  const client = clientReturning([{ id: '1', likeCount: 5, viewCount: 100 }]);
  const read = await observeBatch(client, ['1', '2'], AT);

  assert.equal(read.counters.size, 1);
  assert.equal(read.counters.has('2'), false, 'a deleted post was given a counter set');
  // And the caller can see the shortfall, which is the whole mechanism: the map is
  // keyed by id and the missing keys are the answer.
  assert.equal(read.counters.get('1')?.approval?.value, 5);
});

test('★ a counter the payload does not carry is NULL, never 0', async () => {
  // A zero here reads downstream as "nobody engaged with this", which is the opposite
  // of "we did not get a reading" — and demotes the item in exactly the wrong
  // direction.
  const client = clientReturning([{ id: '1', likeCount: 5 }]);
  const read = await observeBatch(client, ['1'], AT);
  const counters = read.counters.get('1');

  assert.ok(counters !== undefined);
  assert.equal(counters.approval?.value, 5);
  assert.equal(counters.reach?.value, null);
  assert.equal(counters.reproduction?.value, null);
  // Present-and-null is not the same as absent: this source HAS all six counters, so
  // every key is there with an honest null in it.
  assert.equal('reach' in counters, true);
});

test('either spelling of the id keys the map, and an entry with neither is dropped', async () => {
  // An entry under a key no caller holds is worse than an absence: it makes
  // `counters.size` disagree with the number of ids actually answered, and that count
  // is what tells a deleted post from an unread one.
  const client = clientReturning([{ id: '1' }, { id_str: '2' }, { text: 'no id at all' }]);
  const read = await observeBatch(client, ['1', '2', '3'], AT);

  assert.deepEqual([...read.counters.keys()].sort(), ['1', '2']);
});

test('every counter in one batch shares one observedAt, injected', async () => {
  const client = clientReturning([{ id: '1', likeCount: 1 }, { id: '2', likeCount: 2 }]);
  const read = await observeBatch(client, ['1', '2'], AT);
  for (const counters of read.counters.values()) {
    assert.equal(counters.approval?.observedAt, AT);
  }
});

test('★ a batch where everything has been deleted still books a whole unit', async () => {
  // The vendor charges a floor per request. Booking this at zero is precisely how the
  // tracking path came to understate its own spend, and it understates it most on the
  // days the most posts have gone.
  const read = await observeBatch(clientReturning([]), ['1', '2'], AT);
  assert.equal(read.counters.size, 0);
  assert.equal(read.units, 1);
});

test('units are what came back, not what was asked for', async () => {
  const read = await observeBatch(clientReturning([{ id: '1' }, { id: '2' }]), ['1', '2', '3'], AT);
  assert.equal(read.units, 2);
});
