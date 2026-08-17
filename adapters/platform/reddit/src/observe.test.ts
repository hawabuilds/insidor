/**
 * The tracking path. The one behaviour worth a test here is an ABSENCE: an id
 * the vendor did not return must be missing from the map rather than present
 * with zeros. On this source that case is ordinary — posts are removed,
 * deleted and hidden constantly — so it is the default path, not the edge one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAIN, REMOVED } from './__fixtures__/posts.ts';
import type { RedditClient } from './client.ts';
import { chunk, observeBatch } from './observe.ts';

const AT = 1_800_000_000_000;

const clientReturning = (items: readonly unknown[]): { client: RedditClient; asked: string[][] } => {
  const asked: string[][] = [];
  return {
    asked,
    client: {
      listing: async () => {
        throw new Error('unreachable');
      },
      info: async (ids) => {
        asked.push([...ids]);
        return items;
      },
    },
  };
};

test('★ an id that comes back with no payload is OMITTED, never mapped to zeros', async () => {
  // A removed post and an unread post are different facts. A zeroed counter set
  // would look like a post that lost every comment it had — a measurement, and
  // a dramatic one — where the truth is that we got no reading.
  const { client } = clientReturning([PLAIN]);
  const read = await observeBatch(client, ['t3_1a2b3c', 't3_deadbeef'], AT);

  assert.deepEqual([...read.counters.keys()], ['t3_1a2b3c']);
  assert.equal(read.counters.has('t3_deadbeef'), false);
  assert.equal(read.counters.get('t3_1a2b3c')?.conversation?.value, 219);
});

test('the map is keyed by the fullname the caller asked with', async () => {
  // Keying by the bare id would key by a string no caller holds, so every entry
  // would silently look absent — a result that is empty, plausible and wrong.
  const { client } = clientReturning([PLAIN, REMOVED]);
  const read = await observeBatch(client, ['t3_1a2b3c', 't3_1a2b3f'], AT);
  assert.deepEqual([...read.counters.keys()], ['t3_1a2b3c', 't3_1a2b3f']);
});

test('a removed post that still answers carries real readings, not zeros', async () => {
  const { client } = clientReturning([REMOVED]);
  const read = await observeBatch(client, ['t3_1a2b3f'], AT);
  assert.equal(read.counters.get('t3_1a2b3f')?.approval?.value, 77);
  assert.equal(read.counters.get('t3_1a2b3f')?.conversation?.value, 9);
});

test('the re-read emits the same absent counters as the translation does', async () => {
  const { client } = clientReturning([PLAIN]);
  const read = await observeBatch(client, ['t3_1a2b3c'], AT);
  const counters = read.counters.get('t3_1a2b3c') ?? {};
  for (const kind of ['reach', 'rebroadcast', 'reproduction', 'retention']) {
    assert.equal(kind in counters, false, `${kind} leaked into the tracking path`);
  }
});

test('the read instant is injected here too, so a batch shares one observedAt', async () => {
  const { client } = clientReturning([PLAIN, REMOVED]);
  const read = await observeBatch(client, ['t3_1a2b3c', 't3_1a2b3f'], AT);
  for (const counters of read.counters.values()) {
    assert.equal(counters.approval?.observedAt, AT);
    assert.equal(counters.conversation?.observedAt, AT);
  }
});

test('ids are chunked to the batch size, and a size of zero is a caller bug', () => {
  assert.deepEqual(chunk(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(chunk([], 100), []);
  assert.throws(() => chunk(['a'], 0), RangeError);
});
