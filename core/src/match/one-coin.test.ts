/**
 * One post, one coin: the matcher's four ties (link, exact name, picture, timing) and the rule's
 * outcomes — a pick, a rug dropped, a held coin's dip kept on grace, a hand-over only at three
 * times, waiting, none, and the fallback on readings saying so.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { biggestOfName, launchMatches, namedInText, oneCoinBars, pickOneCoin, priorCoins, type Contender, type LaunchSide, type MatchPost, type TradeFacts } from './one-coin.ts';
import { replayTimeline, scoreReplay, type ReplayCoin } from './one-coin-replay.ts';

const P = DEFAULT_POLICY.oneCoin;
const BARS = oneCoinBars(P);
const MIN = 60_000;
const MATCH = { launchLeadMs: P.launchLeadMs, postWindowMs: P.postWindowMs, linkMaxAgeMs: P.linkMaxAgeMs, maxHashDistance: P.picture.maxHashDistance, minSimilarity: P.picture.minSimilarity, minVariantLength: DEFAULT_POLICY.postCoin.minVariantLength };

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

test('★ lookback: older coins the post names, launched within two days, the most traded first, unread last', () => {
  const H = 60 * MIN;
  const kim = post({ postedAtMs: 2_000 * H, judgeNames: ['KIMJONG', 'KIMJONGUN'], guessNames: ['Rip Kim Jong-Un', 'KIM'], text: 'Unconfirmed reports claim Kim Jong Un may have secretly died' });
  const bars = { minVariantLength: MATCH.minVariantLength, launchLeadMs: P.launchLeadMs, lookbackMs: P.existing.lookbackMs, lookbackCoins: 2, minLiquidityUsd: P.minLiquidityUsd };
  const at = (address: string, hoursBefore: number, o: { name?: string | null; ticker?: string | null; capUsd?: number | null; liquidityUsd?: number | null }) =>
    ({ address, name: 'Rip Kim Jong-Un', ticker: 'Kim', launchedAtMs: 2_000 * H - hoursBefore * H, capUsd: null, liquidityUsd: null, readAtMs: null, ...o });
  const picked = priorCoins(kim, [
    at('ESAB', 17, { capUsd: 14_100, liquidityUsd: 8_726 }), // read 16 h ago, under the cap bar: still in
    at('FROZEN', 20, { capUsd: 381_537, liquidityUsd: 0.01 }), // a quote with no pool: no trading
    at('UNREAD', 30, {}),
    at('ANCIENT', 49, { capUsd: 900_000, liquidityUsd: 50_000 }), // past the lookback
    at('JUSTNOW', 0.1, { capUsd: 50_000, liquidityUsd: 9_000 }), // inside the lead: the launch path's
    at('OTHER', 5, { name: 'Kimchi Bowl', ticker: 'KIMCHI', capUsd: 70_000, liquidityUsd: 9_000 }), // not tied
  ], bars);
  assert.deepEqual(picked.map((x) => x.coin.address), ['ESAB', 'FROZEN']);
  assert.deepEqual(picked[0]?.ties, ['name_guess']);
  assert.deepEqual(priorCoins(kim, [at('UNREAD', 30, {}), at('ESAB', 17, { capUsd: 14_100 })], { ...bars, lookbackCoins: 5 }).map((x) => x.coin.address), ['ESAB', 'UNREAD']);
  /* No name tie and no ticker in the words: nothing. */
  assert.equal(priorCoins(post({ postedAtMs: 2_000 * H, text: 'Kim Jong Un' }), [at('NONAME', 3, { name: null, capUsd: 30_000 })], bars).length, 0);
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
  /* Past the link's own age bound (48 h at the launch), neither a direct link nor a quote ties. */
  const stale = 1_000 * MIN + P.linkMaxAgeMs + MIN;
  assert.equal(launchMatches(coin({ launchedAtMs: stale, linksPosts: new Set(['x:1']) }), [post()], MATCH).length, 0);
  assert.equal(launchMatches(coin({ launchedAtMs: stale, linksPosts: new Set(['x:quote']), linksThrough: new Map([['x:1', 'x:quote']]) }), [post()], MATCH).length, 0);
  assert.deepEqual(launchMatches(coin({ launchedAtMs: 1_000 * MIN + P.linkMaxAgeMs, linksPosts: new Set(['x:1']) }), [post()], MATCH)[0]?.evidence, ['link']);
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
  const fell = pickOneCoin([c('A', 1_005, trades({ cap: 50, peakCap: 500, capUsd: 4_000 }))], { address: 'A', sinceMs: 1_011 * MIN }, NOW, true, BARS);
  assert.equal(fell.kind, 'waiting');
  assert.equal(fell.kind === 'waiting' && fell.droppedHolder, 'A');
  /* Not held yet, a coin under the share is out whatever its cap. */
  const unheld = pickOneCoin([c('A', 1_005, trades({ cap: 50, peakCap: 500 }))], null, NOW, true, BARS);
  assert.equal(unheld.kind === 'waiting' && unheld.standings[0]?.out, 'fell_from_peak');
});

test('★ a held coin that dips stays on grace: the floor, the grace and a leading rival end it; the creator selling at once', () => {
  const holder = { address: 'A', sinceMs: 1_011 * MIN };
  const dipped = trades({ cap: 50, peakCap: 500, capUsd: 12_000 });
  const kept = pickOneCoin([c('A', 1_005, dipped)], holder, NOW, true, BARS);
  assert.equal(kept.kind === 'picked' && kept.address, 'A');
  assert.equal(kept.kind === 'picked' && kept.underShareSinceMs, NOW);
  assert.equal(kept.kind === 'picked' && kept.sinceMs, 1_011 * MIN);
  /* The grace runs from when it first went under, carried in the holder. */
  const late = pickOneCoin([c('A', 1_005, dipped)], { ...holder, underShareSinceMs: NOW - P.rugGraceMs }, NOW, true, BARS);
  assert.equal(late.kind === 'waiting' && late.droppedHolder, 'A');
  const inGrace = pickOneCoin([c('A', 1_005, dipped)], { ...holder, underShareSinceMs: NOW - P.rugGraceMs + MIN }, NOW, true, BARS);
  assert.equal(inGrace.kind === 'picked' && inGrace.underShareSinceMs, NOW - P.rugGraceMs + MIN);
  /* Under the floor: out now. */
  assert.equal(pickOneCoin([c('A', 1_005, trades({ cap: 50, peakCap: 500, capUsd: P.rugFloorUsd - 1 }))], holder, NOW, true, BARS).kind, 'waiting');
  /* A rival that clears and leads the dipped coin three times takes it; under that it does not. */
  const rival = pickOneCoin([c('A', 1_005, trades({ cap: 50, peakCap: 500, capUsd: 12_000, netBuy: 10 })), c('B', 1_006, trades({ netBuy: 30 }))], holder, NOW, true, BARS);
  assert.equal(rival.kind === 'picked' && rival.address, 'B');
  assert.equal(rival.kind === 'picked' && rival.handedOverFrom, 'A');
  const weak = pickOneCoin([c('A', 1_005, trades({ cap: 50, peakCap: 500, capUsd: 12_000, netBuy: 10 })), c('B', 1_006, trades({ netBuy: 29 }))], holder, NOW, true, BARS);
  assert.equal(weak.kind === 'picked' && weak.address, 'A');
  /* Back over the share: the grace is over and forgotten. */
  const back = pickOneCoin([c('A', 1_005, trades({}))], { ...holder, underShareSinceMs: NOW - 5 * MIN }, NOW, true, BARS);
  assert.equal(back.kind === 'picked' && back.underShareSinceMs, null);
  /* The creator selling is no dip. */
  assert.equal(pickOneCoin([c('A', 1_005, trades({ creatorSold: true }))], holder, NOW, true, BARS).kind, 'waiting');
});

test('★ $Laura (20 Oct): the dip from $51k to $12k keeps the card on the coin through its run to $219k', () => {
  const at = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return ((h ?? 0) * 60 + (m ?? 0)) * MIN;
  };
  const caps: readonly (readonly [string, number])[] = [
    ['13:07', 38_000], ['13:10', 45_000], ['13:16', 51_000], ['13:19', 14_000], ['13:22', 12_000], ['13:26', 15_000],
    ['13:30', 13_000], ['13:33', 14_000], ['13:36', 15_000], ['13:37', 89_000], ['13:40', 150_000], ['13:43', 219_000],
  ];
  const laura: ReplayCoin = { address: 'LAURA', launchedAtMs: at('13:05'), evidence: ['link'], minutes: [], readings: caps.map(([t, capUsd]) => ({ atMs: at(t), capUsd })) };
  const soft = replayTimeline([laura], BARS, at('13:45'), false);
  assert.deepEqual(soft, [[at('13:10'), 'LAURA']]);
  /* The bare share rule (no grace) blanked the card from 13:19 to 13:37. */
  const bare = replayTimeline([laura], { ...BARS, rugGraceMs: 0 }, at('13:45'), false);
  assert.deepEqual(bare, [[at('13:10'), 'LAURA'], [at('13:19'), null], [at('13:37'), 'LAURA']]);
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

test('★ an older coin of the post\'s name is the incumbent: a later name-only coin must out-trade it three times', () => {
  /* 19 Oct: "Rip Kim Jong-Un" found by the second path, "Kim" launched later and tied by a namer ticker. */
  const older = (m: Contender['market'], t: Contender['trades'] = null) => c('ESAB', 0, t, { existingSinceMs: 1_001 * MIN, evidence: ['name_guess', 'existing'], market: m });
  const kim = (m: Contender['market'], t: Contender['trades'] = null, o: Partial<Contender> = {}) => c('KIM', 1_003, t, { evidence: ['name_guess'], market: m, ...o });
  const read = (capUsd: number, liquidityUsd: number | null = null) => ({ capUsd, peakCapUsd: capUsd, liquidityUsd });
  /* The older coin not read yet: nobody can say the newcomer out-traded it, so nothing is picked. */
  const unread = pickOneCoin([older(null), kim(read(90_000))], null, NOW, false, BARS);
  assert.equal(unread.kind, 'waiting');
  assert.equal(unread.kind === 'waiting' && unread.standings.find((s) => s.address === 'KIM')?.out, 'after_older_coin');
  /* Read: the older coin leads, the newcomer under three times it is out. */
  const read1 = pickOneCoin([older(read(578_000)), kim(read(400_000))], null, NOW, false, BARS);
  assert.equal(read1.kind === 'picked' && read1.address, 'ESAB');
  /* Three times the older coin's climb: the newcomer takes it, on trades as on readings. */
  assert.equal((pickOneCoin([older(read(20_000)), kim(read(90_000))], null, NOW, false, BARS) as { address?: string }).address, 'KIM');
  assert.equal((pickOneCoin([older(null, trades({ netBuy: 10 })), kim(null, trades({ netBuy: 31 }))], null, NOW, true, BARS) as { address?: string }).address, 'KIM');
  /* A held newcomer that does not beat the older coin is dropped. */
  const dropped = pickOneCoin([older(null), kim(read(90_000))], { address: 'KIM', sinceMs: 1_010 * MIN }, NOW, false, BARS);
  assert.equal(dropped.kind === 'waiting' && dropped.droppedHolder, 'KIM');
  /* A coin whose metadata links the post is the creators' own: it competes on the plain rule. */
  const linked = pickOneCoin([older(read(10_000)), kim(read(90_000), null, { evidence: ['link'] })], null, NOW, false, BARS);
  assert.equal(linked.kind === 'picked' && linked.address, 'KIM');
});

test('★ on readings a quote with no pool climbs nothing: a frozen cap is not trading', () => {
  const read = (capUsd: number, liquidityUsd: number | null) => ({ capUsd, peakCapUsd: capUsd, liquidityUsd });
  const o = pickOneCoin([c('FROZEN', 1_005, null, { market: read(381_537, 0.01) }), c('B', 1_006, null, { market: read(40_000, null) })], null, NOW, false, BARS);
  assert.equal(o.kind === 'picked' && o.address, 'B');
  assert.equal(o.kind === 'picked' && o.standings.find((s) => s.address === 'FROZEN')?.strength, 0);
  /* Alone it clears nothing either. */
  assert.equal(pickOneCoin([c('FROZEN', 1_005, null, { market: read(381_537, 0.01) })], null, NOW, false, BARS).kind, 'waiting');
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

test('★ a held coin still worth the keep bar is never dropped for time under the share alone (25 Oct, $Marvin)', () => {
  /* The real Marvin: $657k at its peak, $151k half an hour later, dropped for a $22k coin. */
  const holder = { address: 'A', sinceMs: 1_011 * MIN, underShareSinceMs: NOW - P.rugGraceMs - MIN };
  const stillBig = trades({ cap: 50, peakCap: 500, capUsd: P.rugKeepAboveUsd });
  const kept = pickOneCoin([c('A', 1_005, stillBig)], holder, NOW, true, BARS);
  assert.equal(kept.kind === 'picked' && kept.address, 'A');
  /* Under the keep bar, the half hour still ends it. */
  const small = pickOneCoin([c('A', 1_005, trades({ cap: 50, peakCap: 500, capUsd: P.rugKeepAboveUsd - 1 }))], holder, NOW, true, BARS);
  assert.equal(small.kind === 'waiting' && small.droppedHolder, 'A');
});

test('★ a held coin the trades put out is not re-held on the readings fallback (2026-10-26, $DOUPI)', () => {
  /* The trades: 20 SOL of a 1,108 peak, about $2k. Its reading stands still at $41,293. A rival is unmeasured. */
  const holder = { address: 'RUG', sinceMs: 1_006 * MIN, underShareSinceMs: NOW - 10 * MIN };
  const rug = c('RUG', 1_002, trades({ cap: 20, peakCap: 1_108, capUsd: 2_000, netBuy: -27 }), { evidence: ['link'], market: { capUsd: 41_293, peakCapUsd: 41_293 } });
  const unread = c('OTHER', 1_003, null, { evidence: ['link'], market: { capUsd: 18_000, peakCapUsd: 21_000 } });
  const o = pickOneCoin([rug, unread], holder, NOW, true, BARS);
  assert.notEqual(o.kind === 'picked' ? o.address : null, 'RUG');
  /* Nor picked afresh as the readings' leader when nobody holds it. */
  const fresh = pickOneCoin([rug, unread], null, NOW, true, BARS);
  assert.notEqual(fresh.kind === 'picked' ? fresh.address : null, 'RUG');
});

test('★ the crash switch: under the share, a coin made for the post worth twice the held one takes it, on trades too', () => {
  /* 25 Oct 02:20: the wrong Marvin fell from $177k to $42k; the real one, linking the post, stood at $147k; net buying flat on both. */
  const holder = { address: 'WRONG', sinceMs: 1_006 * MIN };
  const wrong = c('WRONG', 1_002, trades({ cap: 42, peakCap: 177, capUsd: 42_000, netBuy: 10 }), { evidence: ['link'] });
  const real = c('REAL', 1_003, trades({ cap: 147, peakCap: 147, capUsd: 147_000, netBuy: 12 }), { evidence: ['link'] });
  const o = pickOneCoin([wrong, real], holder, NOW, true, BARS);
  assert.equal(o.kind === 'picked' && o.address, 'REAL');
  assert.equal(o.kind === 'picked' && o.handedOverFrom, 'WRONG');
  assert.equal(o.kind === 'picked' && o.crash, true);
  /* A rival that only shares the name does not take it by this rule. */
  const lookAlike = c('REAL', 1_003, trades({ cap: 147, peakCap: 147, capUsd: 147_000, netBuy: 12 }), { evidence: ['name_judge'] });
  const held = (o: ReturnType<typeof pickOneCoin>): string | null => (o.kind === 'picked' ? o.address : null);
  assert.equal(held(pickOneCoin([wrong, lookAlike], holder, NOW, true, BARS)), 'WRONG');
  /* Nor does one under twice the held coin's cap, nor any rival while the held coin has not crashed. */
  const close = c('REAL', 1_003, trades({ cap: 80, peakCap: 80, capUsd: 80_000, netBuy: 12 }), { evidence: ['link'] });
  assert.equal(held(pickOneCoin([wrong, close], holder, NOW, true, BARS)), 'WRONG');
  const standing = c('WRONG', 1_002, trades({ cap: 100, peakCap: 177, capUsd: 100_000, netBuy: 10 }), { evidence: ['link'] });
  assert.equal(held(pickOneCoin([standing, real], holder, NOW, true, BARS)), 'WRONG');
});
