/**
 * The card's coins when an older coin the post's own coins name is trading (older-trading.ts): the
 * highest cap with Buy, "See N coins" over the top three, the pick kept whatever its cap. "*paws at
 * you*", 27 Oct 2026.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { olderTradingLine, type OlderTrading } from './older-trading.ts';
import type { WireCoin } from './wire.ts';

const POSTED = 1_800_000_000_000;
const DAY = 86_400_000;
const coin = (address: string, cap: number | null, mintedAt: number): WireCoin => ({
  coinId: `solana:${address}`, ticker: address, name: address, address, venueLabel: 'pump', imageUrl: null,
  mintedAt: { at: mintedAt }, priceUsd: { v: 1 }, marketCapUsd: cap === null ? { v: null, why: 'not_read_yet' } : { v: cap }, liquidityUsd: { v: 20_000 },
} as unknown as WireCoin);

const PAWS: OlderTrading = {
  postedAtMs: POSTED,
  older: [{ coin: coin('HIM1', 75_000, POSTED - 2.6 * DAY), ties: [] }, { coin: coin('HIM2', 21_000, POSTED - 2.6 * DAY), ties: [] }],
  made: [{ coin: coin('FP4', 44_000, POSTED + 20 * 3_600_000), ties: ['link', 'picture'] }, { coin: coin('COPY', 16_000, POSTED + 3_600_000), ties: ['link'] }],
};

test('★ paws at you: the highest cap with Buy and the top three listed, the dead copies out', () => {
  const line = olderTradingLine(PAWS, undefined, null, new Set(), 3);
  assert.equal(line?.kind, 'matched');
  if (line?.kind !== 'matched') return;
  assert.equal(line.coin.address, 'HIM1');
  assert.deepEqual(line.evidence.tradingCoins, ['HIM1', 'FP4', 'HIM2']);
  assert.equal(line.evidence.linksPost, null, 'an older coin is never said to link the post');
  assert.equal(line.evidence.launchedAfterMs, -2.6 * DAY, 'it launched before the post, and says so');
});

test('the pick is listed whatever its cap, and keeps "Coin for this post" when it is the highest', () => {
  const pick = { address: 'FP4', outcome: 'picked' as const, ties: ['link', 'picture'], launchedAfterMs: 72_000_000 };
  const low = olderTradingLine(PAWS, { ...pick, address: 'LOW' }, coin('LOW', 5_000, POSTED + 60_000), new Set(), 3);
  assert.deepEqual(low?.kind === 'matched' ? low.evidence.tradingCoins : null, ['HIM1', 'FP4', 'HIM2'], 'a pick under the top three is not pushed in over a bigger coin');
  const top = olderTradingLine(PAWS, pick, coin('FP4', 90_000, POSTED + 72_000_000), new Set(), 3);
  assert.equal(top?.kind === 'matched' ? top.evidence.picked : undefined, true);
  assert.equal(top?.kind === 'matched' ? top.coin.address : null, 'FP4');
});

test('a coin the owner called wrong is never listed; one coin left is the card without "See N coins"; none is no line', () => {
  const one = olderTradingLine({ postedAtMs: POSTED, older: [{ coin: coin('HIM1', 75_000, POSTED - DAY), ties: [] }], made: [] }, undefined, null, new Set(), 3);
  assert.equal(one?.kind === 'matched' ? one.evidence.tradingCoins : 'x', undefined);
  const wrong = olderTradingLine(PAWS, undefined, null, new Set(['HIM1']), 3);
  assert.equal(wrong?.kind === 'matched' ? wrong.coin.address : null, 'FP4');
  assert.equal(olderTradingLine({ postedAtMs: POSTED, older: [{ coin: coin('HIM1', 75_000, POSTED - DAY), ties: [] }], made: [] }, undefined, null, new Set(['HIM1']), 3), null);
});
