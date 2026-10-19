/**
 * One post, one coin: the matcher's four ties (link, exact name, picture, timing) and the rule's
 * outcomes — a pick, a rug dropped, a hand-over only at three times, waiting, none, and the fallback
 * on readings saying so.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { biggestOfName, launchMatches, namedInText, oneCoinBars, pickOneCoin, type Contender, type LaunchSide, type MatchPost, type TradeFacts } from './one-coin.ts';
import { replayTimeline, scoreReplay, type ReplayCoin } from './one-coin-replay.ts';

const P = DEFAULT_POLICY.oneCoin;
const BARS = oneCoinBars(P);
const MIN = 60_000;
const MATCH = { launchLeadMs: P.launchLeadMs, postWindowMs: P.postWindowMs, maxHashDistance: P.picture.maxHashDistance, minSimilarity: P.picture.minSimilarity, minVariantLength: DEFAULT_POLICY.postCoin.minVariantLength };

const post = (o: Partial<MatchPost> = {}): MatchPost => ({ itemId: 'x:1', postedAtMs: 1_000 * MIN, judgeNames: ['Pancake'], guessNames: [], hash: null, ...o });
const coin = (o: Partial<LaunchSide> = {}): LaunchSide => ({ address: 'C1', launchedAtMs: 1_005 * MIN, name: 'Other', ticker: 'OTH', linksPosts: new Set(), hash: null, similarity: new Map(), ...o });

test('matcher: a link in the metadata ties the coin, whatever its name, and asks for its picture', () => {
  const [m] = launchMatches(coin({ linksPosts: new Set(['x:1']) }), [post()], MATCH);
  assert.deepEqual(m?.evidence, ['link']);
  assert.equal(m?.wantsPicture, true);
});

test('matcher: the exact judge name or the namer\'s ticker ties it; a variant does not', () => {
  assert.deepEqual(launchMatches(coin({ name: 'Pancake', ticker: 'PNCK' }), [post()], MATCH)[0]?.evidence, ['name_judge']);
  assert.deepEqual(launchMatches(coin({ name: 'x', ticker: 'PANCAT' }), [post({ guessNames: ['PANCAT'] })], MATCH)[0]?.evidence, ['name_guess']);
  assert.equal(launchMatches(coin({ name: 'Pancakes Inu' }), [post()], MATCH).length, 0);
});

test('matcher: a close picture hash alone ties it, and does not ask for an embedding; a far one does not', () => {
  const h = 'ffffffffffffffff';
  const [m] = launchMatches(coin({ hash: h }), [post({ hash: 'fffffffffffffff0' })], MATCH);
  assert.deepEqual(m?.evidence, ['picture']);
  assert.equal(m?.wantsPicture, false);
  assert.equal(launchMatches(coin({ hash: h }), [post({ hash: '0000000000000000' })], MATCH).length, 0);
  /* The embedding, once paid for on a name hit, adds the picture to the evidence. */
  const [e] = launchMatches(coin({ name: 'Pancake', similarity: new Map([['x:1', 0.9]]) }), [post()], MATCH);
  assert.deepEqual(e?.evidence, ['name_judge', 'picture']);
  assert.equal(e?.wantsPicture, false);
});

test('matcher: timing — up to ten minutes before the post counts, more does not; after the window does not', () => {
  const named = { name: 'Pancake' };
  assert.equal(launchMatches(coin({ ...named, launchedAtMs: 991 * MIN }), [post()], MATCH).length, 1);
  assert.equal(launchMatches(coin({ ...named, launchedAtMs: 989 * MIN }), [post()], MATCH).length, 0);
  assert.equal(launchMatches(coin({ ...named, launchedAtMs: 1_000 * MIN + P.postWindowMs + MIN }), [post()], MATCH).length, 0);
});

test('★ matcher: a short ticker ties through the post\'s own words — with the name, never alone', () => {
  /* 19 Oct: "Rip Kim Jong-Un" ($Kim) against the posts the judge named KIMJONG / KIMJONGUN. */
  const kim = post({ judgeNames: ['KIMJONG', 'KIMJONGUN'], text: '🚨#BREAKING: Unconfirmed reports claim Kim Jong Un may have "secretly died" in China.' });
  const esab = coin({ name: 'Rip Kim Jong-Un', ticker: 'Kim' });
  assert.deepEqual(launchMatches(esab, [kim], MATCH)[0]?.evidence, ['name_text']);
  /* The same three letters with no name, or a name that is not the post's subject: no tie. */
  assert.equal(launchMatches(coin({ name: null, ticker: 'Kim' }), [kim], MATCH).length, 0);
  assert.equal(launchMatches(coin({ name: 'Kimchi Bowl', ticker: 'KIM' }), [kim], MATCH).length, 0);
  /* The gorilla called Kim is not Kim Jong Un. */
  const gorilla = post({ judgeNames: ['KIM', 'KIMTHEGORILLA', 'GORILLARUNNER'], text: 'This is Kim The Gorilla and its going GIGA' });
  assert.equal(namedInText(gorilla, esab, MATCH), false);
  /* The full name as a phrase ties when the name is the post's subject; a phrase alone does not. */
  const rip = post({ judgeNames: ['KIMDOGE', 'RIPKIM'], text: 'Rip Kim Jong-un. Perfect time to send this meme' });
  assert.equal(namedInText(rip, coin({ name: 'Rip Kim Jong-Un', ticker: 'NK' }), MATCH), true);
  assert.equal(namedInText(post({ judgeNames: ['FRANCE'], text: 'Manon Meunier said on social media' }), coin({ name: 'Social Media', ticker: 'SOCIAL' }), MATCH), false);
  assert.equal(namedInText(post({ judgeNames: ['NEWS'], text: 'BREAKING: something happened' }), coin({ name: 'Breaking', ticker: 'BRK' }), MATCH), false);
  assert.equal(namedInText(post({ judgeNames: ['PUPPY'], text: 'look at the dog' }), coin({ name: 'The Dog', ticker: 'DOG' }), MATCH), false);
  /* An exact name is still the stronger tie, and an unread text is no tie. */
  assert.deepEqual(launchMatches(esab, [post({ guessNames: ['KIM'], text: kim.text ?? null })], MATCH)[0]?.evidence, ['name_guess']);
  assert.equal(namedInText(post({ judgeNames: ['KIMJONGUN'] }), esab, MATCH), false);
});

test('★ matcher: a link ties past the window — and through the coin\'s own quote of the post, one hop', () => {
  /* HI, 19 Oct: launched a day after the baby post, linking its account's quote of it. */
  const late = 1_000 * MIN + P.postWindowMs + 18 * 60 * MIN;
  const [direct] = launchMatches(coin({ launchedAtMs: late, linksPosts: new Set(['x:1']) }), [post()], MATCH);
  assert.deepEqual(direct?.evidence, ['link']);
  assert.equal(direct?.linkedThrough, null);
  const [quoted] = launchMatches(coin({ launchedAtMs: late, linksPosts: new Set(['x:quote']), linksThrough: new Map([['x:1', 'x:quote']]) }), [post()], MATCH);
  assert.deepEqual(quoted?.evidence, ['link']);
  assert.equal(quoted?.linkedThrough, 'x:quote');
  /* A name alone past the window is chance; a link still never reaches back before the post. */
  assert.equal(launchMatches(coin({ launchedAtMs: late, name: 'Pancake' }), [post()], MATCH).length, 0);
  assert.equal(launchMatches(coin({ launchedAtMs: 980 * MIN, linksThrough: new Map([['x:1', 'x:quote']]) }), [post()], MATCH).length, 0);
});

const trades = (o: Partial<TradeFacts>): TradeFacts => ({ uniqueBuyers: 40, netBuy: 30, capUsd: 40_000, cap: 200, peakCap: 220, creatorSold: false, ...o });
const c = (address: string, launchMin: number, t: Contender['trades'], o: Partial<Contender> = {}): Contender => ({ address, launchedAtMs: launchMin * MIN, evidence: ['name_judge'], trades: t, market: null, ...o });
const NOW = 1_020 * MIN;

test('★ the rule picks the coin people are buying: cap, buyers and three times every rival', () => {
  const o = pickOneCoin([c('A', 1_005, trades({})), c('B', 1_006, trades({ netBuy: 5, capUsd: 9_000 }))], null, NOW, true, BARS);
  assert.equal(o.kind, 'picked');
  assert.equal(o.kind === 'picked' && o.address, 'A');
  assert.equal(o.kind === 'picked' && o.basis, 'trades');
  assert.equal(o.kind === 'picked' && o.confirmed, true);
});

test('★ rugs are out: the creator sold, or the cap fell under 30% of its peak', () => {
  const sold = pickOneCoin([c('A', 1_005, trades({ creatorSold: true })), c('B', 1_006, trades({ netBuy: 2, capUsd: 9_000 }))], null, NOW, true, BARS);
  assert.equal(sold.kind, 'waiting');
  assert.equal(sold.kind === 'waiting' && sold.standings.find((s) => s.address === 'A')?.out, 'creator_sold');
  const fell = pickOneCoin([c('A', 1_005, trades({ cap: 50, peakCap: 500 }))], { address: 'A', sinceMs: 1_011 * MIN }, NOW, true, BARS);
  assert.equal(fell.kind, 'waiting');
  assert.equal(fell.kind === 'waiting' && fell.droppedHolder, 'A');
});

test('★ hand-over only at three times the holder\'s net buying', () => {
  const holder = { address: 'A', sinceMs: 1_011 * MIN };
  const kept = pickOneCoin([c('A', 1_005, trades({ netBuy: 30 })), c('B', 1_006, trades({ netBuy: 80 }))], holder, NOW, true, BARS);
  assert.equal(kept.kind === 'picked' && kept.address, 'A');
  assert.equal(kept.kind === 'picked' && kept.sinceMs, 1_011 * MIN);
  const handed = pickOneCoin([c('A', 1_005, trades({ netBuy: 30 })), c('B', 1_006, trades({ netBuy: 95 }))], holder, NOW, true, BARS);
  assert.equal(handed.kind === 'picked' && handed.address, 'B');
  assert.equal(handed.kind === 'picked' && handed.handedOverFrom, 'A');
});

test('waiting: too early, under the bars, no clear lead, a rival we could not measure', () => {
  assert.equal((pickOneCoin([c('A', 1_018, trades({}))], null, NOW, true, BARS) as { reason?: string }).reason, 'too_early');
  assert.equal((pickOneCoin([c('A', 1_005, trades({ uniqueBuyers: 3 }))], null, NOW, true, BARS) as { reason?: string }).reason, 'under_bars');
  assert.equal((pickOneCoin([c('A', 1_005, trades({})), c('B', 1_005, trades({ netBuy: 20 }))], null, NOW, true, BARS) as { reason?: string }).reason, 'no_clear_lead');
  /* A rival we could not measure sends the post to market readings, said in `basis`, never a stall. */
  const unread = pickOneCoin([c('A', 1_005, trades({})), c('B', 1_005, null)], null, NOW, true, BARS);
  assert.equal(unread.kind !== 'none' && unread.basis, 'market_readings');
  /* A watched coin with no trade is a measured nothing, never a block. */
  assert.equal(pickOneCoin([c('A', 1_005, trades({})), c('B', 1_005, 'quiet')], null, NOW, true, BARS).kind, 'picked');
});

test('none: no candidate at all', () => {
  assert.deepEqual(pickOneCoin([], null, NOW, true, BARS), { kind: 'none' });
});

test('★ without trade data the replay\'s cap-climb rule decides, and the basis says so', () => {
  const m = (capUsd: number, peakCapUsd = capUsd) => ({ capUsd, peakCapUsd });
  const o = pickOneCoin([c('A', 1_005, null, { market: m(40_000) }), c('B', 1_005, null, { market: m(6_000) })], null, NOW, false, BARS);
  assert.equal(o.kind === 'picked' && o.address, 'A');
  assert.equal(o.kind === 'picked' && o.basis, 'market_readings');
  /* A coin with no reading is not judged yet on readings: it does not hold the pick back. */
  assert.equal(pickOneCoin([c('A', 1_005, null, { market: m(40_000) }), c('B', 1_005, null)], null, NOW, false, BARS).kind, 'picked');
  /* The rug floor on readings too: $508k fallen to $1.9k is out. */
  assert.equal(pickOneCoin([c('A', 1_005, null, { market: m(1_900, 508_000) })], { address: 'A', sinceMs: 0 }, NOW, false, BARS).kind, 'waiting');
});

test('second path: the biggest coin of the exact name with a fresh reading over the bar', () => {
  const now = 2_000 * MIN;
  const bars = { minVariantLength: 4, readingWithinMs: 30 * MIN, minCapUsd: 15_000 };
  const coins = [
    { address: 'small', name: 'Pancake', ticker: 'PAN', capUsd: 16_000, readAtMs: now - MIN },
    { address: 'big', name: 'Pancake', ticker: 'PANCAKE', capUsd: 90_000, readAtMs: now - MIN },
    { address: 'stale', name: 'Pancake', ticker: 'PC', capUsd: 900_000, readAtMs: now - 60 * MIN },
    { address: 'other', name: 'Waffle', ticker: 'WAF', capUsd: 900_000, readAtMs: now },
  ];
  assert.equal(biggestOfName(post(), coins, bars, now)?.address, 'big');
  assert.equal(biggestOfName(post({ judgeNames: [] }), coins, bars, now), null);
});

test('replay: a rug that led early is dropped and the real coin taken when it clears', () => {
  const minute = (atMin: number, netBuy: number, newBuyers: number, cap: number, capUsd: number, creatorSold = 0) => ({ atMs: atMin * MIN, newBuyers, netBuy, creatorSold, cap, capUsd });
  const rug: ReplayCoin = { address: 'rug', launchedAtMs: 1_000 * MIN, evidence: ['name_judge'], minutes: [minute(1_001, 50, 30, 300, 60_000), minute(1_007, -45, 0, 20, 4_000, 40)], readings: [] };
  const real: ReplayCoin = { address: 'real', launchedAtMs: 1_002 * MIN, evidence: ['link'], minutes: [minute(1_003, 10, 10, 100, 12_000), minute(1_008, 25, 20, 220, 45_000)], readings: [] };
  const tl = replayTimeline([rug, real], BARS, 1_060 * MIN, true);
  assert.deepEqual(tl.map(([t, a]) => [t / MIN, a]), [[1_005, 'rug'], [1_008, null], [1_009, 'real']]);
  const s = scoreReplay([{ subject: 'x:1', coins: [rug, real], truth: 'real' }, { subject: 'x:2', coins: [{ ...rug, address: 'lone', minutes: [] }], truth: null }], BARS, 10 * MIN, 60 * MIN, true);
  assert.deepEqual(s, { withCoin: 1, right: 1, wrong: 0, noPick: 0, nothingRan: 1, falsePick: 0 });
});
