/**
 * A Meter that keeps its running tally in memory and enforces a daily cap.
 *
 * This is the implementation the conformance suite, eval and local development run
 * against, and it is the tally engine underneath the durable one — `durable.ts` does
 * not reimplement the arithmetic, it seeds this and writes behind it. Both answer the
 * same question, "may we spend this?", and neither knows what to give up first. That
 * order lives in core/track.
 *
 * Every number this file needs is a constructor argument with no default. A default
 * cap is a threshold, and thresholds do not live in adapters.
 *
 * ── ★ THE TWO ARGUMENTS THAT MAKE IT SURVIVE A RESTART ──────────────────────
 *
 * `opening` and `onRecord`. Neither does anything on its own, and together they are
 * the difference between a cap that bounds a day and a cap that bounds a process.
 *
 *   opening   what today's ledger ALREADY holds when this process starts. Without it
 *             a boot believes it has spent nothing, so a supervisor restarting a
 *             crashing process hands out the daily budget once per crash — each
 *             allocation individually correct, the invoice a multiple of the cap.
 *   onRecord  where a recorded spend goes to outlive this process. Called AFTER the
 *             entry is in the tally, so a sink that throws cannot lose a spend from
 *             the in-memory number as well as from the durable one.
 *
 * They are options rather than requirements because the two callers that legitimately
 * have no ledger — a one-shot CLI, a unit test — should not have to invent one, and
 * because a meter with neither is exactly the old behaviour, which is correct for a
 * process that does not outlive its own pass.
 *
 * ── ★ WHY `record` DOES NOT AWAIT ITS SINK ──────────────────────────────────
 *
 * `Meter.record` is synchronous, and it is synchronous because it is called from
 * inside an adapter call on the path of every request — an adapter may not await a
 * database, for the same reason it may not read a clock. So the sink is handed the
 * spend and this file does not wait for it. What that costs is stated where it is
 * paid: `durable.ts` tracks the dollars whose write has not landed and reports them
 * on `BudgetLine.unrecordedUsd`, because a ledger silently falling behind reads
 * exactly like one that is keeping up.
 */

import type { BudgetLine, Meter, Spend, SpendTotals } from '@insidor/contracts/ports/meter.ts';

export interface InMemoryMeterOptions {
  /** Total dollars per day across every vendor. */
  readonly dailyCapUsd: number;
  /** Per-vendor dollars per day, for vendors that need their own named line. */
  readonly perVendorCapUsd?: Readonly<Record<string, number>>;
  /**
   * ★ THE LINE EVERY VENDOR GETS UNLESS IT HAS A NAMED ONE. Omitted means a vendor
   * with no entry above is bounded by the total and by nothing else.
   *
   * It exists because the named map cannot be built where it is needed. The vendor
   * TOKEN is an adapter's secret — the caller wiring the meter holds source ids, not
   * vendor names, and the registry that could translate between them is constructed
   * with the meter already in hand. A default sidesteps that entirely and is the
   * better rule anyway: a new source gets a line by existing, rather than by somebody
   * remembering to add it to a map. The failure mode of the map is silent and always
   * in the same direction — the source nobody added is the one with no ceiling.
   */
  readonly defaultVendorCapUsd?: number;
  /**
   * Fraction of a line at which spending stops. Below 1 it is a SOFT stop: the
   * remainder is headroom for the calls already in flight, which is what stops
   * a cap being crossed by a call we had already committed to.
   */
  readonly softStop: number;
  /** Injected, never `Date.now` — a meter that reads a clock cannot be replayed. */
  readonly now: () => number;
  /**
   * What today already holds, read from a durable ledger at boot. Omitted means a
   * fresh day — which is a claim, and one that is only true for a process with no
   * ledger behind it. See the ★ block above.
   */
  readonly opening?: SpendTotals;
  /**
   * Where a recorded spend goes to survive this process. Called after the entry is
   * in the tally, and never awaited. Must not throw — a sink that can fail is
   * responsible for catching its own failure and reporting it; see `durable.ts`.
   */
  readonly onRecord?: (spend: Spend) => void;
}

export interface InMemoryMeter extends Meter {
  readonly entries: () => readonly Spend[];
  /** Discards yesterday. Called on record, and available to tests. */
  readonly rollover: (at: number) => void;
}

const DAY_MS = 86_400_000;
const NO_OPENING: SpendTotals = { totalUsd: 0, byVendor: {} };

export const dayOf = (at: number): number => Math.floor(at / DAY_MS);

/** The first instant of the UTC day containing `at`. What a durable ledger is read from. */
export const dayStart = (at: number): number => dayOf(at) * DAY_MS;

export function inMemoryMeter(opts: InMemoryMeterOptions): InMemoryMeter {
  let day = dayOf(opts.now());
  let entries: Spend[] = [];

  /**
   * ★ THE OPENING BALANCE IS DISCARDED AT ROLLOVER, not kept.
   *
   * It describes one specific day — the day it was read for — and carrying it into the
   * next one would charge tomorrow for today's spending, permanently, for as long as
   * the process lives. A long-lived process would then look more and more exhausted
   * every day while spending nothing, and the symptom would be a system that refuses
   * every call after a week of uptime with a ledger on disk showing it had spent
   * almost nothing. The cost of dropping it is the opposite and much smaller: the new
   * day starts from this process's own view, which is complete unless a SECOND process
   * is also spending, and a second process spending is a different problem.
   */
  let opening: SpendTotals = opts.opening ?? NO_OPENING;

  const rollover = (at: number): void => {
    const d = dayOf(at);
    if (d !== day) {
      day = d;
      entries = [];
      opening = NO_OPENING;
    }
  };

  const spentUsd = (vendor?: string): number => {
    const carried = vendor === undefined ? opening.totalUsd : (opening.byVendor[vendor] ?? 0);
    return entries.reduce(
      (sum, e) => (vendor === undefined || e.vendor === vendor ? sum + e.usd : sum),
      carried,
    );
  };

  /** A vendor's own line: its named one, else the default, else none at all. */
  const vendorCapFor = (vendor: string): number | undefined =>
    opts.perVendorCapUsd?.[vendor] ?? opts.defaultVendorCapUsd;

  /** The cap that applies to a line, and where spending on it actually stops. */
  const capFor = (vendor?: string): number => {
    if (vendor === undefined) return opts.dailyCapUsd;
    const vendorCap = vendorCapFor(vendor);
    /* A vendor with no line of its own is bounded by the total and by nothing else,
       and reporting the total as its cap is the honest answer to "what is this
       source's ceiling" — not `Infinity`, which reads as unbounded, and not zero,
       which reads as forbidden. And a vendor line ABOVE the daily total is not a
       higher ceiling, it is a slack one: the total still binds first, so the minimum
       is the number a reader should be shown. */
    return vendorCap === undefined ? opts.dailyCapUsd : Math.min(vendorCap, opts.dailyCapUsd);
  };

  return {
    entries: () => entries,
    rollover,
    spentUsd,

    /**
     * The projected total is compared against the soft stop rather than the
     * cap, so the cap itself is never crossed by a call we approved. A refused
     * call is a product outcome — core decides what to give up — not an error
     * this module resolves.
     *
     * ★ BOTH LINES ARE CHECKED AND THE VENDOR LINE IS NOT A SHORTCUT. A vendor under
     * its own line may still be refused by the total, and a vendor over its own line
     * is refused even on a quiet day. That asymmetry is the point of having two: the
     * total protects the invoice, the per-vendor line protects the OTHER sources from
     * whichever one is asked first.
     */
    mayspend: (vendor, usd) => {
      rollover(opts.now());
      if (spentUsd() + usd > opts.dailyCapUsd * opts.softStop) return false;
      const vendorCap = vendorCapFor(vendor);
      if (vendorCap !== undefined && spentUsd(vendor) + usd > vendorCap * opts.softStop) return false;
      return true;
    },

    /**
     * The line as it stands, so a stage that paused can record the arithmetic that
     * paused it rather than the mood.
     *
     * `unrecordedUsd` is zero here and is not a placeholder: this meter has nowhere to
     * fall behind. A durable one wraps this and reports its own figure.
     */
    line: (vendor): BudgetLine => {
      rollover(opts.now());
      const capUsd = capFor(vendor);
      const stopAtUsd = capUsd * opts.softStop;
      const spent = spentUsd(vendor);
      return {
        capUsd,
        spentUsd: spent,
        stopAtUsd,
        remainingUsd: Math.max(stopAtUsd - spent, 0),
        unrecordedUsd: 0,
      };
    },

    record: (spend) => {
      rollover(spend.at);
      entries.push(spend);
      /* After the push, never before. A sink that threw before the entry landed would
         drop the spend from the running tally as well as from the durable one — so a
         database hiccup would hand the process back the money it had just spent. */
      opts.onRecord?.(spend);
    },
  };
}
