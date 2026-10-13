/**
 * The owner's pasted coin address at the service edge: only the owner reaches it, a coin nobody
 * knows saves nothing, a save replaces the post's coin call, and a post we do not hold is queued.
 * The check's rule (coin-check.ts) runs on stand-in sources. No network, no database.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Person } from '@insidor/contracts/ports/people.ts';

import { coinCheck, type CoinCheck } from './coin-check.ts';
import { mintOf, postIdOf } from './owner-coin.ts';
import { ownerRoute } from './owner.ts';

const OWNER = { wallets: ['OwnerWallet111'], xHandles: [] };
const MINT = 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump';
const POSTED = 1_791_897_210_000;
const person = (wallet: string): Person => ({ userId: 'u1', handle: null, name: null, pictureUrl: null, wallets: [{ address: wallet, kind: 'embedded' }] });

function fakeDb(stored: boolean) {
  const writes: { sql: string; params: readonly unknown[] }[] = [];
  return {
    writes,
    db: {
      query: async (sql: string, params: readonly unknown[] = []) => {
        if (sql.includes('from public.item')) return (stored ? [{ at: POSTED }] : []) as never[];
        if (sql.startsWith('insert')) {
          writes.push({ sql, params });
          return (sql.includes('owner_feedback') ? [{ kind: 'coin_match', itemId: params[2], call: 'right', coin: params[3], at: 1 }] : []) as never[];
        }
        return [] as never[];
      },
    },
  };
}

const found: CoinCheck = { read: async (m) => ({ address: m, name: 'HomeView', ticker: 'HomeView', logoUrl: null, marketCapUsd: 40_000, highestMarketCapUsd: 490_000, highestWhy: null, launchedAt: POSTED + 18 * 60_000 }) };
const call = (sub: string, body: unknown, me: Person | null, deps: Parameters<typeof ownerRoute>[2]) => ownerRoute({ method: 'POST', seg: ['owner', sub], query: new URLSearchParams(), body }, me, deps);

test('★ only the owner: signed out 401, anyone else 403, and nothing is read or written', async () => {
  const { db, writes } = fakeDb(true);
  let reads = 0;
  const counting: CoinCheck = { read: async (m) => { reads += 1; return found.read(m); } };
  for (const sub of ['coin-check', 'coin-label']) {
    assert.equal((await call(sub, { coin: MINT, itemId: 'x:1' }, null, { db, owner: OWNER, coinCheck: counting }))?.status, 401);
    assert.equal((await call(sub, { coin: MINT, itemId: 'x:1' }, person('Someone222'), { db, owner: OWNER, coinCheck: counting }))?.status, 403);
  }
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('the check previews the coin against the post; a launch after the post is a positive gap', async () => {
  const { db, writes } = fakeDb(true);
  const r = await call('coin-check', { coin: ` ${MINT} `, itemId: 'x:2109995948407476369' }, person('OwnerWallet111'), { db, owner: OWNER, coinCheck: found });
  assert.equal(r?.status, 200);
  const b = JSON.parse(r?.body ?? '{}');
  assert.equal(b.found, true);
  assert.equal(b.launchedAfterMs, 18 * 60_000);
  assert.equal(writes.length, 0, 'a check never writes');
});

test("★ a coin nobody knows is \"Can't find this coin\" and nothing is saved; a bad address is refused first", async () => {
  const { db, writes } = fakeDb(true);
  const none: CoinCheck = { read: async () => null };
  const deps = { db, owner: OWNER, coinCheck: none };
  const check = await call('coin-check', { coin: MINT, itemId: 'x:1' }, person('OwnerWallet111'), deps);
  assert.equal(JSON.parse(check?.body ?? '{}').found, false);
  assert.equal((await call('coin-label', { coin: MINT, itemId: 'x:1' }, person('OwnerWallet111'), deps))?.status, 404);
  assert.equal((await call('coin-label', { coin: '0OIl-not-a-coin', itemId: 'x:1' }, person('OwnerWallet111'), deps))?.status, 400);
  const down: CoinCheck = { read: async () => { throw new Error('down'); } };
  assert.equal((await call('coin-label', { coin: MINT, itemId: 'x:1' }, person('OwnerWallet111'), { db, owner: OWNER, coinCheck: down }))?.status, 503);
  assert.equal(writes.length, 0);
});

test('a save is a right call with the address; a post we do not hold needs its link and is queued as missed', async () => {
  const held = fakeDb(true);
  const saved = await call('coin-label', { coin: MINT, itemId: 'x:2109995948407476369' }, person('OwnerWallet111'), { db: held.db, owner: OWNER, coinCheck: found });
  assert.equal(saved?.status, 201);
  assert.equal(held.writes.length, 1);
  assert.deepEqual(held.writes[0]?.params.slice(0, 4), ['wallet:OwnerWallet111', 'u1', 'x:2109995948407476369', MINT]);

  const missing = fakeDb(false);
  assert.equal((await call('coin-label', { coin: MINT, itemId: 'x:5' }, person('OwnerWallet111'), { db: missing.db, owner: OWNER, coinCheck: found }))?.status, 400);
  const queued = await call('coin-label', { coin: MINT, postUrl: 'https://x.com/johnternus/status/2109995948407476369?s=20' }, person('OwnerWallet111'), { db: missing.db, owner: OWNER, coinCheck: found });
  assert.equal(queued?.status, 201);
  assert.ok(missing.writes[0]?.sql.includes('internal.missed_post'));
  assert.equal(missing.writes[1]?.params[2], 'x:2109995948407476369');
});

test('a post link becomes the id the runner stores it under; anything else is not a post', () => {
  assert.equal(postIdOf('https://x.com/johnternus/status/2109995948407476369'), 'x:2109995948407476369');
  assert.equal(postIdOf('https://twitter.com/a/status/123456789/photo/1'), 'x:123456789');
  assert.equal(postIdOf('https://www.tiktok.com/@someone/video/7695920757234355470'), 'tiktok:7695920757234355470');
  assert.equal(postIdOf('https://x.com/johnternus'), null);
  assert.equal(postIdOf('http://x.com/a/status/123456789'), null);
  assert.equal(mintOf(`solana:${MINT}`), MINT);
  assert.equal(mintOf('0x1234'), null);
});

test('★ the check keeps only the exact address, and the highest cap scales the price high by the cap now', async () => {
  const check = coinCheck({
    launchpad: null,
    markets: [{ search: async () => ({ capped: false, hits: [
      { address: 'Other111111111111111111111111111111', name: 'HomeView by Apple', ticker: 'HOMEWIEW', venue: 'curve', marketAddress: null, createdAt: 1, marketCapUsd: 9, imageUrl: null, source: 'a' },
      { address: MINT, name: 'HomeView', ticker: '$HomeView', venue: 'pool', marketAddress: null, createdAt: POSTED + 60_000, marketCapUsd: 40_000, imageUrl: 'https://img.example/x.png', source: 'a' },
    ] }) }],
    history: async () => ({ highest: 0.0005, last: 0.00004 }),
  });
  const c = await check.read(MINT);
  assert.equal(c?.name, 'HomeView');
  assert.equal(c?.ticker, 'HomeView');
  assert.equal(Math.round(c?.highestMarketCapUsd ?? 0), 500_000);
  assert.equal(c?.launchedAt, POSTED + 60_000);
  assert.equal(await check.read('Nobody11111111111111111111111111111'), null);
  const blind = coinCheck({ launchpad: null, markets: [{ search: async () => { throw new Error('down'); } }], history: null });
  await assert.rejects(blind.read(MINT), 'nobody read is an outage, never "no such coin"');
});
