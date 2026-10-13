/**
 * The missed-post queue, worked against stand-ins: a link no source takes fails, a second paste of
 * a post fails as a duplicate, a post we held is diagnosed without a read, a post we never had is
 * read once on the learning meter and stored, a gone post is unreadable, a dry run and a spent
 * line leave rows queued, a $0 line fails them, and a failed read is retried before it gives up.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { MISSED_DIAGNOSES, MISSED_FAILURES } from '@insidor/core';
import { inMemoryMeter } from '@insidor/meter';
import type { HeldPost, MissedOutcome, QueuedMissedPost } from '@insidor/store';

import type { Logger } from '../log.ts';
import { MAX_ATTEMPTS, workMissedPosts, type MissedDeps, type MissedRepo } from './missed-posts.ts';

const NOW = 1_800_000_000_000 as Millis;
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;

const row = (id: number, url: string, attempts = 0): QueuedMissedPost => ({ id, url, ownerRef: 'owner', attempts, addedAt: NOW });
const heldPost = (id: string, foundBy: HeldPost['foundBy'] = null): HeldPost => ({
  itemId: `src:${id}`,
  firstSeenAt: NOW,
  postedAt: (NOW - 3_600_000) as Millis,
  foundBy,
  lang: 'en',
  text: 'a cat $CAT',
  hasMedia: true,
  isRebroadcast: false,
  approvals: 5_000,
});

function harness(o: { rows: QueuedMissedPost[]; held?: Record<string, HeldPost>; returns?: string[]; throws?: boolean; mode?: 'dry' | 'live'; lineUsd?: number; doneFor?: Record<string, number> }) {
  const finished: { id: number; o: MissedOutcome }[] = [];
  const retried: number[] = [];
  const looked: string[][] = [];
  const stored: Item[] = [];
  const held = new Map(Object.entries(o.held ?? {}));
  let suggestion: string | null | undefined;
  const repo: MissedRepo = {
    queued: async () => o.rows,
    doneFor: async (_s, id) => o.doneFor?.[id] ?? null,
    held: async (_s, id) => held.get(id) ?? null,
    facts: async () => ({ judgement: null, reach: [], shownAt: null }),
    coinsNamed: async (terms) => (terms.includes('CAT') ? [{ address: 'coin1', name: 'cat', ticker: 'CAT', launchedAt: NOW }] : []),
    finish: async (id, outcome) => void finished.push({ id, o: outcome }),
    retry: async (id) => void retried.push(id),
    diagnosed: async () => finished.filter((f) => f.o.itemId !== null).map((f) => ({ source: f.o.source, diagnosis: f.o.diagnosis, detail: f.o.detail })),
    writeSuggestion: async (text) => void (suggestion = text),
  };
  const adapter = {
    id: 'src',
    capabilities: { discovery: ['catchall'] },
    parseLink: (url: string) => {
      const m = /^https:\/\/posts\.example\/p\/(\d+)$/.exec(url);
      return m?.[1] === undefined ? null : { kind: 'post' as const, sourceItemId: m[1] };
    },
    estimate: (call: { sourceItemIds?: readonly string[] }) => ({ vendor: 'vendor', endpoint: 'lookup', usd: 0.001 * (call.sourceItemIds?.length ?? 1) }),
    lookup: async (ids: readonly string[]) => {
      looked.push([...ids]);
      if (o.throws === true) throw new Error('source down');
      const items = ids.filter((id) => (o.returns ?? ids).includes(id)).map((id) => ({ itemId: `src:${id}`, sourceItemId: id }) as unknown as Item);
      return { value: { items, authors: [], cursor: null, hasMore: false }, spend: { vendor: 'vendor', endpoint: 'lookup', unit: 'per-item-returned', units: ids.length, usd: 0.001 * ids.length, at: NOW } };
    },
  } as unknown as PlatformAdapter;
  const meter = inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: { vendor: o.lineUsd ?? 1 }, softStop: 1, now: () => NOW });
  const deps: MissedDeps = {
    missed: repo,
    openLearning: async () => ({ sources: [adapter], meter, close: async () => {} }),
    store: async (items) => {
      stored.push(...items);
      for (const i of items) held.set(i.sourceItemId, heldPost(i.sourceItemId));
      return items.length;
    },
    coinSearch: [],
    settings: async () => null,
    searchUsdPerDay: async () => 1,
    mode: o.mode ?? 'live',
    policy: DEFAULT_POLICY,
    log: quiet,
    now: () => NOW,
  };
  return { deps, finished, retried, looked, stored, suggestion: () => suggestion };
}

test('a link no source takes fails as not a post; a second paste of a done post fails as a duplicate', async () => {
  const h = harness({ rows: [row(1, 'https://elsewhere.example/x'), row(2, 'https://posts.example/p/5')], doneFor: { '5': 9 } });
  const r = await workMissedPosts(h.deps);
  assert.deepEqual(h.finished.map((f) => [f.id, f.o.diagnosis]), [[1, 'not_a_post'], [2, 'duplicate']]);
  assert.equal(r.failed, 2);
  assert.equal(h.looked.length, 0);
});

test('★ a post we held is diagnosed from what we held, without a read, for nothing; a coin of its cashtag is found', async () => {
  const h = harness({ rows: [row(1, 'https://posts.example/p/7')], held: { '7': heldPost('7', { lane: 'all', at: NOW }) } });
  await workMissedPosts(h.deps);
  assert.equal(h.looked.length, 0, 'a held post was read again');
  const o = h.finished[0]?.o;
  assert.equal(o?.diagnosis, 'not_judged');
  assert.equal(o?.usd, 0);
  assert.equal(o?.coinAddress, 'coin1');
});

test('★ posts we never had are read once, together, on the learning meter, stored, and diagnosed as never found; a gone one is unreadable', async () => {
  const h = harness({ rows: [row(1, 'https://posts.example/p/1'), row(2, 'https://posts.example/p/2')], returns: ['1'] });
  const r = await workMissedPosts(h.deps);
  assert.deepEqual(h.looked, [['1', '2']]);
  assert.deepEqual(h.stored.map((i) => i.sourceItemId), ['1']);
  assert.deepEqual(h.finished.map((f) => [f.id, f.o.diagnosis]), [[1, 'never_found'], [2, 'unreadable']]);
  assert.ok((h.finished[0]?.o.usd ?? 0) > 0);
  assert.equal(r.done, 1);
  assert.ok(h.suggestion() !== undefined, 'the suggestion was not rewritten after a done row');
});

test('a dry run and a learning line spent for today leave rows queued; a $0 line fails them', async () => {
  const dry = harness({ rows: [row(1, 'https://posts.example/p/1')], mode: 'dry' });
  assert.equal((await workMissedPosts(dry.deps)).waiting, 1);
  assert.equal(dry.finished.length + dry.looked.length, 0);

  const spent = harness({ rows: [row(1, 'https://posts.example/p/1')], lineUsd: 0.0001 });
  assert.equal((await workMissedPosts(spent.deps)).waiting, 1);
  assert.equal(spent.looked.length, 0);

  const none = harness({ rows: [row(1, 'https://posts.example/p/1')], lineUsd: 0 });
  await workMissedPosts(none.deps);
  assert.equal(none.finished[0]?.o.diagnosis, 'no_line');
});

test('a failed read is tried again, and fails as unreadable on the last attempt', async () => {
  const h = harness({ rows: [row(1, 'https://posts.example/p/1'), row(2, 'https://posts.example/p/2', MAX_ATTEMPTS - 1)], throws: true });
  await workMissedPosts(h.deps);
  assert.deepEqual(h.retried, [1]);
  assert.deepEqual(h.finished.map((f) => [f.id, f.o.diagnosis]), [[2, 'unreadable']]);
});

test('the diagnosis lists core writes are the CHECK lists of 0055', () => {
  const sql = readFileSync(new URL('../../../../store/migrations/0055_missed_post.sql', import.meta.url), 'utf8');
  const list = /diagnosis\s+text check \(diagnosis in \(([^)]*)\)\)/s.exec(sql)?.[1] ?? '';
  const values = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...values].sort(), [...MISSED_DIAGNOSES, ...MISSED_FAILURES].sort());
});
