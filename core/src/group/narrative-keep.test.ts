/**
 * Keeping narratives (narrative-keep.ts, and the pins in narrative.ts): the regroup adds posts and
 * makes new narratives, never folds one narrative into another or drops one; only the owner merges
 * and removes; a new id is never one already given out; dead is the newest post's age.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { keepNarratives, narrativeDead, ownerMerges, removedPosts, survivorOf, type NarrativeState } from './narrative-keep.ts';
import { foldNarrativeCalls, groupNarratives, type NarrativeCallRow, type NarrativePair, type NarrativePost } from './narrative.ts';

const P = DEFAULT_POLICY;
const post = (itemId: string, text: string, names: readonly string[] = []): NarrativePost => ({ itemId, atMs: 0, text, names, hasPicture: true });
const pair = (a: string, b: string, meaning = 0.9): NarrativePair => ({ a, b, meaning, samePicture: false });
const call = (id: number, verdict: NarrativeCallRow['verdict'], narrativeId: string, otherId: string | null): NarrativeCallRow => ({ id, atMs: id, narrativeId, verdict, otherId, coin: null, members: [], otherMembers: [] });

test('★ two narratives already made never join, even when every pair between them links', () => {
  const posts = ['a', 'b', 'c', 'd'].map((id) => post(id, 'pancake the cat drinks from the fountain again', ['Pancake']));
  const pairs = [pair('a', 'b'), pair('a', 'c'), pair('a', 'd'), pair('b', 'c'), pair('b', 'd'), pair('c', 'd')];
  const free = groupNarratives({ posts, pairs, calls: foldNarrativeCalls([]), previous: new Map(), single: new Set() }, P);
  assert.equal(free.narratives.length, 1, 'with nothing pinned they are one story');
  const pinned = new Map([['a', 'n-1'], ['b', 'n-2']]);
  const kept = groupNarratives({ posts, pairs, calls: foldNarrativeCalls([]), previous: new Map(), single: new Set(), pinned }, P);
  const groups = kept.narratives.map((n) => [...n.members].sort());
  assert.ok(groups.every((g) => !(g.includes('a') && g.includes('b'))), 'n-1 and n-2 stay apart');
  const out = keepNarratives({ groups: kept.narratives.map((n) => n.members), pinned, taken: new Set(['n-1', 'n-2']), removedFrom: new Map() });
  assert.equal(out.created.length, 0, 'c and d join one of them, they make no third');
  assert.equal([...out.grown.values()].flat().sort().join(), 'c,d');
});

test('★ the "parts of one story" step never joins two narratives already made; it may join new posts to one', () => {
  /* Every post the same meaning and the same name: unpinned, the parts step makes them one story. */
  const ids = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  const posts = ids.map((id) => post(id, 'pancake the cat drinks from the fountain again', ['Pancake']));
  const pairs = [pair('a1', 'a2'), pair('b1', 'b2'), pair('c1', 'c2')];
  const vectors = new Map(ids.map((id) => [id, Float32Array.from([1, 0])] as const));
  const free = groupNarratives({ posts, pairs, calls: foldNarrativeCalls([]), previous: new Map(), single: new Set(), vectors }, P);
  assert.equal(free.narratives.length, 1, 'unpinned, the parts join');
  const pinned = new Map([['a1', 'n-a'], ['a2', 'n-a'], ['b1', 'n-b'], ['b2', 'n-b']]);
  const kept = groupNarratives({ posts, pairs, calls: foldNarrativeCalls([]), previous: new Map(), single: new Set(), vectors, pinned }, P);
  const groups = kept.narratives.map((n) => [...n.members].sort());
  assert.ok(groups.every((g) => !(g.includes('a1') && g.includes('b1'))), 'n-a and n-b stay two');
  const out = keepNarratives({ groups: kept.narratives.map((n) => n.members), pinned, taken: new Set(['n-a', 'n-b']), removedFrom: new Map() });
  assert.deepEqual([...out.grown.values()].flat().sort(), ['c1', 'c2'], 'the new part joins one of them');
  assert.equal(out.created.length, 0);
});

test('★ a group with no narrative\'s post is new, named after its oldest post, never an id given out', () => {
  const out = keepNarratives({ groups: [['x', 'y'], ['p', 'q']], pinned: new Map(), taken: new Set(['n-x', 'n-p', 'n-q']), removedFrom: new Map() });
  assert.deepEqual(out.created.map((c) => c.id), ['n-y', 'n-p-1']);
  assert.equal(out.grown.size, 0);
});

test('a group adds only its free posts, to the narrative holding most of them, never a post the owner removed from it', () => {
  const pinned = new Map([['a', 'n-a'], ['b', 'n-a'], ['c', 'n-c']]);
  const out = keepNarratives({ groups: [['a', 'b', 'c', 'new', 'gone']], pinned, taken: new Set(), removedFrom: new Map([['gone', new Set(['n-a'])]]) });
  assert.deepEqual([...out.grown], [['n-a', ['new']]]);
});

test('★ only the owner merges: once, into where the narrative he chose leads now', () => {
  const states = new Map<string, NarrativeState>([
    ['n-1', { state: 'open', mergedInto: null }],
    ['n-2', { state: 'merged', mergedInto: 'n-3' }],
    ['n-3', { state: 'open', mergedInto: null }],
    ['n-4', { state: 'merged', mergedInto: 'n-3' }],
  ]);
  assert.deepEqual(ownerMerges([call(1, 'merge', 'n-1', 'n-2'), call(2, 'merge', 'n-4', 'n-1'), call(3, 'not_narrative', 'n-3', null)], states), [{ from: 'n-1', into: 'n-3' }]);
  assert.equal(survivorOf('n-2', states), 'n-3');
  assert.equal(survivorOf('n-9', states), null);
  assert.deepEqual([...removedPosts([call(4, 'remove_post', 'n-2', 'p')], states)].map(([k, v]) => [k, [...v].sort()]), [['p', ['n-2', 'n-3']]]);
});

test('★ dead after 48 hours with no new post; an unknown post time is not dead', () => {
  const now = 10 * P.narrative.dead.afterMs;
  assert.equal(narrativeDead(now - P.narrative.dead.afterMs, now, P), true);
  assert.equal(narrativeDead(now - P.narrative.dead.afterMs + 1, now, P), false);
  assert.equal(narrativeDead(null, now, P), false);
});
