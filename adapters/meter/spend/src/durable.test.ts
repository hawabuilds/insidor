/**
 * THE PROPERTY UNDER TEST IS THAT THE CAP SURVIVES THE PROCESS.
 *
 * Every test below is a version of one question: does a second process know what the
 * first one spent? The old meter answered no, in one line of its own header — "a
 * restart is a fresh day's budget" — and that answer is what makes a daily cap bound
 * nothing at all under the condition where a bill actually runs away, which is a
 * process that crashes and is restarted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Millis, Spend, SpendLedger, SpendTotals } from '@insidor/contracts';

import { openDurableMeter } from './durable.ts';
import { metered } from './meter.ts';
import type { PriceBook } from './units.ts';

/* Midday, so nothing here sits near a day boundary by accident. */
const AT = 1_800_036_000_000 as Millis;

const BOOK: PriceBook = {
  'acme:search': {
    vendor: 'acme',
    endpoint: 'search',
    unit: 'per-item-returned',
    usdPerUnit: 0.001,
    unitName: 'item returned',
    measuredAt: '2026-08-05',
  },
};

/**
 * A ledger on a shelf rather than in a process.
 *
 * ★ THE ROWS OUTLIVE EVERY METER BUILT AGAINST IT, which is the entire point: a
 * "restart" in these tests is a second `openDurableMeter` over the SAME store, which
 * is exactly what a supervisor does to a crashed process.
 */
function shelf(): SpendLedger & { rows: Spend[]; failWrites: boolean } {
  const store = {
    rows: [] as Spend[],
    failWrites: false,
    append: async (spend: Spend): Promise<void> => {
      if (store.failWrites) throw new Error('the database went away');
      store.rows.push(spend);
    },
    totalsSince: async (sinceMs: Millis): Promise<SpendTotals> => {
      const byVendor: Record<string, number> = {};
      let totalUsd = 0;
      for (const row of store.rows) {
        if (row.at < sinceMs) continue;
        byVendor[row.vendor] = (byVendor[row.vendor] ?? 0) + row.usd;
        totalUsd += row.usd;
      }
      return { totalUsd, byVendor };
    },
  };
  return store;
}

const spend = (usd: number, vendor = 'acme'): Spend => ({
  vendor,
  endpoint: 'search',
  unit: 'per-item-returned',
  units: 1,
  usd,
  at: AT,
});

/* ── the one that matters ──────────────────────────────────────────────── */

test('★ SPEND SURVIVES A RESTART: the second process does not get a fresh budget', async () => {
  const ledger = shelf();

  const first = await openDurableMeter({ ledger, dailyCapUsd: 1, softStop: 1, now: () => AT });
  first.record(spend(0.9));
  await first.drain();

  /* The crash. Everything the first meter held in memory is gone; only the shelf
     remains, which is the situation a supervisor creates every time it restarts. */
  const second = await openDurableMeter({ ledger, dailyCapUsd: 1, softStop: 1, now: () => AT });

  assert.equal(second.openedWith.totalUsd, 0.9, 'the new process did not read the ledger');
  assert.equal(second.spentUsd(), 0.9);
  assert.equal(
    second.mayspend('acme', 0.5),
    false,
    'a restart handed out a fresh daily budget — the cap bounds a process, not a day',
  );
  assert.equal(second.mayspend('acme', 0.05), true, 'the remaining headroom was lost too');
});

test('★ a crash LOOP cannot spend the cap once per crash', async () => {
  /* The failure in its real shape. Ten boots, each one individually enforcing a $1 cap
     correctly; the question is only whether they enforce the same dollar. */
  const ledger = shelf();
  let refusals = 0;

  for (let boot = 0; boot < 10; boot += 1) {
    const meter = await openDurableMeter({ ledger, dailyCapUsd: 1, softStop: 1, now: () => AT });
    if (meter.mayspend('acme', 0.3)) meter.record(spend(0.3));
    else refusals += 1;
    await meter.drain();
  }

  const total = ledger.rows.reduce((sum, row) => sum + row.usd, 0);
  assert.ok(total <= 1, `ten boots spent $${total.toFixed(2)} against a $1 cap`);
  assert.equal(refusals, 7, 'three boots should fit inside the cap and seven should be refused');
});

test('the ledger is read for TODAY, not for all time', async () => {
  /* A cap that summed the whole table would tighten every day until the system refused
     everything — and the symptom would be a process that stops working after a week of
     uptime with a ledger showing it had spent almost nothing. */
  const ledger = shelf();
  const DAY_MS = 86_400_000;
  ledger.rows.push({ ...spend(50), at: (AT - 3 * DAY_MS) as Millis });

  const meter = await openDurableMeter({ ledger, dailyCapUsd: 1, softStop: 1, now: () => AT });

  assert.equal(meter.openedWith.totalUsd, 0, 'yesterday was charged to today');
  assert.equal(meter.mayspend('acme', 0.5), true);
});

/* ── the ceiling itself ────────────────────────────────────────────────── */

test('★ the ceiling refuses BEFORE the call is issued, seeded balance included', async () => {
  /* `metered` consults the meter before `run()`, so a refusal means the function was
     never entered. Asserted through a flag rather than through the return value,
     because "we called and it failed" and "we never called" are the two states this
     whole mechanism exists to keep apart. */
  const ledger = shelf();
  ledger.rows.push(spend(0.95));

  const meter = await openDurableMeter({ ledger, dailyCapUsd: 1, softStop: 1, now: () => AT });
  let entered = false;

  await assert.rejects(
    metered(
      meter,
      BOOK,
      { vendor: 'acme', endpoint: 'search', unit: 'per-item-returned', estUnits: 100, at: AT },
      async () => {
        entered = true;
        return { value: null, units: 100 };
      },
    ),
  );

  assert.equal(entered, false, 'the vendor call ran despite the budget being spent');
});

test('the per-vendor default gives every vendor a line without anybody naming it', async () => {
  /* The named map cannot be built where the meter is built — the vendor token is an
     adapter's secret. A default is also the better rule: a source added next year gets
     a ceiling by existing rather than by somebody remembering to add it to a map. */
  const ledger = shelf();
  const meter = await openDurableMeter({
    ledger,
    dailyCapUsd: 10,
    defaultVendorCapUsd: 1,
    softStop: 1,
    now: () => AT,
  });

  meter.record(spend(0.9, 'acme'));

  assert.equal(meter.mayspend('acme', 0.5), false, 'a vendor exceeded its own line');
  assert.equal(meter.mayspend('other', 0.5), true, 'one vendor is spending another vendor line');
  assert.equal(meter.line('acme').capUsd, 1);
});

test('a vendor line above the daily total is reported as the total, not as a higher ceiling', async () => {
  /* The total still binds first, so showing the bigger number would tell a reader they
     have headroom that does not exist. */
  const ledger = shelf();
  const meter = await openDurableMeter({
    ledger,
    dailyCapUsd: 2,
    defaultVendorCapUsd: 100,
    softStop: 1,
    now: () => AT,
  });

  assert.equal(meter.line('acme').capUsd, 2);
});

/* ── falling behind ────────────────────────────────────────────────────── */

test('★ spend that could not be persisted is COUNTED, not merely logged', async () => {
  /* A ledger that has quietly stopped being durable reads exactly like one that is
     keeping up. This number is the only thing that distinguishes them, and it is the
     number the next process will be missing. */
  const ledger = shelf();
  ledger.failWrites = true;
  const failures: number[] = [];

  const meter = await openDurableMeter({
    ledger,
    dailyCapUsd: 1,
    softStop: 1,
    now: () => AT,
    onWriteFailure: (s) => failures.push(s.usd),
  });

  meter.record(spend(0.4));
  await meter.drain();

  assert.deepEqual(failures, [0.4]);
  assert.equal(meter.unrecordedUsd(), 0.4);
  assert.equal(meter.line().unrecordedUsd, 0.4);
});

test('a failed write does not refund the caller — this process still spent the money', async () => {
  /* The tally must hold the dollars whether or not the row landed. Rolling them back on
     a write failure would hand the process back money it had already spent, and a
     database blip would become a spending spree. */
  const ledger = shelf();
  ledger.failWrites = true;

  const meter = await openDurableMeter({ ledger, dailyCapUsd: 1, softStop: 1, now: () => AT });
  meter.record(spend(0.9));
  await meter.drain();

  assert.equal(meter.spentUsd(), 0.9);
  assert.equal(meter.mayspend('acme', 0.5), false);
});

test('unrecorded dollars are not subtracted twice from what is left', async () => {
  /* They ARE spent and the tally already holds them. Subtracting them again would
     charge for them a second time and refuse calls that are affordable. */
  const ledger = shelf();
  ledger.failWrites = true;

  const meter = await openDurableMeter({ ledger, dailyCapUsd: 1, softStop: 1, now: () => AT });
  meter.record(spend(0.4));
  await meter.drain();

  const line = meter.line();
  assert.ok(Math.abs(line.remainingUsd - 0.6) < 1e-9);
  assert.equal(line.spentUsd, 0.4);
});

test('a ledger that cannot be read fails the BOOT rather than starting empty', async () => {
  /* The one place in this money path that fails closed, and it is the right one: it
     happens before any work is in flight, and a process that cannot find out what it
     has already spent must not start spending. */
  const broken: SpendLedger = {
    append: async () => undefined,
    totalsSince: async () => {
      throw new Error('the database went away');
    },
  };

  await assert.rejects(
    openDurableMeter({ ledger: broken, dailyCapUsd: 1, softStop: 1, now: () => AT }),
  );
});
