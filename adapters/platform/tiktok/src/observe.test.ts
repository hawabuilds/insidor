/**
 * The tracking path: addressing, batching, and the two absences.
 *
 * ★ THE TWO PROPERTIES WORTH THE WHOLE FILE, and both are about not inventing a
 * reading:
 *
 *   An id the run did not answer is ABSENT from the result map, never present with
 *   zeros. On this source that is the difference between "we did not read this post"
 *   and "this post lost every view it had".
 *
 *   An id we cannot ADDRESS is never asked for. This source is addressed by URL, so
 *   a post with no handle — or with a handle that will not survive the URL gate — is
 *   dropped here, where it costs nothing, rather than inside a run we paid for and
 *   which would have come back empty and read as a deleted post.
 *
 * The client is a plain object. No network, no token, no billed run.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { RunResult, TikTokClient } from './client.ts';
import { addressable, chunk, observeBatch } from './observe.ts';

const AT = 1_800_000_000_000;

const clientReturning = (result: RunResult): TikTokClient => ({
  runDiscovery: async () => ({ items: [], runId: null }),
  runObserve: async () => result,
});

const item = (id: string, stats: Record<string, unknown> | null = { playCount: 10, diggCount: 2 }): unknown => ({
  id,
  desc: `post ${id}`,
  ...(stats === null ? {} : { stats }),
});

/* ── addressing ───────────────────────────────────────────────────────── */

test('★ an id with no handle is dropped here, not guessed at inside a paid run', () => {
  const pairs = addressable(['1', '2', '3'], (id) => (id === '2' ? null : 'someone'));
  assert.deepEqual(pairs, [
    { id: '1', url: 'https://www.tiktok.com/@someone/video/1' },
    { id: '3', url: 'https://www.tiktok.com/@someone/video/3' },
  ]);
});

test('★ a handle or an id that would not survive the URL gate is dropped, not encoded', () => {
  // Percent-encoding it would produce a request that is valid, wrong, and answered in
  // a way that reads as "this post is gone". One bad row must also never fail a whole
  // batch, which is why this is a predicate check rather than a caught throw.
  const pairs = addressable(['1', '2', '3', '4/../5'], (id) => (id === '2' ? '../admin' : 'someone'));
  assert.deepEqual(pairs.map((p) => p.id), ['1', '3']);
});

test('★ an absurdly long handle or id is dropped, because it goes into a body we PAY to run', () => {
  // The length bound lives here rather than in the URL builder, because this is where
  // a long string costs something: fifty of them go into one actor input, and that
  // input is a billed run. The builder answers the different question of whether a
  // character can change which request is made.
  const long = 'a'.repeat(200);
  assert.deepEqual(addressable(['1', long], () => 'someone').map((p) => p.id), ['1']);
  assert.deepEqual(addressable(['1'], (id) => (id === '1' ? long : 'someone')), []);
});

test('every id being unaddressable is a legitimate outcome, not an error', () => {
  assert.deepEqual(addressable(['1', '2'], () => null), []);
});

test('chunk splits a list and refuses a batch size of nothing', () => {
  assert.deepEqual(chunk(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(chunk([], 5), []);
  assert.throws(() => chunk(['a'], 0), RangeError);
});

/* ── reading ──────────────────────────────────────────────────────────── */

test('★ an id the run did not answer is ABSENT from the map, not zeroed', async () => {
  const client = clientReturning({ items: [item('1')], runId: 'RUN1' });
  const read = await observeBatch(
    client,
    [
      { id: '1', url: 'https://www.tiktok.com/@someone/video/1' },
      { id: '2', url: 'https://www.tiktok.com/@someone/video/2' },
    ],
    AT,
  );

  assert.equal(read.counters.size, 1);
  assert.equal(read.counters.has('2'), false, 'a deleted post was given a counter set');
  assert.equal(read.runId, 'RUN1');
});

test('★★ reproduction is not on the counter set — not null, not zero, ABSENT', async () => {
  // The build this replaces hardcoded a zero here and every post from this source
  // looked uncopied forever. A zero does not read as "unknown" downstream; it reads
  // as "nobody copied this", which is the opposite of what an uncounted stitch means.
  const read = await observeBatch(
    clientReturning({ items: [item('1')], runId: null }),
    [{ id: '1', url: 'https://www.tiktok.com/@someone/video/1' }],
    AT,
  );
  const counters = read.counters.get('1');

  assert.ok(counters !== undefined);
  assert.equal('reproduction' in counters, false, 'this source emitted a reproduction counter');
});

test('★ a counter the payload does not carry is NULL, never 0', async () => {
  // Distinct from absent above: `reach` is a concept this source HAS, so an unread one
  // is a null reading rather than a missing key.
  const read = await observeBatch(
    clientReturning({ items: [item('1', { commentCount: 4 })], runId: null }),
    [{ id: '1', url: 'https://www.tiktok.com/@someone/video/1' }],
    AT,
  );
  const counters = read.counters.get('1');

  assert.ok(counters !== undefined);
  assert.equal(counters.conversation?.value, 4);
  assert.equal(counters.reach?.value, null);
  assert.equal('reach' in counters, true);
});

test('either spelling of the id keys the map, and an entry with neither is dropped', async () => {
  // An entry under a key no caller holds makes `counters.size` disagree with the
  // number of ids actually answered, and that count is what tells a deleted post from
  // an unread one.
  const client = clientReturning({
    items: [item('1'), { awemeId: '2', stats: { playCount: 1 } }, { desc: 'no id at all' }],
    runId: null,
  });
  const read = await observeBatch(
    client,
    [
      { id: '1', url: 'https://www.tiktok.com/@someone/video/1' },
      { id: '2', url: 'https://www.tiktok.com/@someone/video/2' },
    ],
    AT,
  );

  assert.deepEqual([...read.counters.keys()].sort(), ['1', '2']);
});

test('every counter in one run shares one observedAt, injected', async () => {
  const client = clientReturning({ items: [item('1'), item('2')], runId: null });
  const read = await observeBatch(
    client,
    [
      { id: '1', url: 'https://www.tiktok.com/@someone/video/1' },
      { id: '2', url: 'https://www.tiktok.com/@someone/video/2' },
    ],
    AT,
  );
  for (const counters of read.counters.values()) {
    assert.equal(counters.reach?.observedAt, AT);
  }
});

test('the urls the run is given are the ones addressing produced, in order', async () => {
  let seen: readonly string[] = [];
  const client: TikTokClient = {
    runDiscovery: async () => ({ items: [], runId: null }),
    runObserve: async (urls) => {
      seen = urls;
      return { items: [], runId: null };
    },
  };
  await observeBatch(client, addressable(['1', '2'], () => 'someone'), AT);
  assert.deepEqual(seen, [
    'https://www.tiktok.com/@someone/video/1',
    'https://www.tiktok.com/@someone/video/2',
  ]);
});

/* ── whole posts by id (the owner's missed posts) ─────────────────────── */

test('lookup reads whole posts from the observe run, skips an entry with no id, and starts no run for an id with no handle', async () => {
  const { tiktokPlatform } = await import('./index.ts');
  const { inMemoryMeter } = await import('@insidor/meter');
  let runs = 0;
  const client: TikTokClient = {
    runDiscovery: async () => ({ items: [], runId: null }),
    runObserve: async () => {
      runs += 1;
      return { items: [item('7'), { desc: 'no id' }], runId: 'r1' };
    },
  };
  const meter = inMemoryMeter({ dailyCapUsd: 10, softStop: 1, now: () => AT });
  const handles: Record<string, string> = { '7': 'someone' };
  const adapter = tiktokPlatform({ client, meter, now: () => AT as never, handleOf: (id) => handles[id] ?? null });
  const budget = { capUsd: 10, spentUsd: 0, maxCalls: null, deadline: (AT + 60_000) as never };
  const read = await adapter.lookup!(['7'], budget);
  assert.deepEqual(read.value.items.map((i) => i.sourceItemId), ['7']);
  assert.equal(runs, 1);
  const none = await adapter.lookup!(['8'], budget);
  assert.equal(none.value.items.length, 0);
  assert.equal(runs, 1, 'an id with no handle bought a run');
});
