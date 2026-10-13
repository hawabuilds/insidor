/** The post sheet's and the card's decisions: gains between our own readings, the chart, the tags, the card's coin area, and quick buy under the cap. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CoinEvidence, PostCoinLink } from '../../shared/api/index.ts';
import { instant, pendingInstant } from '../../shared/format/measure.ts';
import { effectiveChoice, quickAmounts, quickBuy } from './quick-buy.ts';
import { cardFoot, chartPlan, coinTag, firstCoinAfter, foundTag, gainText, linePath, niceMax, recentGain } from './sheet-view.ts';

const M = 60_000;
const facts = (e: CoinEvidence) => (e.linksPost === true ? ['Links this post'] : []);

test('★ the gain is between two of our readings, nearest five minutes apart, and says its real span', () => {
  const r = [{ atMs: 0, value: 100_000 }, { atMs: 4 * M, value: 130_000 }, { atMs: 11 * M, value: 168_000 }];
  assert.deepEqual(recentGain(r), { gain: 38_000, minutes: 7 });
  assert.equal(gainText(recentGain(r)), '+38K');
  assert.equal(recentGain([{ atMs: 0, value: 1 }]), null, 'one reading has no gain');
  assert.equal(recentGain([{ atMs: 0, value: 1 }, { atMs: 30 * M, value: 9 }]), null, 'readings half an hour apart are not a five-minute gain');
  assert.equal(recentGain([{ atMs: 0, value: null }, { atMs: 5 * M, value: 9 }]), null, 'a censored reading is never used');
});

test('★ no chart without two counted readings; a censored reading is bridged, never a break or a drop to the floor', () => {
  assert.equal(chartPlan([{ atMs: 0, value: 5 }], null, { found: null, coin: null }), null);
  const plan = chartPlan([{ atMs: 10 * M, value: 100 }, { atMs: 20 * M, value: null }, { atMs: 30 * M, value: 700_000 }], 0, { found: 2 * M, coin: 33 * M });
  assert.ok(plan);
  assert.equal(plan.max, 750_000);
  assert.equal(plan.times[0]?.at, 0, 'the chart starts at the post time');
  assert.equal(plan.times[2]?.at, 33 * M, 'and stretches to the coin launched after our last reading');
  assert.equal(plan.markers[0]?.onLine, false, 'found before our first counted reading: a dotted line, no dot');
  assert.equal(plan.markers.length, 2, 'both markers are drawn at their real times');
  assert.ok(Math.abs((plan.markers[1]?.x ?? 0) - 1) < 1e-9, 'the coin sits at the right edge, where it launched');
  assert.ok(Math.abs(plan.last.x - 30 / 33) < 1e-9, 'the line ends at our last reading, before the coin');
  assert.equal(linePath(plan.points, 100, 10).split('M').length - 1, 1, 'one unbroken line across the censored reading');
  assert.ok(plan.points.every((p) => p !== null && p.y > 0), 'nothing drops to the floor');
  assert.equal(niceMax(751_000), 800_000);
});

test('Found and Coin tags count from the post; a coin before the post is not its first coin', () => {
  const posted = instant(1_000 * M);
  assert.equal(foundTag(posted, instant(1_002 * M)), 'Found 2m');
  assert.equal(foundTag(pendingInstant('not_reported'), instant(1)), null);
  const first = firstCoinAfter(posted, [instant(900 * M), instant(1_033 * M), instant(1_100 * M), pendingInstant('not_reported')]);
  assert.equal(coinTag(posted, first), 'Coin 33m');
  assert.equal(firstCoinAfter(posted, [instant(900 * M)]), null);
});

test("★ the card's coin area: Buy only for the post's own coin, Choose coin for an unsure list, Create for none", () => {
  const coin = { ticker: 'VOID' } as never;
  assert.equal(cardFoot({ kind: 'matched', coin, evidence: { linksPost: true, samePicture: null, launchedAfterMs: null } } as PostCoinLink, facts).kind, 'proven');
  assert.deepEqual(cardFoot({ kind: 'unsure', claimCount: 8 } as PostCoinLink, facts), { kind: 'choose', line: '8 coins, none proven' });
  assert.deepEqual(cardFoot({ kind: 'unsure', claimCount: 10, more: true } as PostCoinLink, facts), { kind: 'choose', line: '10+ coins, none proven' });
  assert.equal(cardFoot({ kind: 'none' } as PostCoinLink, facts).kind, 'create');
  assert.equal(cardFoot({ kind: 'pending' } as PostCoinLink, facts).kind, 'line');
});

const CAP = { maxBuyLamports: '50000000', defaultSlippageBps: 300, maxSlippageBps: 1_500, feeBps: 0 };

test('★ quick buy never offers an amount that, with its slippage, is over the cap', () => {
  assert.deepEqual(quickAmounts(CAP, 300), ['0.01', '0.025'], '0.05 plus 3% is over a 0.05 cap');
  assert.deepEqual(quickAmounts({ ...CAP, maxBuyLamports: '1000000000' }, 1000), ['0.01', '0.025', '0.05']);
  assert.deepEqual(quickAmounts({ ...CAP, maxBuyLamports: '60000000' }, 300), ['0.01', '0.025', '0.05'], 'the 0.06 cap: 0.05 plus 3% fits');
  assert.deepEqual(quickAmounts({ ...CAP, maxBuyLamports: '60000000' }, 1000), ['0.01', '0.025', '0.05'], 'and plus 10%');
  assert.deepEqual(quickAmounts(null, 300), [], 'no cap read, no amount offered');
  assert.deepEqual(effectiveChoice({ amountSol: '0.05', slippageBps: 300 }, CAP), { amountSol: '0.025', slippageBps: 300 }, 'a saved amount over the cap falls to the largest allowed');
  assert.equal(effectiveChoice({ amountSol: '0.01', slippageBps: 300 }, { ...CAP, maxBuyLamports: '1000' }), null);
});

test('★ a refused quote or a failed simulation never reaches the wallet', async () => {
  let signed = 0;
  const signAndSend = async () => {
    signed += 1;
    return { kind: 'sent', ref: 'sig' } as never;
  };
  const choice = { amountSol: '0.01', slippageBps: 300 };
  const refused = await quickBuy({ mint: 'M', account: 'A', choice }, { signAndSend, quote: async () => ({ kind: 'refused', why: 'Trading is off.' }) });
  assert.deepEqual(refused, { kind: 'no-price', why: 'Trading is off.' });
  const quote = { kind: 'quote' as const, quote: { venue: 'curve' as const, side: 'buy' as const, inAmount: '1', outAmount: '1', bound: '1', slippageBps: 300, priceImpactPct: 0.01, sent: {} } };
  const blocked = await quickBuy({ mint: 'M', account: 'A', choice }, { signAndSend, quote: async () => quote, build: async () => ({ kind: 'blocked', why: 'Not enough SOL.' }) });
  assert.deepEqual(blocked, { kind: 'blocked', why: 'Not enough SOL.' });
  assert.equal(signed, 0);
  const sent = await quickBuy({ mint: 'M', account: 'A', choice }, { signAndSend, quote: async () => quote, build: async () => ({ kind: 'ready', transaction: 'AQID' }) });
  assert.deepEqual(sent, { kind: 'sent', ref: 'sig' });
  assert.equal(signed, 1);
});
