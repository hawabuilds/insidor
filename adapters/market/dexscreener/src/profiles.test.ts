/**
 * Profiles, read from a hand-written reply in the vendor's shape: the picture and links survive
 * from whichever pool carries them, numbers come from the deepest pool, and nothing but https
 * links gets through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readProfiles } from './profiles.ts';

const MINT = 'So1aNaCoinMint1111111111111111111111111pump';

const REPLY = [
  {
    chainId: 'solana',
    dexId: 'pumpswap',
    baseToken: { address: MINT },
    liquidity: { usd: 40_000 },
    volume: { h24: 120_000 },
    marketCap: 900_000,
  },
  {
    chainId: 'solana',
    dexId: 'pumpfun',
    baseToken: { address: MINT },
    liquidity: { usd: 10 },
    volume: { h24: 5 },
    info: {
      imageUrl: 'https://cdn.example/coin.png',
      socials: [
        { type: 'twitter', url: 'https://x.com/coin' },
        { type: 'telegram', url: 'https://t.me/coin' },
        { type: 'twitter', url: 'https://x.com/coin' },
        { type: 'tiktok', url: 'javascript:alert(1)' },
      ],
      websites: [{ label: 'Website', url: 'https://coin.example' }],
    },
  },
  { chainId: 'ethereum', baseToken: { address: 'other' }, info: { imageUrl: 'https://x/y.png' } },
];

test('★ picture and links from the pool that has them, numbers from the deepest pool', () => {
  const p = readProfiles(REPLY).get(MINT);
  assert.ok(p);
  assert.equal(p.imageUrl, 'https://cdn.example/coin.png');
  assert.equal(p.volume24hUsd, 120_000);
  assert.equal(p.liquidityUsd, 40_000);
  assert.equal(p.marketCapUsd, 900_000);
  assert.deepEqual(p.links, [
    { kind: 'x', url: 'https://x.com/coin' },
    { kind: 'telegram', url: 'https://t.me/coin' },
    { kind: 'website', url: 'https://coin.example/' },
  ]);
});

test('another chain is not read, and a coin with no info has no picture and no links', () => {
  const m = readProfiles([{ chainId: 'solana', baseToken: { address: MINT }, liquidity: { usd: 1 } }, ...REPLY.slice(2)]);
  assert.equal(m.has('other'), false);
  assert.deepEqual(m.get(MINT)?.links, []);
  assert.equal(m.get(MINT)?.imageUrl, null);
});
