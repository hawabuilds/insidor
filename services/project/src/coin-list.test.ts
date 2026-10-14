/**
 * "See N coins" keeps only coins that could be the post's (coin-list.ts `plausibleCoins`): the
 * owner's cases — an ongoing story's older coin that still trades stays, a lookalike named only
 * for a common word goes, a coin launched long before with nothing linking it goes.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { listBars, plausibleCoins, type ListedCoin } from './coin-list.ts';

const H = 3_600_000;
const POSTED = 1_000_000_000_000;
const NOW = POSTED + 2 * H;
const BARS = listBars(DEFAULT_POLICY);
const coin = (address: string, o: Partial<ListedCoin> = {}): ListedCoin => ({ address, name: null, ticker: address, launchedAtMs: POSTED + H, marketCapUsd: null, tradable: null, ...o });
const run = (names: readonly string[], coins: readonly ListedCoin[], evidence: Record<string, object> = {}) =>
  plausibleCoins({ names, postedAtMs: POSTED }, coins.map((c) => c.address), new Map(coins.map((c) => [c.address, c] as const)), new Map(Object.entries(evidence)) as never, BARS, NOW);

test('★ a coin named for the subject and launched after the post stays; one named for something else goes', () => {
  assert.deepEqual(run(['Bobcat'], [coin('BOBCAT'), coin('DOGE')]), ['BOBCAT']);
});

test('★ an ongoing story\'s coin launched days before stays while the venue still quotes it (Altai)', () => {
  const altai = coin('ALTAI', { name: 'Altai the Tiger', launchedAtMs: POSTED - 88 * H, tradable: true, marketCapUsd: 1_636_101 });
  const stale = coin('TKING', { name: 'Tiger King', ticker: 'TKING', launchedAtMs: POSTED - 88 * H, tradable: false });
  assert.deepEqual(run(['TIGER'], [altai, stale]), ['ALTAI']);
});

test('a coin launched long before, not quoted, is left out unless named exactly or linked', () => {
  const exact = coin('AURAFARMER', { launchedAtMs: POSTED - 90 * H, tradable: false });
  const linked = coin('ZZZ', { launchedAtMs: POSTED - 90 * H, tradable: false });
  assert.deepEqual(run(['AURAFARMER'], [exact, linked], { ZZZ: { linksPost: true } }), ['ZZZ', 'AURAFARMER'], 'a linked coin first');
});

test('★ a name that is only a generic word never counts ("VIRAL" under a viral post)', () => {
  assert.deepEqual(run(['Viral Cat'], [coin('VIRAL', { name: 'viral' })]), []);
});

test('★ best fit first: linked, then the earliest launched (the first coin, not its copycats), then the larger cap; at most `maxCoins`', () => {
  const many = Array.from({ length: 12 }, (_, i) => coin(`MOODENG${i}`, { name: 'Moo Deng', launchedAtMs: POSTED + (12 - i) * 60_000, marketCapUsd: i * 1000 }));
  const out = run(['Moo Deng'], many, { MOODENG2: { linksPost: true } });
  assert.equal(out.length, BARS.maxCoins);
  assert.equal(out[0], 'MOODENG2', 'linked first');
  assert.equal(out[1], 'MOODENG11', 'then the earliest launched, though its cap is the largest only by chance');
  assert.equal(out.includes('MOODENG0'), false, 'the latest copycat is cut');
});
