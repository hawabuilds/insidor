/**
 * The launch archive's follow book (launch-archive.ts): what a launch's files say, when each file is
 * due, horizon snapshots, the crash and selling facts, quiet coins dropped after 24 hours, and a
 * restart turning into `complete: false`. No bucket, no network: the book on its own.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeLaunches, decodeOutcomes } from '@insidor/storage-supabase/launch-archive.ts';

import { LaunchBook } from './launch-archive.ts';

const H = 3_600_000;
const M = 60_000;
const T0 = Date.UTC(2026, 10, 8, 14, 10);
const COIN = 'Coin1111111111111111111111111111111111111pump';

type Side = 'buy' | 'sell';
const tr = (book: LaunchBook, side: Side, maker: string, atMs: number, capUsd: number | null, tokens = 1_000_000, sol: number | null = 0.5, pool = 'pump') =>
  book.trade({ coin: COIN, side, maker, sol, usd: sol === null ? null : sol * 150, capUsd, tokens, pool, atMs });

function launched(): LaunchBook {
  const b = new LaunchBook();
  b.meta(COIN, { name: 'Corgi', symbol: 'CORGI', creator: 'dev', metadataUri: 'https://ipfs.io/x' }, T0);
  b.launched(COIN, T0, 'dev');
  tr(b, 'buy', 'dev', T0, 5_000, 50_000_000, 2);
  tr(b, 'buy', 'b1', T0 + 200, 6_000, 30_000_000, 1);
  tr(b, 'buy', 'b2', T0 + 300, 7_000, 30_000_000, 1);
  tr(b, 'buy', 'late', T0 + 30_000, 9_000);
  return b;
}

test('the launch file carries creator, name, first-minute buys, first-second buyers and the dev buy', () => {
  const b = launched();
  assert.equal(b.due(T0 + 30 * M).length, 0);
  const files = b.due(Date.UTC(2026, 10, 8, 15, 4) + 30_000);
  const f = files.find((x) => x.path === 'launches/2026-11-08/14.jsonl.gz');
  assert.ok(f, files.map((x) => x.path).join(','));
  const [r] = decodeLaunches(f.body);
  assert.equal(r?.creator, 'dev');
  assert.equal(r?.symbol, 'CORGI');
  assert.deepEqual(r?.firstBuyers, ['b1', 'b2']);
  assert.equal(r?.minuteBuys?.length, 4);
  assert.equal(r?.devBuySol, 2);
  f.done();
  assert.equal(b.due(Date.UTC(2026, 10, 8, 15, 10)).filter((x) => x.path.startsWith('launches/')).length, 0);
});

test('a horizon reports what the coin had done by then, not what came after', () => {
  const b = launched();
  tr(b, 'buy', 'x', T0 + 30 * M, 60_000);
  tr(b, 'sell', 'x', T0 + 2 * H, 9_000);
  tr(b, 'buy', 'y', T0 + 3 * H, 200_000);
  const one = b.outcomeRecord(b.coins.get(COIN)!, '1h');
  assert.equal(one.peakCapUsd, 60_000);
  assert.equal(one.crashAt, null);
  const day = b.outcomeRecord(b.coins.get(COIN)!, '24h');
  assert.equal(day.peakCapUsd, 200_000);
  assert.equal(day.crashAt, T0 + 2 * H);
});

test('dev and launch-block wallets selling are timed and sized; a trade in another pool is a graduation', () => {
  const b = launched();
  tr(b, 'sell', 'dev', T0 + 5 * M, 4_000, 25_000_000);
  tr(b, 'sell', 'b1', T0 + 6 * M, 3_000, 30_000_000);
  const g = tr(b, 'buy', 'z', T0 + 40 * M, 80_000, 1_000, 1, 'pump-amm');
  assert.equal(g?.address, COIN);
  const o = b.outcomeRecord(b.coins.get(COIN)!, '1h');
  assert.equal(o.devFirstSellAt, T0 + 5 * M);
  assert.equal(o.devSoldShare, 0.5);
  assert.equal(o.bundleFirstSellAt, T0 + 6 * M);
  assert.equal(o.bundleSoldShare, 0.5);
  assert.equal(o.graduatedAt, T0 + 40 * M);
});

test('a quiet small coin is dropped after its 24-hour file; a live one is followed to 7 days', () => {
  const b = launched();
  tr(b, 'sell', 'late', T0 + M, 3_000);
  const at24 = Date.UTC(2026, 10, 9, 15, 4);
  for (const f of b.due(at24)) f.done();
  assert.equal(b.coins.has(COIN), false);

  const live = launched();
  tr(live, 'buy', 'w', T0 + 23 * H, 90_000);
  for (const f of live.due(at24)) f.done();
  assert.equal(live.coins.has(COIN), true);
  const week = live.due(Date.UTC(2026, 10, 15, 15, 4));
  assert.ok(week.some((f) => f.path === 'outcomes/7d/2026-11-08/14.jsonl.gz'));
});

test('a restart is a gap: outcomes over it are not complete, and the book comes back from its save', () => {
  const b = launched();
  const saved = b.save(T0 + 20 * M);
  const back = new LaunchBook();
  assert.equal(back.restore(saved, T0 + 50 * M), true);
  assert.equal(back.coins.size, 1);
  const files = back.due(Date.UTC(2026, 10, 8, 16, 4));
  const one = files.find((f) => f.path.startsWith('outcomes/1h/'));
  assert.equal(decodeOutcomes(one!.body)[0]?.complete, false);
});

test('a name that arrives after the launch (the listing, minutes later) still reaches the launch file; the first one seen wins', () => {
  const b = new LaunchBook();
  b.launched(COIN, T0, 'dev');
  b.meta(COIN, { name: 'Corgi', symbol: 'CORGI', creator: null, metadataUri: 'https://x/m.json' }, T0 + 4 * M);
  b.meta(COIN, { name: 'Other', symbol: 'OTHER', creator: 'someone', metadataUri: null }, T0 + 5 * M);
  const r = b.launchRecord(b.coins.get(COIN)!);
  assert.equal(r.name, 'Corgi');
  assert.equal(r.symbol, 'CORGI');
  assert.equal(r.creator, 'dev');
  assert.equal(r.metadataUri, 'https://x/m.json');
});

test('top-10 holder share comes from each wallet’s own trades; a sale lowers it', () => {
  const b = launched();
  const o1 = b.outcomeRecord(b.coins.get(COIN)!, '1h');
  assert.equal(o1.holders, 4);
  assert.equal(o1.top10Share, (50 + 30 + 30 + 1) / 1_000);
  tr(b, 'sell', 'b1', T0 + 2 * M, 6_000, 30_000_000);
  const o2 = b.outcomeRecord(b.coins.get(COIN)!, '1h');
  assert.equal(o2.holders, 3);
});

test('take-off marks: the first time a coin reached each cap and each multiple of its opening, kept per horizon', () => {
  const b = launched();
  tr(b, 'buy', 'x', T0 + 20 * M, 16_000);
  tr(b, 'buy', 'y', T0 + 3 * H, 120_000);
  const c = b.coins.get(COIN)!;
  const one = b.outcomeRecord(c, '1h');
  assert.equal(one.reachedAt['15k'], T0 + 20 * M);
  assert.equal(one.reachedAt['2x'], T0 + 20 * M);
  assert.equal(one.reachedAt['100k'], undefined);
  assert.equal(b.outcomeRecord(c, '24h').reachedAt['100k'], T0 + 3 * H);
  assert.equal(b.outcomeRecord(c, '24h').reachedAt['10x'], T0 + 3 * H);
});
