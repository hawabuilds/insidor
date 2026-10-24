/**
 * The stated name: the 23 Oct $BITCHES miss as the cases — the origin post (@TocRadio), the post
 * that said the name (@Na1_N1ako), the real coin and the copycat — and the rule that a stated coin
 * that clears the bars puts a look-alike holder out of the pick.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { launchMatches, oneCoinBars, pickOneCoin, statedNamesOf, type Contender, type LaunchSide, type MatchPost } from './one-coin.ts';
import { statedInText, statesName } from './stated-name.ts';

const P = DEFAULT_POLICY.oneCoin;
const S = DEFAULT_POLICY.runnerLink.stated;
const STATED = { minVariantLength: DEFAULT_POLICY.postCoin.minVariantLength, genericWords: S.genericWords };
const MATCH = { launchLeadMs: P.launchLeadMs, postWindowMs: P.postWindowMs, linkMaxAgeMs: P.linkMaxAgeMs, maxHashDistance: P.picture.maxHashDistance, minSimilarity: P.picture.minSimilarity, minVariantLength: STATED.minVariantLength, stated: { ...STATED, withinMs: S.withinMs } };
const MIN = 60_000;

const REAL = { name: 'You Missed Coin', ticker: 'BITCHES' };
const COPYCAT = { name: 'You Missed Bitches', ticker: 'YMB' };

/* @Na1_N1ako, 23 Oct 19:10 UTC, judged YOU MISSED COIN with BITCHES beside it. */
const NAMED: MatchPost = {
  itemId: 'x:2113709592987259358',
  postedAtMs: 1_000 * MIN,
  judgeNames: ['YOU MISSED COIN', 'BITCHES', 'YOU MISSED TRUMP', 'YOU MISSED THIS BITCHES'],
  guessNames: [],
  hash: null,
  text: 'The coin is officially called "You Missed Coin" so ticker should be BITCHES',
};
/* @TocRadio, the origin, judged YOU MISSED BITCHES. */
const ORIGIN: MatchPost = {
  itemId: 'x:2113693141609886045',
  postedAtMs: 1_000 * MIN,
  judgeNames: ['YOU MISSED BITCHES', 'GOLDCOIN', 'DESANTISCOIN', 'BIRDCOIN'],
  guessNames: [],
  hash: null,
  text: 'NEW: Gov. Ron DeSantis gifted POTUS a custom gold coin ... reads “YOU MISSED BITCHES”',
};

test('the post\'s own words state a name: quoted after "called", after "ticker", and a cashtag', () => {
  assert.deepEqual([...statedInText(NAMED.text)].sort(), ['BITCHES', 'You Missed Coin']);
  assert.deepEqual(statedInText('buy $PNUT now'), ['PNUT']);
  assert.deepEqual(statedInText(null), []);
});

test('★ the real coin states both posts\' names; the copycat states neither', () => {
  assert.equal(statesName(statedNamesOf(NAMED), REAL, STATED), true);
  assert.equal(statesName(statedNamesOf(NAMED), COPYCAT, STATED), false);
  /* The origin's "YOU MISSED BITCHES" is the real coin's name without "coin", then its ticker. */
  assert.equal(statesName(statedNamesOf(ORIGIN), REAL, STATED), true);
  /* The copycat has the origin's name but not its ticker: one half is what a copycat copies. */
  assert.equal(statesName(statedNamesOf(ORIGIN), COPYCAT, STATED), false);
});

test('a short ticker never states, and a name with no ticker never does', () => {
  assert.equal(statesName(['AI', 'Robot'], { name: 'Robot', ticker: 'AI' }, STATED), false);
  assert.equal(statesName(['Robot'], { name: 'Robot', ticker: null }, STATED), false);
  /* A ticker that is the name is one half said twice. */
  assert.equal(statesName(['Kimchi', 'KIMCHI'], { name: 'Kimchi', ticker: 'kimchi' }, STATED), false);
  assert.equal(statesName(['Laura'], { name: 'Laura Coin', ticker: 'LAURA' }, STATED), false);
});

test('★ matcher: the stated coin ties as name_stated, past the six-hour window and up to two days', () => {
  const coin = (launchedAtMs: number, c: { name: string; ticker: string }): LaunchSide => ({ address: 'C', launchedAtMs, ...c, linksPosts: new Set(), hash: null, similarity: new Map() });
  assert.deepEqual(launchMatches(coin(1_071 * MIN, REAL), [NAMED], MATCH)[0]?.evidence, ['name_judge', 'name_stated']);
  assert.deepEqual(launchMatches(coin(1_071 * MIN, REAL), [ORIGIN], MATCH)[0]?.evidence, ['name_stated']);
  const late = 1_000 * MIN + P.postWindowMs + 60 * MIN;
  assert.deepEqual(launchMatches(coin(late, REAL), [NAMED], MATCH)[0]?.evidence, ['name_judge', 'name_stated']);
  assert.equal(launchMatches(coin(late, COPYCAT), [ORIGIN], MATCH).length, 0);
  assert.equal(launchMatches(coin(1_000 * MIN + S.withinMs + MIN, REAL), [NAMED], MATCH).length, 0);
  /* Without the stated bars, as before v153: an exact name still ties, the stated tie does not exist. */
  const { stated: _, ...plain } = MATCH;
  assert.deepEqual(launchMatches(coin(1_071 * MIN, REAL), [NAMED], plain)[0]?.evidence, ['name_judge']);
});

const BARS = oneCoinBars(P);
const reading = (capUsd: number) => ({ capUsd, peakCapUsd: capUsd, liquidityUsd: null });
const contender = (address: string, launchedAtMs: number, evidence: Contender['evidence'], capUsd: number | null): Contender => ({ address, launchedAtMs, evidence, trades: null, market: capUsd === null ? null : reading(capUsd) });

test('★ rule: a held look-alike is out once a stated coin clears the bars and trades more; never for a weaker stated copy', () => {
  const now = 1_100 * MIN;
  const copycat = contender('YMB', 991 * MIN, ['name_judge'], 40_000);
  const holder = { address: 'YMB', sinceMs: 1_008 * MIN };
  /* The stated coin not read yet, or under the bars: the copycat stays the pick. */
  const unread = pickOneCoin([copycat, contender('BITCHES', 1_071 * MIN, ['name_judge', 'name_stated'], null)], holder, now, false, BARS);
  assert.equal(unread.kind === 'picked' && unread.address, 'YMB');
  const under = pickOneCoin([copycat, contender('BITCHES', 1_071 * MIN, ['name_judge', 'name_stated'], 9_000)], holder, now, false, BARS);
  assert.equal(under.kind === 'picked' && under.address, 'YMB');
  /* A stated copy over the bars but trading less than the look-alike: the look-alike keeps it. */
  const weaker = pickOneCoin([copycat, contender('COPY', 1_011 * MIN, ['name_judge', 'name_stated'], 16_000)], holder, now, false, BARS);
  assert.equal(weaker.kind === 'picked' && weaker.address, 'YMB');
  /* Trading more, though well under three times the holder: the pick re-opens and goes to it. */
  const over = pickOneCoin([copycat, contender('BITCHES', 1_071 * MIN, ['name_judge', 'name_stated'], 60_000)], holder, now, false, BARS);
  assert.equal(over.kind, 'picked');
  if (over.kind === 'picked') {
    assert.equal(over.address, 'BITCHES');
    assert.equal(over.handedOverFrom, 'YMB');
    assert.equal(over.standings.find((s) => s.address === 'YMB')?.out, 'behind_stated');
  }
});

test('rule: a coin the creators linked still competes beside the stated coin on the plain rule', () => {
  const now = 1_100 * MIN;
  const linked = contender('L', 1_020 * MIN, ['link'], 400_000);
  const stated = contender('BITCHES', 1_071 * MIN, ['name_stated'], 30_000);
  const o = pickOneCoin([linked, stated], null, now, false, BARS);
  assert.equal(o.kind === 'picked' && o.address, 'L');
});
