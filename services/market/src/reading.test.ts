/**
 * The translation from "what the venue said" to "what we store", tested against the
 * one rule it exists to hold: an absent reading stays absent, and it says why.
 *
 * The recurring shape is an assertion that a field is `{ kind: 'absent', why }` sitting
 * next to one that it is not `{ kind: 'read', value: 0 }`. That looks redundant and is
 * not: those are both falsy-looking shapes that store and render, and the whole history
 * this repository is written against is a build in which the second silently replaced
 * the first and deleted the entire pre-graduation population from the board.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chainId, venueId } from '@insidor/contracts';
import type { Depth, MarketState } from '@insidor/contracts';

import { quotableBy, numberOf, reasonOf, toReading } from './reading.ts';

const CHAIN = chainId('solana');
const VENUE = venueId(CHAIN, 'pool');
const TAKEN_AT = 1_785_913_500_000;

const CTX = { venueId: String(VENUE), quotedBy: null };

/** A MarketState as the mapper hands one over: every market field absent by default. */
function state(overrides: Partial<MarketState> = {}): MarketState {
  return {
    asset: { chain: CHAIN, address: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump' },
    venue: VENUE,
    observedAt: TAKEN_AT,
    priceUsd: null,
    marketCapUsd: null,
    marketCapBasis: null,
    priceChange24hPct: null,
    liquidityUsd: null,
    depth: null,
    mintedAt: { at: null, source: 'none', confidence: 'unknown', boundS: null },
    transferRules: null,
    source: { vendor: 'a-vendor', endpoint: 'an-endpoint', fetchedAt: TAKEN_AT },
    ...overrides,
  };
}

const POOL: Depth = { kind: 'pool', liquidityUsd: 42_000, poolCount: 2 };
const CURVE: Depth = {
  kind: 'bonding-curve',
  progress: null,
  slippageBpsAt: { '0.1': null, '0.5': null, '1.0': null },
};

/* ── the rule: an absent reading stays absent ─────────────────────────── */

test('a coin the venue has never heard of is no_market on every field, and never zero', () => {
  /* The commonest answer this vendor gives about a coin minted four minutes ago, which
     is the population this product exists to serve. `depth: null` is the venue saying
     it found no pair at all — a different claim from any of the fields being empty. */
  const reading = toReading(state(), CTX);

  for (const field of [
    reading.priceUsd,
    reading.marketCapUsd,
    reading.liquidityUsd,
    reading.priceChange24hPct,
  ]) {
    assert.deepEqual(field, { kind: 'absent', why: 'no_market' });
    assert.notDeepEqual(field, { kind: 'read', value: 0 });
    assert.equal(numberOf(field), null);
    assert.equal(reasonOf(field), 'no_market');
  }
  assert.equal(reading.marketCapBasis, null);
});

test('a curve with no reserve says not_reported, which is a different fact from no_market', () => {
  /* ★ THE DISTINCTION THE WHOLE FILE IS FOR. This coin HAS a market — we are looking at
     its pair, we have its price — it just has no two-sided reserve to report a
     liquidity for. Calling that `no_market` would say the coin does not trade, on a row
     whose price cell has a number in it two columns away. */
  const reading = toReading(
    state({ depth: CURVE, priceUsd: 0.0000214, marketCapUsd: 21_400, marketCapBasis: 'fully-diluted' }),
    CTX,
  );

  assert.deepEqual(reading.priceUsd, { kind: 'read', value: 0.0000214 });
  assert.deepEqual(reading.liquidityUsd, { kind: 'absent', why: 'not_reported' });
  assert.notDeepEqual(reading.liquidityUsd, { kind: 'absent', why: 'no_market' });
  assert.notDeepEqual(reading.liquidityUsd, { kind: 'read', value: 0 });
});

test('a drained pool stores a real zero, and a curve stores no number at all', () => {
  /* The two fixtures the adapter keeps side by side, carried through to the row. Zero
     here is a MEASUREMENT — somebody pulled the reserve out — and it must survive the
     trip, or the constraint that distinguishes it from an absence has nothing to hold. */
  const drained = toReading(
    state({ depth: { kind: 'pool', liquidityUsd: 0, poolCount: 1 }, liquidityUsd: 0 }),
    CTX,
  );
  assert.deepEqual(drained.liquidityUsd, { kind: 'read', value: 0 });
  assert.equal(numberOf(drained.liquidityUsd), 0);
  assert.equal(reasonOf(drained.liquidityUsd), null);

  const curve = toReading(state({ depth: CURVE }), CTX);
  assert.equal(numberOf(curve.liquidityUsd), null);
  assert.notEqual(numberOf(curve.liquidityUsd), numberOf(drained.liquidityUsd));
});

test('a coin younger than a day reports no 24h change, not a change of zero', () => {
  /* Zero says the price held for a day. This coin has not existed for a day, so nobody
     observed it holding — and on the one column a user is most likely to trade on, a
     confident "flat" is a worse answer than a dash. */
  const reading = toReading(state({ depth: CURVE, priceUsd: 0.0000214 }), CTX);
  assert.deepEqual(reading.priceChange24hPct, { kind: 'absent', why: 'not_reported' });
  assert.notDeepEqual(reading.priceChange24hPct, { kind: 'read', value: 0 });
});

test('a fall is a reading, not a fault — the non-negativity guard is not pointed here', () => {
  /* Pointing the guard that protects a reserve at a signed change would silently delete
     every coin that dropped, leaving a board on which nothing ever goes down. */
  const reading = toReading(state({ depth: POOL, liquidityUsd: 42_000, priceChange24hPct: -6.94 }), CTX);
  assert.deepEqual(reading.priceChange24hPct, { kind: 'read', value: -6.94 });
  assert.equal(numberOf(reading.priceChange24hPct), -6.94);
});

/* ── the basis: never guessed, and never separated from its cap ───────── */

test('a cap arrives with its basis or it does not arrive', () => {
  const circulating = toReading(
    state({ depth: POOL, liquidityUsd: 42_000, marketCapUsd: 61_000, marketCapBasis: 'circulating' }),
    CTX,
  );
  assert.deepEqual(circulating.marketCapUsd, { kind: 'read', value: 61_000 });
  assert.equal(circulating.marketCapBasis, 'circulating');

  /* ★ A cap whose basis the venue did not state is a number whose meaning is missing.
     The two bases differ by more than a factor of ten on a coin with most of its supply
     still locked, so publishing 61,000 under a guess would put a large-coin label on a
     small coin — which is the sentence the basis field exists to make unsayable. */
  const unlabelled = toReading(
    state({ depth: POOL, liquidityUsd: 42_000, marketCapUsd: 61_000, marketCapBasis: null }),
    CTX,
  );
  assert.deepEqual(unlabelled.marketCapUsd, { kind: 'absent', why: 'unreadable' });
  assert.equal(unlabelled.marketCapBasis, null);
});

test('a basis never survives a cap it cannot describe', () => {
  /* 0010 asserts the same biconditional as a CHECK, so a row that broke this would be
     refused by the database. This is the same rule stated where it can be tested
     without one. */
  const capless = toReading(state({ depth: POOL, liquidityUsd: 1, marketCapBasis: 'circulating' }), CTX);
  assert.equal(numberOf(capless.marketCapUsd), null);
  assert.equal(capless.marketCapBasis, null);
});

/* ── values that arrived and are not readings ─────────────────────────── */

test('a negative price is unreadable, and is stored as neither a number nor a no_market', () => {
  /* The adapter already refuses these, so this fires only if that guard is ever
     relaxed — which is exactly when a silent negative or a coerced zero would cost the
     most. `unreadable` also keeps it out of the `no_market` count, so a mapper bug does
     not disguise itself as a market full of untraded coins. */
  const reading = toReading(state({ depth: POOL, liquidityUsd: 42_000, priceUsd: -1 }), CTX);
  assert.deepEqual(reading.priceUsd, { kind: 'absent', why: 'unreadable' });
  assert.notDeepEqual(reading.priceUsd, { kind: 'read', value: 0 });
  assert.notDeepEqual(reading.priceUsd, { kind: 'absent', why: 'no_market' });
});

test('a non-finite number is unreadable rather than becoming NaN in a column', () => {
  const reading = toReading(state({ depth: POOL, liquidityUsd: Number.NaN }), CTX);
  assert.deepEqual(reading.liquidityUsd, { kind: 'absent', why: 'unreadable' });
});

/* ── tradability: decided by asking, never by a number in this row ────── */

test('★ a venue that cannot be asked for a quote cannot make a coin tradable', () => {
  /* The data vendor this service reads through declares `read` and not `trade`, so
     there is nobody to ask and nothing to stand behind. Note what is NOT consulted:
     this coin has a deep pool and a live price, and it is still not tradable — because
     liquidity is not quotability, and gating on it is forbidden by name in
     contracts/src/asset.ts. */
  const readOnly = { id: VENUE };
  assert.equal(quotableBy(readOnly), null);

  const rich = toReading(
    state({ depth: POOL, liquidityUsd: 42_000, priceUsd: 0.0031, marketCapUsd: 61_000, marketCapBasis: 'circulating' }),
    { venueId: String(VENUE), quotedBy: quotableBy(readOnly) },
  );
  assert.equal(rich.tradable, false);
  assert.equal(rich.quotedBy, null);
});

test('tradable is true only beside the name of the venue that quoted', () => {
  /* 0010's `tradable_requires_a_quoting_venue` refuses the row otherwise, so the two
     move together or neither moves. A `true` with nobody's name on it is a Buy button
     in front of an order that cannot fill. */
  const quoting = { id: venueId(CHAIN, 'curve'), trade: {} };
  assert.equal(quotableBy(quoting), 'solana:curve');

  const reading = toReading(state({ depth: CURVE, priceUsd: 0.0000214 }), {
    venueId: String(VENUE),
    quotedBy: quotableBy(quoting),
  });
  assert.equal(reading.tradable, true);
  assert.equal(reading.quotedBy, 'solana:curve');
});

/* ── provenance and the instant ───────────────────────────────────────── */

test('the reading is stamped when it was TAKEN, not when it is written', () => {
  /* The projector's freshness rule is enforced against this instant. A row that said
     "now" when it meant "twenty minutes ago" would defeat the staleness guarantee from
     the inside, and nothing downstream could tell. */
  const reading = toReading(state({ observedAt: TAKEN_AT - 20 * 60_000 }), CTX);
  assert.equal(reading.takenAt, TAKEN_AT - 20 * 60_000);
  assert.notEqual(reading.takenAt, Date.now());
});

test('the asset is spelled both ways, and the key is the one storable spelling', () => {
  const reading = toReading(state(), CTX);
  assert.equal(reading.chain, 'solana');
  assert.equal(reading.address, 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump');
  assert.equal(reading.assetKey, 'solana:Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump');
});

test('provenance is carried, and the venue on the row is a venue rather than a vendor', () => {
  /* `source_vendor` names who we paid and is why the projector's SELECT does not list
     it: a vendor's name reaching a user leaks who we buy from, and the projector throws
     on one at any depth of a payload. `venue_id` is the market that answered. */
  const reading = toReading(state(), CTX);
  assert.equal(reading.sourceVendor, 'a-vendor');
  assert.equal(reading.sourceEndpoint, 'an-endpoint');
  assert.equal(reading.venueId, 'solana:pool');
});

test('exactly one of the number and the reason is set, on every field of every shape', () => {
  /* The invariant 0010 enforces four times as a CHECK, asserted here across the four
     shapes a reading can take so that a row this service builds is never one the
     database has to refuse. */
  const shapes = [
    state(),
    state({ depth: CURVE, priceUsd: 0.0000214, marketCapUsd: 21_400, marketCapBasis: 'fully-diluted' }),
    state({ depth: POOL, liquidityUsd: 42_000, priceUsd: 0.0031, priceChange24hPct: 12.5, marketCapUsd: 61_000, marketCapBasis: 'circulating' }),
    state({ depth: POOL, liquidityUsd: -3, priceUsd: Number.POSITIVE_INFINITY }),
  ];

  for (const shape of shapes) {
    const reading = toReading(shape, CTX);
    for (const field of [
      reading.priceUsd,
      reading.marketCapUsd,
      reading.liquidityUsd,
      reading.priceChange24hPct,
    ]) {
      assert.equal(
        (numberOf(field) === null) !== (reasonOf(field) === null),
        true,
        'a field carried both a number and a reason, or neither',
      );
    }
    assert.equal(
      (numberOf(reading.marketCapUsd) === null) === (reading.marketCapBasis === null),
      true,
      'a cap and its basis disagreed about whether they exist',
    );
  }
});
