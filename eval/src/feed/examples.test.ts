/** The learned-examples block: a fixed split by id, the owner's newest call wins, balanced and capped, and a block applied only when the gate holds and no caught missed post regresses. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { atCutoff, buildBlock, caught, changed, currentCalls, gate, goalsText, isExample, latestSlot, missedCaught, ratesOf, regressions, sweepCutoff, type GradedPost, type OwnerCall } from './examples.ts';

const L = DEFAULT_POLICY.learning;
const call = (itemId: string, label: 'meme' | 'not', from: OwnerCall['from'], at: number | null = null): OwnerCall => ({ itemId, text: `post ${itemId}`, imageUri: null, label, why: 'because', at, from });
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `x:${prefix}${i}`);

test('★ the split is the id alone: the same post lands on the same side whatever else is in the set', () => {
  const nots = ids(40, 'n').map((id) => call(id, 'not', 'labels'));
  const a = buildBlock(nots, [], 120);
  const b = buildBlock(nots.slice(0, 10), [], 120);
  for (const id of b.exampleIds) assert.ok(a.exampleIds.includes(id));
  for (const p of [...a.testNegatives]) assert.equal(isExample(p.itemId), false);
  assert.ok(a.testNegatives.length > 0 && a.exampleIds.length > 0);
});

test("a tap beats the labels file, and the owner's newest tap beats an older one", () => {
  const cur = currentCalls([call('x:1', 'meme', 'labels'), call('x:1', 'not', 'tap', 1), call('x:1', 'meme', 'tap', 2), call('x:2', 'meme', 'missed', 5), call('x:2', 'not', 'tap', 1)]);
  assert.deepEqual(cur.map((c) => [c.itemId, c.label, c.from]).sort(), [['x:1', 'meme', 'tap'], ['x:2', 'not', 'tap']]);
});

test('balanced and capped: a short side leaves its room to the other, newest first', () => {
  const memes = ids(5, 'm').map((id, i) => call(id, 'meme', 'labels', i));
  const nots = ids(400, 'n').map((id, i) => call(id, 'not', 'tap', i));
  const b = buildBlock([...memes, ...nots], [], 20);
  assert.equal(b.exampleIds.length, 20);
  assert.equal(b.used.labels, 5, 'every meme goes in');
  assert.equal(b.used.taps, 15, 'the no side takes the room the memes left');
  const newest = nots.filter((n) => isExample(n.itemId)).sort((x, y) => (y.at ?? 0) - (x.at ?? 0)).slice(0, 15).map((n) => n.itemId);
  assert.deepEqual(nots.filter((n) => b.exampleIds.includes(n.itemId)).map((n) => n.itemId).sort(), newest.sort(), 'the newest no examples of the taught half');
});

test('★ no tap is dropped: a call the cap leaves out of the block is tested instead', () => {
  const memes = ids(30, 'm').map((id, i) => call(id, 'meme', 'tap', i));
  const nots = ids(400, 'n').map((id, i) => call(id, 'not', 'tap', i));
  const b = buildBlock([...memes, ...nots], [], 20);
  assert.equal(b.exampleIds.length, 20);
  assert.equal(b.taps.taught + b.taps.tested, 430, 'every tap is an example or tested');
  const used = new Set([...b.exampleIds, ...b.testNegatives.map((c) => c.itemId), ...b.testMemes.map((c) => c.itemId)]);
  for (const c of [...memes, ...nots]) assert.ok(used.has(c.itemId), c.itemId);
  for (const c of [...b.testNegatives, ...b.testMemes]) assert.ok(!b.exampleIds.includes(c.itemId), 'never both taught and tested');
});

test("missed posts are split like non-memes: half taught, half held back to test", () => {
  const missed = ids(30, 'k').map((id) => call(id, 'meme', 'missed'));
  const b = buildBlock(missed, [], 120);
  assert.equal(b.used.missed + b.testMissed.length, 30);
  assert.ok(b.testMissed.every((m) => !b.exampleIds.includes(m.itemId)));
});

test("the owner's names go in a names section", () => {
  const b = buildBlock([call('x:1', 'meme', 'tap')], [{ itemId: 'x:1', text: 'a frog in a hat', name: 'FROG', verdict: 'down', betterName: 'HATFROG', at: 1 }], 120);
  assert.match(b.text, /NAMES/);
  assert.match(b.text, /the owner's name: "HATFROG"/);
  assert.equal(b.used.names, 1);
});

const live = { hand: { passed: 28, tested: 41 }, negatives: { passed: 4, tested: 90 }, missed: { passed: 1, tested: 2 } };
const ok = { hand: { passed: 30, tested: 41 }, negatives: { passed: 2, tested: 90 }, missed: { passed: 0, tested: 0 }, regressions: [] as string[], live };

test('★ applied when it beats live on hand gold AND on non-memes; a tie on either is not an improvement', () => {
  assert.equal(gate(ok, L).apply, true);
  assert.equal(gate({ ...ok, hand: { passed: 28, tested: 41 } }, L).apply, false, 'equal gold');
  assert.equal(gate({ ...ok, negatives: { passed: 4, tested: 90 } }, L).apply, false, 'equal non-memes');
  assert.equal(gate({ ...ok, hand: { passed: 27, tested: 41 } }, L).apply, false);
  assert.equal(gate({ ...ok, live: null }, L).apply, false, 'nothing to beat');
  assert.equal(gate({ ...ok, hand: { passed: 0, tested: 0 } }, L).apply, false);
});

test('★ the 65% / 15% / 50% bars are the goal: reported met or not met, never a block', () => {
  const below = { ...ok, hand: { passed: 20, tested: 41 }, negatives: { passed: 20, tested: 90 }, live: { ...live, hand: { passed: 18, tested: 41 }, negatives: { passed: 25, tested: 90 } } };
  const v = gate(below, L);
  assert.equal(v.apply, true, 'an improvement under the goal is applied');
  assert.deepEqual(v.goals, { hand: false, negatives: false, missed: null });
  assert.match(goalsText(below, L), /hand gold 49% of 65% \(not met\), live non-memes 22% of at most 15% \(not met\), missed — of 50% \(not tested\)/);
  assert.deepEqual(gate(ok, L).goals, { hand: true, negatives: true, missed: null });
});

test('★ no block is applied that makes a missed post the judge in use catches fail', () => {
  const r = regressions(new Map([['x:1', true], ['x:2', true], ['x:3', false], ['x:4', true]]), new Map([['x:1', false], ['x:2', true], ['x:3', false], ['x:4', null]]));
  assert.deepEqual(r, ['x:1'], 'a caught post now failing; not one never caught, not one left unanswered');
  const v = gate({ ...ok, regressions: r }, L);
  assert.equal(v.apply, false);
  assert.match(v.why ?? '', /1 missed post caught now would fail: x:1/);
});

const g = (id: string, group: string, firstPass: boolean, kind: string | null, coinable: boolean | null = firstPass): GradedPost => ({ id, group, coinable, firstPass, kind });

test('hand gold is one set whatever its kind; a held kind keeps a post off the feed only when policy holds it; auto gold is reported, never gated', () => {
  const rows = [
    g('a', 'gold', true, null), g('b', 'gold', true, 'OTHER'), g('c', 'gold', false, null), g('d', 'gold', true, 'TRAGEDY'),
    g('e', 'missed', true, 'SPORT'), g('f', 'gold', true, 'AD'), g('u', 'gold', false, null, null),
    g('n1', 'live-not', true, 'SHOWBIZ'), g('n2', 'live-not', true, null), g('n3', 'live-not', false, null),
    g('z', 'auto', true, 'CORP_NEWS'),
  ];
  const groups = { hand: ['gold', 'missed'], auto: 'auto', negatives: 'live-not', missed: 'missed' };
  const adsOnly = ratesOf(rows, ['AD'], groups);
  assert.deepEqual(adsOnly.hand, { passed: 4, tested: 6 }, 'news and a tragedy count when the first question passed; an ad does not; unanswered is out');
  assert.deepEqual(adsOnly.negatives, { passed: 2, tested: 3 });
  assert.deepEqual(adsOnly.auto, { passed: 1, tested: 1 });
  const old = ratesOf(rows, ['AD', 'SPORT', 'FANDOM', 'SHOWBIZ', 'POLITICS'], groups);
  assert.deepEqual([old.hand.passed, old.negatives.passed, old.missed.passed], [3, 1, 0]);
  const none = ratesOf(rows, [], groups);
  assert.deepEqual(none.hand, { passed: 5, tested: 6 }, 'no kind gate: the first question alone decides');
  assert.equal(caught(g('t', 'gold', true, 'TRAGEDY'), ['TRAGEDY']), false);
  assert.equal(caught(g('t', 'gold', true, 'TRAGEDY'), ['AD']), true);
  assert.equal(caught(g('t', 'gold', true, 'MADE_UP'), ['MADE_UP']), true, 'a label core does not know holds nothing');
});

test('what changed: added and removed example ids', () => {
  assert.deepEqual(changed(['a', 'b', 'c'], ['b', 'c', 'd', 'e']), { added: 2, removed: 1 });
});

test('the re-tune slot is the latest 08:00 or 20:00 London at or before now, through a clock change', () => {
  const times = ['08:00', '20:00'];
  const tz = 'Europe/London';
  /* Summer: London is UTC+1, so 08:00 London is 07:00Z. */
  assert.equal(new Date(latestSlot(Date.UTC(2026, 9, 13, 7, 30), times, tz)).toISOString(), '2026-10-13T07:00:00.000Z');
  assert.equal(new Date(latestSlot(Date.UTC(2026, 9, 13, 6, 59), times, tz)).toISOString(), '2026-10-12T19:00:00.000Z');
  assert.equal(new Date(latestSlot(Date.UTC(2026, 9, 13, 19, 0), times, tz)).toISOString(), '2026-10-13T19:00:00.000Z');
  /* Winter (after 25 October): London is UTC. */
  assert.equal(new Date(latestSlot(Date.UTC(2026, 10, 2, 9), times, tz)).toISOString(), '2026-11-02T08:00:00.000Z');
});

test("★ the crypto signal lifts a post the judge failed, never a held kind, and a shill never passes", () => {
  const others = { others: true, shill: false };
  assert.equal(inFeedOf(g('a', 'gold', false, null), others), true);
  assert.equal(inFeedOf(g('a', 'gold', false, 'SPORT'), others), false);
  assert.equal(inFeedOf(g('a', 'gold', true, null), { others: false, shill: true }), false);
  assert.equal(inFeedOf(g('a', 'gold', true, null), null), true, 'no facts: the judge alone');
});
const inFeedOf = (r: GradedPost, signal: { others: boolean; shill: boolean } | null) => ratesOf([{ ...r, signal }], ['AD', 'SPORT'], { hand: ['gold'], auto: 'auto', negatives: 'live-not', missed: 'missed' }).hand.passed === 1;

/* ── the new block's own cutoff ── */

const GROUPS = { hand: ['gold', 'missed'], auto: 'auto', negatives: 'live-not', missed: 'missed' } as const;
/** A "yes" at this confidence, on text, that passes the first question at the policy bar when confident enough. */
const yes = (id: string, group: string, confidence: number): GradedPost => ({
  id, group, coinable: true, firstPass: confidence >= DEFAULT_POLICY.qualify.minJudgeConfidence.text, kind: null, signal: null, similarity: null,
  answer: { coinable: true, confidence, lookedAt: 'text', proposedName: 'Cat' },
});
const no = (id: string, group: string): GradedPost => ({ id, group, coinable: false, firstPass: false, kind: null, signal: null, similarity: null, answer: { coinable: false, confidence: 0.9, lookedAt: 'text', proposedName: null } });
const bar = DEFAULT_POLICY.qualify.minJudgeConfidence.text;
const sweep = (rows: readonly GradedPost[], live: readonly GradedPost[]) =>
  sweepCutoff({ rows, live: ratesOf(live, [], GROUPS), liveCaught: missedCaught(live, []), from: bar, held: [], groups: GROUPS, policy: DEFAULT_POLICY });

test('a raised cutoff only removes passes, and keeps a post the judge did not answer as graded', () => {
  const rows = [yes('a', 'gold', 0.72), yes('b', 'gold', 0.9), { ...no('c', 'gold'), coinable: null, answer: null }];
  const at = atCutoff(rows, 0.8, DEFAULT_POLICY);
  assert.deepEqual(at.map((r) => r.firstPass), [false, true, false]);
  assert.equal(atCutoff(rows, null, DEFAULT_POLICY), rows);
});

test('★ rule A: the strictest cutoff with gold at least live, fewer non-memes and no missed post lost', () => {
  /* Live: gold 2/3, junk 2/3, missed m1 caught. New: more gold, more junk, but its junk is less sure. */
  const live = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.8), no('g3', 'gold'), yes('n1', 'live-not', 0.9), yes('n2', 'live-not', 0.75), no('n3', 'live-not'), yes('m1', 'missed', 0.85)];
  const mine = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.88), yes('g3', 'gold', 0.8), yes('n1', 'live-not', 0.74), yes('n2', 'live-not', 0.72), yes('n3', 'live-not', 0.73), yes('m1', 'missed', 0.86)];
  const c = sweep(mine, live);
  assert.equal(c.rule, 'A');
  /* At 0.80 gold is 3/3 and junk 0/3; the strictest with gold ≥ 2/3 and m1 kept is 0.86. */
  assert.equal(c.cutoff, 0.86);
  assert.deepEqual([c.point.hand.passed, c.point.negatives.passed, c.point.missed.passed, c.point.lost.length], [3, 0, 1, 0]);
});

test('rule B: junk no worse than live with more gold, when no cutoff gives less junk', () => {
  const live = [yes('g1', 'gold', 0.9), no('g2', 'gold'), yes('n1', 'live-not', 0.95)];
  const mine = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.8), yes('n1', 'live-not', 0.95)];
  const c = sweep(mine, live);
  assert.equal(c.rule, 'B');
  assert.deepEqual([c.point.hand.passed, c.point.negatives.passed], [2, 1]);
});

test("★ refused when a missed post live catches is answered \"no\": no cutoff can bring it back", () => {
  const live = [yes('g1', 'gold', 0.9), yes('n1', 'live-not', 0.8), yes('m1', 'missed', 0.9)];
  const mine = [yes('g1', 'gold', 0.95), no('n1', 'live-not'), no('m1', 'missed')];
  const c = sweep(mine, live);
  assert.equal(c.rule, 'refused');
  assert.equal(c.cutoff, null);
  assert.deepEqual(c.point.lost, ['m1']);
  assert.match(c.why ?? '', /cannot bring back/);
});

test('refused when every cutoff with less junk loses gold', () => {
  const live = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.9), yes('n1', 'live-not', 0.8)];
  const mine = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.75), yes('n1', 'live-not', 0.95), yes('n2', 'live-not', 0.8)];
  assert.equal(sweep(mine, live).rule, 'refused');
});
