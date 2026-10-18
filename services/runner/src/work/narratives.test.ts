/**
 * The narratives pass against a fake store: who is grouped (the judge's yes at its own model's
 * cutoff, never the owner's "Not a meme", a held kind or a shill), that vectors are compared in
 * memory and read once, that a dry run writes nothing, that titles go to the shown narratives, and
 * that the owner's "Not a narrative" holds through the regroup it causes; that a narrative made
 * stays made (never retired, never folded into another, grown only by new posts) and only the
 * owner's merge folds one into another; and the early posts: a stored post the regroup could not
 * see joins the narrative it matches, by the parts' rule, never against the owner's calls.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { TitlePort } from '@insidor/contracts/ports/titles.ts';
import type { NarrativeCallRow } from '@insidor/core';
import type { NarrativePass, NarrativePostRow, StoredNarrative } from '@insidor/store';

import { createLogger } from '../log.ts';
import { narrativeGrouper } from './narratives.ts';

const NOW = 1_800_000_000_000;
const meter = { line: () => ({ capUsd: 1, spentUsd: 0 }) } as unknown as Meter;
const log = createLogger({ test: 'narratives' });
const OPEN_JUDGE = 'judge:openrouter/google/gemma-3-27b-it@abc';
const MAIN_JUDGE = 'judge:anthropic/claude-haiku-4-5@abc';

const row = (itemId: string, extra: Partial<NarrativePostRow> = {}): NarrativePostRow => ({
  itemId,
  source: 'x',
  body: 'GTA 6 trailer two is finally out and it looks unreal',
  media: [{ kind: 'image', uri: `https://pics.invalid/${itemId}.jpg` }],
  atMs: NOW - 60_000,
  coinable: true,
  confidence: 0.99,
  lookedAt: 'picture',
  proposedName: 'GTA 6',
  alternateNames: [],
  judgeId: MAIN_JUDGE,
  kindLabel: null,
  ownerCall: null,
  ownTalk: false,
  ...extra,
});

const unit = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);

function setup(rows: readonly NarrativePostRow[], vectors: Record<string, Float32Array>, mode: 'live' | 'dry' = 'live', calls: readonly NarrativeCallRow[] = [], older: readonly NarrativePostRow[] = [], open: () => readonly StoredNarrative[] = () => [], policy = DEFAULT_POLICY) {
  const saved: NarrativePass[] = [];
  const reads: string[][] = [];
  const titles: [string, string][] = [];
  const titler: TitlePort = {
    id: 't', model: 'm',
    async title(subjects) {
      return { value: subjects.map((s) => ({ kind: 'titled' as const, ref: s.ref, title: 'GTA 6 Trailer Two' })), spend: { vendor: 'v', endpoint: 'narrative-title', unit: 'per-call', units: 1, usd: 0.0001, at: NOW } } as never;
    },
  };
  const repo = {
    candidates: async () => rows,
    vectors: async (ids: readonly string[], _space: string, kind: 'post' | 'picture') => {
      if (kind === 'post') reads.push([...ids]);
      return new Map(kind === 'post' ? ids.flatMap((id) => (vectors[id] === undefined ? [] : [[id, vectors[id]] as const])) : []);
    },
    reach: async () => ({ points: new Map(), latest: new Map() }),
    calls: async () => calls,
    ofPosts: async (ids: readonly string[]) => new Map(open().flatMap((n) => n.members.filter((m) => ids.includes(m)).map((m) => [m, n.id] as const))),
    states: async (ids: readonly string[]) => open().filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, state: 'open' as const, mergedInto: null })),
    byIds: async (ids: readonly string[]) => open().filter((n) => ids.includes(n.id)),
    setTitle: async (id: string, title: string) => void titles.push([id, title]),
    storedGood: async () => older,
  };
  const grouper = narrativeGrouper({
    repo, save: async (p) => (saved.push(p), true), block: async () => ({ cutoff: null, chosenOn: null }), titler, embed: null, keepVectors: async () => false,
    meter, mode, policy: { ...policy, judge: { ...policy.judge, cutoffs: { primary: 0.7, fallback: 0.95 } } }, postSpace: 'post-space', log, now: () => NOW as Millis,
  });
  return { grouper, saved, reads, titles };
}

test('★ only good posts are grouped: the owner, held kinds, shills and the open model under its cutoff stay out', async () => {
  const rows = [
    row('a'), row('b'),
    row('owner', { ownerCall: 'not' }),
    row('ad', { kindLabel: 'AD' }),
    row('shill', { body: 'GTA 6 trailer out, buy $GTA now' }),
    row('open-low', { judgeId: OPEN_JUDGE, confidence: 0.9 }),
    row('open-high', { judgeId: OPEN_JUDGE, confidence: 0.97 }),
  ];
  const v = Object.fromEntries(rows.map((r) => [r.itemId, unit(0)]));
  const { grouper, saved, titles } = setup(rows, v);
  const r = await grouper.pass();
  assert.equal(r.good, 3);
  assert.deepEqual(r.left, { owner_not_meme: 1, held_kind: 1, shill: 1, judge_no: 1 });
  assert.deepEqual(saved[0]?.narratives.map((n) => [...n.members].sort()), [['a', 'b', 'open-high']]);
  assert.equal(saved[0]?.narratives[0]?.shown, true);
  assert.deepEqual(titles, [[saved[0]?.narratives[0]?.id ?? '', 'GTA 6 Trailer Two']]);
});

test('★ far apart in meaning, apart in narratives; vectors are read once for the life of the process', async () => {
  const rows = [row('a'), row('b'), row('c')];
  const { grouper, saved, reads } = setup(rows, { a: unit(0), b: unit(0.1), c: unit(1.5) });
  await grouper.pass();
  await grouper.pass();
  assert.deepEqual(saved[0]?.narratives.map((n) => [...n.members].sort()), [['a', 'b']]);
  assert.deepEqual(reads, [['a', 'b', 'c']], 'the second pass reads no vector again');
});

test('a dry run groups and writes nothing', async () => {
  const { grouper, saved } = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'dry');
  const r = await grouper.pass();
  assert.equal(r.narratives, 1);
  assert.equal(saved.length, 0);
});

test('★ "Not a narrative" holds through the regroup: a hidden post with one new post stays hidden, with two new posts it shows', async () => {
  /* As the owner's tap 1040: said over the narrative's posts, which then shrank and changed. */
  const hide: NarrativeCallRow = { id: 1040, atMs: NOW - 1, narrativeId: 'n-a', verdict: 'not_narrative', otherId: null, coin: null, members: ['a', 'old'], otherMembers: [] };
  const one = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'live', [hide]);
  await one.grouper.pass();
  assert.deepEqual(one.saved[0]?.narratives.map((n) => [[...n.members].sort(), n.shown]), [[['a', 'b'], false]]);
  const two = setup([row('a'), row('b'), row('c')], { a: unit(0), b: unit(0), c: unit(0) }, 'live', [hide]);
  await two.grouper.pass();
  assert.deepEqual(two.saved[0]?.narratives.map((n) => [[...n.members].sort(), n.shown]), [[['a', 'b', 'c'], true]]);
});

/* ── the early posts (0100) ── */

const DAY = 86_400_000;
const old = (itemId: string, daysBack: number, extra: Partial<NarrativePostRow> = {}) => row(itemId, { atMs: NOW - daysBack * DAY, ...extra });
/* The window's oldest posts, so a post a little before the window is inside the regroup's one-day gap. */
const edge = (itemId: string) => old(itemId, 1.9);

test('★ a stored post from before the window that matches joins the narrative as early, followed back one link at a time', async () => {
  const rows = [edge('a'), edge('b')];
  const older = [
    old('bridge', 2.5), // half a day before the window's first post
    old('first', 3.2), // the story's first post: linked to the bridge, not to the window
    old('jump', 5), // the same words, but two days before anything: a gap the regroup never links across
    old('other', 2.5, { body: 'A new cat cafe opened downtown with twenty rescue cats', proposedName: 'Cat Cafe' }),
    old('far', 2.5), // the same words but far in meaning
    old('tooOld', 9), // outside the seven days
  ];
  const v = { a: unit(0), b: unit(0.05), bridge: unit(0.1), first: unit(0.1), jump: unit(0), other: unit(0.05), far: unit(1.5), tooOld: unit(0) };
  const { grouper, saved } = setup(rows, v, 'live', [], older);
  const r = await grouper.pass();
  const n = saved[0]?.narratives[0];
  assert.deepEqual([...(n?.members ?? [])].sort(), ['a', 'b'], 'the regroup made the narrative from the window');
  assert.deepEqual(n?.early, ['first', 'bridge'], 'earliest first');
  assert.equal(r.early, 2);
});

test('★ a narrative made stays made: the next pass with nothing new writes nothing for it, and a new post is added to it', async () => {
  const rows = [edge('a'), edge('b')];
  const older = [old('first', 2.5)];
  const v = { a: unit(0), b: unit(0), c: unit(0), first: unit(0) };
  let stored: StoredNarrative[] = [];
  const s = setup(rows, v, 'live', [], older, () => stored);
  await s.grouper.pass();
  const first = s.saved[0]?.narratives[0];
  assert.ok(first !== undefined);
  assert.deepEqual(first.early, ['first']);
  stored = [{ id: first.id, members: [...first.members, ...(first.early ?? [])], anchor: first.anchor, shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 't', titlePosts: 3, newestPostAtMs: NOW, early: [...(first.early ?? [])] }];
  await s.grouper.pass();
  assert.deepEqual(s.saved[1]?.narratives, [], 'untouched: nothing rewritten, nothing retired');
  assert.deepEqual(s.saved[1]?.retired, []);
  const later = [edge('a'), edge('b'), edge('c')];
  const t = setup(later, v, 'live', [], older, () => stored);
  await t.grouper.pass();
  const grown = t.saved[0]?.narratives[0];
  assert.equal(grown?.id, first.id, 'the id holds');
  assert.deepEqual(grown?.added, ['c']);
  assert.deepEqual([...(grown?.members ?? [])].sort(), ['a', 'b', 'c'], 'its posts, the early one aside');
});

test('★ a narrative whose posts all left the window is never retired, and two narratives never fold into one', async () => {
  const stored: StoredNarrative[] = [
    { id: 'n-old', members: ['gone1', 'gone2'], anchor: 'gone1', shown: true, firstShownAtMs: NOW - 5 * DAY, postsChangedAtMs: NOW - 5 * DAY, title: 'Old', titlePosts: 2, newestPostAtMs: NOW - 5 * DAY, early: [] },
    { id: 'n-one', members: ['a'], anchor: 'a', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'One', titlePosts: 2, newestPostAtMs: NOW, early: [] },
    { id: 'n-two', members: ['b'], anchor: 'b', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'Two', titlePosts: 2, newestPostAtMs: NOW, early: [] },
  ];
  const v = { a: unit(0), b: unit(0), c: unit(0) };
  const s = setup([row('a'), row('b'), row('c')], v, 'live', [], [], () => stored);
  const r = await s.grouper.pass();
  assert.deepEqual(s.saved[0]?.retired, []);
  assert.equal(r.created, 0);
  assert.deepEqual(s.saved[0]?.narratives.map((n) => n.added), [['c']], 'c joins one of them; n-one and n-two stay two');
});

test('★ only the owner merges: his "Merge with…" moves one narrative into the other', async () => {
  const stored: StoredNarrative[] = [
    { id: 'n-one', members: ['a'], anchor: 'a', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'One', titlePosts: 2, newestPostAtMs: NOW, early: [] },
    { id: 'n-two', members: ['b'], anchor: 'b', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'Two', titlePosts: 2, newestPostAtMs: NOW, early: [] },
  ];
  const merge: NarrativeCallRow = { id: 7, atMs: NOW - 1, narrativeId: 'n-one', verdict: 'merge', otherId: 'n-two', coin: null, members: ['a'], otherMembers: ['b'] };
  const s = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'live', [merge], [], () => stored);
  await s.grouper.pass();
  assert.deepEqual(s.saved[0]?.retired, [{ id: 'n-one', into: 'n-two' }]);
});

test('★ the owner outranks the match: a post he removed from beside the narrative, or kept apart, is not early', async () => {
  const rows = [edge('a'), edge('b'), edge('c')];
  const older = [old('removed', 2.5), old('apart', 2.5), old('kept', 2.5)];
  const calls: NarrativeCallRow[] = [
    { id: 1, atMs: NOW - 10, narrativeId: 'n-x', verdict: 'remove_post', otherId: 'removed', coin: null, members: ['removed', 'a', 'b'], otherMembers: [] },
    { id: 2, atMs: NOW - 5, narrativeId: 'n-y', verdict: 'not_narrative', otherId: null, coin: null, members: ['apart', 'a'], otherMembers: [] },
  ];
  const v = { a: unit(0), b: unit(0), c: unit(0), removed: unit(0), apart: unit(0), kept: unit(0) };
  const { grouper, saved } = setup(rows, v, 'live', calls, older);
  await grouper.pass();
  const shown = saved[0]?.narratives.find((x) => x.members.includes('b'));
  assert.equal(shown?.shown, true, 'b and c are posts he never saw in it');
  assert.deepEqual(shown?.early, ['kept']);
});

test('a good post the regroup dropped at its cap is matched back in as early', async () => {
  const policy = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, maxPosts: 2 } };
  const rows = [row('a', { atMs: NOW - 1_000 }), row('b', { atMs: NOW - 2_000 }), row('dropped', { atMs: NOW - 3 * 3_600_000 })];
  const v = { a: unit(0), b: unit(0), dropped: unit(0.05) };
  const { grouper, saved } = setup(rows, v, 'live', [], [], () => [], policy);
  const r = await grouper.pass();
  assert.equal(r.left.over_cap, 1);
  assert.deepEqual(saved[0]?.narratives[0]?.early, ['dropped']);
});

test('switched off, nothing is early', async () => {
  const policy = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, early: { ...DEFAULT_POLICY.narrative.early, on: false } } };
  const { grouper, saved } = setup([edge('a'), edge('b')], { a: unit(0), b: unit(0), first: unit(0) }, 'live', [], [old('first', 2.5)], () => [], policy);
  const r = await grouper.pass();
  assert.deepEqual(saved[0]?.narratives[0]?.early, []);
  assert.equal(r.early, 0);
});
