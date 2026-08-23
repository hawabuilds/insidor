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

import { CAPABILITIES } from './capabilities.ts';
import type { RunResult, TikTokClient } from './client.ts';
import { discoverRun, toActorInput } from './discover.ts';

const AT = 1_800_000_000_000;

const query = (over: Partial<DiscoveryQuery> = {}): DiscoveryQuery => ({
  mode: 'hashtag',
  term: 'chillguy',
  sinceMs: null,
  untilMs: null,
  limit: 25,
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
  // for it. `searchQueries` exists on one actor family and is deliberately not
  // claimed, because which actor is configured is not knowable here.
  assert.equal(CAPABILITIES.discovery.includes('keyword'), false, 'keyword search was claimed');
  assert.deepEqual([...CAPABILITIES.discovery].sort(), ['account', 'feed', 'hashtag']);
  assert.deepEqual(CAPABILITIES.absent, ['reproduction']);
  assert.equal(CAPABILITIES.billing, 'per-run');
});

/* ── rendering ────────────────────────────────────────────────────────── */

test('a mode this source cannot express is an error, never an empty page', () => {
  // An empty result reads downstream as "nothing is happening", which is the failure
  // the capability list exists to design out.
  for (const mode of ['keyword', 'catalog'] as const) {
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
    resultsPerPage: 25,
  });
  assert.deepEqual(toActorInput(query({ mode: 'account', term: 'someone' })), {
    accounts: ['someone'],
    resultsPerPage: 25,
  });
  assert.deepEqual(toActorInput(query({ mode: 'feed', term: 'someone' })), {
    hashtags: ['someone'],
    resultsPerPage: 25,
  });
});

test('★ a size hint IS sent, and the asymmetry with the cutoff is the whole argument', () => {
  // Same kind of parameter: one actor family's key, unverifiable, silently ignorable.
  // The difference is the FAILURE DIRECTION. An ignored cutoff contaminates a
  // decision; an ignored size bound costs a little more scraping and the caller
  // slices the result anyway. That asymmetry, not the parameter's provenance, is what
  // decides whether an unverifiable bound may be relied on.
  assert.equal(toActorInput(query({ limit: 7 })).resultsPerPage, 7);
  assert.equal(toActorInput(query({ limit: 0 })).resultsPerPage, 1);
  assert.equal(toActorInput(query({ limit: 12.9 })).resultsPerPage, 12);
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
