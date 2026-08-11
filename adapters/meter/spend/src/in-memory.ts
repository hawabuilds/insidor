/**
 * A Meter that keeps its ledger in memory and enforces a daily cap.
 *
 * This is the implementation the conformance suite, eval and local development
 * run against; the production one writes the same Spend rows to the store.
 * Both answer the same question — "may we spend this?" — and neither knows what
 * to give up first. That order lives in core/track.
 *
 * Every number this file needs is a constructor argument with no default. A
 * default cap is a threshold, and thresholds do not live in adapters.
 */

import type { Meter, Spend } from '@insidor/contracts/ports/meter.ts';

export interface InMemoryMeterOptions {
  /** Total dollars per day across every vendor. */
  readonly dailyCapUsd: number;
  /** Per-vendor dollars per day. A vendor with no entry is capped only by the total. */
  readonly perVendorCapUsd?: Readonly<Record<string, number>>;
  /**
   * Fraction of a line at which spending stops. Below 1 it is a SOFT stop: the
   * remainder is headroom for the calls already in flight, which is what stops
   * a cap being crossed by a call we had already committed to.
   */
  readonly softStop: number;
  /** Injected, never `Date.now` — a meter that reads a clock cannot be replayed. */
  readonly now: () => number;
}

export interface InMemoryMeter extends Meter {
  readonly entries: () => readonly Spend[];
  /** Discards yesterday. Called on record, and available to tests. */
  readonly rollover: (at: number) => void;
}

const DAY_MS = 86_400_000;
const dayOf = (at: number): number => Math.floor(at / DAY_MS);

export function inMemoryMeter(opts: InMemoryMeterOptions): InMemoryMeter {
  let day = dayOf(opts.now());
  let entries: Spend[] = [];

  const rollover = (at: number): void => {
    const d = dayOf(at);
    if (d !== day) {
      day = d;
      entries = [];
    }
  };

  const spentUsd = (vendor?: string): number =>
    entries.reduce((sum, e) => (vendor === undefined || e.vendor === vendor ? sum + e.usd : sum), 0);

  return {
    entries: () => entries,
    rollover,
    spentUsd,

    /**
     * The projected total is compared against the soft stop rather than the
     * cap, so the cap itself is never crossed by a call we approved. A refused
     * call is a product outcome — core decides what to give up — not an error
     * this module resolves.
     */
    mayspend: (vendor, usd) => {
      rollover(opts.now());
      if (spentUsd() + usd > opts.dailyCapUsd * opts.softStop) return false;
      const vendorCap = opts.perVendorCapUsd?.[vendor];
      if (vendorCap !== undefined && spentUsd(vendor) + usd > vendorCap * opts.softStop) return false;
      return true;
    },

    record: (spend) => {
      rollover(spend.at);
      entries.push(spend);
    },
  };
}
