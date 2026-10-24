/**
 * The war's coin on the wire: the reading's numbers when it is current, "not read yet" and not
 * tradable when it is old, the venue's own reason for an absence, and no coin when the view
 * cannot be read (a database before 0134).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readWarCoin, warCoinOf } from './war-coin.ts';

const ROW = {
  address: '6Vk3fAQWYEot6JbQb8Nx8j5wZeDnMhzk8FajjHhZpump',
  symbol: 'MWW',
  name: 'Meme World War',
  image_uri: 'ipfs://nope',
  market_cap_usd: '13987',
  market_cap_absent: null,
  price_change_24h_pct: null,
  price_change_24h_absent: 'not_reported',
  tradable: true,
  taken_ms: 1_000_000,
};

test('a current reading is sent as it is; an absence keeps the venue\'s reason; a non-https picture is none', () => {
  const c = warCoinOf(ROW, 1_000_000 + 60_000, 300_000);
  assert.deepEqual(c, { address: ROW.address, ticker: 'MWW', name: 'Meme World War', imageUrl: null, marketCapUsd: { v: 13987 }, priceChange24h: { v: null, why: 'not_reported' }, tradable: true });
});

test('★ an old reading is "not read yet" and not tradable, never yesterday\'s cap as today\'s', () => {
  const c = warCoinOf(ROW, 1_000_000 + 300_001, 300_000);
  assert.deepEqual(c.marketCapUsd, { v: null, why: 'not_read_yet' });
  assert.deepEqual(c.priceChange24h, { v: null, why: 'not_read_yet' });
  assert.equal(c.tradable, false);
  assert.deepEqual(warCoinOf({ ...ROW, taken_ms: null }, 0, 300_000).marketCapUsd, { v: null, why: 'not_read_yet' }, 'never read');
});

test('no coin chosen, or a view the database does not have yet: null', async () => {
  assert.equal(await readWarCoin({ query: async () => [] }, 0), null);
  assert.equal((await readWarCoin({ query: async () => [{ ...ROW, taken_ms: 1_000_000 }] }, 1_000_000))?.ticker, 'MWW');
  assert.equal(await readWarCoin({ query: async () => { throw new Error('relation "public.war_coin" does not exist'); } }, 0), null);
});
