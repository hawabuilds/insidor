/**
 * The one wrapper every adapter call passes through.
 *
 * Two properties, and both were absent from the build this replaces:
 *
 *   1. Spend is MEASURED, not estimated. The Spend is recorded on BOTH the
 *      success and the failure path. Today the equivalent line sits inside
 *      `if (parsed)`, so every rejected response was billed by the vendor and
 *      invisible to us — the error path, which is exactly the path that runs
 *      during an incident, was free in our books.
 *
 *   2. A cap can actually stop it. `mayspend` is consulted BEFORE the request,
 *      so the wrapper can refuse. The adapter does not decide what is
 *      affordable — it asks, and reports. Which tier to shed when money runs
 *      low is a product judgement and lives in core, where it is testable.
 *
 * The meter deliberately does not retry, cache, or rate-limit. Those change
 * what the vendor is asked, and this thing exists to say what was asked.
 */

import type { Millis } from '@insidor/contracts';
import type { BillingUnit, Meter, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import { BudgetRefused } from '@insidor/vendor-kit';

import type { PriceBook } from './units.ts';
import { BillingMismatch, priceOf, usdFor } from './units.ts';

export interface CallSpec {
  readonly vendor: string;
  /** Narrow: 'search', 'lookup', 'judge', 'embed'. Prices are per endpoint. */
  readonly endpoint: string;
  /** What the CALLER believes it is billed as. Checked against the price book. */
  readonly unit: BillingUnit;
  /** Units we expect to consume. Used for the pre-check and as the fallback. */
  readonly estUnits: number;
  /** Injected. An adapter never calls a clock, and neither does its ledger. */
  readonly at: Millis;
}

/** What a vendor call returns: the value, plus what it actually cost us. */
export interface Billed<T> {
  readonly value: T;
  /** Units the vendor actually charged for — items returned, runs, calls. */
  readonly units: number;
  /**
   * Set only when the vendor itemises the charge itself (token counts, for
   * instance). When absent the price book prices `units`.
   */
  readonly usdActual?: number;
}

export async function metered<T>(
  meter: Meter,
  book: PriceBook,
  spec: CallSpec,
  run: () => Promise<Billed<T>>,
): Promise<Metered<T>> {
  const price = priceOf(book, spec.vendor, spec.endpoint);
  if (price.unit !== spec.unit) {
    throw new BillingMismatch(spec.vendor, spec.endpoint, spec.unit, price.unit);
  }

  if (!meter.mayspend(spec.vendor, usdFor(price, spec.estUnits))) {
    throw new BudgetRefused(spec.vendor, spec.endpoint, 'soft stop reached');
  }

  // Charged even if the call throws: the vendor bills on receipt, not on our
  // ability to parse. On failure we fall back to the estimate, which is the
  // only honest number available at that point.
  const settle = (units: number, usdActual: number | null): Spend => {
    const spend: Spend = {
      vendor: spec.vendor,
      endpoint: spec.endpoint,
      unit: price.unit,
      units,
      usd: usdActual ?? usdFor(price, units),
      at: spec.at,
    };
    meter.record(spend);
    return spend;
  };

  let billed: Billed<T>;
  try {
    billed = await run();
  } catch (error) {
    settle(spec.estUnits, null);
    throw error;
  }

  return { value: billed.value, spend: settle(billed.units, billed.usdActual ?? null) };
}

/**
 * Several calls, one line in the ledger's caller-facing result.
 *
 * A batched read is one logical call to everything above the adapter, and
 * reporting it as several would make a per-decision cost meaningless. Every
 * individual Spend was already recorded; this is the summary that travels with
 * the value.
 */
export function mergeSpend(spends: readonly Spend[], fallback: CallSpec, unit: BillingUnit): Spend {
  if (spends.length === 1 && spends[0] !== undefined) return spends[0];
  return {
    vendor: fallback.vendor,
    endpoint: fallback.endpoint,
    unit,
    units: spends.reduce((sum, s) => sum + s.units, 0),
    usd: spends.reduce((sum, s) => sum + s.usd, 0),
    at: fallback.at,
  };
}

/** A call that cost nothing and touched no vendor. Replays are free; say so. */
export const freeSpend = (vendor: string, endpoint: string, at: Millis): Spend => ({
  vendor,
  endpoint,
  unit: 'flat',
  units: 0,
  usd: 0,
  at,
});
