/** The learned-examples block: a fixed split by id, the owner's newest call wins, balanced and capped, and a block applied only when the gate holds and it catches no fewer missed posts than live. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { atCutoff, buildBlock, caught, changed, chooseCutoff, coinedYes, currentCalls, gate, goalsText, isExample, latestSlot, missedCaught, parseFloor, withRulebook, ratesOf, regressions, strictestKeeping, sweepCutoff, type CoinedPost, type GradedPost, type OwnerCall } from './examples.ts';

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

test('★ a post on the always-teach list is taught, first, whatever its hash, and so never tested', () => {
  const missed = ids(30, 'k').map((id, i) => call(id, 'meme', 'missed', i));
  const heldOut = missed.find((m) => !isExample(m.itemId))!;
  assert.equal(isExample(heldOut.itemId, [heldOut.itemId]), true);
  /* The oldest of 30 and two yes places (a cap of 4): it still goes in, ahead of the newest. */
  const b = buildBlock([...missed, call('x:n', 'not', 'tap', 99)], [], 4, { alwaysTeach: [heldOut.itemId] });
  assert.equal(b.exampleIds[0], heldOut.itemId);
  assert.ok(!b.testMissed.some((m) => m.itemId === heldOut.itemId), 'out of the held-out missed set');
  assert.ok(buildBlock(missed, [], 120).testMissed.some((m) => m.itemId === heldOut.itemId), 'without the list it is tested');
});

const MIN = 60_000;
const coinedPost = (itemId: string, over: Partial<CoinedPost> = {}): CoinedPost => ({ itemId, text: `news ${itemId}`, imageUri: null, postedAt: 1_000 * MIN, coins: 2, firstLateAt: 1_015 * MIN, kind: null, ...over });

test('★ coined posts taught as yes: late, by several coins, never the owner\'s, hand gold, crypto talk, a reply or a held kind', () => {
  const picked = coinedYes([
    coinedPost('x:ok'),
    coinedPost('x:tragedy', { kind: 'TRAGEDY', text: 'a fire took a school' }),
    coinedPost('x:one', { coins: 1 }),
    coinedPost('x:quick', { firstLateAt: 1_005 * MIN }),
    coinedPost('x:owner'),
    coinedPost('x:tag', { text: 'buy $FROG now' }),
    coinedPost('x:word', { text: 'my token is live' }),
    coinedPost('x:reply', { text: '@someone get well soon' }),
    coinedPost('x:sport', { kind: 'SPORT' }),
  ], DEFAULT_POLICY, new Set(['x:owner']));
  assert.deepEqual(picked.map((c) => c.itemId).sort(), ['x:ok', 'x:tragedy'], 'a tragedy is not held, so it is taught');
  assert.ok(picked.every((c) => c.label === 'meme' && c.from === 'coined'));
  assert.match(picked[0]!.why, /2 coins launched for it, the first 15 minutes after it was posted/);
  const many = Array.from({ length: 30 }, (_, i) => coinedPost(`x:c${i}`, { postedAt: i * MIN, firstLateAt: i * MIN + 20 * MIN }));
  const capped = coinedYes(many, DEFAULT_POLICY, new Set());
  assert.equal(capped.length, L.coinedYes.maxPerBlock);
  assert.equal(capped[0]!.itemId, 'x:c29', 'newest first');
  const off = { ...DEFAULT_POLICY, learning: { ...L, coinedYes: { ...L.coinedYes, on: false } } };
  assert.deepEqual(coinedYes(many, off, new Set()), [], 'the switch');
});

test('coined yes examples take their room in the block first, in their own section, and are never tested', () => {
  const nots = ids(200, 'n').map((id, i) => call(id, 'not', 'tap', i));
  const coined = coinedYes([coinedPost('x:k1'), coinedPost('x:k2', { postedAt: 999 * MIN })], DEFAULT_POLICY, new Set());
  const b = buildBlock([call('x:m', 'meme', 'tap', 1), ...nots], [], 20, { coinedYes: coined });
  assert.equal(b.exampleIds.length, 20);
  assert.equal(b.used.coined, 2);
  assert.ok(b.exampleIds.includes('x:k1') && b.exampleIds.includes('x:k2'));
  assert.match(b.text, /YES — not the owner's calls: posts several people coined/);
  assert.equal(b.taps.taught + b.taps.tested, 201, 'the owner\'s taps the coined posts made room for are tested, not dropped');
  const owned = buildBlock([call('x:k1', 'not', 'tap', 1)], [], 20, { coinedYes: coined });
  assert.ok(!owned.text.includes('"news x:k1" — 2 coins'), "the owner's call on a post wins over its coins");
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

test('★ missed posts are counted overall: a lost one is named, fewer caught than live is refused', () => {
  const r = regressions(new Map([['x:1', true], ['x:2', true], ['x:3', false], ['x:4', true]]), new Map([['x:1', false], ['x:2', true], ['x:3', false], ['x:4', null]]));
  assert.deepEqual(r, ['x:1'], 'a caught post now failing; not one never caught, not one left unanswered');
  assert.equal(gate({ ...ok, missed: { passed: 2, tested: 2 }, regressions: r }, L).apply, true, 'one lost, more caught overall: applied');
  assert.equal(gate({ ...ok, missed: { passed: 1, tested: 2 }, regressions: r }, L).apply, true, 'as many as live');
  const fewer = gate({ ...ok, missed: { passed: 0, tested: 2 }, regressions: r }, L);
  assert.equal(fewer.apply, false);
  assert.match(fewer.why ?? '', /missed posts caught 0\/2 are fewer than live's 1\/2/);
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

test('★ rule A: the strictest cutoff with gold and missed caught at least live and fewer non-memes', () => {
  /* Live: gold 2/3, junk 2/3, missed m1 caught. New: more gold, more junk, but its junk is less sure. */
  const live = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.8), no('g3', 'gold'), yes('n1', 'live-not', 0.9), yes('n2', 'live-not', 0.75), no('n3', 'live-not'), yes('m1', 'missed', 0.85)];
  const mine = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.88), yes('g3', 'gold', 0.8), yes('n1', 'live-not', 0.74), yes('n2', 'live-not', 0.72), yes('n3', 'live-not', 0.73), yes('m1', 'missed', 0.86)];
  const c = sweep(mine, live);
  assert.equal(c.rule, 'A');
  /* At 0.80 gold is 3/3 and junk 0/3; the strictest with gold ≥ 2/3 and m1 kept is 0.86. */
  assert.equal(c.cutoff, 0.86);
  assert.deepEqual([c.point.hand.passed, c.point.negatives.passed, c.point.missed.passed, c.point.lost.length], [3, 0, 1, 0]);
});

test('rule B: junk no worse than live with more gold and missed caught no fewer, when no cutoff gives less junk', () => {
  const live = [yes('g1', 'gold', 0.9), no('g2', 'gold'), yes('n1', 'live-not', 0.95)];
  const mine = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.8), yes('n1', 'live-not', 0.95)];
  const c = sweep(mine, live);
  assert.equal(c.rule, 'B');
  assert.deepEqual([c.point.hand.passed, c.point.negatives.passed], [2, 1]);
});

test("★ refused when fewer missed posts are caught than live: no cutoff can bring them back", () => {
  const live = [yes('g1', 'gold', 0.9), yes('n1', 'live-not', 0.8), yes('m1', 'missed', 0.9)];
  const mine = [yes('g1', 'gold', 0.95), no('n1', 'live-not'), no('m1', 'missed')];
  const c = sweep(mine, live);
  assert.equal(c.rule, 'refused');
  assert.equal(c.cutoff, null);
  assert.deepEqual(c.point.lost, ['m1']);
  assert.match(c.why ?? '', /missed posts caught 0\/1 are fewer than live's 1\/1.*cannot bring back/);
});

test('★ a missed post lost is named, not a refusal, when as many or more are caught overall', () => {
  /* Live catches m1, not m2; the new block catches m2, not m1: 1 of 2 each side. */
  const live = [yes('g1', 'gold', 0.9), no('g2', 'gold'), yes('n1', 'live-not', 0.8), yes('m1', 'missed', 0.9), no('m2', 'missed')];
  const mine = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.9), no('n1', 'live-not'), no('m1', 'missed'), yes('m2', 'missed', 0.9)];
  const c = sweep(mine, live);
  assert.equal(c.rule, 'A');
  assert.deepEqual(c.point.lost, ['m1'], 'still named for the log and the alert');
});

/* Version 9, the re-tune of 2026-10-16 07:00 UTC, as its log line "retune cutoff sweep" gave it, 0.70 to 0.80. */
const v9Live = { hand: { passed: 65, tested: 117 }, negatives: { passed: 104, tested: 513 }, missed: { passed: 7, tested: 16 } };
const v9 = ([cutoff, gold, junk, missed, lost]: readonly [number, number, number, number, number]) => ({
  cutoff, hand: { passed: gold, tested: 117 }, negatives: { passed: junk, tested: 513 }, missed: { passed: missed, tested: 16 }, lost: Array.from({ length: lost }, (_, i) => `x:${i}`), extra: null,
});
const v9Points = ([
  [0.7, 71, 102, 10, 1], [0.71, 70, 98, 10, 1], [0.72, 70, 98, 10, 1], [0.73, 67, 88, 9, 2], [0.74, 67, 88, 9, 2], [0.75, 67, 88, 9, 2],
  [0.76, 60, 73, 6, 4], [0.77, 60, 72, 6, 4], [0.78, 60, 72, 6, 4], [0.79, 56, 67, 6, 4], [0.8, 56, 63, 6, 5],
] as const).map(v9);

test("★ version 9's numbers pass under the counted rule: rule A takes the strictest, 0.75; 0.71, applied by hand, passes too", () => {
  const c = chooseCutoff(v9Points, v9Live);
  assert.equal(c.rule, 'A');
  assert.equal(c.cutoff, 0.75, 'gold 67 ≥ 65, junk 88 < 104, missed 9 ≥ 7; at 0.76 gold falls to 60');
  assert.equal(c.point.lost.length, 2, 'the two lost missed posts are still named');
  const to071 = chooseCutoff(v9Points.filter((p) => p.cutoff <= 0.71), v9Live);
  assert.deepEqual([to071.rule, to071.cutoff], ['A', 0.71], 'gold 70, junk 98, missed 10 against live 65 / 104 / 7');
  /* Rule B's floor, the owner's "(gold better, junk no worse)": 0.71 holds it with junk equal to live's. */
  const onlyB = chooseCutoff([v9Points[1]!], { ...v9Live, negatives: { passed: 98, tested: 513 } });
  assert.deepEqual([onlyB.rule, onlyB.cutoff], ['B', 0.71]);
});

test('refused when every cutoff with less junk loses gold', () => {
  const live = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.9), yes('n1', 'live-not', 0.8)];
  const mine = [yes('g1', 'gold', 0.9), yes('g2', 'gold', 0.75), yes('n1', 'live-not', 0.95), yes('n2', 'live-not', 0.8)];
  assert.equal(sweep(mine, live).rule, 'refused');
});

test("★ --floor: the main judge's stored numbers, read as passed/tested and compared as shares", () => {
  const floor = parseFloor('70/117,98/513,10/16');
  assert.deepEqual(floor, { hand: { passed: 70, tested: 117 }, negatives: { passed: 98, tested: 513 }, missed: { passed: 10, tested: 16 } });
  assert.equal(parseFloor(null), null);
  assert.throws(() => parseFloor('70/117,98/513'), /gold,junk,missed/);
  assert.throws(() => parseFloor('70/0,98/513,10/16'), /gold,junk,missed/);
  /* A set grown since (140 gold, 600 junk, 20 missed) is held to the same shares. */
  const grown = (cutoff: number, gold: number, junk: number, missed: number) => ({ cutoff, hand: { passed: gold, tested: 140 }, negatives: { passed: junk, tested: 600 }, missed: { passed: missed, tested: 20 }, lost: [], extra: null });
  const points = [grown(0.7, 90, 130, 14), grown(0.74, 84, 110, 13), grown(0.78, 83, 100, 12), grown(0.82, 70, 80, 10)];
  /* 84/140 = 0.600 >= 70/117 = 0.598, 13/20 >= 10/16; at 0.78, 83/140 = 0.593 is under the floor. */
  assert.equal(strictestKeeping(points, floor!)?.cutoff, 0.74);
  const c = chooseCutoff(points, floor!);
  assert.deepEqual([c.rule, c.cutoff], ['A', 0.74], 'and its junk, 110/600 = 0.183, is under 98/513 = 0.191: rule A takes the same point');
  const dearer = points.map((p) => ({ ...p, negatives: { passed: 130, tested: 600 } }));
  assert.equal(strictestKeeping(dearer, floor!)?.cutoff, 0.74, 'item 4 names the point whatever its junk');
  assert.equal(chooseCutoff(dearer, floor!).rule, 'refused', "and the owner's rule refuses it when its junk is over the floor's");
});

test('the rulebook goes after the examples under its heading; the posts held out do not move', () => {
  const calls: OwnerCall[] = [{ itemId: 'x:1', text: 'a dog in a suit', imageUri: null, label: 'meme', why: 'funny', at: 1, from: 'tap' }];
  const block = buildBlock(calls, [], 10);
  const ruled = withRulebook(block, 'RULES:', '- Ads are no.');
  assert.ok(ruled.text.startsWith(block.text));
  assert.ok(ruled.text.endsWith('RULES:\n- Ads are no.'));
  assert.deepEqual([ruled.exampleIds, ruled.testNegatives, ruled.testMissed], [block.exampleIds, block.testNegatives, block.testMissed]);
  assert.equal(withRulebook(block, 'RULES:', null), block, 'none written: the block alone');
});
