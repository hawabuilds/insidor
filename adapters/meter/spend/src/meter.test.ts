/**
 * The first test here is the one that matters: a call that throws is still
 * billed. That is the live bug this wrapper exists to make impossible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BudgetRefused } from '@insidor/vendor-kit';

import { inMemoryMeter } from './in-memory.ts';
import { metered } from './meter.ts';
import { BillingMismatch, UnpricedCall, usdFor } from './units.ts';
import type { PriceBook } from './units.ts';

const AT = 1_800_000_000_000;

const BOOK: PriceBook = {
  'acme:search': {
    vendor: 'acme',
    endpoint: 'search',
    unit: 'per-item-returned',
    usdPerUnit: 0.001,
    unitName: 'item returned',
    measuredAt: '2026-08-05',
  },
  'acme:run': {
    vendor: 'acme',
    endpoint: 'run',
    unit: 'per-run',
    usdPerUnit: 0.02,
    unitName: 'actor run',
    measuredAt: '2026-08-05',
  },
  'acme:sub': {
    vendor: 'acme',
    endpoint: 'sub',
    unit: 'flat',
    usdPerUnit: 99,
    unitName: 'month',
    measuredAt: '2026-08-05',
  },
};

const ledger = (dailyCapUsd: number, perVendorCapUsd?: Readonly<Record<string, number>>) =>
  perVendorCapUsd === undefined
    ? inMemoryMeter({ dailyCapUsd, softStop: 1, now: () => AT })
    : inMemoryMeter({ dailyCapUsd, perVendorCapUsd, softStop: 1, now: () => AT });

test('a call that throws is still recorded — the vendor billed us either way', async () => {
  const meter = ledger(10);

  await assert.rejects(
    metered(meter, BOOK, { vendor: 'acme', endpoint: 'search', unit: 'per-item-returned', estUnits: 20, at: AT }, async () => {
      throw new Error('vendor returned a shape we could not parse');
    }),
  );

  assert.equal(meter.entries().length, 1);
  assert.equal(meter.entries()[0]?.units, 20); // the estimate, the only honest number available
  assert.equal(meter.spentUsd(), 0.02);
});

test('a successful call records the units the vendor actually charged for', async () => {
  const meter = ledger(10);

  const out = await metered(
    meter,
    BOOK,
    { vendor: 'acme', endpoint: 'search', unit: 'per-item-returned', estUnits: 100, at: AT },
    async () => ({ value: ['a', 'b'], units: 2 }),
  );

  assert.deepEqual(out.value, ['a', 'b']);
  assert.equal(out.spend.units, 2);
  assert.equal(out.spend.usd, 0.002);
  assert.equal(out.spend.at, AT);
  assert.equal(meter.entries().length, 1);
});

test('a vendor that itemises its own charge overrides the price book', async () => {
  const meter = ledger(10);

  const out = await metered(meter, BOOK, { vendor: 'acme', endpoint: 'run', unit: 'per-run', estUnits: 1, at: AT }, async () => ({
    value: null,
    units: 1,
    usdActual: 0.0731,
  }));

  assert.equal(out.spend.usd, 0.0731);
  assert.equal(meter.spentUsd(), 0.0731);
});

test('calling a per-run vendor as if it billed per item is an error, not a number', async () => {
  const meter = ledger(10);

  await assert.rejects(
    metered(meter, BOOK, { vendor: 'acme', endpoint: 'run', unit: 'per-item-returned', estUnits: 50, at: AT }, async () => ({
      value: null,
      units: 50,
    })),
    BillingMismatch,
  );
  assert.equal(meter.entries().length, 0, 'a refused call never reached the vendor');
});

test('an unpriced call refuses to run rather than being estimated', async () => {
  const meter = ledger(10);
  await assert.rejects(
    metered(meter, BOOK, { vendor: 'acme', endpoint: 'mystery', unit: 'per-call', estUnits: 1, at: AT }, async () => ({
      value: null,
      units: 1,
    })),
    UnpricedCall,
  );
});

test('the cap stops the next call before it is made, so it is never crossed', async () => {
  // The pre-check prices the ESTIMATE, not the spend so far: a call that would
  // cross the line is refused before the vendor is asked, rather than after.
  const meter = ledger(0.015);
  const spec = { vendor: 'acme', endpoint: 'search', unit: 'per-item-returned' as const, estUnits: 10, at: AT };

  await metered(meter, BOOK, spec, async () => ({ value: 1, units: 10 })); // $0.010
  await assert.rejects(metered(meter, BOOK, spec, async () => ({ value: 2, units: 10 })), BudgetRefused);
  assert.equal(meter.entries().length, 1);
  assert.ok(meter.spentUsd() <= 0.015, 'the cap was never crossed');
});

test('a per-vendor cap stops one vendor without stopping the rest', () => {
  const meter = ledger(100, { acme: 0.001 });
  assert.equal(meter.mayspend('acme', 0.0005), true);
  meter.record({ vendor: 'acme', endpoint: 'search', unit: 'per-call', units: 1, usd: 0.002, at: AT });
  assert.equal(meter.mayspend('acme', 0.0005), false);
  assert.equal(meter.mayspend('other', 0.0005), true);
});

test('a soft stop leaves headroom for calls already in flight', () => {
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 0.8, now: () => AT });
  meter.record({ vendor: 'acme', endpoint: 'search', unit: 'per-call', units: 1, usd: 0.79, at: AT });
  assert.equal(meter.mayspend('acme', 0.005), true);
  assert.equal(meter.mayspend('acme', 0.05), false, 'stops at the soft line, not at the cap');
});

test('a flat subscription has no marginal cost', () => {
  const price = BOOK['acme:sub'];
  assert.ok(price);
  assert.equal(usdFor(price, 1_000), 0);
});

test('spend resets when the day rolls over', () => {
  let t = AT;
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => t });
  meter.record({ vendor: 'acme', endpoint: 'search', unit: 'per-call', units: 1, usd: 0.5, at: t });
  assert.equal(meter.spentUsd(), 0.5);
  t += 86_400_000;
  meter.rollover(t);
  assert.equal(meter.spentUsd(), 0);
});
