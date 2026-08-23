/**
 * The HTTP half, exercised with an injected `fetch`.
 *
 * ★ NOT ONE OF THESE TESTS TOUCHES THE NETWORK. `fetch` is a required field on the
 * client's config and is never imported or read off `globalThis`. There are no
 * credentials for this vendor and every RUN costs money whether or not it returns
 * anything, so a test that could reach it would be a test that bills us for running
 * the suite — twice as expensively as the other paid source, because here the charge
 * does not depend on the result.
 *
 * ★ AND THE CASE THIS WHOLE FILE EXISTS FOR: a run that FAILED and a run that found
 * nothing leave the same empty dataset. Every test below that mentions a status is
 * really about that one sentence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

import {
  decodeDataset,
  decodeRun,
  httpClient,
  isPathSegment,
  isTerminal,
  postUrl,
  RUN_ENDPOINT,
  TikTokNotConfigured,
} from './client.ts';
import type { TikTokClientConfig } from './client.ts';
import type { QuotaReading } from '@insidor/vendor-kit/http.ts';

const TOKEN = 'apify-token';
const BASE = 'https://api.apify.com';
const DISCOVERY_ACTOR = 'clockworks~tiktok-scraper';
const OBSERVE_ACTOR = 'moJRLRc85AitArpNN';
const RUN_ID = 'HG7ML7M8z78YcAPEB';
const DATASET_ID = 'dataset123';

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

interface Harness {
  readonly config: TikTokClientConfig;
  readonly calls: Recorded[];
  readonly quotas: { reading: QuotaReading; endpoint: string }[];
}

function harness(
  handler: (url: string, init: RequestInit, calls: readonly Recorded[]) => Response | Promise<Response>,
  over: Partial<TikTokClientConfig> = {},
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
      token: TOKEN,
      baseUrl: BASE,
      discoveryActorId: DISCOVERY_ACTOR,
      observeActorId: OBSERVE_ACTOR,
      fetch,
      onQuota: (reading, endpoint) => quotas.push({ reading, endpoint }),
      ...over,
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const run = (status: string, over: Record<string, unknown> = {}): unknown => ({
  data: { id: RUN_ID, status, defaultDatasetId: DATASET_ID, ...over },
});

const isDataset = (url: string): boolean => url.includes('/v2/datasets/');

const item = (id: string): unknown => ({ id, desc: 'a post', stats: { playCount: 10 } });

/** The ordinary flow: the run finishes inside the blocking create, then we read it. */
const straightThrough = (items: readonly unknown[]) => (url: string): Response =>
  isDataset(url) ? json(items) : json(run('SUCCEEDED'));

const authOf = (init: RequestInit): string =>
  String((init.headers as Record<string, string> | undefined)?.authorization ?? '');

const paramsOf = (url: string): URLSearchParams => new URL(url).searchParams;

/* ── ★ construction ───────────────────────────────────────────────────── */

test('★ every missing value fails AT CONSTRUCTION and names its own variable', () => {
  const base = harness(straightThrough([])).config;

  for (const [field, variable] of [
    ['token', 'APIFY_TOKEN'],
    ['discoveryActorId', 'TIKTOK_DISCOVERY_ACTOR_ID'],
    ['observeActorId', 'TIKTOK_OBSERVE_ACTOR_ID'],
  ] as const) {
    assert.throws(
      () => httpClient({ ...base, [field]: '   ' }),
      (error: unknown) => {
        assert.ok(error instanceof TikTokNotConfigured);
        assert.equal(error.variable, variable);
        // ★ This is the only source with THREE secrets, so a half-filled block is far
        // likelier here than anywhere else. The message names all three, because the
        // reader is looking at a file with one of them filled in.
        for (const named of ['APIFY_TOKEN', 'TIKTOK_DISCOVERY_ACTOR_ID', 'TIKTOK_OBSERVE_ACTOR_ID']) {
          assert.ok(error.message.includes(named), `the message omits ${named}`);
        }
        assert.ok(error.message.includes('.env.local'));
        return true;
      },
    );
  }
});

test('a configuration failure is its own class, not a vendor failure', () => {
  const base = harness(straightThrough([])).config;
  assert.throws(
    () => httpClient({ ...base, token: '' }),
    (error: unknown) => {
      assert.equal(error instanceof VendorUnavailable, false);
      assert.ok(error instanceof TikTokNotConfigured);
      return true;
    },
  );
});

test('★ the console spelling of an actor id is refused, with the API spelling in the message', () => {
  // `username/actor-name` pasted from the console would add a path segment and produce
  // a 404 that reads exactly like a retired actor. The variable is an environment
  // value interpolated into a URL, which is the same hole a caller-supplied name
  // opened on the other source.
  const base = harness(straightThrough([])).config;
  assert.throws(
    () => httpClient({ ...base, discoveryActorId: 'clockworks/tiktok-scraper' }),
    (error: unknown) => {
      assert.ok(error instanceof TikTokNotConfigured);
      assert.equal(error.variable, 'TIKTOK_DISCOVERY_ACTOR_ID');
      assert.ok(error.message.includes('username~actor-name'), 'the fix is not in the message');
      return true;
    },
  );
});

test('an actor id that could address a path is refused', () => {
  const base = harness(straightThrough([])).config;
  for (const bad of ['../../v2/datasets', 'actor?x=1', 'actor#frag', 'a b', 'x'.repeat(200)]) {
    assert.throws(
      () => httpClient({ ...base, observeActorId: bad }),
      (error: unknown) => error instanceof TikTokNotConfigured,
      `accepted ${JSON.stringify(bad)}`,
    );
  }
});

test('a token with a newline in it is refused rather than sent', () => {
  const base = harness(straightThrough([])).config;
  assert.throws(
    () => httpClient({ ...base, token: 'tok\nen' }),
    (error: unknown) => error instanceof TikTokNotConfigured && error.variable === 'APIFY_TOKEN',
  );
});

test('a base url that is not http(s), or that carries a query, is refused', () => {
  const base = harness(straightThrough([])).config;
  for (const bad of ['not a url', 'ftp://api.example.com', 'https://api.example.com?token=x']) {
    assert.throws(
      () => httpClient({ ...base, baseUrl: bad }),
      (error: unknown) => error instanceof TikTokNotConfigured && error.variable === 'TIKTOK_API_BASE',
      `accepted ${bad}`,
    );
  }
});

/* ── the happy path ───────────────────────────────────────────────────── */

test('a run is created, waited on server-side, and its dataset read', async () => {
  const h = harness(straightThrough([item('1'), item('2')]));
  const result = await httpClient(h.config).runDiscovery({ hashtags: ['chillguy'] });

  assert.equal(h.calls.length, 2, 'the run finished inside the blocking create; one poll would be waste');

  const create = h.calls[0];
  assert.ok(create !== undefined);
  assert.equal(create.init.method, 'POST');
  // ★ `/v2/actors/`, not the deprecated `/v2/acts/` alias.
  assert.ok(create.url.includes('/v2/actors/clockworks~tiktok-scraper/runs'));
  assert.equal(create.init.body, JSON.stringify({ hashtags: ['chillguy'] }));
  // The vendor does the waiting; this client has no timer, no sleep and no clock.
  assert.equal(paramsOf(create.url).get('waitForFinish'), '60');
  // ★ And it is told to KILL the run at a timeout, because a run we walk away from
  // keeps billing and would never appear in our ledger at all.
  assert.equal(paramsOf(create.url).get('timeout'), '360');

  // The credential is a header, never a query parameter: the vendor's own docs call
  // `?token=` less secure because URLs are stored in histories and server logs.
  assert.equal(authOf(create.init), `Bearer ${TOKEN}`);
  assert.equal(create.url.includes(TOKEN), false, 'the credential reached the URL');

  const dataset = h.calls[1];
  assert.ok(dataset !== undefined);
  assert.ok(dataset.url.includes(`/v2/datasets/${DATASET_ID}/items`));
  assert.equal(paramsOf(dataset.url).get('clean'), 'true');

  assert.equal(result.items.length, 2);
  // ★ The run id, which the one-shot endpoint cannot give us. Without it a charge on
  // an invoice cannot be reconciled to a call in our ledger.
  assert.equal(result.runId, RUN_ID);
});

test('a run still going is polled until it is terminal', async () => {
  let seen = 0;
  const h = harness((url) => {
    if (isDataset(url)) return json([item('1')]);
    seen += 1;
    return json(run(seen < 3 ? 'RUNNING' : 'SUCCEEDED'));
  });

  const result = await httpClient(h.config).runObserve(['https://www.tiktok.com/@a/video/1']);
  assert.equal(seen, 3, 'the create plus two polls');
  assert.equal(result.items.length, 1);

  const poll = h.calls[1];
  assert.ok(poll !== undefined);
  assert.ok(poll.url.includes(`/v2/actor-runs/${RUN_ID}`));
  assert.equal(poll.init.method, 'GET');
});

test('★ a SUCCEEDED run with an empty dataset is the ONE thing allowed to mean "nothing found"', async () => {
  const h = harness(straightThrough([]));
  const result = await httpClient(h.config).runDiscovery({ hashtags: ['nobody-posts-this'] });
  assert.deepEqual(result.items, []);
  assert.equal(result.runId, RUN_ID);
});

/* ── ★ the reason this client takes three requests ────────────────────── */

test('★★ a FAILED run is an outage, and its dataset is never even read', async () => {
  // The whole argument for the async path. Under the one-shot endpoint this arrives
  // as an empty array, indistinguishable from a hashtag nobody posted under — an
  // outage rendered as a claim, on a source billed per run.
  for (const status of ['FAILED', 'TIMED-OUT', 'ABORTED']) {
    const h = harness((url) => (isDataset(url) ? json([item('1')]) : json(run(status))));
    await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable, `${status} was not an outage`);
      assert.equal(error.endpoint, RUN_ENDPOINT);
      assert.ok(error.message.includes(status));
      assert.ok(error.message.includes(RUN_ID), 'the run id is the only way to find the charge');
      return true;
    });
    assert.equal(h.calls.some((c) => isDataset(c.url)), false, 'a failed run\'s dataset was read anyway');
  }
});

test('★ a status we cannot read is a shape error, never a default', () => {
  // Defaulting to SUCCEEDED reports a failed run's empty dataset as an empty internet;
  // defaulting to RUNNING spends the poll budget and reports a timeout on a run that
  // finished. There is no safe guess, so there is no guess.
  assert.throws(
    () => decodeRun({ data: { id: RUN_ID, defaultDatasetId: DATASET_ID } }, 'endpoint'),
    (error: unknown) => {
      assert.ok(error instanceof VendorShapeError);
      assert.equal(error.field, 'data.status');
      return true;
    },
  );
});

test('★ a status the vendor invents later is treated as still running, not as success', async () => {
  // Listed exhaustively rather than as "not RUNNING", so a new status times out here
  // instead of being silently accepted as a run that worked.
  assert.equal(isTerminal('SUCCEEDED'), true);
  assert.equal(isTerminal('RUNNING'), false);
  assert.equal(isTerminal('SOMETHING-NEW'), false);

  const h = harness((url) => (isDataset(url) ? json([]) : json(run('SOMETHING-NEW'))), { maxStatusPolls: 1 });
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), VendorUnavailable);
});

test('★ giving up on a slow run is an outage that names the run, never an empty result', async () => {
  const h = harness((url) => (isDataset(url) ? json([]) : json(run('RUNNING'))), {
    maxStatusPolls: 2,
    waitForFinishSeconds: 30,
  });
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.ok(error.message.includes(RUN_ID));
    // 90s = (1 create + 2 polls) x 30s. The reader needs to know how long we waited.
    assert.ok(error.message.includes('90s'));
    assert.ok(error.message.includes('still be billed'), 'the cost of walking away is not stated');
    return true;
  });
  // The create plus exactly two polls, and no dataset read.
  assert.equal(h.calls.length, 3);
});

/* ── ★ the taxonomy: an outage is never a claim ───────────────────────── */

test('401 is unavailability with the status, and never echoes the body', async () => {
  const h = harness(() => json({ error: { message: `token rejected: ${TOKEN}` } }, 401));
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 401);
    assert.ok(error.message.includes('APIFY_TOKEN'));
    assert.equal(error.message.includes(TOKEN), false, 'the body was echoed and it contained our token');
    return true;
  });
});

test('★ 402 and 403 are outages — an exhausted plan is not a quiet internet', async () => {
  for (const status of [402, 403]) {
    const h = harness(() => new Response('<html>plan exhausted</html>', { status, headers: { 'content-type': 'text/html' } }));
    await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable, `status ${status} was not an outage`);
      assert.equal(error.status, status);
      return true;
    });
  }
});

test('404 says a mistyped actor id looks exactly like this', async () => {
  // The single most likely symptom of a wrong TIKTOK_*_ACTOR_ID, and the actor id is
  // deliberately a swappable environment variable with no default.
  const h = harness(() => json({}, 404));
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 404);
    assert.ok(error.message.includes('actor id'));
    return true;
  });
});

test('429 carries whatever the vendor said about the window', async () => {
  const h = harness(() => json({}, 429, { 'retry-after': '5' }));
  await assert.rejects(httpClient(h.config).runObserve(['https://www.tiktok.com/@a/video/1']), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 429);
    assert.ok(error.message.includes('retry after 5'));
    return true;
  });
});

test('408 — the synchronous endpoint\'s timeout — is an outage, never an empty run', async () => {
  const h = harness(() => json({}, 408));
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 408);
    return true;
  });
});

test('a 5xx is unavailability carrying its status', async () => {
  const h = harness(() => json({}, 502));
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, 502);
    return true;
  });
});

test('a transport failure is unavailability with NO status', async () => {
  const h = harness(() => {
    throw new TypeError('ECONNRESET');
  });
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, undefined);
    return true;
  });
});

test('★ 200 with a body that is not JSON is an outage, not a shape error', async () => {
  const h = harness(() => new Response('<html>just a moment</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error instanceof VendorShapeError, false);
    return true;
  });
});

test('a dataset that is not an array is a shape error, not an empty run', async () => {
  // This endpoint has no envelope. A body that is not an array means the shape changed
  // — reading it as "no items" would report a schema change as a quiet hashtag.
  const h = harness((url) => (isDataset(url) ? json({ items: [] }) : json(run('SUCCEEDED'))));
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), VendorShapeError);
  assert.throws(() => decodeDataset({ items: [] }, 'endpoint'), VendorShapeError);
  assert.deepEqual(decodeDataset([], 'endpoint'), []);
});

test('a SUCCEEDED run with no dataset id is a shape error rather than an empty answer', async () => {
  const h = harness(() => json(run('SUCCEEDED', { defaultDatasetId: null })));
  await assert.rejects(httpClient(h.config).runDiscovery({ hashtags: ['x'] }), VendorShapeError);
});

test('★ a run id or dataset id that could address a path is refused', () => {
  // These arrive in a RESPONSE BODY and are interpolated into the next request's path.
  // That is the shortest route from "the vendor was confused" to "we made a request
  // nobody wrote", and it costs one regular expression to close.
  for (const bad of ['../../datasets/someone-elses', 'id?x=1', 'id/../..', 'x'.repeat(100)]) {
    assert.throws(
      () => decodeRun({ data: { id: bad, status: 'SUCCEEDED' } }, 'endpoint'),
      VendorShapeError,
      `accepted run id ${JSON.stringify(bad)}`,
    );
    assert.throws(
      () => decodeRun({ data: { id: RUN_ID, status: 'SUCCEEDED', defaultDatasetId: bad } }, 'endpoint'),
      VendorShapeError,
      `accepted dataset id ${JSON.stringify(bad)}`,
    );
  }
});

test('a hostile status string is bounded before it reaches an exception', () => {
  const decoded = decodeRun({ data: { id: RUN_ID, status: 'S'.repeat(5_000) } }, 'endpoint');
  assert.ok(decoded.status.length < 40, 'an unbounded vendor string reached a log line');
});

/* ── ★ the post URL, which is the most dangerous string in the package ── */

test('★ a hostile handle or id is refused, not encoded, before it can reach a URL', () => {
  // User-written text that reaches a URL. Percent-encoding it would produce a request
  // that is valid, wrong, and answered in a way that reads as "this post is gone" —
  // and on the projection side the same class of value once built a citation that
  // opened cleanly and pointed at somebody else's post.
  assert.equal(postUrl('someone', '123'), 'https://www.tiktok.com/@someone/video/123');
  assert.equal(
    postUrl('some.one_1', '7300000000000000000'),
    'https://www.tiktok.com/@some.one_1/video/7300000000000000000',
  );

  for (const handle of ['../admin', 'a/b', 'a?b', 'a#b', 'a%2fb', 'a b', 'a\nb', '', 'аpple']) {
    assert.throws(() => postUrl(handle, '123'), RangeError, `accepted handle ${JSON.stringify(handle)}`);
  }
  for (const id of ['../x', '1 2', '1?x=', '1#frag', '']) {
    assert.throws(() => postUrl('someone', id), RangeError, `accepted id ${JSON.stringify(id)}`);
  }
});

test('★ the gate is RFC 3986\'s unreserved set, so it cannot drift from the projector\'s', () => {
  // `services/project/src/permalinks.ts` gates the same two strings with the same set
  // before calling this. A second, STRICTER copy here would be worse than a shared
  // rule: the projector would pass a handle its own rule accepts, this would throw,
  // and a throw inside a projection takes the whole frame down. So this is the URL
  // question — what a character does to a path — and deliberately NOT the platform's
  // username policy, which is a different question and is not ours.
  assert.equal(isPathSegment('a.b_c-d'), true, 'an ordinary handle with a hyphen must build');
  assert.equal(isPathSegment('a~b'), true);
  assert.equal(isPathSegment('7300000000000000000'), true);
  assert.equal(postUrl('a.b_c-d', '7'), 'https://www.tiktok.com/@a.b_c-d/video/7');
  for (const bad of ['a/b', 'a?b', 'a#b', 'a%b', 'a b', '', 'a:b', 'a@b']) {
    assert.equal(isPathSegment(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

/* ── the batch that costs a run and cannot return anything ────────────── */

test('★ a run of nothing is refused before it is billed', async () => {
  const h = harness(straightThrough([]));
  await assert.rejects(httpClient(h.config).runObserve([]), RangeError);
  assert.equal(h.calls.length, 0, 'an empty batch reached the vendor and was charged for');
});

/* ── quota observation ────────────────────────────────────────────────── */

test('★ a header that is present and BLANK reads as no reading, never as zero', async () => {
  const h = harness((url) =>
    isDataset(url) ? json([]) : json(run('SUCCEEDED'), 200, { 'x-ratelimit-remaining': '  ' }),
  );
  await httpClient(h.config).runDiscovery({ hashtags: ['x'] });

  const seen = h.quotas[0];
  assert.ok(seen !== undefined);
  assert.equal(seen.reading.remaining, null);
  // This vendor publishes no quota headers at all, so four nulls is the honest answer
  // rather than a defect.
  assert.equal(seen.reading.used, null);
  assert.equal(seen.reading.resetSeconds, null);
});
