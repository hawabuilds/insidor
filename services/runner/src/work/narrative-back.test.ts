/**
 * The backward name search (work/narrative-back.ts): off by default; on, a narrative formed in the
 * last hour is asked once, by its name, from seven days before its first post up to it, in all
 * languages in one search, credited to 'narrative_name'.
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
const ON = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, backSearch: { ...DEFAULT_POLICY.narrative.backSearch, on: true } } };

const narrative = (id: string, formedAgo: number): StoredNarrative => ({ id, members: [`x:${id}a`, `x:${id}b`], anchor: `x:${id}a`, shown: true, firstShownAtMs: NOW - formedAgo, postsChangedAtMs: NOW, title: 'Tesla Roadster Launched', titlePosts: 2 });
const rows = (ids: readonly string[]): NarrativePostRow[] => ids.map((itemId, i) => ({
  itemId, source: 'x', body: 'the tesla roadster is up', media: [], atMs: FIRST + i * HOUR, coinable: true, confidence: 1, lookedAt: 'text',
  proposedName: 'ROADSTER', alternateNames: [], judgeId: null, kindLabel: null, ownerCall: null, ownTalk: false,
}));

function deps(seen: DiscoveryQuery[], stored: unknown[], policy = ON): NarrativeBackDeps {
  return {
    sources: () => [pagingSource(seen, () => 3)],
    narratives: { open: async () => [narrative('new', 10 * 60_000), narrative('old', 5 * HOUR)], standingRows: async (ids) => rows(ids) },
    store: async (items, _a, lane) => (stored.push(lane), items.length),
    uncredited: async (ids) => ids.length,
    ledger: memoryLaneLedger(),
    meter: openMeter,
    mode: 'live',
    policy,
    log: quiet,
    now: () => NOW,
  };
}

test('off by default: nothing is asked', async () => {
  const seen: DiscoveryQuery[] = [];
  assert.equal((await narrativeBackPass(deps(seen, [], DEFAULT_POLICY), new Set())).asked, 0);
  assert.equal(seen.length, 0);
});

test('★ a narrative formed in the last hour is asked once, back from its first post, in every language at once', async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: unknown[] = [];
  const asked = new Set<string>();
  const r = await narrativeBackPass(deps(seen, stored), asked);
  assert.equal(r.asked, 1, 'the narrative formed five hours ago is not');
  assert.equal(seen[0]?.term, 'tesla roadster');
  assert.equal(seen[0]?.untilMs, FIRST);
  assert.equal(seen[0]?.sinceMs, FIRST - ON.narrative.backSearch.lookbackMs);
  assert.deepEqual(seen[0]?.filter?.langs, []);
  assert.deepEqual([...new Set(stored)], ['narrative_name']);
  await narrativeBackPass(deps(seen, stored), asked);
  assert.equal(seen.length, 1, 'asked once for the life of the process');
});
