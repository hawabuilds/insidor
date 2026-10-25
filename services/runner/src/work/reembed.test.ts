/**
 * The re-embed walk (reembed.ts) over fake work lists and a fake port: that it pages by key, chunks
 * by the port's batch, writes what came back, counts what did not as unread, and stops at the limit
 * and at the shutdown signal. The SQL itself is exercised by the tool's dry run against the database.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { MediaRef } from '@insidor/contracts';
import type { EmbedPort, Embedding } from '@insidor/contracts/ports/embed.ts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { E5_POST_SPACE, POST_SPACE, SPACE } from '@insidor/embed-selfhost';
import type { Db } from '@insidor/store';

import { reembedPlan } from '../reembed-on-boot.ts';
import { reembedKinds, reembedPostSpace, reembedSources, type ReembedEvent, type ReembedKind, type ReembedRow, type ReembedSource } from './reembed.ts';

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

const withImage = (over: Partial<Policy['group']['image']>): Policy => ({ ...DEFAULT_POLICY, group: { ...DEFAULT_POLICY.group, image: { ...DEFAULT_POLICY.group.image, ...over } } });

test('★ the post kinds fill toward the next post space when one is named, else the current one', () => {
  assert.equal(reembedPostSpace(withImage({ postSpace: POST_SPACE, postSpaceNext: E5_POST_SPACE })), E5_POST_SPACE);
  assert.equal(reembedPostSpace(withImage({ postSpace: POST_SPACE, postSpaceNext: null })), POST_SPACE);
  assert.equal(reembedPostSpace(withImage({ postSpace: E5_POST_SPACE, postSpaceNext: null })), E5_POST_SPACE, 'after the switch, the boot tops up the new space');
  assert.equal(reembedPostSpace(withImage({ postSpace: 'multimodal-3.1024.post', postSpaceNext: null })), null, 'a space this adapter does not compute is never filled');
});

test('★ a named next space starts the fill on its own; with neither it does not run; pictures always go', () => {
  assert.equal(reembedPlan(withImage({ backfill: false, postSpaceNext: null })), null);
  assert.deepEqual(reembedPlan(withImage({ backfill: false, postSpace: POST_SPACE, postSpaceNext: E5_POST_SPACE })), { kinds: ['posts', 'labels', 'names', 'pictures', 'coins', 'coined'], postSpace: E5_POST_SPACE });
  assert.deepEqual(reembedPlan(withImage({ backfill: true, postSpace: 'multimodal-3.1024.post', postSpaceNext: null }))?.kinds, ['pictures', 'coins', 'coined']);
});

test('★ the work lists read and write the post space they are given; pictures stay in the picture space', async () => {
  const asked: unknown[][] = [];
  const fake: Db = {
    query: async (sql: string, params?: readonly unknown[]) => {
      asked.push([sql, ...(params ?? [])]);
      return (/from internal\.post_embedding where space <> \$1 group by item_id/.test(sql) ? [{ item_id: 'x:1', at: '2026-10-25 00:00:00+00', body: 'deer', media: [] }] : []) as never;
    },
  };
  const all = reembedSources({ policy: DEFAULT_POLICY, coinSinceMs: 0, now: () => 0, postSpace: E5_POST_SPACE });
  const [row] = await all.posts.page(fake, null);
  assert.equal(asked[0]?.[1], E5_POST_SPACE, 'the work list is "not yet in the next space"');
  await row!.write(new Float32Array(3));
  assert.ok(asked.some((q) => /insert into internal\.post_embedding/.test(String(q[0])) && q.includes(E5_POST_SPACE)), 'written under the next space');
  asked.length = 0;
  await all.labels.count(fake);
  await all.names.count(fake);
  assert.deepEqual(asked.map((q) => q[1]), [E5_POST_SPACE, E5_POST_SPACE]);
  asked.length = 0;
  await all.pictures.count(fake);
  assert.equal(asked[0]?.[1], SPACE);
  asked.length = 0;
  await reembedSources({ policy: DEFAULT_POLICY, coinSinceMs: 0 }).posts.count(fake);
  assert.equal(asked[0]?.[1], POST_SPACE, 'no space given: our first post space, as before');
});
