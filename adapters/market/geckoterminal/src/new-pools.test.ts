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
