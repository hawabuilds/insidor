/**
 * The second vendor for re-reads and creator pages, and the route between it and the backup: two
 * failures in a row (or one refusal to pay) move the work to the backup and are announced once; the
 * work a failure left is done on the backup in the same call; a deleted video is not a failure; a
 * retry after the wait moves it back; past the backup's last day there is no backup; and never a
 * cached answer, never the key in a URL.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { inMemoryMeter } from '@insidor/meter';

import { tiktokPlatform } from './index.ts';
import type { RunResult, TikTokClient } from './client.ts';
import { lastCreditReading, route, type RouteEvent } from './route.ts';
import { scClient, SC_VENDOR } from './scrapecreators.ts';
import { VENDOR } from './capabilities.ts';

const NOW = 1_792_000_000_000 as Millis;
const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: NOW };

const entry = (id: string) => ({
  aweme_id: id,
  desc: 'a dog #dog',
  create_time: 1_791_999_000,
  author: { uid: '1', unique_id: 'h', nickname: 'H' },
  statistics: { play_count: 1000 + Number(id), digg_count: 10, comment_count: 1, share_count: 1, collect_count: 1 },
  video: { duration: 6000, cover: { url_list: ['https://p.example/c.jpeg'] } },
  music: { id_str: '77' },
});

/** The first scraper, counting the URLs it was asked for. */
function backup(asked: string[]): TikTokClient {
  return {
    runObserve: async (urls: readonly string[]): Promise<RunResult> => {
      asked.push(...urls);
      return { runId: 'r', items: urls.map((u) => ({ id: u.split('/').pop(), playCount: 5, diggCount: 1, createTime: 1_791_999_000, authorMeta: { name: 'h' } })) };
    },
    runDiscovery: async () => ({ runId: 'r', items: [] }),
  } as unknown as TikTokClient;
}

type Answer = number | Record<string, unknown>;
function vendor(answers: Answer[], seen: string[]): typeof globalThis.fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push(String(url));
    assert.equal(new Headers(init?.headers).get('x-api-key'), 'k');
    const a = answers.shift() ?? 500;
    return typeof a === 'number' ? new Response('{}', { status: a }) : new Response(JSON.stringify(a), { status: 200 });
  }) as typeof globalThis.fetch;
}

function build(answers: Answer[], seen: string[], asked: string[], r = route()) {
  r.configure({ on: true, failAfter: 2, retryAfterMs: 1_800_000, backupUntilMs: NOW + 7 * 86_400_000 });
  let now: number = NOW;
  const adapter = tiktokPlatform({
    client: backup(asked),
    sc: scClient({ apiKey: 'k', baseUrl: 'https://h', fetch: vendor(answers, seen) }),
    route: r,
    meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: {}, softStop: 1, now: () => NOW }),
    now: () => now as Millis,
    handleOf: () => 'h',
  });
  return { adapter, r, tick: (ms: number) => (now += ms) };
}

test('re-reads go to the second vendor, one credit a video, never from its cache; the balance is read off the answer', async () => {
  const seen: string[] = [];
  const asked: string[] = [];
  const { adapter } = build([{ success: true, credits_charged: 1, credits_remaining: 412, aweme_detail: entry('11') }, { success: true, credits_charged: 1, aweme_detail: entry('12') }], seen, asked);
  const quote = adapter.estimate({ kind: 'observe', sourceItemIds: ['11', '12'] });
  assert.equal(quote.vendor, SC_VENDOR);
  const got = await adapter.observe(['11', '12'], budget);
  assert.deepEqual([...got.value.keys()], ['11', '12']);
  assert.equal(got.value.get('11')?.reach?.value, 1011);
  assert.equal(asked.length, 0);
  assert.ok(seen.every((u) => u.startsWith('https://h/v2/tiktok/video?url=') && !u.includes('cache') && !u.includes('k=')));
  assert.equal(lastCreditReading()?.credits, 412);
});

test('two failures in a row move the work to the backup, announced once; what failed is read there in the same call', async () => {
  const seen: string[] = [];
  const asked: string[] = [];
  const { adapter, r, tick } = build([500, 500, 500, 500], seen, asked);
  const events: RouteEvent[] = [];
  r.onSwitch((e) => events.push(e));
  const first = await adapter.observe(['11', '12'], budget);
  assert.equal(first.value.size, 2, 'the backup read both');
  assert.equal(events.length, 0);
  await adapter.observe(['13'], budget);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'backup');
  /* On the backup now: nothing more is sent to the second vendor until the wait is over. */
  const before = seen.length;
  const third = await adapter.observe(['14'], budget);
  assert.equal(seen.length, before);
  assert.equal(third.spend.vendor, VENDOR);
  assert.deepEqual(asked.map((u) => u.split('/').pop()), ['11', '12', '13', '14']);
  assert.equal(adapter.estimate({ kind: 'observe', sourceItemIds: ['15'] }).vendor, VENDOR);
  /* Still failing at the retry: stays on the backup, no second alert. */
  tick(1_800_000);
  await adapter.observe(['15'], budget);
  assert.equal(events.length, 1);
});

test('a refusal to pay switches at once; an answer after the wait switches back, announced', async () => {
  const seen: string[] = [];
  const asked: string[] = [];
  const { adapter, r, tick } = build([402, { success: true, credits_charged: 1, aweme_detail: entry('12') }], seen, asked);
  const events: RouteEvent[] = [];
  r.onSwitch((e) => events.push(e));
  await adapter.observe(['11'], budget);
  assert.deepEqual(events.map((e) => e.kind), ['backup']);
  tick(1_800_000);
  const got = await adapter.observe(['12'], budget);
  assert.equal(got.value.get('12')?.reach?.value, 1012);
  assert.deepEqual(events.map((e) => e.kind), ['backup', 'back']);
});

test('a deleted video is a fact, not a failure: no switch, and it is not paid for twice', async () => {
  const seen: string[] = [];
  const asked: string[] = [];
  const { adapter, r } = build([{ success: true, credits_charged: 1, aweme_detail: null }, { success: true, credits_charged: 1, aweme_detail: null }, { success: true, credits_charged: 1, aweme_detail: null }], seen, asked);
  await adapter.observe(['11', '12', '13'], budget);
  assert.equal(r.state().backupSince, null);
  assert.equal(asked.length, 0);
});

test('past the last day of the backup, failures are failures', async () => {
  const seen: string[] = [];
  const asked: string[] = [];
  const r = route();
  const { adapter } = build([500, 500, 500, 500, 500, 500], seen, asked, r);
  r.configure({ on: true, failAfter: 2, retryAfterMs: 1_800_000, backupUntilMs: NOW - 1 });
  await adapter.observe(['11'], budget);
  await adapter.observe(['12'], budget);
  assert.equal(r.state().backupSince, null);
});

test('a creator page: newest posts from the second vendor; an empty page counts against it and the backup is asked', async () => {
  const seen: string[] = [];
  const asked: string[] = [];
  const { adapter, r } = build([{ success: true, credits_charged: 1, aweme_list: [entry('21'), entry('22'), entry('23')] }, { success: true, credits_charged: 1, aweme_list: [] }], seen, asked);
  const q = { mode: 'account' as const, term: 'buddytrashpanda', sinceMs: null, untilMs: null, limit: 2, cursor: null };
  assert.equal(adapter.estimate({ kind: 'discover', query: q }).vendor, SC_VENDOR);
  const got = await adapter.discover(q, budget);
  assert.deepEqual(got.value.items.map((i) => i.sourceItemId), ['21', '22']);
  assert.ok(seen[0]?.includes('/v3/tiktok/profile/videos?handle=buddytrashpanda&sort_by=latest'));
  await adapter.discover(q, budget);
  assert.equal(r.state().failures, 1);
});

test('switched off: nothing goes to the second vendor', async () => {
  const seen: string[] = [];
  const asked: string[] = [];
  const r = route();
  const { adapter } = build([], seen, asked, r);
  r.configure({ on: false, failAfter: 2, retryAfterMs: 0, backupUntilMs: NOW + 1 });
  await adapter.observe(['11'], budget);
  assert.equal(seen.length, 0);
  assert.equal(asked.length, 1);
});

test('a sound: its posts on the second vendor, a bad id refused before any request', async () => {
  const seen: string[] = [];
  const { adapter } = build([{ success: true, credits_charged: 1, cursor: 12, aweme_list: [entry('31')] }], seen, []);
  const got = await adapter.soundPosts!('tiktok:sound:7643908584044791824', budget);
  assert.deepEqual(got.value.items.map((i) => i.sourceItemId), ['31']);
  assert.ok(seen[0]?.includes('/v1/tiktok/song/videos?clipId=7643908584044791824'));
  await assert.rejects(() => adapter.soundPosts!('tiktok:sound:abc', budget), RangeError);
  assert.equal(seen.length, 1);
});
