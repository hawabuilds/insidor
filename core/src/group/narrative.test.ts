/**
 * Narratives (narrative.ts): who counts, what two posts must share, how groups join and keep their
 * ids, the owner's calls, the single-post bar and the coin order. GTA 6, the tiger and the text and
 * short-video posts below are examples of the one rule, not cases of it.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import {
  climbPerMinute,
  detailOf,
  foldNarrativeCalls,
  groupNarratives,
  hiddenByOwner,
  hugeAndClimbing,
  narrativeCoin,
  narrativeShown,
  narrativeStanding,
  sharedDetail,
  type NarrativeCallRow,
  type NarrativePair,
  type NarrativePost,
} from './narrative.ts';

const P = DEFAULT_POLICY;
const HOUR = 3_600_000;
const yes = { coinable: true, confidence: 0.99, lookedAt: 'picture' as const, proposedName: 'GTA 6' };
const NO_CALLS = foldNarrativeCalls([]);

const post = (itemId: string, text: string, names: readonly string[] = [], atMs = 0, hasPicture = true): NarrativePost => ({ itemId, atMs, text, names, hasPicture });
const pair = (a: string, b: string, meaning: number, samePicture = false): NarrativePair => ({ a, b, meaning, samePicture });
const run = (posts: readonly NarrativePost[], pairs: readonly NarrativePair[], extra: Partial<Parameters<typeof groupNarratives>[0]> = {}) =>
  groupNarratives({ posts, pairs, calls: NO_CALLS, previous: new Map(), single: new Set(), ...extra }, P);
const membersOf = (out: ReturnType<typeof run>) => out.narratives.map((n) => [...n.members].sort());

test('★ only posts that passed the judge count: the owner, shills, held kinds and the bar', () => {
  assert.equal(narrativeStanding({ answer: yes, kindLabel: null, ownerCall: null, shill: false }, P), 'good');
  assert.equal(narrativeStanding({ answer: yes, kindLabel: null, ownerCall: 'not', shill: false }, P), 'owner_not_meme');
  assert.equal(narrativeStanding({ answer: yes, kindLabel: null, ownerCall: null, shill: true }, P), 'shill');
  assert.equal(narrativeStanding({ answer: yes, kindLabel: 'AD', ownerCall: null, shill: false }, P), 'held_kind');
  assert.equal(narrativeStanding({ answer: yes, kindLabel: 'NOT_MEME_MATCH', ownerCall: null, shill: false }, P), 'held_kind');
  assert.equal(narrativeStanding({ answer: { ...yes, confidence: 0.2 }, kindLabel: null, ownerCall: null, shill: false }, P), 'judge_no');
  assert.equal(narrativeStanding({ answer: { ...yes, coinable: false }, kindLabel: null, ownerCall: null, shill: false }, P), 'judge_no');
  assert.equal(narrativeStanding({ answer: null, kindLabel: null, ownerCall: null, shill: false }, P), 'not_judged');
  /* "Is a meme" is the owner's look, judged or not. */
  assert.equal(narrativeStanding({ answer: null, kindLabel: null, ownerCall: 'meme', shill: false }, P), 'good');
});

test('★ a shared detail: a name, a picture or a topic word — never hashtags alone', () => {
  const d = (text: string, names: readonly string[] = [], pic = true) => detailOf(post('p', text, names, 0, pic), P);
  assert.equal(sharedDetail(d('the trailer is finally out today', ['GTA 6']), d('rockstar dropped it', ['GTA6']), false), 'name');
  assert.equal(sharedDetail(d('look at this cat'), d('what a day'), true), 'picture');
  assert.equal(sharedDetail(d('a tiger cub named Altai was born'), d('the Altai tiger cub is everywhere'), false), 'topic');
  /* The same hashtags and nothing else: nothing shared. */
  assert.equal(sharedDetail(d('#gta6 #gaming #fyp'), d('#gta6 #gaming #fyp'), false), null);
  /* A name one says, the other writes in plain words. */
  assert.equal(sharedDetail(d('wow', ['Altai']), d('this altai cub is so cute'), false), 'name');
});

test('★ meaning AND a detail: close posts with nothing in common stay apart, and so do far posts sharing a word', () => {
  const posts = [post('a', 'the tiger cub Altai at the zoo'), post('b', 'Altai the tiger cub went viral'), post('c', 'my breakfast this morning was good')];
  assert.deepEqual(membersOf(run(posts, [pair('a', 'b', 0.71), pair('a', 'c', 0.8)])), [['a', 'b']]);
  assert.deepEqual(membersOf(run(posts, [pair('a', 'b', 0.5)])), []);
});

test('★ text and short-video posts on one story join: the judge named both, the video is all hashtags', () => {
  const x = post('x:1', 'GTA 6 trailer two is out and it looks unreal', ['GTA 6']);
  const video = post('sv:1', '#gta6 #rockstar #fyp', ['GTA6']);
  assert.deepEqual(membersOf(run([x, video], [pair('x:1', 'sv:1', 0.64)])), [['sv:1', 'x:1']]);
});

test('★ a thin post with no picture is never grouped', () => {
  const posts = [post('a', 'GTA 6 trailer two is out and it looks unreal', ['GTA 6']), post('b', '#gta6', ['GTA 6'], 0, false)];
  assert.deepEqual(membersOf(run(posts, [pair('a', 'b', 0.9)])), []);
});

test('★ an old story and a new one sharing a word stay apart', () => {
  const posts = [post('old', 'the tiger cub at the zoo', ['Tiger'], 0), post('new', 'a tiger cub at the zoo again', ['Tiger'], 3 * 24 * HOUR)];
  assert.deepEqual(membersOf(run(posts, [pair('old', 'new', 0.9)])), []);
});

test('★ average linkage: a drifting chain splits, a real story holds together', () => {
  /* a~b~c~d, each only linked to its neighbours: a and b, then c and d, never one chain. */
  const words = 'the same tiger story every time';
  const chain = ['a', 'b', 'c', 'd'].map((id) => post(id, words));
  const out = membersOf(run(chain, [pair('a', 'b', 0.8), pair('b', 'c', 0.7), pair('c', 'd', 0.8)]));
  assert.ok(out.every((g) => g.length <= 3), JSON.stringify(out));
  /* Four posts all linked: one narrative. */
  const all = ['a', 'b', 'c', 'd'];
  const pairs = all.flatMap((x, i) => all.slice(i + 1).map((y) => pair(x, y, 0.75)));
  assert.deepEqual(membersOf(run(chain, pairs)), [all]);
});

test('★ ids are kept by overlap, a merge retires the smaller id into the larger, a split gets a new id', () => {
  const words = 'the same tiger story every time';
  const posts = ['a', 'b', 'c', 'd'].map((id, i) => post(id, words, [], i));
  const all = ['a', 'b', 'c', 'd'];
  const pairs = all.flatMap((x, i) => all.slice(i + 1).map((y) => pair(x, y, 0.75)));
  const previous = new Map([['n-a', new Set(['a', 'b', 'c'])], ['n-d', new Set(['d'])]]);
  const merged = run(posts, pairs, { previous });
  assert.equal(merged.narratives.length, 1);
  assert.equal(merged.narratives[0]?.id, 'n-a');
  assert.deepEqual(merged.retired, [{ id: 'n-d', into: 'n-a' }]);
  /* Split: c and d drift away from a and b. */
  const split = run(posts, [pair('a', 'b', 0.8), pair('c', 'd', 0.8)], { previous: new Map([['n-a', new Set(all)]]) });
  const ids = split.narratives.map((n) => n.id).sort();
  assert.deepEqual(ids, ['n-a', 'n-c']);
});

test('★ the owner: Not a narrative keeps its posts apart, Remove this post takes one out, Merge joins', () => {
  const words = 'the same tiger story every time';
  const posts = ['a', 'b', 'c'].map((id, i) => post(id, words, [], i));
  const pairs = [pair('a', 'b', 0.8), pair('a', 'c', 0.8), pair('b', 'c', 0.8)];
  const call = (id: number, verdict: NarrativeCallRow['verdict'], extra: Partial<NarrativeCallRow> = {}): NarrativeCallRow =>
    ({ id, atMs: id, narrativeId: 'n-a', verdict, otherId: null, coin: null, members: ['a', 'b', 'c'], otherMembers: [], ...extra });
  assert.deepEqual(membersOf(run(posts, pairs, { calls: foldNarrativeCalls([call(1, 'not_narrative')]) })), []);
  assert.deepEqual(membersOf(run(posts, pairs, { calls: foldNarrativeCalls([call(1, 'remove_post', { otherId: 'c' })]) })), [['a', 'b']]);
  /* Merge: two posts with no link at all, joined by the owner. */
  const two = [post('x', 'one thing entirely'), post('y', 'something else entirely')];
  const merge = foldNarrativeCalls([{ id: 1, atMs: 1, narrativeId: 'n-x', verdict: 'merge', otherId: 'n-y', coin: null, members: ['x'], otherMembers: ['y'] }]);
  assert.deepEqual(membersOf(run(two, [], { calls: merge, single: new Set(['x', 'y']) })), [['x', 'y']]);
  /* A later merge undoes an earlier "apart". */
  const undone = foldNarrativeCalls([call(1, 'not_narrative'), { ...call(2, 'merge'), members: ['a'], otherMembers: ['b', 'c'] }]);
  assert.deepEqual(membersOf(run(posts, pairs, { calls: undone })), [['a', 'b', 'c']]);
});

test('★ on screen: two good posts, or one huge and climbing; the owner\'s hide wins over both', () => {
  assert.equal(narrativeShown(2, false, false, P), 'shown');
  assert.equal(narrativeShown(1, false, false, P), 'too_few_posts');
  assert.equal(narrativeShown(1, true, false, P), 'shown');
  assert.equal(narrativeShown(5, false, true, P), 'hidden_by_owner');
  assert.equal(narrativeShown(1, true, true, P), 'hidden_by_owner');
  assert.equal(hugeAndClimbing(600_000, 2_500, false, P), true);
  assert.equal(hugeAndClimbing(600_000, 900, false, P), false);
  assert.equal(hugeAndClimbing(null, 9_000, false, P), false);
  /* A short video is held to its own scale. */
  assert.equal(hugeAndClimbing(600_000, 2_500, true, P), false);
  const now = 10 * HOUR;
  assert.equal(climbPerMinute([{ atMs: now - 40 * 60_000, reach: 100_000 }, { atMs: now - 5 * 60_000, reach: 170_000 }], now, P), 2_000);
  assert.equal(climbPerMinute([{ atMs: now - 3 * HOUR, reach: 1 }], now, P), null);
});

test('★ the coin: the owner, then proven, then the coins most posts list; wrong never', () => {
  const m = (itemId: string, extra: Partial<Parameters<typeof narrativeCoin>[0][number]> = {}) => ({ itemId, confirmed: null, proven: null, listed: null, ...extra });
  assert.deepEqual(narrativeCoin([m('a', { proven: 'P' })], { right: { address: 'O', atMs: 1 }, wrong: new Map(), members: [] }, 5), { kind: 'confirmed', address: 'O' });
  assert.deepEqual(narrativeCoin([m('a', { confirmed: { address: 'C', atMs: 1 }, proven: 'P' })], null, 5), { kind: 'confirmed', address: 'C' });
  assert.deepEqual(narrativeCoin([m('a', { proven: 'P' }), m('b', { proven: 'P' }), m('c', { proven: 'Q' })], null, 5), { kind: 'proven', addresses: ['P'] });
  assert.deepEqual(narrativeCoin([m('a', { listed: ['A', 'B'] }), m('b', { listed: ['B'] })], null, 5), { kind: 'fitting', addresses: ['B', 'A'] });
  assert.deepEqual(narrativeCoin([m('a', { listed: ['A', 'B'] })], { right: null, wrong: new Map([['A', 1]]), members: [] }, 5), { kind: 'fitting', addresses: ['B'] });
  assert.deepEqual(narrativeCoin([m('a', { listed: [] })], null, 5), { kind: 'none' });
  assert.deepEqual(narrativeCoin([m('a')], null, 5), { kind: 'pending' });
});

/* The owner's four "Not a narrative" taps of 2026-10-17 (internal.owner_feedback 1011-1013, 1040),
   with the posts each was said over, against what the runner holds after them. Each call keeps its
   posts apart, so every one of these narratives shrank right after the tap: the old rule read that
   as "its posts changed" and showed it again, two of them as a single huge post. */
const tap = (id: number, narrativeId: string, members: readonly string[]): NarrativeCallRow =>
  ({ id, atMs: id, narrativeId, verdict: 'not_narrative', otherId: null, coin: null, members, otherMembers: [] });
const TAPS: readonly NarrativeCallRow[] = [
  tap(1011, 'n-x:2111150219731603874', ['x:2111150219731603874', 'x:2111187936485982496']),
  tap(1012, 'n-x:2111166141418832079', ['x:2111166141418832079', 'x:2111170394124333462', 'x:2111188971447619825']),
  tap(1013, 'n-x:2111155680799564037', ['x:2111155680799564037', 'x:2111164032933855527']),
  tap(1040, 'n-x:2111107000549380582', ['x:2111107000549380582', 'x:2111143110826975343', 'x:2111166141418832079', 'x:2111185450937323800', 'x:2111215684923375796', 'x:2111220284242215023', 'x:2111263907297788052', 'x:2111341668100133025']),
];

test('★ "Not a narrative" stays said: held on its posts, lifted only by posts the owner never saw in it', () => {
  const calls = foldNarrativeCalls(TAPS);
  const shown = (id: string, members: readonly string[], single = false) => narrativeShown(members.length, single, hiddenByOwner(id, members, calls, P), P);
  /* Live after the taps: the same ids, shrunk to one of the hidden posts each, found huge and climbing. */
  assert.equal(shown('n-x:2111107000549380582', ['x:2111263907297788052'], true), 'hidden_by_owner');
  assert.equal(shown('n-x:2111150219731603874', ['x:2111187936485982496'], true), 'hidden_by_owner');
  /* A regroup that gives the hidden posts a new id is still the narrative he hid. */
  assert.equal(shown('n-x:2111143110826975343', ['x:2111143110826975343', 'x:2111185450937323800']), 'hidden_by_owner');
  assert.equal(shown('n-x:2111155680799564037', ['x:2111155680799564037', 'x:2111164032933855527']), 'hidden_by_owner');
  /* One new post beside a hidden one is not a different story. */
  assert.equal(shown('n-x:2111150219731603874', ['x:2111187936485982496', 'x:new-1']), 'hidden_by_owner');
  /* `minPosts` posts he never saw in it is a different, bigger story, and it shows. Live: the
     narrative 1012's was merged into holds one of its posts and five others. */
  assert.equal(shown('n-x:2111150219731603874', ['x:2111187936485982496', 'x:new-1', 'x:new-2']), 'shown');
  assert.equal(shown('n-x:2111145801678532810', ['x:2111145801678532810', 'x:2111149725457981741', 'x:2111150463819165973', 'x:2111153823444017255', 'x:2111170394124333462', 'x:2111273748355514575']), 'shown');
  /* A narrative that holds none of the hidden posts is not touched. */
  assert.equal(shown('n-x:other', ['x:o1', 'x:o2']), 'shown');
  /* A call stored without its posts holds on its id. */
  const bare = foldNarrativeCalls([tap(1011, 'n-x:2111150219731603874', [])]);
  assert.equal(hiddenByOwner('n-x:2111150219731603874', ['x:a', 'x:b', 'x:c'], bare, P), true);
  assert.equal(hiddenByOwner('n-x:other', ['x:2111150219731603874', 'x:b'], bare, P), false);
});
