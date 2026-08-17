/**
 * The HTTP half, exercised with an injected `fetch` and an injected clock.
 *
 * ★ NOT ONE OF THESE TESTS TOUCHES THE NETWORK, and that is a property of the
 * design rather than of the tests: `fetch` is a required field on the client's
 * config and is never imported or read off `globalThis`. The clock is injected
 * for the same reason — a test that cannot move time cannot check that a token
 * is refreshed BEFORE it expires rather than after, which is the whole point of
 * having a margin.
 *
 * The cases below are the ones that decide whether this source tells the truth
 * when it is unhappy: an expired token, a rate limit, a refusal, and a success
 * code carrying an error page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

import { LISTING_ENVELOPE } from './__fixtures__/posts.ts';
import {
  DEFAULT_BASE_URL,
  DEFAULT_TOKEN_URL,
  decodeListing,
  httpClient,
  parseQuota,
  RedditNotConfigured,
} from './client.ts';
import type { QuotaReading, RedditClientConfig } from './client.ts';

const START = 1_800_000_000_000;

const AGENT = 'script:com.insidor.adapter:v0.1.0 (by /u/insidor_dev)';

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

interface Harness {
  readonly config: RedditClientConfig;
  readonly calls: Recorded[];
  readonly setNow: (ms: number) => void;
  readonly quotas: { reading: QuotaReading; endpoint: string }[];
}

/** A fetch that answers from a handler and records exactly what it was asked. */
function harness(
  handler: (url: string, init: RequestInit, calls: readonly Recorded[]) => Response,
  over: Partial<RedditClientConfig> = {},
): Harness {
  const calls: Recorded[] = [];
  const quotas: { reading: QuotaReading; endpoint: string }[] = [];
  let now = START;

  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const recorded = { url: String(input), init: init ?? {} };
    const answer = handler(recorded.url, recorded.init, calls);
    calls.push(recorded);
    return answer;
  }) as typeof globalThis.fetch;

  return {
    calls,
    quotas,
    setNow: (ms) => {
      now = ms;
    },
    config: {
      clientId: 'an-app-id',
      clientSecret: 'an-app-secret',
      userAgent: AGENT,
      fetch,
      now: () => now,
      onQuota: (reading, endpoint) => quotas.push({ reading, endpoint }),
      ...over,
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const token = (value: string, expiresIn = 3_600): Response =>
  json({ access_token: value, token_type: 'bearer', expires_in: expiresIn, scope: '*' });

const bearerOf = (init: RequestInit): string =>
  String((init.headers as Record<string, string> | undefined)?.authorization ?? '');

const isToken = (url: string): boolean => url.startsWith(DEFAULT_TOKEN_URL);

/* ── ★ construction ───────────────────────────────────────────────────── */

test('★ a missing credential fails AT CONSTRUCTION and names all three variables', () => {
  const base = harness(() => token('never used')).config;

  for (const [field, variable] of [
    ['clientId', 'REDDIT_CLIENT_ID'],
    ['clientSecret', 'REDDIT_CLIENT_SECRET'],
    ['userAgent', 'REDDIT_USER_AGENT'],
  ] as const) {
    assert.throws(
      () => httpClient({ ...base, [field]: '   ' }),
      (error: unknown) => {
        assert.ok(error instanceof RedditNotConfigured);
        assert.equal(error.variable, variable);
        // The reader has to edit one file; the error names every line of it,
        // and where the values come from.
        for (const named of ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT']) {
          assert.ok(error.message.includes(named), `the message omits ${named}`);
        }
        assert.ok(error.message.includes('https://www.reddit.com/prefs/apps'));
        assert.ok(error.message.includes('script'), 'the app type matters and is easy to get wrong');
        return true;
      },
    );
  }
});

test('a configuration failure is its own class, not a vendor failure', () => {
  // They demand opposite responses: one is a person editing a file, the other
  // is a retry. Collapsing them makes an unconfigured source look flaky.
  const base = harness(() => token('x')).config;
  assert.throws(() => httpClient({ ...base, clientId: '' }), (error: unknown) => {
    assert.equal(error instanceof VendorUnavailable, false);
    assert.ok(error instanceof RedditNotConfigured);
    return true;
  });
});

test('the placeholder user agent from .env.example is refused', () => {
  const base = harness(() => token('x')).config;
  assert.throws(
    () => httpClient({ ...base, userAgent: 'insidor/0.1 by /u/YOUR_REDDIT_USERNAME' }),
    (error: unknown) => error instanceof RedditNotConfigured && error.variable === 'REDDIT_USER_AGENT',
  );
});

test('a spoofed or generic user agent is refused, because this vendor bans for it', () => {
  const base = harness(() => token('x')).config;
  for (const agent of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'python-requests/2.31 (by /u/insidor_dev)',
    'curl/8.4.0 (by /u/insidor_dev)',
  ]) {
    assert.throws(() => httpClient({ ...base, userAgent: agent }), RedditNotConfigured, agent);
  }
});

test('a user agent naming no contactable account is refused', () => {
  const base = harness(() => token('x')).config;
  assert.throws(() => httpClient({ ...base, userAgent: 'insidor/0.1' }), RedditNotConfigured);
  // The vendor's own recommended shape passes.
  assert.doesNotThrow(() => httpClient({ ...base, userAgent: AGENT }));
});

/* ── the token ────────────────────────────────────────────────────────── */

test('the grant is client_credentials, sent as HTTP Basic — no username, no password', async () => {
  const h = harness((url) => (isToken(url) ? token('tok-1') : json(LISTING_ENVELOPE)));
  await httpClient(h.config).listing({ path: '/r/aww/new', query: { limit: '2' } });

  const tokenCall = h.calls[0];
  assert.equal(tokenCall?.url, DEFAULT_TOKEN_URL, 'the token comes from the public host, not the authed one');
  assert.equal(tokenCall?.init.method, 'POST');
  assert.equal(tokenCall?.init.body, 'grant_type=client_credentials');
  assert.equal(bearerOf(tokenCall?.init ?? {}), `Basic ${Buffer.from('an-app-id:an-app-secret').toString('base64')}`);
  // Nothing anywhere in this package asks for an account password.
  assert.equal(String(tokenCall?.init.body).includes('password'), false);

  const read = h.calls[1];
  assert.ok(read?.url.startsWith(DEFAULT_BASE_URL), 'reads go to the authenticated host');
  assert.equal(bearerOf(read?.init ?? {}), 'bearer tok-1');
});

test('the token is cached, so a second read does not buy a second one', async () => {
  const h = harness((url) => (isToken(url) ? token('tok-1') : json(LISTING_ENVELOPE)));
  const client = httpClient(h.config);
  await client.listing({ path: '/r/aww/new', query: {} });
  await client.listing({ path: '/r/aww/new', query: { after: 't3_1' } });

  assert.equal(h.calls.filter((c) => isToken(c.url)).length, 1);
});

test('★ the token is refreshed BEFORE it expires, not after a 401 tells us it has', async () => {
  let minted = 0;
  const h = harness((url) => {
    if (isToken(url)) {
      minted += 1;
      return token(`tok-${minted}`, 3_600);
    }
    return json(LISTING_ENVELOPE);
  });
  const client = httpClient(h.config);

  await client.listing({ path: '/r/aww/new', query: {} });
  assert.equal(minted, 1);

  // Still comfortably inside the lifetime: no refresh.
  h.setNow(START + 3_000_000);
  await client.listing({ path: '/r/aww/new', query: {} });
  assert.equal(minted, 1);

  // Inside the last minute of it: refreshed, because a token that dies mid-call
  // costs a 401, a token request and a retry — three units of the quota that is
  // actually scarce here.
  h.setNow(START + 3_600_000 - 30_000);
  await client.listing({ path: '/r/aww/new', query: {} });
  assert.equal(minted, 2);
  assert.equal(bearerOf(h.calls[h.calls.length - 1]?.init ?? {}), 'bearer tok-2');
});

test('the lifetime comes from the response, never from a hardcoded hour', async () => {
  let minted = 0;
  const h = harness((url) => {
    if (isToken(url)) {
      minted += 1;
      // A short-lived token. A hardcoded 3600 would keep sending it for an
      // hour, every call would 401, and it would read as a permissions problem.
      return token(`tok-${minted}`, 120);
    }
    return json(LISTING_ENVELOPE);
  });
  const client = httpClient(h.config);
  await client.listing({ path: '/r/aww/new', query: {} });
  h.setNow(START + 90_000);
  await client.listing({ path: '/r/aww/new', query: {} });
  assert.equal(minted, 2);
});

test('a token response missing its lifetime or its token is a SHAPE error, not a guess', async () => {
  for (const body of [{ token_type: 'bearer', expires_in: 3_600 }, { access_token: 'tok', token_type: 'bearer' }]) {
    const h = harness(() => json(body));
    await assert.rejects(
      () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
      (error: unknown) => error instanceof VendorShapeError,
    );
  }
});

test('rejected credentials are reported as such, pointing at the variables to check', async () => {
  const h = harness(() => json({ message: 'Unauthorized', error: 401 }, 401));
  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable);
      assert.equal(error.status, 401);
      assert.ok(error.message.includes('REDDIT_CLIENT_ID'));
      return true;
    },
  );
});

test('two concurrent reads buy one token, not two', async () => {
  // A wasted token is pure quota burn on the one budget that binds here.
  let minted = 0;
  const h = harness((url) => {
    if (isToken(url)) {
      minted += 1;
      return token(`tok-${minted}`);
    }
    return json(LISTING_ENVELOPE);
  });
  const client = httpClient(h.config);
  await Promise.all([
    client.listing({ path: '/r/aww/new', query: {} }),
    client.listing({ path: '/r/videos/new', query: {} }),
  ]);
  assert.equal(minted, 1);
});

/* ── ★ the 401 retry ──────────────────────────────────────────────────── */

test('★ a token that expires mid-call is refreshed once and the read is retried', async () => {
  let minted = 0;
  const h = harness((url, init) => {
    if (isToken(url)) {
      minted += 1;
      return token(`tok-${minted}`);
    }
    // The first token has been retired early — a clock skew, a long batch.
    return bearerOf(init) === 'bearer tok-1' ? json({ message: 'Unauthorized' }, 401) : json(LISTING_ENVELOPE);
  });

  const page = await httpClient(h.config).listing({ path: '/r/aww/new', query: {} });
  assert.equal(minted, 2, 'one refresh');
  assert.equal(page.items.length, 3, 'and the read succeeded on the retry');
  assert.equal(h.calls.filter((c) => !isToken(c.url)).length, 2, 'exactly one extra request, and it is visible');
});

test('★ a second 401 is the end of it — a rejected credential is not hammered', async () => {
  let minted = 0;
  const h = harness((url) => {
    if (isToken(url)) {
      minted += 1;
      return token(`tok-${minted}`);
    }
    return json({ message: 'Unauthorized' }, 401);
  });

  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable);
      assert.equal(error.status, 401);
      return true;
    },
  );
  assert.equal(minted, 2, 'one refresh, then it stops');
  assert.equal(h.calls.filter((c) => !isToken(c.url)).length, 2);
});

/* ── the unhappy statuses ─────────────────────────────────────────────── */

test('★ 429 surfaces as an event, carrying the vendor\'s own quota headers', async () => {
  const h = harness((url) =>
    isToken(url)
      ? token('tok-1')
      : new Response('too many requests', {
          status: 429,
          headers: { 'x-ratelimit-used': '600', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '42' },
        }),
  );

  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable);
      assert.equal(error.status, 429);
      // The measured answer to "how long until this works again". The published
      // requests-per-minute constant is not that answer.
      assert.ok(error.message.includes('remaining 0'));
      assert.ok(error.message.includes('resets in 42s'));
      return true;
    },
  );

  // The reading is reported before anything throws, because the response that
  // carries the most interesting quota figure is the 429.
  assert.deepEqual(h.quotas[h.quotas.length - 1]?.reading, { used: 600, remaining: 0, resetSeconds: 42 });
});

test('★ 403 is an outage and its body is never parsed for content', async () => {
  // This is the exact shape an unauthenticated or blocked read takes on this
  // vendor: a 403 carrying an HTML page. Mapping it to "no posts" would report
  // a blocked client as a quiet community, forever.
  const h = harness((url) =>
    isToken(url)
      ? token('tok-1')
      : new Response('<!doctype html><html><body>whoa there, pardner</body></html>', {
          status: 403,
          headers: { 'content-type': 'text/html' },
        }),
  );

  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable);
      assert.equal(error.status, 403);
      assert.ok(error.message.includes('text/html'), 'enough to recognise the page on sight');
      return true;
    },
  );
});

test('404 is an outage too, and never an empty community', async () => {
  const h = harness((url) => (isToken(url) ? token('tok-1') : new Response('', { status: 404 })));
  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/nosuchplace/new', query: {} }),
    (error: unknown) => error instanceof VendorUnavailable && error.status === 404,
  );
});

test('★ 200 with a body that is not JSON is an outage wearing a success code', async () => {
  const h = harness((url) =>
    isToken(url)
      ? token('tok-1')
      : new Response('<!doctype html><html>edge interstitial</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
  );
  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => {
      // Deliberately NOT a shape error: calling it one would send the next
      // person hunting a schema change that has not happened.
      assert.ok(error instanceof VendorUnavailable);
      assert.equal(error instanceof VendorShapeError, false);
      assert.equal(error.status, 200);
      return true;
    },
  );
});

test('a socket failure has no status, which is how a caller tells it from an answer', async () => {
  const h = harness(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => error instanceof VendorUnavailable && error.status === undefined,
  );
});

/* ── the request itself ───────────────────────────────────────────────── */

test('★ raw_json=1 goes on every request, or every text field arrives HTML-escaped', async () => {
  // Without it the text we shingle is `&amp;` where the author wrote `&`. The
  // shingles still compute and silently fail to match the same sentence from
  // any other source — the cheapest evidence the grouper has.
  const h = harness((url) => (isToken(url) ? token('tok-1') : json(LISTING_ENVELOPE)));
  const client = httpClient(h.config);
  await client.listing({ path: '/r/aww/new', query: { limit: '2' } });
  await client.info(['t3_1a2b3c']);

  for (const call of h.calls.filter((c) => !isToken(c.url))) {
    assert.ok(call.url.includes('raw_json=1'), call.url);
    assert.equal(
      (call.init.headers as Record<string, string>)['user-agent'],
      AGENT,
      'the same descriptive agent on every request',
    );
  }
});

test('a path that could change which request is made is refused rather than encoded', async () => {
  const h = harness((url) => (isToken(url) ? token('tok-1') : json(LISTING_ENVELOPE)));
  const client = httpClient(h.config);
  for (const path of ['/r/aww/new?limit=1', 'r/aww/new', '/r/a w w/new', '/r/aww/new#x']) {
    await assert.rejects(() => client.listing({ path, query: {} }), RangeError, path);
  }
});

test('the batch lookup joins fullnames with a comma, and rejects anything that would split it', async () => {
  const h = harness((url) => (isToken(url) ? token('tok-1') : json(LISTING_ENVELOPE)));
  const client = httpClient(h.config);

  await client.info(['t3_1a2b3c', 't3_1a2b3d']);
  const asked = h.calls[h.calls.length - 1]?.url ?? '';
  assert.ok(asked.includes('/api/info?'));
  assert.ok(decodeURIComponent(asked).includes('id=t3_1a2b3c,t3_1a2b3d'));

  // A comma inside an id would become two ids and shift every result after it.
  await assert.rejects(() => client.info(['t3_a,t3_b']), RangeError);
  await assert.rejects(() => client.info(['1a2b3c']), RangeError, 'a bare id is not a fullname');
  await assert.rejects(() => client.info(['t1_abc']), RangeError, 'a comment is not a post');
  await assert.rejects(() => client.info([]), RangeError);
  await assert.rejects(
    () => client.info(Array.from({ length: 101 }, (_, i) => `t3_x${i}`)),
    RangeError,
    'truncating would drop the 101st silently',
  );
});

/* ── decoding the envelope ────────────────────────────────────────────── */

test('the envelope is unwrapped, non-post children are dropped, and paging comes from the vendor', () => {
  const page = decodeListing(LISTING_ENVELOPE, 'test');
  assert.equal(page.items.length, 3, 'the comment child is not a post and is not translated into one');
  assert.equal(page.cursor, 't3_1a2b41');
  assert.equal(page.hasMore, true);

  const last = decodeListing({ kind: 'Listing', data: { after: null, children: [] } }, 'test');
  assert.equal(last.cursor, null);
  assert.equal(last.hasMore, false, 'the vendor said there is no next page');
});

test('an envelope in the wrong shape is a loud shape error, because types prove nothing at runtime', () => {
  for (const body of [{ kind: 'Something', data: {} }, { kind: 'Listing', data: { children: 'nope' } }, [], null]) {
    assert.throws(() => decodeListing(body, 'test'), VendorShapeError);
  }
});

/* ── quota headers ────────────────────────────────────────────────────── */

test('the quota headers are read as measured facts, and a junk value is null rather than a guess', () => {
  assert.deepEqual(
    parseQuota(new Headers({ 'x-ratelimit-used': '3.0', 'x-ratelimit-remaining': '97.0', 'x-ratelimit-reset': '540' })),
    { used: 3, remaining: 97, resetSeconds: 540 },
  );
  assert.deepEqual(parseQuota(new Headers({})), { used: null, remaining: null, resetSeconds: null });
  assert.deepEqual(parseQuota(new Headers({ 'x-ratelimit-remaining': 'lots' })), {
    used: null,
    remaining: null,
    resetSeconds: null,
  });
});

test('★ a header that is present and BLANK is not a quota of zero — Number(\'\') is 0', () => {
  // The bug this replaces: an edge that rewrites a response it did not generate
  // emits the header empty, `Number('')` is 0, and `remaining: 0` gets reported
  // as a measured fact — "this client has no requests left" — on a source that
  // is fine. A fabricated zero, in the package whose whole argument is that we
  // do not fabricate them. Null means "no reading", which is what we have.
  assert.deepEqual(
    parseQuota(new Headers({ 'x-ratelimit-used': '', 'x-ratelimit-remaining': '', 'x-ratelimit-reset': '' })),
    { used: null, remaining: null, resetSeconds: null },
  );
  assert.deepEqual(parseQuota(new Headers({ 'x-ratelimit-remaining': '   ' })), {
    used: null,
    remaining: null,
    resetSeconds: null,
  });
  // `Number` also reads these happily, and neither is a spelling this vendor
  // uses. Accepting them would be inventing a reading out of a parser quirk.
  assert.equal(parseQuota(new Headers({ 'x-ratelimit-remaining': '0x10' })).remaining, null);
  assert.equal(parseQuota(new Headers({ 'x-ratelimit-remaining': '1e3' })).remaining, null);
  // A genuine zero still reads as zero: it is the one reading that matters most.
  assert.equal(parseQuota(new Headers({ 'x-ratelimit-remaining': '0' })).remaining, 0);
});

test('★ a token shorter-lived than the refresh margin is still CACHED, not re-minted every call', async () => {
  // The cache test used to be `now < expiresAt - margin`, which is false the
  // instant a 45-second token is minted against a 60-second margin. Every read
  // then buys its own token: twice the requests, on the one budget that binds
  // on a free source, with nothing erroring and nothing looking wrong.
  let minted = 0;
  let reads = 0;
  const h = harness((url) => {
    if (isToken(url)) {
      minted += 1;
      return token(`tok-${minted}`, 45);
    }
    reads += 1;
    return json(LISTING_ENVELOPE);
  });
  const client = httpClient(h.config);

  for (let i = 0; i < 5; i++) {
    await client.listing({ path: '/r/aww/new', query: {} });
    h.setNow(START + (i + 1) * 1_000);
  }
  assert.equal(reads, 5);
  assert.equal(minted, 1, 'one token for five reads, not five');

  // And the clamped margin is still a margin: half the life, so the token is
  // replaced well before it dies rather than at the last instant.
  h.setNow(START + 23_000);
  await client.listing({ path: '/r/aww/new', query: {} });
  assert.equal(minted, 2);
});

test('★ 429 surfaces the vendor\'s retry-after, which is the one header that is an instruction', async () => {
  // The quota trio describes the window; this is the party doing the rationing
  // saying when to come back. This client still does not wait on it — pacing
  // inside a client is pacing nobody above it can budget for — but a caller
  // that wants to back off cannot, if the number only ever existed in a
  // response we threw away. There is no appeal queue on a free tier.
  const h = harness((url) =>
    isToken(url)
      ? token('tok-1')
      : new Response('too many requests', {
          status: 429,
          headers: { 'x-ratelimit-remaining': '0', 'retry-after': '17' },
        }),
  );
  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable);
      assert.ok(error.message.includes('retry after 17'), error.message);
      return true;
    },
  );
});

test('the 429 message says nothing about a retry-after the vendor did not send', async () => {
  const h = harness((url) =>
    isToken(url) ? token('tok-1') : new Response('slow down', { status: 429 }),
  );
  await assert.rejects(
    () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
    (error: unknown) => error instanceof VendorUnavailable && !error.message.includes('retry after'),
  );
});

/* ── ★ nothing in an error message is a credential ────────────────────── */

test('★ no error this client raises carries the id, the secret or the bearer token', async () => {
  // Every one of these ends up in a log somebody else reads. The endpoint
  // labels carry no host and no credential for exactly that reason, the
  // credentials travel only in headers — never in a URL, never in a body we
  // send — and the 401 path deliberately drops the response rather than echoing
  // back something we may have handed over.
  //
  // The one channel this cannot close is the vendor CHOOSING to echo a
  // credential in an error body, since 403 and non-JSON-200 attach a snippet so
  // the page is recognisable on sight. That is a claim about the vendor rather
  // than about us, and it is not one this test can make; what it does assert is
  // that we add nothing of our own.
  const SECRETS = ['an-app-id', 'an-app-secret', 'tok-1', Buffer.from('an-app-id:an-app-secret').toString('base64')];

  const responses: (() => Response)[] = [
    () => json({ message: 'Unauthorized', error: 401 }, 401),
    () => new Response('<!doctype html>blocked', { status: 403, headers: { 'content-type': 'text/html' } }),
    () => new Response('', { status: 500 }),
    () => new Response('not json', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => new Response('too many', { status: 429, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '5' } }),
  ];

  for (const make of responses) {
    const h = harness((url) => (isToken(url) ? token('tok-1') : make()));
    await assert.rejects(
      () => httpClient(h.config).listing({ path: '/r/aww/new', query: {} }),
      (error: unknown) => {
        const text = `${String((error as Error).message)} ${String((error as Error).stack)}`;
        for (const secret of SECRETS) {
          assert.equal(text.includes(secret), false, `a credential reached an error message: ${secret}`);
        }
        return true;
      },
    );
  }

  // And the URLs actually requested carry no credential either — a secret in a
  // query string is a secret in every proxy log between here and the vendor.
  const h = harness((url) => (isToken(url) ? token('tok-1') : json(LISTING_ENVELOPE)));
  const client = httpClient(h.config);
  await client.listing({ path: '/r/aww/new', query: {} });
  await client.info(['t3_1a2b3c']);
  for (const call of h.calls) {
    for (const secret of SECRETS) {
      assert.equal(call.url.includes(secret), false, `${secret} appeared in ${call.url}`);
    }
  }
});
