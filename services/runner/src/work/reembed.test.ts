/**
 * The re-embed walk (reembed.ts) over fake work lists and a fake port: that it pages by key, chunks
 * by the port's batch, writes what came back, counts what did not as unread, and stops at the limit
 * and at the shutdown signal. The SQL itself is exercised by the tool's dry run against the database.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { MediaRef } from '@insidor/contracts';
import type { EmbedPort, Embedding } from '@insidor/contracts/ports/embed.ts';
import type { Db } from '@insidor/store';

import { reembedKinds, type ReembedEvent, type ReembedKind, type ReembedRow, type ReembedSource } from './reembed.ts';

const db: Db = { query: async () => [] };
const empty: ReembedSource = { count: async () => ({ rows: 0, pictures: 0 }), page: async () => [] };

/** A work list of `n` rows keyed n-1 … 0, served `size` at a time after the given key; records every write. */
function list(n: number, size: number, picture: boolean, written: string[], afters: (readonly string[] | null)[]): ReembedSource {
  const keys = Array.from({ length: n }, (_, i) => String(n - 1 - i).padStart(4, '0'));
  return {
    count: async () => ({ rows: n, pictures: picture ? n : 0 }),
    page: async (_db, after) => {
      afters.push(after);
      const from = after === null ? 0 : keys.indexOf(after[0]!) + 1;
      return keys.slice(from, from + size).map((k): ReembedRow => ({
        key: [k],
        input: picture ? { media: { kind: 'image', uri: `u${k}`, width: null, height: null, durationMs: null } } : { text: `t${k}`, picture: null },
        write: async () => void written.push(k),
      }));
    },
  };
}

function sources(over: Partial<Record<ReembedKind, ReembedSource>>): Record<ReembedKind, ReembedSource> {
  return { posts: empty, labels: empty, names: empty, pictures: empty, coins: empty, coined: empty, ...over };
}

/** A port of batch 2 that cannot read any input whose name ends in 3. */
function fakePort(calls: string[][]): EmbedPort {
  const embed = (names: readonly string[]) => {
    calls.push([...names]);
    const value = names.map((s): Embedding | null => (s.endsWith('3') ? null : { space: 's', dimensions: 1, values: new Float32Array([1]) }));
    return Promise.resolve({ value, spend: { vendor: 'self', usd: 0 } } as unknown as Awaited<ReturnType<NonNullable<EmbedPort['embedMedia']>>>);
  };
  return {
    id: 'fake',
    space: 's',
    postSpace: 's.post',
    dimensions: 1,
    maxBatch: 2,
    embedText: (texts) => embed(texts),
    embedMedia: (media: readonly MediaRef[]) => embed(media.map((m) => m.uri)),
    embedPosts: (posts) => embed(posts.map((p) => p.text)),
  };
}

test('walks every page by key, writes what came back, counts the unread, and finishes', async () => {
  const written: string[] = [];
  const afters: (readonly string[] | null)[] = [];
  const calls: string[][] = [];
  const events: ReembedEvent[] = [];
  const results = await reembedKinds(db, fakePort(calls), {
    kinds: ['posts'],
    concurrency: 2,
    limit: Infinity,
    sources: sources({ posts: list(10, 4, false, written, afters) }),
    log: (e) => events.push(e),
    now: () => 0,
  });
  /* Three pages of 4, 4, 2 and the empty one that ends the walk, each after the last key seen. */
  assert.deepEqual(afters, [null, ['0006'], ['0002'], ['0000']]);
  /* Chunks of the port's batch. */
  assert.ok(calls.every((c) => c.length <= 2));
  assert.equal(calls.length, 5);
  /* 0003 could not be read: not written, counted. */
  assert.deepEqual([...written].sort(), ['0000', '0001', '0002', '0004', '0005', '0006', '0007', '0008', '0009']);
  assert.deepEqual(results, [{ kind: 'posts', done: 10, written: 9, unread: 1 }]);
  assert.deepEqual(events.map((e) => e.event), ['page', 'page', 'page', 'finished']);
  assert.deepEqual(events.at(-1), { kind: 'posts', event: 'finished', written: 9, unread: 1 });
});

test('pictures go to embedMedia, and each kind is walked in turn', async () => {
  const calls: string[][] = [];
  const written: string[] = [];
  const results = await reembedKinds(db, fakePort(calls), {
    kinds: ['labels', 'pictures'],
    concurrency: 1,
    limit: Infinity,
    sources: sources({ labels: list(1, 4, false, written, []), pictures: list(2, 4, true, written, []) }),
    log: () => {},
    now: () => 0,
  });
  assert.deepEqual(calls, [['t0000'], ['u0001', 'u0000']]);
  assert.deepEqual(results.map((r) => [r.kind, r.written]), [['labels', 1], ['pictures', 2]]);
});

test('stops reading pages once the limit is reached', async () => {
  const afters: (readonly string[] | null)[] = [];
  const results = await reembedKinds(db, fakePort([]), {
    kinds: ['names'],
    concurrency: 2,
    limit: 5,
    sources: sources({ names: list(20, 4, false, [], afters) }),
    log: () => {},
    now: () => 0,
  });
  /* Checked a page at a time: 4, then 8 ≥ 5, and the third page read is not embedded. */
  assert.equal(afters.length, 3);
  assert.equal(results[0]!.done, 8);
});

test('an aborted signal stops the walk before its next page', async () => {
  const ac = new AbortController();
  const afters: (readonly string[] | null)[] = [];
  const src = list(20, 4, false, [], afters);
  const results = await reembedKinds(db, fakePort([]), {
    kinds: ['posts', 'labels'],
    concurrency: 2,
    limit: Infinity,
    sources: sources({ posts: { ...src, page: async (d, a) => { const rows = await src.page(d, a); ac.abort(); return rows; } }, labels: list(4, 4, false, [], []) }),
    log: () => {},
    signal: ac.signal,
    now: () => 0,
  });
  assert.equal(afters.length, 1);
  assert.deepEqual(results.map((r) => [r.kind, r.done]), [['posts', 4], ['labels', 0]]);
});
