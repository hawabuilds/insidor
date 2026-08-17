/**
 * Query rendering, and — more importantly — the two things it refuses to do.
 *
 * The refusals are the reason this function is pure and exported: a cutoff that
 * cannot be enforced must fail LOUDLY at the point the query is built, before
 * anything has been asked for and before anything has been paid for. A test
 * that can only observe that behaviour through a network call is a test that
 * does not run.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { LISTING_ENVELOPE } from './__fixtures__/posts.ts';
import { decodeListing } from './client.ts';
import type { ListingPage, ListingRequest, RedditClient } from './client.ts';
import { discoverPage, toListingRequest } from './discover.ts';

const AT = 1_800_000_000_000;

const query = (over: Partial<DiscoveryQuery>): DiscoveryQuery => ({
  mode: 'feed',
  term: 'aww',
  sinceMs: null,
  untilMs: null,
  limit: 25,
  cursor: null,
  ...over,
});

/* ── ★ the cutoff ─────────────────────────────────────────────────────── */

test('a discovery bounded by an instant is REFUSED, never filtered after the fact', () => {
  // The port's rule is absolute: an adapter that cannot enforce the cutoff
  // server-side must fail, because a result already counted against budget has
  // already leaked. Every time filter this source has is a lower bound measured
  // back from now, so there is nothing to enforce it with.
  for (const mode of ['feed', 'keyword'] as const) {
    assert.throws(
      () => toListingRequest(query({ mode, term: 'aww', untilMs: AT - 60_000 })),
      (error: unknown) => {
        assert.ok(error instanceof NotImplemented);
        assert.equal(error.endpoint, 'reddit:discover:cutoff');
        return true;
      },
    );
  }
});

test('the refusal happens before any request is rendered, so nothing is spent to discover it', async () => {
  const client: RedditClient = {
    listing: async () => {
      throw new Error('the cutoff must be refused before the client is reached');
    },
    info: async () => {
      throw new Error('unreachable');
    },
  };
  await assert.rejects(
    () => discoverPage(client, query({ untilMs: AT }), AT),
    (error: unknown) => error instanceof NotImplemented,
  );
});

/* ── the lower bound, which is safe to widen ──────────────────────────── */

test('a since bound is not sent, because the parameter that would carry it is silently ignored', () => {
  // On a plain listing there is no time parameter at all. On a search, `t` is
  // honoured only for the `top` and `controversial` sorts — we sort by `new`,
  // so sending it would put a bound in the request that is accepted and
  // dropped. Over-returning on a LOWER bound is harmless: extra old items
  // cannot know about anything that happened later.
  const feed = toListingRequest(query({ sinceMs: AT - 3 * 3_600_000 }));
  assert.equal('t' in feed.query, false);

  const search = toListingRequest(query({ mode: 'keyword', term: 'grandma dance', sinceMs: AT - 60_000 }));
  assert.equal('t' in search.query, false);
  assert.equal(search.query.sort, 'new');
});

/* ── modes ────────────────────────────────────────────────────────────── */

test('a mode this source has no entry point for throws rather than returning an empty page', () => {
  // An empty result reads downstream as "nothing is happening", which is the
  // exact failure the capability list exists to design out.
  for (const mode of ['hashtag', 'catalog', 'account'] as const) {
    assert.throws(
      () => toListingRequest(query({ mode })),
      (error: unknown) => error instanceof NotImplemented && error.endpoint === `reddit:discover:${mode}`,
    );
  }
});

test('an empty term is an error, not an everything-feed', () => {
  for (const term of ['', '   ']) {
    assert.throws(
      () => toListingRequest(query({ term })),
      (error: unknown) => error instanceof NotImplemented,
    );
  }
});

test('a community feed reads the chronological listing, not the ranked one', () => {
  const request = toListingRequest(query({ term: 'aww', limit: 25 }));
  // `new` and not `hot`: the only listing whose ordering is a fact rather than
  // an opinion computed from the engagement we are trying to measure.
  assert.equal(request.path, '/r/aww/new');
  assert.deepEqual(request.query, { limit: '25' });
});

test('a community name is normalised, and one that could change the request is refused', () => {
  assert.equal(toListingRequest(query({ term: 'r/aww' })).path, '/r/aww/new');
  assert.equal(toListingRequest(query({ term: '/r/aww' })).path, '/r/aww/new');

  for (const term of ['aww/../admin', 'aww?limit=1', 'a w w', 'aww#x']) {
    assert.throws(
      () => toListingRequest(query({ term })),
      (error: unknown) => error instanceof NotImplemented && error.endpoint === 'reddit:discover:feed',
      `'${term}' must not be percent-encoded into a valid, wrong request`,
    );
  }
});

test('a keyword search passes the term through as the vendor\'s own syntax', () => {
  // Which is what makes a community-restricted search available without
  // inventing a mini-syntax core would have to know about.
  const request = toListingRequest(query({ mode: 'keyword', term: 'subreddit:aww grandma dance' }));
  assert.equal(request.path, '/search');
  assert.equal(request.query.q, 'subreddit:aww grandma dance');
  assert.equal(request.query.type, 'link', 'posts only; comments and accounts are not items here');
});

/* ── paging and limits ────────────────────────────────────────────────── */

test('the cursor is the vendor\'s own token, round-tripped verbatim', () => {
  const request = toListingRequest(query({ cursor: 't3_1a2b41' }));
  assert.equal(request.query.after, 't3_1a2b41');
  assert.equal('after' in toListingRequest(query({ cursor: null })).query, false);
});

test('the page size is clamped to the vendor ceiling rather than being silently clamped for us', () => {
  assert.equal(toListingRequest(query({ limit: 500 })).query.limit, '100');
  assert.equal(toListingRequest(query({ limit: 0 })).query.limit, '1');
  assert.equal(toListingRequest(query({ limit: 25.7 })).query.limit, '25');
});

/* ── one page, translated ─────────────────────────────────────────────── */

test('a page translates, slices to the caller\'s limit, and reports what the vendor said', async () => {
  const page: ListingPage = decodeListing(LISTING_ENVELOPE, 'test');
  let asked: ListingRequest | null = null;
  const client: RedditClient = {
    listing: async (request) => {
      asked = request;
      return page;
    },
    info: async () => {
      throw new Error('unreachable');
    },
  };

  const result = await discoverPage(client, query({ limit: 2 }), AT);
  assert.equal(asked !== null, true);
  assert.equal(result.items.length, 2, 'a client-side cap on an already-paid-for page');
  assert.equal(result.returned, 3, 'what the vendor actually returned, for the record');
  // `hasMore` comes from the vendor's own pagination token and never from
  // whether the page looked full.
  assert.equal(result.hasMore, true);
  assert.equal(result.cursor, 't3_1a2b41');
  assert.equal(result.items[0]?.firstSeenAt, AT, 'the instant is injected, not read');
});
