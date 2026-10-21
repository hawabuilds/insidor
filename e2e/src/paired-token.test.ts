/**
 * ★ A TOKEN LAUNCHES ARE PAIRED AGAINST IS NOT A LAUNCH (0122), against the real schema (PGlite).
 *
 * The launch socket filed MSTRx (a tokenised stock) as the coin of every meme launched against
 * it: the row took each meme's name, and the name index kept the first one forever. This holds
 * the store's half of the fix: marking turns such a row into the token as its market names it,
 * clears the meme's launch facts, corrects the name index, and leaves the row out of every read
 * of launches; and no later launch frame can rename it or promote it back.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { Asset } from '@insidor/contracts/asset.ts';
import { assetKey, chainId, venueId } from '@insidor/contracts/ids.ts';
import { PgAssetRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const CHAIN = chainId('solana');
const VENUE = venueId(CHAIN, 'pumpfun');
const MSTRX = 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ';
const FRESH_STOCK = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';

let db: Db;
let assets: PgAssetRepo;

/** A launch frame's row, as the socket built one before the fix: the stock's address, a meme's name. */
function launchRow(address: string, name: string, atMs: number): Asset {
  const ref = { chain: CHAIN, address };
  return {
    ref,
    key: assetKey(ref),
    chain: CHAIN,
    venue: VENUE,
    origin: 'live_stream',
    mintedAt: { at: atMs as Millis, source: 'vendor_field', confidence: 'bounded', boundS: 5 },
    symbol: name.toUpperCase(),
    name,
    imageUri: null,
    decimals: 6,
    creator: '2WYpSJnoxMaDbzW2sqchD6jd6pHC8N3vLmiwgCmSvebM',
    declaredSocial: { metadata: 'https://ipfs.io/ipfs/bafkreiexample' },
    firstSeenAt: atMs as Millis,
  };
}

before(async () => {
  db = await migratedDb();
  assets = new PgAssetRepo(db);
});

test('★ a stock filed as a launch is marked: its market name, no launch facts, out of every launch read, the name index corrected', async () => {
  await assets.upsert([launchRow(MSTRX, 'Junior USD*', NOW - 60_000)]);
  await assets.recordOpenings([{ ref: { chain: CHAIN, address: MSTRX }, creatorBuyTokens: 0, creatorBuySol: 0, launchMcapSol: 27.96 }]);
  await assets.upsert([launchRow(MSTRX, 'LAURA', NOW - 30_000)]);
  const [before] = await db.query<{ name: string }>('select name from public.coin_name where address = $1', [MSTRX]);
  assert.equal(before?.name, 'Junior USD*', 'the bug as found: the name index keeps the first meme forever');

  const marked = await assets.markPaired(CHAIN, VENUE, [{ address: MSTRX, symbol: 'MSTRx', name: 'MicroStrategy xStock' }], NOW);
  assert.deepEqual(marked, [MSTRX]);
  const [row] = await db.query<Record<string, unknown>>(
    'select origin, name, symbol, minted_at, minted_at_conf, creator, declared_social, creator_buy_sol from public.asset where address = $1',
    [MSTRX],
  );
  assert.equal(row?.['origin'], 'paired_token');
  assert.equal(row?.['name'], 'MicroStrategy xStock');
  assert.equal(row?.['symbol'], 'MSTRx');
  assert.equal(row?.['minted_at'], null, 'the meme\'s launch time was never the stock\'s');
  assert.equal(row?.['minted_at_conf'], 'unknown');
  assert.equal(row?.['creator'], null);
  assert.deepEqual(row?.['declared_social'], {});
  assert.equal(row?.['creator_buy_sol'], null);

  const [named] = await db.query<{ name: string; ticker: string; launched_at: unknown }>('select name, ticker, launched_at from public.coin_name where address = $1', [MSTRX]);
  assert.deepEqual({ ...named }, { name: 'MicroStrategy xStock', ticker: 'MSTRx', launched_at: null });

  const launches = await assets.mintedBetween(CHAIN, (NOW - 3_600_000) as Millis, NOW, 100, 'observed');
  assert.equal(launches.some((a) => a.ref.address === MSTRX), false, 'a paired token is never a candidate launch');
  assert.equal(await assets.symbolSightings(CHAIN, 'MSTRx', (NOW - 3_600_000) as Millis), 0);
});

test('★ a later launch frame naming the stock cannot rename it, promote it, or give it an opening buy', async () => {
  await assets.upsert([launchRow(MSTRX, 'NEXTMEME', NOW)]);
  await assets.recordOpenings([{ ref: { chain: CHAIN, address: MSTRX }, creatorBuyTokens: 1, creatorBuySol: 1, launchMcapSol: 30 }]);
  const [row] = await db.query<{ origin: string; name: string; creator_buy_sol: unknown }>('select origin, name, creator_buy_sol from public.asset where address = $1', [MSTRX]);
  assert.deepEqual({ ...row }, { origin: 'paired_token', name: 'MicroStrategy xStock', creator_buy_sol: null });
  const [named] = await db.query<{ name: string }>('select name from public.coin_name where address = $1', [MSTRX]);
  assert.equal(named?.name, 'MicroStrategy xStock');
});

test('a paired token we never held gets a row before any frame can file it, and marking twice changes nothing', async () => {
  assert.deepEqual(await assets.markPaired(CHAIN, VENUE, [{ address: FRESH_STOCK, symbol: 'NVDAx', name: 'NVIDIA xStock' }], NOW), [FRESH_STOCK]);
  assert.deepEqual(await assets.markPaired(CHAIN, VENUE, [{ address: FRESH_STOCK, symbol: 'NVDAx', name: 'NVIDIA xStock' }], NOW), []);
  await assets.upsert([launchRow(FRESH_STOCK, 'PARABOLIC', NOW)]);
  const [row] = await db.query<{ origin: string; name: string }>('select origin, name from public.asset where address = $1', [FRESH_STOCK]);
  assert.deepEqual({ ...row }, { origin: 'paired_token', name: 'NVIDIA xStock' });
  const named = await db.query('select 1 from public.coin_name where address = $1', [FRESH_STOCK]);
  assert.equal(named.length, 0, 'a paired token never enters the name index of launches');
  assert.deepEqual([...(await assets.pairedAddresses(CHAIN, [FRESH_STOCK, MSTRX, 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump']))].sort(), [FRESH_STOCK, MSTRX].sort());
});
