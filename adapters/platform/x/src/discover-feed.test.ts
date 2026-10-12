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

import type { XClient } from './client.ts';
import { cutoffSecond, searchPage, toSearchQuery } from './discover.ts';
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
  filter: { minApproval: 50, mediaOnly: false, lang: 'en', originalsOnly: true },
  ...over,
});

test('★ the catch-all lane renders the earlier build\'s query, with no keyword', () => {
  assert.equal(
    toSearchQuery(feed()),
    `min_faves:50 lang:en -filter:replies -filter:retweets since_time:${SINCE / 1000} until_time:${cutoffSecond(AT)}`,
  );
});

test('★ the media lane is the same query with filter:media', () => {
  const q = toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: true, lang: 'en', originalsOnly: true } }));
  assert.equal(q, `min_faves:50 filter:media lang:en -filter:replies -filter:retweets since_time:${SINCE / 1000} until_time:${cutoffSecond(AT)}`);
});

test('a null language searches every language', () => {
  assert.ok(!toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, lang: null, originalsOnly: true } })).includes('lang:'));
});

test('★ a catch-all search with no floor is refused rather than sent unbounded', () => {
  const { filter: _omitted, ...unbounded } = feed();
  assert.throws(() => toSearchQuery(unbounded), NotImplemented);
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 0, mediaOnly: false, lang: 'en', originalsOnly: true } })), NotImplemented);
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 12.5, mediaOnly: false, lang: 'en', originalsOnly: true } })), NotImplemented);
});

test('a term on a catch-all search is refused, so it cannot quietly become a keyword search', () => {
  assert.throws(() => toSearchQuery(feed({ term: 'chillguy' })), NotImplemented);
});

test('a language code that is not one is refused rather than pasted into the query', () => {
  assert.throws(() => toSearchQuery(feed({ filter: { minApproval: 50, mediaOnly: false, lang: 'en OR x', originalsOnly: true } })), NotImplemented);
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
