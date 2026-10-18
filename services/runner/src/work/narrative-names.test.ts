/**
 * The narrative-name search (work/narrative-names.ts): which name a narrative is searched by, and
 * what one pass asks — shown narratives only, one keyword search in every language forward from the last ask,
 * credited to 'narrative_name', stopping the whole pass at the lane's cap.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis, Policy } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { NarrativePostRow, StoredNarrative } from '@insidor/store';

import type { Logger } from '../log.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { NOW, openMeter, pagingSource } from './lane-search-fakes.ts';
import { chooseName, narrativeNameClock, narrativeNamesPass, type NarrativeNamesDeps } from './narrative-names.ts';

const P = DEFAULT_POLICY.feed.narrativeNames;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const post = (body: string, proposedName: string | null = null, alternateNames: readonly string[] = []) => ({ body, proposedName, alternateNames });

test('a phrase people write beats a single word, and a single word must be a judged name', () => {
  const posts = [
    post('The Tesla Roadster event starts at 7:55', 'ROADSTER'),
    post('watching the tesla roadster launch', 'ROADSTER'),
    post('roadster roadster', 'FLYINGCAR'),
  ];
  assert.deepEqual(chooseName('Tesla Roadster Launched Into Flight', posts, P), { name: 'tesla roadster', posts: 2 });
  /* "the hi": a phrase may start on a common word if another word is not common. */
  assert.equal(chooseName('The Hi Meme', [post('Really into the Hi lately'), post('scientists reveal the Hi')], P)?.name, 'the hi');
  /* A title's lone English word is never a name; a judged one is. */
  assert.equal(chooseName('Police Car Incident', [post('police here'), post('police there')], P), null);
  assert.equal(chooseName('Vaquita Facing Extinction Crisis', [post('save the vaquita', 'VAQUITA'), post('vaquita count is 10', 'VAQUITA')], P)?.name, 'vaquita');
});

test('a generic name, a phrase ending on a common word, or a name in one post only is not searched', () => {
  assert.equal(chooseName('Elon Musk And Viral Cat Meme', [post('elon musk cat', 'ELON'), post('elon musk again', 'MUSK')], P), null);
  assert.equal(chooseName('Dougy the Wojak', [post('dougy the dog'), post('dougy the best')], P), null);
  assert.equal(chooseName('Glorp Alien Cat Run', [post('glorp is here', 'GLORP'), post('nothing')], P), null);
});

function narrative(id: string, shown: boolean, title: string): StoredNarrative {
  return { id, members: [`x:${id}a`, `x:${id}b`], anchor: `x:${id}a`, shown, firstShownAtMs: NOW, postsChangedAtMs: NOW, title, titlePosts: 2 };
}

function deps(seen: DiscoveryQuery[], stored: unknown[], policy: Policy = DEFAULT_POLICY, over: Partial<NarrativeNamesDeps> = {}): NarrativeNamesDeps {
  const rows = (ids: readonly string[]): NarrativePostRow[] =>
    ids.map((itemId) => ({
      itemId, source: 'x', body: itemId.includes('n1') ? 'the tesla roadster is up' : 'save the vaquita', media: [], atMs: NOW,
      coinable: true, confidence: 1, lookedAt: 'text', proposedName: itemId.includes('n1') ? 'ROADSTER' : 'VAQUITA', alternateNames: [],
      judgeId: null, kindLabel: null, ownerCall: null, ownTalk: false,
    }));
  return {
    sources: () => [pagingSource(seen, () => 3)],
    narratives: {
      open: async () => [narrative('n1', true, 'Tesla Roadster Launched'), narrative('n2', true, 'Vaquita Facing Extinction'), narrative('n3', false, 'Tesla Roadster Hidden')],
      standingRows: async (ids) => rows(ids),
    },
    store: async (items, _a, lane) => {
      stored.push(lane);
      return items.length;
    },
    uncredited: async (ids) => ids.length,
    ledger: memoryLaneLedger(),
    meter: openMeter,
    mode: 'live',
    policy,
    log: quiet,
    now: () => NOW,
    ...over,
  };
}

test('a pass asks each shown narrative by name, once across every language and forward from its last ask, and credits the lane', async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: unknown[] = [];
  const clock = narrativeNameClock();
  const r = await narrativeNamesPass(deps(seen, stored), clock);
  assert.equal(r.narratives, 2);
  assert.equal(r.named, 2);
  assert.equal(r.asked, 2);
  /* ★ Each name is ONE search with no language filter (the owner, 2026-10-18), never one per language. */
  assert.deepEqual(seen.map((q) => q.term).sort(), ['tesla roadster', 'vaquita']);
  for (const q of seen) {
    assert.equal(q.mode, 'keyword');
    assert.equal(q.sinceMs, NOW - P.everyMs);
    assert.deepEqual(q.filter, { minApproval: P.minApproval, mediaOnly: false, langs: [], excludeRebroadcasts: true });
  }
  assert.deepEqual(stored, ['narrative_name', 'narrative_name']);

  /* The next pass reaches back to where this one began, not an hour before it. */
  const later: DiscoveryQuery[] = [];
  await narrativeNamesPass({ ...deps(later, []), now: () => (NOW + P.everyMs) as Millis }, clock);
  assert.ok(later.every((q) => q.sinceMs === NOW));
});

test('a spent lane, a source with no filtered search, or the switch off asks nothing', async () => {
  const seen: DiscoveryQuery[] = [];
  const capped = await narrativeNamesPass(deps(seen, [], DEFAULT_POLICY, { ledger: memoryLaneLedger({ narrative_name: P.cap.dailyUsd }) }), narrativeNameClock());
  assert.equal(capped.stopped, 'capped');
  assert.equal(seen.length, 0);
  const plain = await narrativeNamesPass(deps(seen, [], DEFAULT_POLICY, { sources: () => [pagingSource(seen, () => 3, { narrowedSearch: { filter: false, reproductionsOf: false } })] }), narrativeNameClock());
  assert.equal(plain.asked, 0);
  const off: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, narrativeNames: { ...P, on: false } } };
  await narrativeNamesPass(deps(seen, [], off), narrativeNameClock());
  assert.equal(seen.length, 0);
});
