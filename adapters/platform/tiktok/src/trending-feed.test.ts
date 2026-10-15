/**
 * The recommendation feed: no key means no client (the feed is optional, never a fault); the key
 * goes in a header and never in the URL; adverts are dropped; a spent pack throws rather than
 * reading as an empty feed; tags come from the caption; and the adapter meters one credit a region,
 * on its own vendor, with a video two regions both returned stored once.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { inMemoryMeter } from '@insidor/meter';
import { OutOfCredit } from '@insidor/vendor-kit';

import { tiktokPlatform } from './index.ts';
import type { TikTokClient } from './client.ts';
import { FEED_USD_PER_CREDIT, FEED_VENDOR, feedRegions, fromTrendingFeed, trendingFeedClient } from './trending-feed.ts';
import { toItem } from './to-item.ts';

const NOW = 1_792_000_000_000 as Millis;

/* One entry in the vendor's shape, trimmed from a page read 2026-10-15 (ids and counts kept). */
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  aweme_id: id,
  desc: 'So the boy broke the window #fyp #viral',
  create_time: 1_791_990_000,
  author: { uid: '7042076224482542597', unique_id: 'mr.aura144', nickname: 'Aura', avatar_medium: { uri: 'x', url_list: ['https://p.example/a.jpeg'] } },
  statistics: { play_count: 763255, digg_count: 80670, comment_count: 900, share_count: 1200, collect_count: 4000 },
  video: { duration: 6000, cover: { uri: 'https://p.example/c.jpeg', url_list: ['https://p.example/c.jpeg'] } },
  music: { id: 7080961279083400000, id_str: '7080961279083399938', title: 'original sound' },
  is_ad: false,
  ...extra,
});

function fakeFetch(pages: Record<string, unknown>, seen: { url: string; key: string | null }[]): typeof globalThis.fetch {
  return (async (url: string, init?: RequestInit) => {
    const key = new Headers(init?.headers).get('x-api-key');
    seen.push({ url: String(url), key });
    const region = new URL(String(url)).searchParams.get('region') ?? '';
    const body = pages[region];
    if (body === undefined) return new Response('{}', { status: 402 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
}

test('no key, no client: the feed is optional', () => {
  assert.equal(trendingFeedClient({ apiKey: '  ', baseUrl: 'https://h', fetch: globalThis.fetch }), null);
});

test('regions: two capitals only, no repeats', () => {
  assert.deepEqual(feedRegions(['us', 'US', 'GB', 'WORLD', '']), ['US', 'GB']);
});

test('the key rides the header, never the URL; adverts dropped; a spent pack throws', async () => {
  const seen: { url: string; key: string | null }[] = [];
  const client = trendingFeedClient({ apiKey: 'k-123', baseUrl: 'https://h/', fetch: fakeFetch({ US: { success: true, credits_charged: 1, aweme_list: [entry('1'), entry('2', { is_ad: true })] } }, seen) })!;
  const page = await client.feed('US');
  assert.equal(page.items.length, 1);
  assert.equal(page.creditsCharged, 1);
  assert.equal(seen[0]?.url, 'https://h/v1/tiktok/get-trending-feed?region=US');
  assert.equal(seen[0]?.key, 'k-123');
  assert.ok(!seen[0]?.url.includes('k-123'));
  await assert.rejects(() => client.feed('GB'), (e: unknown) => e instanceof OutOfCredit);
});

test('an entry becomes an Item through to-item, its tags read from the caption', () => {
  const item = toItem(fromTrendingFeed(entry('7696911502623657229')), NOW);
  assert.equal(item.sourceItemId, '7696911502623657229');
  assert.equal(item.postedAt, 1_791_990_000_000);
  assert.equal(item.counters.reach?.value, 763255);
  assert.ok(item.formatIds.includes('tiktok:sound:7080961279083399938'));
  assert.deepEqual(item.fingerprints.filter((f) => f.kind === 'entitySpan').length, 2);
});

test('the adapter: one credit a region on its own vendor, a video both regions returned stored once', async () => {
  const seen: { url: string; key: string | null }[] = [];
  const pages = {
    US: { success: true, credits_charged: 1, aweme_list: [entry('1'), entry('2')] },
    GB: { success: true, credits_charged: 1, aweme_list: [entry('2'), entry('3')] },
  };
  const meter = inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: {}, softStop: 1, now: () => NOW });
  const adapter = tiktokPlatform({
    client: {} as TikTokClient,
    feed: trendingFeedClient({ apiKey: 'k', baseUrl: 'https://h', fetch: fakeFetch(pages, seen) }),
    meter,
    now: () => NOW,
    handleOf: () => null,
  });
  const quote = adapter.estimateTrendingFeed!({ regions: ['US', 'GB'] });
  assert.equal(quote.vendor, FEED_VENDOR);
  assert.equal(quote.usd, 2 * FEED_USD_PER_CREDIT);
  const got = await adapter.trendingFeed!({ regions: ['US', 'GB'] }, { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: NOW });
  assert.deepEqual(got.value.items.map((i) => i.sourceItemId), ['1', '2', '3']);
  assert.equal(got.spend.vendor, FEED_VENDOR);
  assert.equal(got.spend.units, 2);
  assert.equal(seen.length, 2);
});

test('a 5xx is asked once more, and only once', async () => {
  let n = 0;
  const flaky = (async () => {
    n += 1;
    return n === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ success: true, credits_charged: 1, aweme_list: [entry('1')] }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const page = await trendingFeedClient({ apiKey: 'k', baseUrl: 'https://h', fetch: flaky })!.feed('US');
  assert.equal(page.items.length, 1);
  assert.equal(n, 2);
  const down = (async () => new Response('{}', { status: 503 })) as unknown as typeof globalThis.fetch;
  await assert.rejects(() => trendingFeedClient({ apiKey: 'k', baseUrl: 'https://h', fetch: down })!.feed('US'), /503/);
});

test('no feed client, no feed methods', () => {
  const adapter = tiktokPlatform({ client: {} as TikTokClient, meter: inMemoryMeter({ dailyCapUsd: 1, perVendorCapUsd: {}, softStop: 1, now: () => NOW }), now: () => NOW, handleOf: () => null });
  assert.equal(adapter.trendingFeed, undefined);
});
