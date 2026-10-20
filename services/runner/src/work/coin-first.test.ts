/**
 * The coin-first route against stand-ins: a post a running coin ties is read by id if we do not hold
 * it, judged once if nobody answered it, credited once answered; each only once, inside the day's
 * caps and the pass's; a post too old at the launch costs nothing; a dry run reads, asks and stamps
 * nothing; off, the route reads no table; and the record names the post's first coin.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { inMemoryMeter } from '@insidor/meter';
import type { CoinFirstRow, CoinFirstWrite } from '@insidor/store';

import type { Logger } from '../log.ts';
import { byPost, coinFirstPass, newCoinFirstState, room, type CoinFirstDeps } from './coin-first.ts';

const NOW = 1_800_000_000_000 as Millis;
const HOUR = 3_600_000;
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;
const policyWith = (over: Partial<Policy['rising']['coinFirst']>): Policy => ({ ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, coinFirst: { ...DEFAULT_POLICY.rising.coinFirst, on: true, ...over } } });

const row = (over: Partial<CoinFirstRow>): CoinFirstRow => ({
  itemId: 'txt:1', source: 'txt', sourceItemId: '1', link: 'https://text.example/dog/status/1', via: 'link', address: 'COIN', launchedAtMs: (NOW - 10 * 60_000) as Millis,
  held: true, postedAtMs: (NOW - HOUR) as Millis, judged: false, credited: false, fetchAskedAtMs: null, judgeAskedAtMs: null, admittedAtMs: null, ...over,
});

const item = (itemId: string): Item => ({ itemId, sourceItemId: itemId.split(':')[1], postedAt: NOW - HOUR, counters: {} }) as unknown as Item;

function harness(rows: CoinFirstRow[], o: { policy?: Policy; mode?: 'dry' | 'live'; spent?: { fetches: number; judgements: number } } = {}) {
  const looked: string[][] = [];
  const judged: string[] = [];
  const credited: string[] = [];
  const written: CoinFirstWrite[] = [];
  let reads = 0;
  const t = {
    id: 'txt',
    capabilities: { discovery: ['catchall'] },
    parseLink: (url: string) => {
      const m = /^https:\/\/text\.example\/(\w+)\/status\/(\d+)/.exec(url);
      return m?.[2] === undefined ? null : { kind: 'post' as const, sourceItemId: m[2], handle: m[1] };
    },
    estimate: (call: { sourceItemIds?: readonly string[] }) => ({ vendor: 'txt', endpoint: 'lookup', usd: 0.00015 * (call.sourceItemIds?.length ?? 1) }),
    lookup: async (ids: readonly string[]) => {
      looked.push([...ids]);
      return { value: { items: ids.map((sid) => item(`txt:${sid}`)), authors: [], cursor: null, hasMore: false }, spend: { vendor: 'txt', endpoint: 'lookup', unit: 'per-item-returned', units: ids.length, usd: 0.00015 * ids.length, at: NOW } };
    },
  } as unknown as PlatformAdapter;
  const deps: CoinFirstDeps = {
    repo: {
      running: async () => {
        reads += 1;
        return rows;
      },
      spentSince: async () => o.spent ?? { fetches: 0, judgements: 0 },
      record: async (w) => void written.push(...w),
      ties: async () => new Map([['txt:1', [{ address: 'EARLIER', launchedAtMs: (NOW - 20 * 60_000) as Millis }]]]),
    },
    items: {
      byIds: async (ids) => new Map(ids.filter((id) => rows.some((r) => r.itemId === String(id) && r.held)).map((id) => [id, item(String(id))] as const)),
      markFoundBy: async (ids) => void credited.push(...ids.map(String)),
    },
    sources: () => [t],
    store: async (items) => items.length,
    score: async (queue) => {
      judged.push(...queue.map((i) => String(i.itemId)));
      return { queued: queue.length, scored: queue.length, copied: 0, waiting: 0, wouldSpendUsd: 0, spentUsd: 0.0002 * queue.length };
    },
    meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: { txt: 1 }, softStop: 1, now: () => NOW }),
    mode: o.mode ?? 'live',
    policy: o.policy ?? policyWith({}),
    log: quiet,
    now: () => NOW,
  };
  return { deps, looked, judged, credited, written, reads: () => reads };
}

test('off, the route reads no table', async () => {
  const h = harness([row({})], { policy: policyWith({ on: false }) });
  const r = await coinFirstPass(h.deps, newCoinFirstState());
  assert.equal(r.posts, 0);
  assert.equal(h.reads(), 0);
});

test('a post we do not hold is read by id once, and the ask is stamped', async () => {
  const h = harness([row({ held: false, postedAtMs: null })]);
  await coinFirstPass(h.deps, newCoinFirstState());
  assert.deepEqual(h.looked, [['1']]);
  assert.equal(h.written[0]?.fetchAsked, true);
  assert.equal(h.judged.length, 0);
});

test('a held post nobody answered is judged once; an answered one is credited to the coin lane', async () => {
  const h = harness([row({}), row({ itemId: 'txt:2', sourceItemId: '2', judged: true })]);
  await coinFirstPass(h.deps, newCoinFirstState());
  assert.deepEqual(h.judged, ['txt:1']);
  assert.deepEqual(h.credited, ['txt:2']);
  const w = new Map(h.written.map((x) => [x.itemId, x]));
  assert.equal(w.get('txt:1')?.judgeAsked, true);
  assert.equal(w.get('txt:2')?.credited, true);
});

test('asked before and still unanswered, or read before and gone: nothing more is spent', async () => {
  const h = harness([row({ judgeAskedAtMs: (NOW - 60_000) as Millis }), row({ itemId: 'txt:3', sourceItemId: '3', held: false, fetchAskedAtMs: (NOW - 60_000) as Millis })]);
  await coinFirstPass(h.deps, newCoinFirstState());
  assert.equal(h.judged.length, 0);
  assert.equal(h.looked.length, 0);
});

test('a post older than 48 hours at the launch costs nothing and is not recorded', async () => {
  const h = harness([row({ postedAtMs: (NOW - 10 * 60_000 - 49 * HOUR) as Millis })]);
  await coinFirstPass(h.deps, newCoinFirstState());
  assert.equal(h.judged.length, 0);
  assert.equal(h.written.length, 0);
});

test('the day caps and the pass cap bound the asks', async () => {
  const many = Array.from({ length: 30 }, (_, i) => row({ itemId: `txt:${i + 10}`, sourceItemId: String(i + 10) }));
  const p = policyWith({ perPass: 5, judgementsPerDay: 200 });
  const h = harness(many, { policy: p });
  await coinFirstPass(h.deps, newCoinFirstState());
  assert.equal(h.judged.length, 5);
  const spent = harness(many, { policy: p, spent: { fetches: 0, judgements: 198 } });
  await coinFirstPass(spent.deps, newCoinFirstState());
  assert.equal(spent.judged.length, 2);
  assert.deepEqual(room({ fetches: 500, judgements: 500 }, p), { fetches: 0, judgements: 0 });
});

test('a dry run reads, judges and credits nothing it would pay for, and stamps no ask', async () => {
  const h = harness([row({ held: false, postedAtMs: null }), row({ itemId: 'txt:2', sourceItemId: '2', judged: true })], { mode: 'dry' });
  await coinFirstPass(h.deps, newCoinFirstState());
  assert.equal(h.looked.length, 0);
  assert.equal(h.credited.length, 0);
  assert.ok(h.written.every((w) => w.fetchAsked !== true && w.credited !== true));
});

test('the record names the earliest coin tying the post; the route waits its own clock', async () => {
  const h = harness([row({})]);
  const state = newCoinFirstState();
  await coinFirstPass(h.deps, state);
  assert.equal(h.written[0]?.firstCoinAddress, 'EARLIER');
  await coinFirstPass(h.deps, state);
  assert.equal(h.reads(), 1);
});

test('one row per post: the earliest-launched running coin', () => {
  const rows = byPost([row({ address: 'LATE', launchedAtMs: (NOW - 60_000) as Millis }), row({ address: 'EARLY', launchedAtMs: (NOW - 120_000) as Millis })]);
  assert.deepEqual(rows.map((r) => r.address), ['EARLY']);
});
