/**
 * What a re-read on this source can say about a post being gone (capabilities `leftOutIsGone`).
 *
 * ★ TWO OUTCOMES AND NO THIRD: the lookup answers, and a post it leaves out (absent, or the
 * id-less entry the vendor sends for a post it cannot return) is missing from the map; or it throws
 * — a rate limit, a refusal, an error envelope under a 200 — and nothing at all comes back. A failed
 * read must never arrive as a map with every post left out, because the runner reads a left-out
 * post as gone (services/runner work/gone-posts.ts). Through the real HTTP client, with a stub fetch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { VendorUnavailable } from '@insidor/vendor-kit';

import { CAPABILITIES } from './capabilities.ts';
import { httpClient } from './client.ts';
import { xPlatform } from './index.ts';
import { PLAIN } from './__fixtures__/posts.ts';

const AT = 1_800_000_000_000 as Millis;
const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 } as const;
const LIVE = '1823456789012345678';
const GONE = '1823456789012345999';

const meter = {
  mayspend: () => true,
  record: () => undefined,
  spentUsd: () => 0,
  line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
} as unknown as Meter;

const answering = (status: number, body: unknown): typeof globalThis.fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;

const adapter = (fetch: typeof globalThis.fetch) =>
  xPlatform({ client: httpClient({ apiKey: 'k', baseUrl: 'https://h.example', fetch }), meter, now: () => AT });

test('this source declares that a post an answered re-read leaves out is gone', () => {
  assert.equal(CAPABILITIES.leftOutIsGone, true);
});

test('★ an answered re-read leaves the gone post out, and the id-less entry for it is not a post', async () => {
  const x = adapter(answering(200, { status: 'success', tweets: [PLAIN, { type: 'tweet' }] }));
  const read = await x.observe([LIVE, GONE], budget);
  assert.equal(read.value.has(LIVE), true);
  assert.equal(read.value.has(GONE), false, 'the post X did not return is left out');
  assert.equal(read.value.size, 1);
});

test('★ a rate limit is not an answer: it throws, and no post is left out of anything', async () => {
  const x = adapter(answering(429, { error: 'Too Many Requests' }));
  await assert.rejects(x.observe([LIVE, GONE], budget), VendorUnavailable);
});

test('★ an error envelope under a 200 is not an answer either', async () => {
  const x = adapter(answering(200, { status: 'error', message: 'something went wrong' }));
  await assert.rejects(x.observe([LIVE, GONE], budget), VendorUnavailable);
});
