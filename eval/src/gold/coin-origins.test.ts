/**
 * The coin-origin gold set, as imported: the counts the founders gave, every origin a post
 * with an id (or the one known account), every coin dated from the chain, and a split that
 * is the seeded one and holds every stratum on both sides.
 *
 * Append-only data: if a count here changes, the import was re-run or the file was edited,
 * and either has to be argued for in coin-origins-cleaning.md — never fixed by editing this.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { assignSplit, goldCoins, holdout, stratumOf, tuning } from './coin-origins.ts';

const coins = goldCoins();

test('★ 851 coins, 79 viral — 62 on X, 11 on TikTok, 6 on Instagram', () => {
  /* 866 rows, less the 15 coins both sheets held (BIGTROUT kept once, as backtest2 labelled
     it; the 14 others labelled the same way, kept once). See coin-origins-cleaning.md. */
  assert.equal(coins.length, 851);
  const viral = coins.filter((c) => c.origin.kind !== 'none');
  assert.equal(viral.length, 79);
  const on = (p: string) => viral.filter((c) => c.origin.kind !== 'none' && c.origin.platform === p).length;
  assert.deepEqual([on('x'), on('tiktok'), on('instagram')], [62, 11, 6]);
  assert.deepEqual(
    coins.filter((c) => c.origin.kind === 'account').map((c) => c.id),
    ['bt3:179'],
    'the one origin known only as an account, kept out of the "right origin" score',
  );
});

test('★ a post made more than ten minutes after the mint is viral after launch, never the origin', () => {
  const late = coins.filter((c) => c.origin.kind === 'afterLaunch');
  assert.deepEqual(late.map((c) => c.ticker).sort(), ['AUREON', 'BIGTROUT', 'Boardy', 'KIMCHI', 'Odysseus', 'Schrödinger', 'grok 4.5'].sort());
  for (const c of late) {
    assert.ok(c.origin.kind === 'afterLaunch' && c.origin.afterMintMs > DEFAULT_POLICY.origin.launchAllowanceMs, c.id);
  }
  const fitness = coins.find((c) => c.ticker === 'FITNESS');
  assert.equal(fitness?.origin.kind, 'post', 'posted 72 seconds after its mint: inside the allowance, still the origin');
  assert.equal(coins.filter((c) => c.ticker === 'BIGTROUT').length, 1, 'one copy');
});

test('every origin post has an id, and no share link survived the import', () => {
  for (const c of coins) {
    if (c.origin.kind !== 'post' && c.origin.kind !== 'afterLaunch') continue;
    assert.ok(c.origin.postId !== '', `${c.id} has no post id`);
    assert.doesNotMatch(c.origin.url, /vm\.tiktok|vt\.tiktok|\?/, `${c.id} kept a share link or query`);
  }
});

test('★ every coin is dated from the chain, every mint is a 32-byte address, and each is there once', () => {
  for (const c of coins) assert.ok(!Number.isNaN(Date.parse(c.createdAt)), `${c.id} has no created time`);
  for (const c of coins) assert.match(c.mint, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/, `${c.id} mint ${c.mint}`);
  assert.equal(new Set(coins.map((c) => c.mint)).size, coins.length);
});

test('★ the stored split is the seeded one, about 30% of each stratum held out', () => {
  const again = assignSplit(coins);
  for (const c of coins) assert.equal(c.split, again.get(c.id), `${c.id} is not where the seed puts it`);
  for (const stratum of ['none', 'x', 'tiktok', 'instagram']) {
    const all = coins.filter((c) => stratumOf(c.origin) === stratum);
    const held = holdout().filter((c) => stratumOf(c.origin) === stratum);
    assert.ok(held.length > 0 && held.length < all.length, `${stratum} is on both sides`);
    assert.ok(Math.abs(held.length / all.length - 0.3) < 0.1, `${stratum}: ${held.length} of ${all.length} held out`);
  }
  assert.equal(tuning().length + holdout().length, coins.length);
});

test('a Y/N label is true, false or unlabelled — never a string', () => {
  for (const c of coins) for (const v of Object.values(c.features)) assert.ok(v === true || v === false || v === null);
});
