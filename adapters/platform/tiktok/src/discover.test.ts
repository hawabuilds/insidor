/**
 * Query rendering, and the refusal.
 *
 * ★ THE MOST IMPORTANT TEST IN THIS PACKAGE AFTER `capabilities.absent` IS THE ONE
 * THAT ASSERTS THIS SOURCE STILL SAYS NO. `toActorInput` refuses `untilMs`, that
 * refusal was previously protected by no test at all, and it is the thing standing
 * between this repository and a backtest that looks blind and is not. Somebody
 * holding the scraper's input schema — which does document an upload-date filter —
 * will eventually read the refusal as a stale mistake. These tests, and the reasons
 * in the file header, are what has to stop them.
 *
 * No network: every case below is reached with a plain object for a client.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { CAPABILITIES, DISCOVER_RESULTS_CAP, PRICES } from './capabilities.ts';
import type { RunResult, TikTokClient } from './client.ts';
import { discoverRun, toActorInput } from './discover.ts';

const AT = 1_800_000_000_000;

const query = (over: Partial<DiscoveryQuery> = {}): DiscoveryQuery => ({
  mode: 'hashtag',
  term: 'chillguy',
  sinceMs: null,
  untilMs: null,
  limit: 8,
  cursor: null,
  ...over,
});

const item = (id: string): unknown => ({ id, desc: `post ${id}`, stats: { playCount: 10 } });

const clientReturning = (result: RunResult): TikTokClient => ({
  runDiscovery: async () => result,
  runObserve: async () => {
    throw new Error('not used');
  },
});

/* ── ★ the refusal ────────────────────────────────────────────────────── */

test('★★ a query carrying the anti-contamination cutoff is REFUSED on this source', async () => {
  assert.throws(
    () => toActorInput(query({ untilMs: 1_800_000_000_000 })),
    (error: unknown) => {
      assert.ok(error instanceof NotImplemented);
      assert.equal(error.endpoint, 'tiktok:discover:cutoff');
      return true;
    },
  );
});

test('★ the refusal states the reason that survives reading the scraper\'s schema', () => {
  // The old wording — "this source cannot bound discovery by time" — is factually
  // contestable: one actor family documents `newestPostDate`. A reader who checks
  // will conclude the refusal is stale and delete it. The true reason is different
  // and is not contestable: the candidate set is chosen by a PRESENT-DAY RANKING
  // before any date filter is applied, so no reachable cutoff can make the run blind
  // — and which actor is configured is not knowable to this code.
  try {
    toActorInput(query({ untilMs: 1 }));
    assert.fail('the cutoff was accepted');
  } catch (error) {
    assert.ok(error instanceof NotImplemented);
    assert.ok(error.message.includes('present-day ranking'), 'the message does not give the real reason');
    assert.ok(error.message.includes('which actor is'), 'the message does not mention the swappable actor');
    assert.equal(
      error.message.includes('cannot bound discovery by time'),
      false,
      'the message still makes the contestable claim a reader will disprove',
    );
  }
});

test('★ the refusal fires before any run is created, so it costs nothing', async () => {
  let ran = false;
  const client: TikTokClient = {
    runDiscovery: async () => {
      ran = true;
      return { items: [], runId: null };
    },
    runObserve: async () => ({ items: [], runId: null }),
  };
  await assert.rejects(discoverRun(client, query({ untilMs: 1_800_000_000_000 }), AT), NotImplemented);
  assert.equal(ran, false, 'a refused query still bought a run');
});

test('★ the capability list still tells the truth about what this source cannot do', () => {
  // Declaring a mode no code path renders is the same lie as returning an empty page
  // for it. Keyword search is declared because the scraper's input schema has it
  // (`searchQueries`, checked 2026-10-13); a catch-all is not, because it has no
  // trending feed to stand in for one.
  assert.equal(CAPABILITIES.discovery[0], 'keyword', 'keyword search is not the first entry point');
  assert.equal(CAPABILITIES.discovery.includes('catchall'), false, 'a catch-all was claimed');
  assert.deepEqual([...CAPABILITIES.discovery].sort(), ['account', 'feed', 'hashtag', 'keyword']);
  assert.deepEqual(CAPABILITIES.absent, ['reproduction']);
  assert.equal(CAPABILITIES.billing, 'per-run');
});

/* ── rendering ────────────────────────────────────────────────────────── */

test('a mode this source cannot express is an error, never an empty page', () => {
  // An empty result reads downstream as "nothing is happening", which is the failure
  // the capability list exists to design out.
  for (const mode of ['catchall', 'catalog'] as const) {
    assert.throws(() => toActorInput(query({ mode })), (error: unknown) => {
      assert.ok(error instanceof NotImplemented);
      assert.equal(error.endpoint, `tiktok:discover:${mode}`);
      return true;
    });
  }
  assert.throws(() => toActorInput(query({ term: '  ' })), NotImplemented);
});

test('a hashtag and an account go into different keys, because the actor reads them differently', () => {
  assert.deepEqual(toActorInput(query({ mode: 'hashtag', term: ' chillguy ' })), {
    hashtags: ['chillguy'],
    resultsPerPage: 8,
  });
  assert.deepEqual(toActorInput(query({ mode: 'account', term: 'someone' })), {
    profiles: ['someone'],
    resultsPerPage: 8,
  });
  assert.deepEqual(toActorInput(query({ mode: 'feed', term: 'someone' })), {
    hashtags: ['someone'],
    resultsPerPage: 8,
  });
});

test('★ a keyword is a video search with no sort and no date filter', () => {
  const input = toActorInput(query({ mode: 'keyword', term: ' memecoin ' }));
  assert.deepEqual(input, {
    searchQueries: ['memecoin'],
    searchSection: '/video',
    resultsPerPage: 8,
  });
  // The newest-first sort goes through a route that returned an empty SUCCEEDED run live;
  // the date filter is a cutoff with every flaw the header lists.
  assert.equal('videoSearchSorting' in input, false);
  assert.equal('videoSearchDateFilter' in input, false);
  // And the cutoff is refused on this mode exactly as on the others.
  assert.throws(() => toActorInput(query({ mode: 'keyword', untilMs: 1 })), NotImplemented);
});

test('★ the cap is the policy\'s hashtag ask, so a run is quoted at exactly what is asked', () => {
  assert.equal(DISCOVER_RESULTS_CAP, DEFAULT_POLICY.feed.hashtagResults);
});

test('★ a run never asks for more posts than its price was quoted at', () => {
  // The vendor charges per post returned and the ledger records per run, so the run's
  // price is a bound only while the size is.
  assert.equal(toActorInput(query({ limit: 100 })).resultsPerPage, DISCOVER_RESULTS_CAP);
  assert.equal(toActorInput(query({ mode: 'keyword', limit: 1_000 })).resultsPerPage, DISCOVER_RESULTS_CAP);
});

test('★ a size hint IS sent, and the asymmetry with the cutoff is the whole argument', () => {
  // Same kind of parameter: one actor family's key, unverifiable, silently ignorable.
  // The difference is the FAILURE DIRECTION. An ignored cutoff contaminates a
  // decision; an ignored size bound costs a little more scraping and the caller
  // slices the result anyway. That asymmetry, not the parameter's provenance, is what
  // decides whether an unverifiable bound may be relied on.
  assert.equal(toActorInput(query({ limit: 7 })).resultsPerPage, 7);
  assert.equal(toActorInput(query({ limit: 0 })).resultsPerPage, 1);
  assert.equal(toActorInput(query({ limit: 9.9 })).resultsPerPage, 9);
});

/* ── the run ──────────────────────────────────────────────────────────── */

test('a run is translated, sliced to the limit, and carries its run id out', async () => {
  const client = clientReturning({ items: [item('1'), item('2'), item('3')], runId: 'RUN1' });
  const result = await discoverRun(client, query({ limit: 2 }), AT);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.sourceItemId, '1');
  // The run id is how a charge on an invoice is reconciled to a call in the ledger.
  assert.equal(result.runId, 'RUN1');
});

test('a run that found nothing produces no items and is not an error', async () => {
  // Reachable only because the client proved the run SUCCEEDED first — see
  // client.test.ts. That ordering is the only thing separating this from an outage.
  const result = await discoverRun(clientReturning({ items: [], runId: 'RUN1' }), query(), AT);
  assert.deepEqual(result.items, []);
});

test('the read instant is injected and shared by every item in one run', async () => {
  const client = clientReturning({ items: [item('1'), item('2')], runId: null });
  const result = await discoverRun(client, query(), AT);
  for (const translated of result.items) {
    assert.equal(translated.firstSeenAt, AT);
  }
});

/* ── the price ────────────────────────────────────────────────────────── */

test('★ a run is quoted at its full bill: the start fee plus every post it may return', () => {
  // The flat two cents that was here first was about a seventh of a full observe batch.
  const discover = PRICES['apify:discover']?.usdPerUnit ?? 0;
  const observe = PRICES['apify:observe']?.usdPerUnit ?? 0;
  assert.ok(Math.abs(discover - (0.001 + DISCOVER_RESULTS_CAP * 0.003)) < 1e-9, `discover quoted at ${discover}`);
  assert.ok(Math.abs(observe - (0.001 + (CAPABILITIES.observeBatchSize ?? 1) * 0.003)) < 1e-9, `observe quoted at ${observe}`);
});
