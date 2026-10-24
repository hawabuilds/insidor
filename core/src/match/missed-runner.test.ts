/**
 * The missed runner's post, on the 23 Oct $BITCHES case: of the posts that tie "You Missed Coin",
 * the origin (@TocRadio, 84.5k reach) beats the 21-view promos that state the name too; a post in
 * another language ties through its translation; a picture alone ranks under every name.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { rankRunnerPosts, runnerTies, type RunnerPost } from './missed-runner.ts';

const BARS = { minVariantLength: DEFAULT_POLICY.postCoin.minVariantLength, genericWords: DEFAULT_POLICY.runnerLink.stated.genericWords, minSimilarity: DEFAULT_POLICY.oneCoin.picture.minSimilarity, originShareOfTop: DEFAULT_POLICY.runnerLink.missed.originShareOfTop };
const COIN = { name: 'You Missed Coin', ticker: 'BITCHES' };
const MIN = 60_000;
const base = (o: Partial<RunnerPost>): RunnerPost => ({ itemId: 'x', postedAtMs: 0, judgeNames: [], guessNames: [], hash: null, text: null, textEn: null, reach: null, pictureSimilarity: null, ...o });

const ORIGIN = base({ itemId: 'x:2113693141609886045', postedAtMs: 1_084 * MIN, judgeNames: ['YOU MISSED BITCHES', 'GOLDCOIN'], text: 'a custom gold coin ... reads “YOU MISSED BITCHES”', reach: 84_508 });
const NAMED = base({ itemId: 'x:2113709592987259358', postedAtMs: 1_150 * MIN, judgeNames: ['YOU MISSED COIN', 'BITCHES'], text: 'The coin is officially called "You Missed Coin" so ticker should be BITCHES', reach: 21 });
const PROMO = base({ itemId: 'x:2113707399198503265', postedAtMs: 1_141 * MIN, judgeNames: ['YOU MISSED BITCHES', 'TRUMPCOIN'], text: "TRUMP JUST SHOWED A NEW COIN ''YOU MISSED BITCHES''", reach: 300 });
const OTHER = base({ itemId: 'x:other', postedAtMs: 1_100 * MIN, judgeNames: ['GOLD'], text: 'gold is up', reach: 900_000 });

test('★ the origin post, not the small promos, is the coin\'s post', () => {
  const ranked = rankRunnerPosts([NAMED, PROMO, OTHER, ORIGIN], COIN, BARS);
  assert.deepEqual(ranked.map((r) => r.itemId), [ORIGIN.itemId, PROMO.itemId, NAMED.itemId]);
  assert.deepEqual(ranked[0]?.ties, ['name_stated']);
  assert.deepEqual(runnerTies(NAMED, COIN, BARS), ['name_stated', 'name_judge']);
  assert.deepEqual(runnerTies(OTHER, COIN, BARS), []);
});

test('★ the origin over a later, bigger retelling: the earliest post with half the biggest one\'s reach', () => {
  /* @LauraLoomer, 19:31 UTC, 111.7k when last read, judged YOU MISSED BITCHES too. */
  const laura = base({ itemId: 'x:2113715070672707623', postedAtMs: 1_171 * MIN, judgeNames: ['YOU MISSED BITCHES'], reach: 111_672 });
  assert.deepEqual(rankRunnerPosts([laura, NAMED, ORIGIN], COIN, BARS).map((r) => r.itemId), [ORIGIN.itemId, laura.itemId, NAMED.itemId]);
  /* A retelling ten times the size is the post people saw. */
  const huge = { ...laura, reach: 900_000 };
  assert.equal(rankRunnerPosts([huge, ORIGIN], COIN, BARS)[0]?.itemId, laura.itemId);
});

test('a post in another language ties through its English translation', () => {
  const fr = base({ itemId: 'x:fr', judgeNames: ['YOU MISSED'], text: 'la pièce dit “vous avez raté”', textEn: 'the coin reads "You Missed" ... ticker BITCHES' });
  assert.ok(runnerTies(fr, COIN, BARS).length > 0);
});

test('a picture alone ties, and ranks under every name whatever its reach', () => {
  const pic = base({ itemId: 'x:pic', pictureSimilarity: 0.95, reach: 5_000_000 });
  const ranked = rankRunnerPosts([pic, NAMED], COIN, BARS);
  assert.deepEqual(ranked.map((r) => r.itemId), [NAMED.itemId, 'x:pic']);
  assert.deepEqual(runnerTies(base({ pictureSimilarity: 0.5 }), COIN, BARS), []);
});
