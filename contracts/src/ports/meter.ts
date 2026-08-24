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

/**
 * One billable call, recorded where it happened. It carries BOTH `units` and `usd`
 * rather than just the dollars: the dollars are what core reasons about, and the units
 * are the only way to tell a price change from a volume change afterwards. A bill that
 * doubled is a different investigation depending on which of the two moved, and a record
 * holding only the total cannot answer it.
 */
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
 *
 * ★ NO ADAPTER IN THIS REPOSITORY READS IT, AND THE STOP DOES NOT COME FROM HERE.
 * Saying so is not an apology, it is a warning: this type reads like the thing that
 * bounds a bill and it is not, so anyone tuning `capUsd` to make a run cheaper is
 * tuning nothing. What actually refuses is `Meter.mayspend`, consulted by `metered()`
 * BEFORE the request goes out, against `BudgetPolicy.dailyUsd` and the per-source
 * line. `maxCalls` is the one field here with no equivalent on the meter — dollars
 * cannot bound a vendor that rations requests rather than money — and it is
 * documented as unenforced on the source it matters to.
 */
export interface Budget {
  readonly capUsd: number;
  readonly spentUsd: number;
  /** Hard call ceiling for rate-limited vendors, or null when only dollars bind. */
  readonly maxCalls: number | null;
  /** Wall-clock deadline for this unit of work. */
  readonly deadline: Millis;
}

/**
 * What one call WOULD cost, worked out WITHOUT making it.
 *
 * ★ THIS TYPE IS WHY A DRY RUN IS POSSIBLE AT ALL, and why "what will this cost me"
 * is answerable before any money is spent. The alternative — reading the price book
 * from the caller — cannot work: the price book lives inside the adapter, keyed by a
 * vendor token and an endpoint that nothing above the adapter is entitled to know,
 * and the estimated unit count depends on how that particular vendor bills (a page of
 * items, a single call, one actor run). Only the adapter can answer, so the adapter
 * is asked, and it answers in dollars.
 *
 * ★ AND IT IS A SEPARATE TYPE FROM `Spend` ON PURPOSE. A Spend is a measurement of a
 * call that happened; a CostEstimate is an arithmetic projection of one that did not.
 * They are the same shape and they are not the same fact, and the day they share a
 * type is the day a dry run's projection can be written into the ledger as if money
 * had moved. `estUnits` rather than `units` is the other half of that: the name says
 * the number was estimated, everywhere it is read.
 */
export interface CostEstimate {
  /** Opaque vendor token, as on Spend. Two sources may share one bill. */
  readonly vendor: string;
  readonly endpoint: string;
  readonly unit: BillingUnit;
  /** Units we expect to consume. Pessimistic where a vendor's page size is its choice. */
  readonly estUnits: number;
  /** Dollars this call would cost at the adapter's own measured rate. */
  readonly usd: number;
}

/**
 * ★ THE NUMBERS BEHIND A REFUSAL, so a stage that stopped for money can SAY so.
 *
 * `mayspend` answers yes or no, and a boolean is not enough to record with: a stage
 * that paused writes a row, and a row saying only "paused" is indistinguishable from
 * a row saying "we chose not to ask" a week later, when the question is whether the
 * cap was too low or the vendor was down. So the meter can be asked for the line
 * itself, and the pause carries the arithmetic that produced it.
 *
 * It is a snapshot and not a live view. A caller holding one after another call has
 * been recorded is holding a fact about the past, which is the correct thing to write
 * into a log and the wrong thing to make a second decision from.
 */
export interface BudgetLine {
  /** The daily cap this line is measured against. */
  readonly capUsd: number;
  /** Spent so far today, on this vendor or across all of them. */
  readonly spentUsd: number;
  /** Where spending actually stops — the cap times the soft-stop fraction. */
  readonly stopAtUsd: number;
  /** Dollars still available before the stop. Clamped at zero, never negative. */
  readonly remainingUsd: number;
  /**
   * ★ SPEND THIS PROCESS COULD NOT PERSIST. Above zero, the ledger on disk is
   * behind the ledger in memory, and a restart will forget the difference and
   * hand the next process a budget it has already partly spent. It is surfaced
   * rather than logged and dropped because a cap that quietly stopped being
   * durable is a cap that reads exactly like a working one.
   */
  readonly unrecordedUsd: number;
}

/**
 * The running tally, held by the service and written to by adapters.
 *
 * `record` is called BEFORE the value is returned, and that ordering is the whole
 * reliability of the number: a spend recorded after the return is a spend that goes
 * missing whenever the caller throws, and the calls that throw are not a random sample —
 * they cluster on exactly the vendors and the hours you most want the figure for.
 */
export interface Meter {
  /** Called by the adapter, once per billable call, before the value is returned. */
  record(spend: Spend): void;
  /** Total for a vendor in the current interval; drives the soft stop. */
  spentUsd(vendor?: string): number;
  /** False once the soft-stop fraction of a line is consumed. */
  mayspend(vendor: string, usd: number): boolean;
  /**
   * The line as it stands, for a vendor or across all of them. Read after a
   * refusal so the pause can be recorded with its numbers rather than as a mood.
   */
  line(vendor?: string): BudgetLine;
}

/**
 * The ledger that survives the process.
 *
 * ★ WHY THIS IS A SEPARATE PORT AND NOT A SECOND `Meter`. `Meter` is synchronous by
 * necessity — it is consulted inside an adapter call, on the path of every request,
 * and an adapter may not await a database (see the platform port on `handles`). A
 * durable ledger is I/O. So the two are composed rather than merged: the meter holds
 * the tally and answers instantly, and this port is read ONCE at boot to seed it and
 * written behind every record to outlive the process.
 *
 * ★ AND WHY IT MATTERS: without it, `dailyCapUsd` means "per process lifetime", not
 * "per day". A process that crashes and is restarted by a supervisor gets a fresh
 * budget every time it boots, so a crash loop spends the daily cap once per crash.
 * That is the single way a cap that is genuinely enforced still fails to bound a bill.
 */
export interface SpendLedger {
  /** Every dollar recorded on or after `sinceMs`, totalled overall and per vendor. */
  totalsSince(sinceMs: Millis): Promise<SpendTotals>;
  /** One recorded call. Append-only: a correction is a new row, never an edit. */
  append(spend: Spend): Promise<void>;
}

export interface SpendTotals {
  readonly totalUsd: number;
  /** Keyed by the same opaque vendor token `Spend` carries. */
  readonly byVendor: Readonly<Record<string, number>>;
}
