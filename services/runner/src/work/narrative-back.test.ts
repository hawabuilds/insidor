/**
 * The backward name search (work/narrative-back.ts): on, a shown narrative of 3 posts or more
 * formed in the last two days is asked once, by its name, from seven days before its earliest post
 * up to it, in all languages in one search, credited to 'narrative_name' and charged to its own
 * 'narrative_back' day.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { NarrativePostRow, StoredNarrative } from '@insidor/store';

import type { Logger } from '../log.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { NOW, openMeter, pagingSource } from './lane-search-fakes.ts';
import { narrativeBackPass, type NarrativeBackDeps } from './narrative-back.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const HOUR = 3_600_000;
const FIRST = NOW - 30 * HOUR;
const OFF = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, backSearch: { ...DEFAULT_POLICY.narrative.backSearch, on: false } } };
/* Shipped off since 2026-10-20 (its money went to the account watch); what it does when on is tested on this. */
const ON = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, backSearch: { ...DEFAULT_POLICY.narrative.backSearch, on: true } } };

const narrative = (id: string, formedAgo: number, posts = 3): StoredNarrative => ({
  id,
  members: Array.from({ length: posts }, (_, i) => `x:${id}${i}`),
  anchor: `x:${id}0`,
  shown: true,
  firstShownAtMs: NOW - formedAgo,
  postsChangedAtMs: NOW,
  title: 'Tesla Roadster Launched',
  titlePosts: posts,
});
const rows = (ids: readonly string[]): NarrativePostRow[] => ids.map((itemId, i) => ({
  itemId, source: 'x', body: 'the tesla roadster is up', media: [], atMs: FIRST + i * HOUR, coinable: true, confidence: 1, lookedAt: 'text',
  proposedName: 'ROADSTER', alternateNames: [], judgeId: null, kindLabel: null, ownerCall: null, ownTalk: false,
}));

function deps(seen: DiscoveryQuery[], stored: unknown[], open: readonly StoredNarrative[], policy = ON, ledger = memoryLaneLedger()): NarrativeBackDeps {
  return {
    sources: () => [pagingSource(seen, () => 3)],
    narratives: { live: async () => open, standingRows: async (ids) => rows(ids) },
    store: async (items, _a, lane) => (stored.push(lane), items.length),
    uncredited: async (ids) => ids.length,
    ledger,
    meter: openMeter,
    mode: 'live',
    policy,
    log: quiet,
    now: () => NOW,
  };
}

test('off: nothing is asked', async () => {
  const seen: DiscoveryQuery[] = [];
  assert.equal((await narrativeBackPass(deps(seen, [], [narrative('new', 10 * 60_000)], OFF), new Set())).asked, 0);
  assert.equal(seen.length, 0);
});

test('★ on: a narrative of 3 posts formed in the last two days is asked once, back from its earliest post, in every language at once', async () => {
  assert.equal(DEFAULT_POLICY.narrative.backSearch.on, false, 'shipped off');
  const seen: DiscoveryQuery[] = [];
  const stored: unknown[] = [];
  const asked = new Set<string>();
  const open = [narrative('new', 10 * 60_000), narrative('old', 3 * 24 * HOUR), narrative('small', HOUR, 2)];
  const r = await narrativeBackPass(deps(seen, stored, open), asked);
  assert.equal(r.asked, 1, 'the one formed three days ago and the one of 2 posts are not');
  assert.equal(seen[0]?.term, 'tesla roadster');
  assert.equal(seen[0]?.untilMs, FIRST);
  assert.equal(seen[0]?.sinceMs, FIRST - DEFAULT_POLICY.narrative.backSearch.lookbackMs);
  assert.deepEqual(seen[0]?.filter?.langs, []);
  assert.deepEqual([...new Set(stored)], ['narrative_name']);
  await narrativeBackPass(deps(seen, stored, open), asked);
  assert.equal(seen.length, 1, 'asked once for the life of the process');
});

test('★ its own day: charged to narrative_back, never to the forward search, and stopped at its own cap', async () => {
  const ledger = memoryLaneLedger();
  const seen: DiscoveryQuery[] = [];
  await narrativeBackPass(deps(seen, [], [narrative('new', HOUR)], ON, ledger), new Set());
  const day = new Date(NOW).toISOString().slice(0, 10);
  assert.ok((ledger.totals.get(`${day}:narrative_back`) ?? 0) > 0);
  assert.equal(ledger.totals.get(`${day}:narrative_name`), undefined);

  const spent = memoryLaneLedger({ narrative_back: DEFAULT_POLICY.narrative.backSearch.cap.dailyUsd, narrative_name: 0 });
  const none: DiscoveryQuery[] = [];
  await narrativeBackPass(deps(none, [], [narrative('new', HOUR)], ON, spent), new Set());
  assert.equal(none.length, 0, 'its day spent: nothing asked, whatever the forward search has left');
});

test('the biggest narrative is asked first', async () => {
  const seen: DiscoveryQuery[] = [];
  const one = { ...ON, narrative: { ...ON.narrative, backSearch: { ...ON.narrative.backSearch, perPass: 1 } } };
  const asked = new Set<string>();
  await narrativeBackPass(deps(seen, [], [narrative('newer', HOUR, 3), narrative('bigger', 20 * HOUR, 9)], one), asked);
  assert.deepEqual([...asked], ['bigger']);
});
