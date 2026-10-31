/**
 * PvP as the screens draw it: the leader is the highest read cap, an unread cap is never ranked as
 * $0, a race with no read cap shows no list, and the token page's line is said only while true.
 * Decoded from the wire, so a malformed coin is left out rather than failing the feed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoin, decodeCoinEvidence } from './api/decode.ts';
import type { PostCoinLink } from './api/index.ts';
import { measuredFrom } from './format/measure.ts';
import { pvpAhead, pvpCoins } from './pvp.ts';

const racer = (address: string, cap: number | null) => ({ coinId: `solana:${address}`, address, ticker: address, imageUrl: null, marketCapUsd: cap === null ? { v: null, why: 'not_read_yet' } : { v: cap }, priceChange24h: { v: -14 } });
const coin = decodeCoin({ coinId: 'c', ticker: 'KIJ', name: 'K', address: 'KIJ', venueLabel: 'pump.fun', imageUrl: null, mintedAt: { at: null }, priceUsd: { v: 1 }, marketCapUsd: { v: 12_000 }, marketCapBasis: null, liquidityUsd: { v: null }, priceChange24h: { v: null }, tradable: true });
const post = (racingCoins: unknown): PostCoinLink => ({ kind: 'matched', coin, evidence: decodeCoinEvidence({ linksPost: true, samePicture: null, launchedAfterMs: 1, picked: true, racing: 2, racingCoins }) });

test('★ the leader is the highest read cap, on top; an unread cap sits last, never as $0', () => {
  const rows = pvpCoins(post([racer('NOCAP', null), racer('KIJ', 12_000), racer('KJI', 51_000)]));
  assert.deepEqual(rows?.map((r) => [r.address, r.leader]), [['KJI', true], ['KIJ', false], ['NOCAP', false]]);
  assert.equal(rows?.[0]?.changePct24h.known, true);
});

test('the card\'s own live cap replaces the frame\'s before ranking', () => {
  const rows = pvpCoins(post([racer('KIJ', 12_000), racer('KJI', 51_000)]), { address: 'KIJ', cap: measuredFrom(80_000, 'no_market') });
  assert.deepEqual(rows?.map((r) => r.address), ['KIJ', 'KJI']);
});

test('★ no PvP list: no race, one coin read whole, or no cap read on any coin', () => {
  assert.equal(pvpCoins({ kind: 'none' }), null);
  assert.equal(pvpCoins(post(undefined)), null);
  assert.equal(pvpCoins(post([racer('KIJ', 1), { address: 'BAD' }])), null);
  assert.equal(pvpCoins(post([racer('A', null), racer('B', null)])), null);
});

test('★ the token page line: only while another coin for the post is strictly ahead', () => {
  const evidence = post([racer('KIJ', 12_000), racer('KJI', 51_000)]);
  const racingCoins = evidence.kind === 'matched' ? evidence.evidence.racingCoins : undefined;
  const posts = [{ postId: 'p1', ...(racingCoins !== undefined ? { racingCoins } : {}) }];
  const ahead = pvpAhead(posts, 'KIJ', measuredFrom(null, 'not_read_yet'));
  assert.deepEqual(ahead && { post: ahead.postId, leader: ahead.leader.address, at: ahead.leaderCap, own: ahead.ownCap }, { post: 'p1', leader: 'KJI', at: 51_000, own: 12_000 });
  /* The leader's own page, and a page whose live cap has caught up: nothing. */
  assert.equal(pvpAhead(posts, 'KJI', measuredFrom(null, 'not_read_yet')), null);
  assert.equal(pvpAhead(posts, 'KIJ', measuredFrom(60_000, 'no_market')), null);
  assert.equal(pvpAhead([{ postId: 'p2' }], 'KIJ', measuredFrom(1, 'no_market')), null);
});
