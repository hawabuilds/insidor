/**
 * The one market-cap rule every screen shows: price × the launchpad's billion while a fresh price
 * is held, the server's figure otherwise, and never a zero.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { CoinMarket } from './api/wire/market.ts';
import { capAtPrice, capOf, knownSupply, LAUNCHPAD_SUPPLY, LIVE_KEEP_MS, livePrice, marketPrice, noteMarket, priceStore } from './coin-cap.ts';

const known = (amount: number) => ({ known: true as const, amount });
const trade = (price: number | null) => ({ tx: null, side: 'buy' as const, tokenAmount: known(1), usd: known(1), priceUsd: price === null ? { known: false as const, pending: 'not_reported' as const } : known(price), at: { known: true as const, at: 0 }, maker: null });
const read = (venue: 'curve' | 'pool' | null, trades: readonly ReturnType<typeof trade>[] | null, closes: readonly number[] = []): CoinMarket =>
  ({ kind: 'read', timeframe: '1m', venue, candles: closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c })), trades, curveProgress: null }) as unknown as CoinMarket;

test('★ the cap is the price times one billion', () => {
  assert.equal(LAUNCHPAD_SUPPLY, 1_000_000_000);
  assert.equal(capAtPrice(0.0000034), 3_400);
  assert.equal(capAtPrice(0.00124), 1_240_000);
});

test('the price is the newest trade\'s, else the last close; an unreadable or zero price is none', () => {
  assert.equal(marketPrice(read('curve', [trade(null), trade(0.000004), trade(0.000003)], [0.000001])), 0.000004);
  assert.equal(marketPrice(read('pool', [], [0.000001, 0.000002])), 0.000002);
  assert.equal(marketPrice(read('pool', [trade(0)], [0])), null);
  assert.equal(marketPrice({ kind: 'unavailable', timeframe: '1m' }), null);
  assert.equal(marketPrice(null), null);
});

test('★ only a coin whose supply we know: the launchpad\'s suffix, or on its curve', () => {
  assert.equal(knownSupply('Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump'), true);
  assert.equal(knownSupply('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), false);
  assert.equal(knownSupply('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'curve'), true);
  noteMarket('OtherTokenNotLaunchpad', read('pool', [trade(5)]), 1_000);
  assert.equal(livePrice('OtherTokenNotLaunchpad'), undefined, 'another token\'s price is never turned into a cap');
});

test('★ every screen gets the same cap from the shared price, until it goes stale', () => {
  const addr = 'Coin1pump';
  const served = { known: false as const, pending: 'not_read_yet' as const };
  let redraws = 0;
  const stop = priceStore.subscribe(() => (redraws += 1));
  noteMarket(addr, read('pool', [trade(0.0000032)]), 10_000);
  stop();
  assert.equal(redraws, 1, 'a new price redraws every watcher');
  const cap = capOf(served, livePrice(addr), 10_000);
  assert.ok(cap.known && Math.abs(cap.amount - 3_200) < 1e-6);
  assert.deepEqual(capOf(known(9_999), livePrice(addr), 10_000 + LIVE_KEEP_MS + 1), known(9_999), 'stale: the server\'s figure');
  assert.deepEqual(capOf(served, undefined, 0), served, 'nothing read: the server\'s absence, with its reason, never 0');
});

test('an older read never replaces a newer one', () => {
  noteMarket('Coin2pump', read('curve', [trade(0.000002)]), 20_000);
  noteMarket('Coin2pump', read('curve', [trade(0.000009)]), 19_000);
  assert.equal(livePrice('Coin2pump')?.priceUsd, 0.000002);
});

test('★ without a live price, the price the reply carried follows the same rule, never a source\'s circulating cap', () => {
  const served = known(3_053);
  assert.deepEqual(capOf(served, undefined, 0, 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump', known(0.000003439)).known, true);
  const cap = capOf(served, undefined, 0, 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump', known(0.000003439));
  assert.ok(cap.known && Math.round(cap.amount) === 3_439);
  assert.deepEqual(capOf(served, undefined, 0, '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', known(0.000003439)), served, 'a supply we do not know: the server\'s cap');
  assert.deepEqual(capOf(served, undefined, 0, 'Xpump', { known: false, pending: 'not_reported' }), served);
  const live = capOf(served, { priceUsd: 0.000004, readAt: 0 }, 1, 'Xpump', known(0.000003));
  assert.ok(live.known && Math.round(live.amount) === 4_000, 'a fresh live price beats the reply\'s');
});
