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

function setup(rows: readonly NarrativePostRow[], vectors: Record<string, Float32Array>, mode: 'live' | 'dry' = 'live', calls: readonly NarrativeCallRow[] = [], older: readonly NarrativePostRow[] = [], open: () => readonly StoredNarrative[] = () => [], policy = DEFAULT_POLICY, more: Record<string, unknown> = {}) {
  const saved: NarrativePass[] = [];
  const reads: string[][] = [];
  const titles: [string, string][] = [];
  const titler: TitlePort = {
    id: 't', model: 'm',
    async title(subjects) {
      return { value: subjects.map((s) => ({ kind: 'titled' as const, ref: s.ref, title: 'GTA 6 Trailer Two', fight: s.ref === 'n-war' ? ['China', 'Turkey'] : [] })), spend: { vendor: 'v', endpoint: 'narrative-title', unit: 'per-call', units: 1, usd: 0.0001, at: NOW } } as never;
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
    ...more,
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
  assert.deepEqual(s.saved[0]?.retired, [{ id: 'n-one', into: 'n-two', by: 'owner' }]);
});

test('★ the owner\'s title stands: a narrative he renamed is never sent to the titler, however much it grows', async () => {
  const stored: StoredNarrative[] = [
    { id: 'n-mine', members: ['a'], anchor: 'a', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'Twitter World War', titlePosts: 1, titleModel: 'owner', newestPostAtMs: NOW, early: [] },
    { id: 'n-model', members: ['x'], anchor: 'x', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'Old Title', titlePosts: 1, titleModel: 'm', newestPostAtMs: NOW, early: [] },
  ];
  const rename: NarrativeCallRow = { id: 11, atMs: NOW - 1, narrativeId: 'n-mine', verdict: 'rename', otherId: null, coin: null, members: ['a'], otherMembers: [] };
  const other = { body: 'A new cat cafe opened downtown with twenty rescue cats', proposedName: 'Cat Cafe' };
  const v = { a: unit(0), b: unit(0), c: unit(0), x: unit(1.5), y: unit(1.5), z: unit(1.5) };
  const s = setup([row('a'), row('b'), row('c'), row('x', other), row('y', other), row('z', other)], v, 'live', [rename], [], () => stored);
  await s.grouper.pass();
  assert.deepEqual(s.saved[0]?.narratives.map((n) => [n.id, [...(n.added ?? [])].sort()]).sort(), [['n-mine', ['b', 'c']], ['n-model', ['y', 'z']]], 'both grew threefold');
  assert.deepEqual(s.titles.map(([id]) => id), ['n-model'], 'only the model\'s title is asked again');
});

test('★ the owner\'s "Add a post": the post is moved into his narrative, pinned there for the regroup, and written once', async () => {
  const war: StoredNarrative = { id: 'n-war', members: ['a', 'b'], anchor: 'a', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'War', titlePosts: 2, newestPostAtMs: NOW, early: [] };
  const cat: StoredNarrative = { id: 'n-cat', members: ['x', 'y'], anchor: 'x', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'Cat', titlePosts: 2, newestPostAtMs: NOW, early: [] };
  const add: NarrativeCallRow = { id: 12, atMs: NOW - 1, narrativeId: 'n-war', verdict: 'add_post', otherId: 'x', coin: null, members: ['a', 'b'], otherMembers: [] };
  const other = { body: 'A new cat cafe opened downtown with twenty rescue cats', proposedName: 'Cat Cafe' };
  const v = { a: unit(0), b: unit(0), x: unit(1.5), y: unit(1.5), z: unit(1.5), far: unit(0) };
  let stored = [war, cat];
  const s = setup([row('a'), row('b'), row('x', other), row('y', other), row('z', other)], v, 'live', [add], [], () => stored);
  await s.grouper.pass();
  assert.deepEqual(s.saved[0]?.added, [{ itemId: 'x', into: 'n-war' }]);
  assert.ok(!(s.saved[0]?.narratives ?? []).some((n) => n.added?.includes('x')), 'x is pinned to n-war: no group takes it anywhere else');

  /* As the write left it: x in n-war. Nothing to write again, and a post never in the window (a queued one) waits the same way. */
  stored = [{ ...war, members: ['a', 'b', 'x'] }, { ...cat, members: ['y'] }];
  const again = setup([row('a'), row('b'), row('x', other), row('y', other)], v, 'live', [add, { ...add, id: 13, otherId: 'queued' }], [], () => stored);
  await again.grouper.pass();
  assert.deepEqual(again.saved[0]?.added, [{ itemId: 'queued', into: 'n-war' }], 'x is there; the queued post is offered until the store has it');
});

test('★ the owner\'s split: the posts he picked are a new narrative this pass, shown and titled, and it is done once', async () => {
  const before: StoredNarrative[] = [
    { id: 'n-a', members: ['a', 'b', 'c', 'd'], anchor: 'a', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: 'All', titlePosts: 4, newestPostAtMs: NOW, early: [] },
  ];
  const split: NarrativeCallRow = { id: 9, atMs: NOW - 1, narrativeId: 'n-a', verdict: 'split', otherId: 'n-c', coin: null, members: ['c', 'd'], otherMembers: ['a', 'b'] };
  const v = { a: unit(0), b: unit(0), c: unit(0), d: unit(0), e: unit(0) };
  let stored = before;
  const s = setup([row('a'), row('b'), row('c'), row('d')], v, 'live', [split], [], () => stored);
  await s.grouper.pass();
  assert.deepEqual(s.saved[0]?.split, [{ from: 'n-a', into: 'n-c', members: ['c', 'd'] }]);
  const made = s.saved[0]?.narratives.find((x) => x.id === 'n-c');
  assert.deepEqual({ members: made?.members, added: made?.added, shown: made?.shown, changed: made?.changed }, { members: ['c', 'd'], added: [], shown: true, changed: true });
  assert.ok(!(s.saved[0]?.narratives.find((x) => x.id === 'n-a')?.added ?? []).some((m) => m === 'c' || m === 'd'), 'n-a never takes them back');
  assert.ok(s.titles.some(([id]) => id === 'n-c'), 'named by the title step like any new narrative');

  /* As the write left it: the new narrative stored, so the split is not applied again; a new post beside them is not n-a\'s. */
  stored = [{ ...before[0]!, members: ['a', 'b'] }, { id: 'n-c', members: ['c', 'd'], anchor: 'c', shown: true, firstShownAtMs: NOW, postsChangedAtMs: NOW, title: null, titlePosts: null, newestPostAtMs: NOW, early: [] }];
  const again = setup([row('a'), row('b'), row('c'), row('d')], v, 'live', [split], [], () => stored);
  await again.grouper.pass();
  assert.deepEqual(again.saved[0]?.split, []);
  assert.ok(!(again.saved[0]?.narratives ?? []).some((x) => x.id === 'n-a' && x.added?.some((m) => m === 'c' || m === 'd')));
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

test('★ the meme-war answer rides on the title call, and a live narrative never asked (an owner-renamed one too) is asked for it alone', async () => {
  const fights: [string, readonly string[]][] = [];
  const war: StoredNarrative = { id: 'n-war', members: ['w1', 'w2'], anchor: 'w1', shown: true, firstShownAtMs: NOW - DAY, postsChangedAtMs: NOW - DAY, title: 'His Title', titlePosts: 2, titleModel: 'owner', fight: null, newestPostAtMs: NOW - DAY, early: [] };
  const more = {
    fightUnasked: async (sinceMs: number, limit: number) => (assert.equal(sinceMs, NOW - DEFAULT_POLICY.narrative.fight.activeMs), assert.equal(limit, DEFAULT_POLICY.narrative.fight.perPass), [war]),
    standingRows: async (ids: readonly string[]) => ids.map((id) => row(id, { body: 'Chinese and Turkish users roast each other over Patrick Star' })),
    setFight: async (id: string, countries: readonly string[]) => void fights.push([id, countries]),
  };
  const s = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'live', [], [], () => [], DEFAULT_POLICY, more);
  await s.grouper.pass();
  const made = s.saved[0]?.narratives[0]?.id ?? '';
  assert.deepEqual(s.titles, [[made, 'GTA 6 Trailer Two']], 'only the new narrative is titled: his title stands');
  assert.deepEqual(fights.sort(), [[made, []], ['n-war', ['China', 'Turkey']]], 'both answers are kept: the new one is not a war, his is');
});

const warPost = (itemId: string, lang: string, body: string, reach: number, authorKey = `a:${itemId}`) => ({ itemId, authorKey, lang, body, atMs: NOW - 3_600_000, reach });

test('★ a post naming the other country in its own language joins the live war, judged no or not; the owner\'s "Not a meme" and an English post do not', async () => {
  const war: StoredNarrative = { id: 'n-war', members: ['w1', 'w2', 'w3'], anchor: 'w1', shown: true, firstShownAtMs: NOW - DAY, postsChangedAtMs: NOW - DAY, title: 'Turkey and China Meme War', titlePosts: 3, fight: ['China', 'Turkey'], fightModel: 'm', newestPostAtMs: NOW - DAY, early: [] };
  const more = {
    fightPosts: async () => [warPost('zh1', 'zh', '我们不吃土耳其人，请不要误会。', 340_862), warPost('tr1', 'tr', 'Binlerce yıllık kadim Çin kültürü', 776_905), warPost('tr-hid', 'tr', 'Çinliler tw kullanıyor', 500_000), warPost('en1', 'en', 'Turkey and China at war', 900_000)],
    standingRows: async (ids: readonly string[]) => ids.map((id) => row(id, { coinable: false, confidence: 0.9, ownerCall: id === 'tr-hid' ? 'not' : null, body: 'a post' })),
    fights: async () => [war],
  };
  const s = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'live', [], [], () => [], DEFAULT_POLICY, more);
  const r = await s.grouper.pass();
  const entry = s.saved[0]?.narratives.find((x) => x.id === 'n-war');
  assert.deepEqual([...(entry?.added ?? [])].sort(), ['tr1', 'zh1']);
  assert.equal(entry?.shown, true);
  assert.equal(r.joinedFight, 2);
  assert.deepEqual(s.saved[0]?.fights, []);
});

test('★ the catch-up: an older war post joins as early, an English post alike to the war joins, a narrative of its own folds in; one the owner called on is left alone', async () => {
  const war: StoredNarrative = { id: 'n-war', members: ['w1', 'w2', 'w3'], anchor: 'w1', shown: true, firstShownAtMs: NOW - DAY, postsChangedAtMs: NOW - DAY, title: 'French and Japanese users trade memes', titlePosts: 3, fight: ['France', 'Japan'], fightModel: 'm', newestPostAtMs: NOW - 3_600_000, early: [] };
  const solo: StoredNarrative = { id: 'n-solo', members: ['solo'], anchor: 'solo', shown: true, firstShownAtMs: NOW - DAY, postsChangedAtMs: NOW - DAY, title: null, titlePosts: null, fight: null, newestPostAtMs: NOW - DAY, early: [] };
  const owned: StoredNarrative = { ...solo, id: 'n-owned', members: ['owned'], anchor: 'owned' };
  const old = { ...warPost('vegeta', 'fr', 'Les japonais quand tu leurs dit que végéta est algérien', 164_530), atMs: NOW - 1.5 * DAY };
  const caught = [
    { ...old, narrativeId: null },
    { ...warPost('beef', 'en', 'this french vs japanese twitter beef is the funniest thing', 155_511), narrativeId: null },
    { ...warPost('solo', 'fr', 'Le japonais qui plante une graine', 78_872), narrativeId: 'n-solo' },
    { ...warPost('owned', 'fr', 'Les touristes japonais', 316_567), narrativeId: 'n-owned' },
  ];
  const asked: unknown[][] = [];
  const more = {
    fightPosts: async () => [],
    fightWarPosts: async (...args: unknown[]) => (asked.push(args), caught),
    fightRowsOf: async (ids: readonly string[]) => caught.filter((c) => ids.includes(c.itemId)),
    ownStarts: async () => new Map([['n-war', NOW - DAY]]),
    standingRows: async (ids: readonly string[]) => ids.map((id) => row(id, { coinable: false, confidence: 0.9, body: 'a post' })),
    fights: async () => [war],
  };
  const right: NarrativeCallRow = { id: 7, atMs: NOW - 1, narrativeId: 'n-owned', verdict: 'right', otherId: null, coin: null, members: ['owned'], otherMembers: [] };
  const s = setup([row('a'), row('b')], { a: unit(0), b: unit(0), w1: unit(0), beef: unit(0.1) }, 'live', [right], [], () => [war, solo, owned], DEFAULT_POLICY, more);
  const r = await s.grouper.pass();
  const entry = s.saved[0]?.narratives.find((x) => x.id === 'n-war');
  assert.deepEqual(entry?.added, ['beef']);
  assert.deepEqual(entry?.early, ['vegeta']);
  assert.deepEqual(s.saved[0]?.retired.filter((x) => x.by === 'meme_war'), [{ id: 'n-solo', into: 'n-war', by: 'meme_war' }]);
  assert.equal(r.joinedFight, 3);
  /* Read back to two days before the war's own first post, with the war's own words. */
  assert.equal(asked[0]?.[0], NOW - 3 * DAY);
  /* Not again inside the catch-up's interval. */
  await s.grouper.pass();
  assert.equal(asked.length, 1);
});

test('★ the catch-up: a Japanese quote of a French war post joins it; the owner\'s "Not a meme" and a waiting seed\'s quotes do not', async () => {
  const war: StoredNarrative = { id: 'n-war', members: ['w1', 'w2', 'w3'], anchor: 'w1', shown: true, firstShownAtMs: NOW - DAY, postsChangedAtMs: NOW - DAY, title: 'French and Japanese users trade memes', titlePosts: 3, fight: ['France', 'Japan'], fightModel: 'm', newestPostAtMs: NOW - 3_600_000, early: [] };
  const seed: StoredNarrative = { ...war, id: 'n-seed', members: ['s1'], anchor: 's1', shown: false, fight: ['China', 'Japan'], fightModel: 'native-names' };
  const own = [warPost('w1', 'fr', 'Les japonais ils sont au courant que végéta est algérien ?', 14_880_528), warPost('w2', 'fr', 'Le japonais qui remercie son patron', 288_592), warPost('w3', 'fr', 'Les touristes japonais', 316_567)];
  const quotes = [
    { ...warPost('ja1', 'ja', 'ベジータがアルジェリア人ではない最大の証拠がコチラ', 4_946_842), narrativeId: null, refersTo: ['w1'] },
    { ...warPost('ja-not', 'ja', 'これは草', 120_000), narrativeId: null, refersTo: ['w2'] },
    { ...warPost('ja-seed', 'ja', 'これは草', 120_000), narrativeId: null, refersTo: ['s1'] },
  ];
  const asked: unknown[][] = [];
  const more = {
    fightPosts: async () => [],
    fightWarPosts: async () => [],
    fightQuotes: async (...args: unknown[]) => (asked.push(args), quotes.filter((q) => (args[1] as readonly string[]).some((t) => q.refersTo.includes(t)))),
    fightRowsOf: async (ids: readonly string[]) => own.filter((c) => ids.includes(c.itemId)),
    ownStarts: async () => new Map([['n-war', NOW - DAY]]),
    standingRows: async (ids: readonly string[]) => ids.map((id) => row(id, { coinable: false, confidence: 0.9, ownerCall: id === 'ja-not' ? 'not' : null, body: 'a post' })),
    fights: async () => [war, seed],
  };
  const s = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'live', [], [], () => [war, seed], DEFAULT_POLICY, more);
  const r = await s.grouper.pass();
  const entry = s.saved[0]?.narratives.find((x) => x.id === 'n-war');
  assert.deepEqual(entry?.added, ['ja1']);
  assert.equal(r.joinedFight, 1);
  assert.deepEqual(asked[0]?.[1], ['w1', 'w2', 'w3'], 'only a named war\'s posts are quoted targets, never a seed\'s');
  assert.deepEqual(asked[0]?.[2], Object.keys(DEFAULT_POLICY.narrative.fight.native.home));
});

test('★ a pair no war holds seeds a narrative off the board; the titler naming both countries shows it', async () => {
  const shownNow: string[] = [];
  const seed: StoredNarrative = { id: 'n-war', members: ['w1', 'w2', 'w3'], anchor: 'w1', shown: false, firstShownAtMs: null, postsChangedAtMs: NOW - DAY, title: null, titlePosts: null, fight: ['China', 'Turkey'], fightModel: 'native-names', newestPostAtMs: NOW - DAY, early: [] };
  const more = {
    fightPosts: async () => [warPost('fr1', 'fr', 'Les japonais quand tu leurs dit que végéta est algérien', 164_530), warPost('fr2', 'fr', 'Le japonais qui remercie son patron', 288_592), warPost('fr3', 'fr', 'Moi, vais bientôt m’installer au Japon', 127_991)],
    standingRows: async (ids: readonly string[]) => ids.map((id) => row(id, { coinable: false, confidence: 0.9, body: 'a post' })),
    fights: async () => [],
    fightPending: async () => [seed],
    showFight: async (id: string) => void shownNow.push(id),
    setFight: async () => undefined,
  };
  const s = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'live', [], [], () => [], DEFAULT_POLICY, more);
  const r = await s.grouper.pass();
  assert.equal(r.seededFight, 1);
  const made = s.saved[0]?.narratives.find((x) => x.id === 'n-fr1');
  assert.deepEqual(made?.members, ['fr1', 'fr2', 'fr3']);
  assert.equal(made?.shown, false, 'off the board until the titler says it is the war');
  assert.deepEqual(s.saved[0]?.fights, [{ id: 'n-fr1', countries: ['France', 'Japan'] }]);
  assert.deepEqual(shownNow, ['n-war'], 'the waiting seed the titler named China and Turkey for is shown');
  assert.ok(s.titles.some(([id]) => id === 'n-war'), 'and titled');
});

test('★ a seed the titler declined is asked again once grown, shown when it now names two countries; a seed declined now is marked declined', async () => {
  const shownNow: string[] = [];
  const fights: [string, readonly string[], string][] = [];
  /* Declined at 3 posts, grown to 5: asked again, and the titler (above) names China and Turkey for n-war. */
  const declined: StoredNarrative = { id: 'n-war', members: ['w1', 'w2', 'w3', 'w4', 'w5'], anchor: 'w1', shown: false, firstShownAtMs: null, postsChangedAtMs: NOW - DAY, title: 'Users Joke', titlePosts: 3, fight: [], fightModel: 'native-names:declined', newestPostAtMs: NOW - DAY, early: [] };
  /* A fresh seed the titler answers with no countries: written as declined, not shown. */
  const fresh: StoredNarrative = { id: 'n-other', members: ['o1', 'o2', 'o3'], anchor: 'o1', shown: false, firstShownAtMs: null, postsChangedAtMs: NOW - DAY, title: null, titlePosts: null, fight: ['France', 'Japan'], fightModel: 'native-names', newestPostAtMs: NOW - DAY, early: [] };
  const more = {
    fightPosts: async () => [],
    standingRows: async (ids: readonly string[]) => ids.map((id) => row(id, { body: 'a post' })),
    fights: async () => [],
    fightPending: async () => [declined, fresh],
    showFight: async (id: string) => void shownNow.push(id),
    setFight: async (id: string, countries: readonly string[], model: string) => void fights.push([id, countries, model]),
  };
  const s = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'live', [], [], () => [], DEFAULT_POLICY, more);
  await s.grouper.pass();
  assert.deepEqual(shownNow, ['n-war']);
  assert.deepEqual(fights.find(([id]) => id === 'n-other'), ['n-other', [], 'native-names:declined']);
  assert.equal(fights.find(([id]) => id === 'n-war')?.[2], 'm', 'a yes is written as the titler\'s own answer');
});
