/**
 * The HTTP half, exercised with an injected `fetch`.
 *
 * ★ NOT ONE OF THESE TESTS TOUCHES THE NETWORK, and that is a property of the design
 * rather than of the tests: `fetch` is a required field on the client's config and is
 * never imported or read off `globalThis`. There are no credentials for this vendor
 * and every call to it costs money, so a test that could reach it would be a test
 * that bills us for running the suite.
 *
 * The cases below are the ones that decide whether this source tells the truth when
 * it is unhappy: a rejected key, an exhausted balance, a rate limit, a success code
 * carrying an error envelope, and a cursor that goes nowhere.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

import {
  decodeCursor,
  decodeLookup,
  decodeSearchPage,
  httpClient,
  MAX_IDS_PER_CALL,
  QUERY_TYPE,
  XNotConfigured,
} from './client.ts';
import type { XClientConfig } from './client.ts';
import type { QuotaReading } from '@insidor/vendor-kit/http.ts';

const KEY = 'a-reseller-key';
const BASE = 'https://api.twitterapi.io';

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

interface Harness {
  readonly config: XClientConfig;
  readonly calls: Recorded[];
  readonly quotas: { reading: QuotaReading; endpoint: string }[];
}

/** A fetch that answers from a handler and records exactly what it was asked. */
function harness(
  handler: (url: string, init: RequestInit, calls: readonly Recorded[]) => Response | Promise<Response>,
  over: Partial<XClientConfig> = {},
): Harness {
  const calls: Recorded[] = [];
  const quotas: { reading: QuotaReading; endpoint: string }[] = [];

  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const recorded = { url: String(input), init: init ?? {} };
    const answer = await handler(recorded.url, recorded.init, calls);
    calls.push(recorded);
    return answer;
  }) as typeof globalThis.fetch;

  return {
    calls,
    quotas,
    config: {
      apiKey: KEY,
      baseUrl: BASE,
      fetch,
      onQuota: (reading, endpoint) => quotas.push({ reading, endpoint }),
      ...over,
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const page = (tweets: unknown[], hasNext = false, cursor = ''): unknown => ({
  tweets,
  has_next_page: hasNext,
  next_cursor: cursor,
});

const post = (id: string): unknown => ({ id, text: 'hello', likeCount: 1 });

const keyOf = (init: RequestInit): string =>
  String((init.headers as Record<string, string> | undefined)?.['X-API-Key'] ?? '');

const paramsOf = (url: string): URLSearchParams => new URL(url).searchParams;

/* ── ★ construction ───────────────────────────────────────────────────── */

test('★ a missing credential fails AT CONSTRUCTION and names the variable', () => {
  const base = harness(() => json(page([]))).config;

  for (const empty of ['', '   ', '\n']) {
    assert.throws(
      () => httpClient({ ...base, apiKey: empty }),
      (error: unknown) => {
        assert.ok(error instanceof XNotConfigured);
        assert.equal(error.variable, 'X_API_KEY');
        // The reader has to edit one file; the message names the line and says where
        // the value comes from.
        assert.ok(error.message.includes('X_API_KEY'));
        assert.ok(error.message.includes('X_API_BASE'));
        assert.ok(error.message.includes('.env.local'));
        return true;
      },
    );
  }
});

test('a configuration failure is its own class, not a vendor failure', () => {
  // They demand opposite responses: one is a person editing a file, the other is a
  // retry — and here a retry is billed.
  const base = harness(() => json(page([]))).config;
  assert.throws(
    () => httpClient({ ...base, apiKey: '' }),
    (error: unknown) => {
      assert.equal(error instanceof VendorUnavailable, false);
      assert.ok(error instanceof XNotConfigured);
      return true;
    },
  );
});

test('★ a key with a newline in it is refused rather than sent', () => {
  // A trailing newline off a terminal paste is the ordinary way this happens, and a
  // newline in a header value means the request that goes out is not the request this
  // code wrote.
  const base = harness(() => json(page([]))).config;
  assert.throws(
    () => httpClient({ ...base, apiKey: 'key-with-a\nnewline' }),
    (error: unknown) => error instanceof XNotConfigured && error.variable === 'X_API_KEY',
  );
});

test('a base url that is not http(s), or that carries a query, is refused', () => {
  const base = harness(() => json(page([]))).config;
  for (const bad of ['not a url', 'ftp://api.example.com', 'https://api.example.com?token=x']) {
    assert.throws(
      () => httpClient({ ...base, baseUrl: bad }),
      (error: unknown) => error instanceof XNotConfigured && error.variable === 'X_API_BASE',
      `accepted ${bad}`,
    );
  }
});

/* ── the happy path ───────────────────────────────────────────────────── */

test('search sends the key as a header, pins queryType, and omits the cursor on page one', async () => {
  const h = harness(() => json(page([post('1'), post('2')], true, 'CURSOR2')));
  const result = await httpClient(h.config).search('chillguy', null);

  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.ok(call !== undefined);
  assert.equal(keyOf(call.init), KEY);
  // ★ Never a query parameter: a keyed URL ends up in a proxy log and a history.
  assert.equal(call.url.includes(KEY), false, 'the credential reached the URL');

  const params = paramsOf(call.url);
  assert.equal(params.get('query'), 'chillguy');
  assert.equal(params.get('queryType'), QUERY_TYPE);
  assert.equal(params.get('queryType'), 'Latest', 'Top is the vendor opinion and must never be reachable');
  assert.equal(params.has('cursor'), false);

  assert.equal(result.items.length, 2);
  assert.equal(result.cursor, 'CURSOR2');
  assert.equal(result.hasMore, true);
});

test('pagination round-trips the vendor cursor verbatim', async () => {
  const h = harness((url) =>
    paramsOf(url).get('cursor') === 'CURSOR2' ? json(page([post('3')], false, '')) : json(page([post('1')], true, 'CURSOR2')),
  );
  const client = httpClient(h.config);

  const first = await client.search('q', null);
  assert.equal(first.cursor, 'CURSOR2');
  const second = await client.search('q', first.cursor);

  const call = h.calls[1];
  assert.ok(call !== undefined);
  assert.equal(paramsOf(call.url).get('cursor'), 'CURSOR2');
  // The last page: an empty cursor string is this vendor saying there is no next one,
  // and `str` already treats an empty string as absent.
  assert.equal(second.cursor, null);
  assert.equal(second.hasMore, false);
});

test('★ an EMPTY page is not the end of results, and is not an error', async () => {
  // This vendor documents that a page can be short — or empty — because it filters
  // ads out of it, so `has_next_page` is the only honest end signal. Inferring the
  // end from a page size would halve recall silently.
  const h = harness(() => json(page([], true, 'CURSOR2')));
  const result = await httpClient(h.config).search('q', null);
  assert.deepEqual(result.items, []);
  assert.equal(result.hasMore, true);
});

test('lookup joins ids with a comma and omits ids the vendor did not answer', async () => {
  const h = harness(() => json({ tweets: [post('1'), post('3')], status: 'success' }));
  const raw = await httpClient(h.config).lookup(['1', '2', '3']);

  const call = h.calls[0];
  assert.ok(call !== undefined);
  assert.equal(paramsOf(call.url).get('tweet_ids'), '1,2,3');
  // ★ Absence is preserved: `2` is simply not here. observe.ts omits it from its map
  // rather than mapping it to zeros, because a deleted post and an unread post are
  // different facts.
  assert.equal(raw.length, 2);
});

/* ── ★ the taxonomy: an outage is never a claim ───────────────────────── */

test('401 is unavailability with the status, and never echoes the body', async () => {
  const h = harness(() => json({ status: 'error', message: 'bad key sent: a-reseller-key' }, 401));
  await assert.rejects(httpClient(h.config).search('q', null), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 401);
    assert.ok(error.message.includes('X_API_KEY'));
    assert.equal(error.message.includes(KEY), false, 'the body was echoed and it contained our key');
    return true;
  });
});

test('★ 402 and 403 are outages, not empty results — this is a lapsed plan, not a quiet internet', async () => {
  for (const status of [402, 403]) {
    const h = harness(() => new Response('<html>payment required</html>', { status, headers: { 'content-type': 'text/html' } }));
    await assert.rejects(httpClient(h.config).search('q', null), (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable, `status ${status} was not an outage`);
      assert.equal(error.status, status);
      assert.ok(error.message.includes('text/html'), 'the content type is what makes the page recognisable');
      return true;
    });
  }
});

test('429 carries whatever the vendor said about the window, including retry-after', async () => {
  const h = harness(() =>
    json({}, 429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '42', 'retry-after': '30' }),
  );
  await assert.rejects(httpClient(h.config).search('q', null), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 429);
    assert.ok(error.message.includes('remaining 0'));
    assert.ok(error.message.includes('retry after 30'));
    return true;
  });
});

test('404 is an outage and is explicitly not "this query matched nothing"', async () => {
  const h = harness(() => json({}, 404));
  await assert.rejects(httpClient(h.config).search('q', null), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 404);
    return true;
  });
});

test('a 5xx is unavailability carrying its status', async () => {
  const h = harness(() => json({}, 503));
  await assert.rejects(httpClient(h.config).lookup(['1']), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 503);
    return true;
  });
});

test('a transport failure is unavailability with NO status', async () => {
  // Deliberately not the same error as "the vendor said no": a caller failing closed
  // has to be able to tell an outage from an answer it did not like.
  const h = harness(() => {
    throw new TypeError('socket hang up');
  });
  await assert.rejects(httpClient(h.config).search('q', null), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, undefined);
    assert.ok(error.message.includes('socket hang up'));
    return true;
  });
});

test('★ 200 with a body that is not JSON is an outage, not a shape error', async () => {
  // An edge serving an HTML interstitial under a 200. Calling it a shape error would
  // send the next person hunting a schema change in the wrong file.
  const h = harness(() => new Response('<html>just a moment</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(httpClient(h.config).search('q', null), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error instanceof VendorShapeError, false);
    assert.equal(error.status, 200);
    return true;
  });
});

test('★★ a 200 carrying an error envelope is an outage — NEVER an empty result', async () => {
  // The single most dangerous response this vendor sends. `tweets` is absent, so any
  // decoder that reached for it defensively would report a broken key as "these posts
  // vanished" — and on the tracking path that is every tracked post deleted at once.
  const h = harness(() => json({ status: 'error', message: 'invalid api key' }));
  for (const call of [
    () => httpClient(h.config).search('q', null),
    () => httpClient(h.config).lookup(['1']),
  ]) {
    await assert.rejects(call(), (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable);
      assert.equal(error.status, 200, 'the status was 200 and must be recorded as 200, not invented');
      assert.ok(error.message.includes('invalid api key'));
      return true;
    });
  }
});

test('a hostile error message is bounded before it reaches an exception', async () => {
  const h = harness(() => json({ status: 'error', message: 'x'.repeat(5_000) }));
  await assert.rejects(httpClient(h.config).search('q', null), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.ok(error.message.length < 600, `an unbounded vendor string reached a log line (${error.message.length})`);
    return true;
  });
});

/* ── ★ the cursor that goes nowhere ───────────────────────────────────── */

test('★ a cursor that does not advance is raised, not repaired', async () => {
  // Left alone this is not a hang: it is a paging loop re-buying the same page until
  // the daily cap stops it. Answering hasMore:false would repair it silently, and
  // silently truncating a result set is the class of plausible-and-wrong this adapter
  // refuses everywhere else.
  const h = harness(() => json(page([post('1')], true, 'SAME')));
  await assert.rejects(httpClient(h.config).search('q', 'SAME'), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.ok(error.message.includes('same pagination cursor'));
    return true;
  });
});

test('a repeated cursor with no more pages is fine — the loop is over either way', async () => {
  const h = harness(() => json(page([post('1')], false, 'SAME')));
  const result = await httpClient(h.config).search('q', 'SAME');
  assert.equal(result.hasMore, false);
});

/* ── ★ the batch ceiling and the id gate ──────────────────────────────── */

test('an id containing the batch separator is refused, not encoded', async () => {
  // A comma inside an id would become two ids and shift every result after it.
  const h = harness(() => json({ tweets: [] }));
  for (const bad of ['1,2', '../admin', '', 'abc', '1'.repeat(40)]) {
    await assert.rejects(httpClient(h.config).lookup([bad]), RangeError, `accepted ${JSON.stringify(bad)}`);
  }
  assert.equal(h.calls.length, 0, 'a refused batch must not reach the vendor, because it would be billed');
});

test('the batch ceiling throws rather than truncating', async () => {
  // A silently dropped id reads downstream as a post that returned nothing — a
  // plausible, wrong, unnoticeable answer. The ceiling is an unverified assumption,
  // which is exactly why it must fail loudly rather than quietly.
  const h = harness(() => json({ tweets: [] }));
  const ids = Array.from({ length: MAX_IDS_PER_CALL + 1 }, (_, i) => String(i + 1));
  await assert.rejects(httpClient(h.config).lookup(ids), RangeError);
  await assert.rejects(httpClient(h.config).lookup([]), RangeError);
});

/* ── quota observation ────────────────────────────────────────────────── */

test('★ a header that is present and BLANK reads as no reading, never as zero', async () => {
  // `Number('')` is 0. Reporting `remaining: 0` as a measured fact would be a
  // fabricated measurement in the one layer whose argument is that we do not
  // fabricate them, and whoever eventually paces on it would stop dead on a source
  // that was fine.
  const h = harness(() => json(page([]), 200, { 'x-ratelimit-remaining': '   ', 'x-ratelimit-used': '7' }));
  await httpClient(h.config).search('q', null);

  const seen = h.quotas[0];
  assert.ok(seen !== undefined);
  assert.equal(seen.reading.remaining, null);
  assert.equal(seen.reading.used, 7);
  // This vendor publishes no reset header at all; absent is null, and null is not a number.
  assert.equal(seen.reading.resetSeconds, null);
});

test('a quota reading is reported even on the response we are about to reject', async () => {
  const h = harness(() => json({}, 429, { 'x-ratelimit-remaining': '0' }));
  await assert.rejects(httpClient(h.config).search('q', null));
  assert.equal(h.quotas.length, 1, 'the most interesting reading is on the rejected response');
});

/* ── the decoders, without a socket ───────────────────────────────────── */

test('★ has_next_page is required and is never inferred from a page size', () => {
  // A short page is documented not to mean the last page on this vendor, so guessing
  // is wrong in both directions: false halves recall, true pages forever against a
  // metered vendor. Both look like working code.
  assert.throws(
    () => decodeSearchPage({ tweets: [post('1')], next_cursor: 'c' }, 'endpoint'),
    (error: unknown) => {
      assert.ok(error instanceof VendorShapeError);
      assert.equal(error.field, 'has_next_page');
      return true;
    },
  );
});

test('a missing or wrongly-typed tweets array is a shape error, not an empty page', () => {
  for (const body of [{}, { tweets: null, has_next_page: false }, { tweets: {}, has_next_page: false }]) {
    assert.throws(() => decodeSearchPage(body, 'endpoint'), VendorShapeError);
    assert.throws(() => decodeLookup(body, 'endpoint'), VendorShapeError);
  }
});

test('an oversized cursor is refused rather than carried or truncated', () => {
  // A truncated cursor is a request for a page that does not exist, answered
  // plausibly. Refusing is the only option that cannot be mistaken for working.
  assert.equal(decodeCursor('abc', 'endpoint'), 'abc');
  assert.equal(decodeCursor('', 'endpoint'), null);
  assert.equal(decodeCursor(undefined, 'endpoint'), null);
  assert.throws(() => decodeCursor('x'.repeat(5_000), 'endpoint'), VendorShapeError);
});

test('a field we have never seen does not change anything', () => {
  const decoded = decodeSearchPage(
    { tweets: [post('1')], has_next_page: false, next_cursor: '', some_new_field: { a: 1 } },
    'endpoint',
  );
  assert.equal(decoded.items.length, 1);
  assert.equal(decoded.hasMore, false);
});
