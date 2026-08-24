/**
 * What a vendor charges for, and how much.
 *
 * Billing differs in KIND, not degree: one vendor bills per item returned, the
 * next per actor run, the next a flat subscription. A single `costOf(call)`
 * cannot express all three, and pretending it can is how a per-item budget
 * helper from one vendor ended up imported by an adapter for a vendor that
 * bills per run — the same dollar figure, arrived at by arithmetic that meant
 * nothing. So `unit` travels WITH the price, the caller declares the unit it
 * believes it is under, and a mismatch is an error rather than a number.
 *
 * `measuredAt` is here because the old constants were stale in the expensive
 * direction — a scoring call priced at $0.003 against a measured $0.00127 —
 * which paused work at a third of affordable throughput. A price with no date
 * on it is a guess, and this field makes the guess visible.
 */

import type { BillingUnit, CostEstimate } from '@insidor/contracts/ports/meter.ts';

export interface Price {
  readonly vendor: string;
  /** The specific call. Prices are per endpoint, never per vendor. */
  readonly endpoint: string;
  readonly unit: BillingUnit;
  /** Dollars per unit. For 'flat', this is the subscription — not a marginal cost. */
  readonly usdPerUnit: number;
  /** What one unit IS: 'item returned', 'actor run', 'call', 'month'. */
  readonly unitName: string;
  /** ISO date the rate was last checked against a real invoice. */
  readonly measuredAt: string;
}

/** Keyed `${vendor}:${endpoint}`. A plain object so a price book is JSON. */
export type PriceBook = Readonly<Record<string, Price>>;

export const priceKey = (vendor: string, endpoint: string): string => `${vendor}:${endpoint}`;

export class UnpricedCall extends Error {
  readonly vendor: string;
  readonly endpoint: string;

  constructor(vendor: string, endpoint: string) {
    super(`no price for ${priceKey(vendor, endpoint)} — add it to the price book, do not estimate`);
    this.name = 'UnpricedCall';
    this.vendor = vendor;
    this.endpoint = endpoint;
  }
}

/**
 * The error that makes the billing-kind leak structural: you cannot bill a
 * per-run vendor through a per-item price, even if the numbers multiply.
 */
export class BillingMismatch extends Error {
  readonly expected: BillingUnit;
  readonly found: BillingUnit;

  constructor(vendor: string, endpoint: string, expected: BillingUnit, found: BillingUnit) {
    super(`${priceKey(vendor, endpoint)} is billed ${found}, called as ${expected}`);
    this.name = 'BillingMismatch';
    this.expected = expected;
    this.found = found;
  }
}

export function priceOf(book: PriceBook, vendor: string, endpoint: string): Price {
  const price = book[priceKey(vendor, endpoint)];
  if (price === undefined) throw new UnpricedCall(vendor, endpoint);
  return price;
}

/**
 * Dollars for a call, given the units it actually consumed.
 *
 * 'flat' returns 0 deliberately: the marginal cost of one more call under a
 * subscription is zero, and spreading the subscription across calls would make
 * a cheap day look expensive and a busy day look cheap. The subscription is a
 * fixed cost and belongs in a monthly line, not in a per-call ledger.
 */
export function usdFor(price: Price, units: number): number {
  if (!Number.isFinite(units) || units < 0) {
    throw new RangeError(`${priceKey(price.vendor, price.endpoint)}: units must be finite and >= 0`);
  }
  return price.unit === 'flat' ? 0 : price.usdPerUnit * units;
}

/**
 * What a call WOULD cost, priced from the same book that will bill it.
 *
 * ★ THE POINT IS THAT IT IS THE SAME BOOK. A dry run whose estimate came from
 * anywhere but the price book the live path uses is a dry run that answers a
 * different question from the one asked, and the divergence would appear exactly
 * when a rate was updated in one place — which is the moment somebody is checking
 * the estimate against an invoice and concluding the meter is broken.
 *
 * ★ AND IT THROWS `UnpricedCall` RATHER THAN RETURNING ZERO for a call with no
 * entry. An unpriced call is not a free call, and a dry run that silently reported
 * $0.00 for a vendor nobody had priced would be a budget answer made out of a
 * missing row — the same failure as writing a zero where a counter does not exist.
 */
export function estimateFor(
  book: PriceBook,
  vendor: string,
  endpoint: string,
  estUnits: number,
): CostEstimate {
  const price = priceOf(book, vendor, endpoint);
  return { vendor, endpoint, unit: price.unit, estUnits, usd: usdFor(price, estUnits) };
}
