/**
 * The newest pools, read from a recorded reply: only the curve's launches, each named from its
 * own token row.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { NEW_POOLS } from './__fixtures__/new-pools.ts';
import { readNewLaunches } from './new-pools.ts';

test("★ only the curve's launches come back; other launchpads and graduated pools do not", () => {
  const hits = readNewLaunches(NEW_POOLS);
  const curvePools = NEW_POOLS.data.filter((p) => p.relationships.dex.data.id === 'pump-fun').length;
  assert.equal(hits.length, curvePools);
  assert.ok(hits.length > 0);
  for (const h of hits) {
    assert.equal(h.venue, 'curve');
    assert.ok(h.address.length >= 32 && !h.address.startsWith('solana_'));
    assert.ok(h.createdAt !== null && Number.isFinite(h.createdAt));
  }
  const others = NEW_POOLS.data.filter((p) => p.relationships.dex.data.id !== 'pump-fun').map((p) => p.relationships.base_token.data.id.slice(7));
  assert.equal(hits.some((h) => others.includes(h.address)), false, 'a pool on another dex is not a launch on the curve');
});

test("each launch carries its token's own name and symbol", () => {
  const hits = readNewLaunches(NEW_POOLS);
  for (const h of hits) {
    const token = NEW_POOLS.included.find((t) => t.id === `solana_${h.address}`);
    if (token === undefined) continue;
    assert.equal(h.name, token.attributes.name);
    assert.equal(h.ticker, token.attributes.symbol);
  }
});

test('without the token rows the ticker still comes from the pool name, and the name is unknown', () => {
  const hits = readNewLaunches({ data: NEW_POOLS.data });
  assert.ok(hits.length > 0);
  for (const h of hits) assert.equal(h.name, null);
  assert.ok(hits.every((h) => h.ticker !== null));
});

test('a reply that is not a list reads as no launches', () => {
  assert.deepEqual(readNewLaunches(null), []);
  assert.deepEqual(readNewLaunches({ data: 'x' }), []);
});

/* Two launches on the curve as the vendor lists them with `include=base_token,quote_token`: one
   priced in SOL, one in MSTRx (the MicroStrategy xStock) — the shape Laura's launch had. */
const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const MSTRX = 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ';
const SOLCOIN = 'Eqkhz4SxCbvksXbEwUsMgVfpP7fZTv3YNHLGL4YdDBwr';
const WSOL = 'So11111111111111111111111111111111111111112';
const pool = (address: string, name: string, base: string, quote: string) => ({
  id: `solana_${address}`,
  type: 'pool',
  attributes: { address, name, pool_created_at: '2026-10-16T20:30:36Z', fdv_usd: '4100.0', market_cap_usd: null },
  relationships: {
    base_token: { data: { id: `solana_${base}`, type: 'token' } },
    quote_token: { data: { id: `solana_${quote}`, type: 'token' } },
    dex: { data: { id: 'pump-fun', type: 'dex' } },
  },
});
const token = (address: string, name: string, symbol: string) => ({ id: `solana_${address}`, type: 'token', attributes: { address, name, symbol } });
const PAIRED = {
  data: [
    pool('Fv44ZP4nZa45cT7Vv2UaQ8o5jNdrZzjuE3jvT1jPYVDK', 'Laura / MSTRx', LAURA, MSTRX),
    pool('86hVRu9KG89cG1tEYMA8fdaSFrUDk2Mom9cmo12DYxrU', 'LONGCAT / SOL', SOLCOIN, WSOL),
  ],
  included: [
    token(LAURA, 'Laura', 'Laura'),
    token(MSTRX, 'MicroStrategy xStock', 'MSTRx'),
    token(SOLCOIN, 'Long Cat', 'LONGCAT'),
    token(WSOL, 'Wrapped SOL', 'SOL'),
  ],
};

test("★ a launch paired against a stock is the pool's base coin, and carries the stock as what it is paired with", () => {
  const [laura, longcat] = readNewLaunches(PAIRED);
  assert.equal(laura?.address, LAURA, 'the launched coin is the base, never the quote');
  assert.equal(laura?.name, 'Laura');
  assert.deepEqual(laura?.pairedWith, { address: MSTRX, symbol: 'MSTRx', name: 'MicroStrategy xStock' });
  assert.equal(longcat?.address, SOLCOIN);
  assert.equal(longcat?.pairedWith, null, 'a SOL launch is paired with nothing worth naming');
});

test('without the quote token rows the pairing is still known by address', () => {
  const [laura] = readNewLaunches({ data: PAIRED.data });
  assert.deepEqual(laura?.pairedWith, { address: MSTRX, symbol: null, name: null });
});
