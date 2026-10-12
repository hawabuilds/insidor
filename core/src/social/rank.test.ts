/**
 * ★ The ranks, thresholds and multipliers are Trador's, number for number, and the rules around
 * them hold: GOAT needs the percentile, a voter's twenty-first like of the day earns nothing,
 * a fall is never announced.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { boughtEarly, earnsRep, goatCount, nextRank, rankFor, rankedUp, seasonOf, standings, votePoints } from './rank.ts';

const P = DEFAULT_POLICY.social;

test("★ Trador's ladder: Intern 0, Analyst 250, Quant 1,000, Wolf 5,000, GOAT the top 1%", () => {
  assert.deepEqual(P.rankRep, { intern: 0, analyst: 250, quant: 1_000, wolf: 5_000, goat: 5_000 });
  assert.deepEqual(P.rankMultiplier, { intern: 1, analyst: 1.25, quant: 1.5, wolf: 1.75, goat: 2 });
  assert.equal(P.votePoints, 10);
  assert.equal(P.proofBoost, 1.25);
  assert.equal(P.earlyBoost, 1.5);
  assert.equal(P.earlyBuyMultiple, 3);
  assert.equal(P.dailyVoteCap, 20);
  assert.equal(P.goatPercentile, 0.01);
  assert.equal(rankFor({ rep: 0, percentile: null }, P), 'intern');
  assert.equal(rankFor({ rep: 249.99, percentile: 0.5 }, P), 'intern');
  assert.equal(rankFor({ rep: 250, percentile: 0.5 }, P), 'analyst');
  assert.equal(rankFor({ rep: 1_000, percentile: 0.5 }, P), 'quant');
  assert.equal(rankFor({ rep: 5_000, percentile: 0.5 }, P), 'wolf');
  assert.equal(rankFor({ rep: 5_000, percentile: 0 }, P), 'goat');
  assert.equal(rankFor({ rep: 4_999, percentile: 0 }, P), 'quant', 'the top of the season below Wolf rep is not GOAT');
});

test("★ a like is 10 points times the voter's rank, ×1.25 with proof, ×1.5 when the author bought early", () => {
  assert.equal(votePoints({ voterRank: 'intern', proof: false, early: false }, P), 10);
  assert.equal(votePoints({ voterRank: 'goat', proof: false, early: false }, P), 20);
  assert.equal(votePoints({ voterRank: 'analyst', proof: true, early: false }, P), 15.63);
  assert.equal(votePoints({ voterRank: 'wolf', proof: true, early: true }, P), 32.81);
});

test('★ the twenty-first like of a UTC day earns nothing', () => {
  assert.equal(earnsRep(19, P), true);
  assert.equal(earnsRep(20, P), false);
});

test('early is under three times the earliest price, and unknown is never early', () => {
  assert.equal(boughtEarly(2.9, 1, P), true);
  assert.equal(boughtEarly(3, 1, P), false);
  assert.equal(boughtEarly(null, 1, P), false);
  assert.equal(boughtEarly(1, null, P), false);
});

test('GOAT is the top 1% of the ranked, at least one; the unranked are not counted', () => {
  assert.equal(goatCount(0, P), 0);
  assert.equal(goatCount(50, P), 1);
  assert.equal(goatCount(250, P), 2);
  const s = standings([{ userId: 'a', rep: 9_000 }, { userId: 'b', rep: 6_000 }, { userId: 'c', rep: 0 }], P);
  assert.equal(s.get('a')?.percentile, 0);
  assert.equal(s.get('b')?.percentile, 1);
  assert.equal(s.get('c'), undefined);
  assert.equal(rankFor(s.get('b') ?? { rep: 0, percentile: null }, P), 'wolf', 'overtaken: Wolf, not GOAT');
});

test('the next rung never names GOAT, and only a rise is a rank-up', () => {
  assert.deepEqual(nextRank(100, P), { rank: 'analyst', repToGo: 150 });
  assert.deepEqual(nextRank(4_000.5, P), { rank: 'wolf', repToGo: 1_000 });
  assert.equal(nextRank(6_000, P), null);
  assert.equal(rankedUp('analyst', 'quant'), true);
  assert.equal(rankedUp('goat', 'wolf'), false);
});

test('seasons are calendar months from the epoch, season one first', () => {
  const epoch = { year: 2026, month: 9 };
  assert.equal(seasonOf({ year: 2026, month: 9 }, epoch), 1);
  assert.equal(seasonOf({ year: 2027, month: 0 }, epoch), 4);
  assert.equal(seasonOf({ year: 2026, month: 3 }, epoch), 1, 'before the epoch is season one');
});
