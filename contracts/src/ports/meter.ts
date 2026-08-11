/**
 * METERING — what a call cost, in dollars, recorded where the call happened.
 *
 * WHY billing is a declared unit and not a number: vendors bill in kinds that do not
 * reconcile. One charges per item returned, another per call, another per run of a
 * job, another a flat monthly fee. A single `costOf(call)` cannot express all four,
 * and in the build this replaces the leak was literal — one vendor's ingest imported
 * the other vendor's per-item budget helper, so a per-run charge was counted as if
 * it were per item. Declaring the unit on the adapter makes that import fail.
 *
 * The core reasons only in dollars. It never sees a unit, a vendor or an endpoint.
 */

import type { Millis } from '../vocabulary.ts';

export const BILLING_UNITS = ['per-item-returned', 'per-call', 'per-run', 'flat'] as const;

export type BillingUnit = (typeof BILLING_UNITS)[number];

export interface Spend {
  /** Opaque vendor token. Never appears in core/ or in any projection. */
  readonly vendor: string;
  readonly endpoint: string;
  readonly unit: BillingUnit;
  /** Countable units consumed, in the unit above. */
  readonly units: number;
  readonly usd: number;
  readonly at: Millis;
}

/** Any adapter result that cost money arrives paired with what it cost. */
export interface Metered<T> {
  readonly value: T;
  readonly spend: Spend;
}

/**
 * What an adapter is handed instead of a wallet. It is passed in and never read from
 * a global, so a replay can hand over a budget that is already spent and get the same
 * refusals the original run got.
 */
export interface Budget {
  readonly capUsd: number;
  readonly spentUsd: number;
  /** Hard call ceiling for rate-limited vendors, or null when only dollars bind. */
  readonly maxCalls: number | null;
  /** Wall-clock deadline for this unit of work. */
  readonly deadline: Millis;
}

export interface Meter {
  /** Called by the adapter, once per billable call, before the value is returned. */
  record(spend: Spend): void;
  /** Total for a vendor in the current interval; drives the soft stop. */
  spentUsd(vendor?: string): number;
  /** False once the soft-stop fraction of a line is consumed. */
  mayspend(vendor: string, usd: number): boolean;
}
