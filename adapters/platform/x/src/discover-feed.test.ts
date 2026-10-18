/**
 * The catch-all search: no keyword, an approval floor, a media lane, and a time window —
 * rendered exactly as the earlier build sent it, and refused when it would be unbounded.
 *
 * Recorded responses only: the client is a plain object answering with the adapter's own
 * recorded payloads (__fixtures__/posts.ts). Nothing here opens a socket.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Millis } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import type { Meter } from '@insidor/contracts/ports/meter.ts';

import type { XClient } from './client.ts';
import { cutoffSecond, searchPage, toSearchQuery } from './discover.ts';
import { xPlatform } from './index.ts';
import { PLAIN, QUOTE } from './__fixtures__/posts.ts';

const AT = 1_800_000_000_000 as Millis;
const SINCE = (AT - 30 * 60_000) as Millis;

const feed = (over: Partial<DiscoveryQuery> = {}): DiscoveryQuery => ({
  mode: 'catchall',
  term: '',
  sinceMs: SINCE,
  untilMs: AT,
  limit: 20,
  cursor: null,
  filter: { minApproval: 50, mediaOnly: false, langs: ['en'], excludeRebroadcasts: true },
  ...over,
});

test('★ the catch-all lane renders the earlier build\'s query, with no keyword, leaving out only plain reposts', () => {
  assert.equal(
    toSearchQuery(feed()),
    `min_faves:50 lang:en -filter:retweets since_time:${SINCE / 1000} until_time:${cutoffSecond(AT)}`,
  );
});

test('★ replies and quote posts are never filtered out: a meme can start as either', () => {
  const q = toSearchQuery(feed());
  assert.ok(!q.includes('filter:replies'), q);
  assert.ok(!q.includes('filter:quote'), q);
  assert.ok(!toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, langs: ['en'], excludeRebroadcasts: false } })).includes('filter:'), 'and nothing at all when reposts are wanted too');
});

test('★ the media lane is the same query with filter:media', () => {
  const q = toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: true, langs: ['en'], excludeRebroadcasts: true } }));
  assert.equal(q, `min_faves:50 filter:media lang:en -filter:retweets since_time:${SINCE / 1000} until_time:${cutoffSecond(AT)}`);
});

test('a null language searches every language', () => {
  assert.ok(!toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, langs: [], excludeRebroadcasts: true } })).includes('lang:'));
});

test('★ a catch-all search with no floor is refused rather than sent unbounded', () => {
  const { filter: _omitted, ...unbounded } = feed();
  assert.throws(() => toSearchQuery(unbounded), NotImplemented);
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 0, mediaOnly: false, langs: ['en'], excludeRebroadcasts: true } })), NotImplemented);
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 12.5, mediaOnly: false, langs: ['en'], excludeRebroadcasts: true } })), NotImplemented);
});

test('a term on a catch-all search is refused, so it cannot quietly become a keyword search', () => {
  assert.throws(() => toSearchQuery(feed({ term: 'chillguy' })), NotImplemented);
});

test('a language code that is not one is refused rather than pasted into the query', () => {
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, langs: ['en OR x'], excludeRebroadcasts: true } })), NotImplemented);
});

test('★ a recorded page comes back as posts with their authors, and the units are what was returned', async () => {
  let sent = '';
  const recorded: XClient = {
    search: async (q) => {
      sent = q;
      return { items: [PLAIN, QUOTE], cursor: null, hasMore: false };
    },
    lookup: async () => [],
  };
  const page = await searchPage(recorded, feed({ untilMs: null }), AT);
  assert.ok(sent.startsWith('min_faves:50 '));
  assert.equal(page.items.length, 2);
  assert.equal(page.units, 2);
  assert.ok(page.authors.some((a) => a.handle === 'someone'));
});

test('★ several languages are refused, never an OR group: the supplier answers only the last one since 2026-10-16', () => {
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, langs: ['en', 'zxx'], excludeRebroadcasts: true } })), NotImplemented);
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, langs: ['en', 'zxx', 'pt', 'qme', 'ja'], excludeRebroadcasts: true } })), NotImplemented);
  /* One language is the bare operator, and no OR is ever sent. */
  const q = toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, langs: ['zxx'], excludeRebroadcasts: true } }));
  assert.ok(q.includes('lang:zxx') && !q.includes(' OR '), q);
});

test('★ the adapter refuses an OR of languages before the supplier is called or the meter charged', async () => {
  let searched = 0;
  const charged: number[] = [];
  const client: XClient = { search: async () => { searched += 1; return { items: [PLAIN], cursor: null, hasMore: false }; }, lookup: async () => [] };
  const meter = {
    mayspend: () => true,
    record: (s: { usd: number }) => void charged.push(s.usd),
    spentUsd: () => 0,
    line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
  } as unknown as Meter;
  const x = xPlatform({ client, meter, now: () => AT });
  const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: (AT + 60_000) as Millis };
  await assert.rejects(x.discover(feed({ filter: { minApproval: 50, mediaOnly: false, langs: ['en', 'ja'], excludeRebroadcasts: true } }), budget), NotImplemented);
  assert.equal(searched, 0, 'no search went out');
  assert.deepEqual(charged, [], 'and nothing was charged');
  /* One language goes out as before. */
  await x.discover(feed({ filter: { minApproval: 50, mediaOnly: false, langs: ['ja'], excludeRebroadcasts: true } }), budget);
  assert.equal(searched, 1);
});
