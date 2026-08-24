/**
 * A Meter whose daily cap survives the process that enforces it.
 *
 * ── ★ THE FAILURE THIS FILE EXISTS TO CLOSE ─────────────────────────────────
 *
 * `inMemoryMeter` enforces a cap correctly and forgets it on exit. Its own header
 * said so in one line — "a restart is a fresh day's budget" — and that line is the
 * whole gap, because the condition under which a bill actually runs away is not a
 * busy afternoon, it is a process that crashes and is restarted. `main.ts` exits on
 * an uncaught exception, every supervisor worth deploying under restarts on exit, and
 * a process crashing once a minute would receive fourteen hundred correctly-enforced
 * daily budgets in a day. Nothing throws, nothing looks wrong, and the invoice is a
 * multiple of the number somebody typed into policy.
 *
 * ── ★ WHY IT IS A COMPOSITION AND NOT AN IMPLEMENTATION ─────────────────────
 *
 * `Meter` is synchronous by necessity: `metered()` consults `mayspend` inside the
 * adapter call, before the request goes out, and an adapter may not await a database
 * any more than it may read a clock. So a "store-backed Meter" cannot exist in the
 * obvious shape — the read would have to happen on the hot path. What can exist is
 * this: the durable ledger is read ONCE, at boot, to seed the tally, and written
 * BEHIND every record to outlive the process. The arithmetic stays in one place,
 * `in-memory.ts`, and this file adds memory to it.
 *
 * ── ★ WHAT HAPPENS WHEN THE WRITE FAILS, WHICH IS THE INTERESTING CASE ──────
 *
 * The write is not awaited, so a failure cannot be returned to the caller — and it
 * must not be, because the alternative is a database hiccup refusing a vendor call
 * that was affordable. It is also not merely logged: a log line is the same thing as
 * silence at three in the morning, and the state it announces is precise and
 * dangerous. Unpersisted dollars are dollars the NEXT process will not know about, so
 * they are counted, and the total travels on `BudgetLine.unrecordedUsd` where the
 * pause record and the health line can both see it. A ledger that has quietly stopped
 * being durable reads exactly like one that is keeping up, and this number is the
 * only thing that distinguishes them.
 *
 * ★ IT DOES NOT FAIL CLOSED ON A WRITE ERROR, AND THAT IS A DECISION. Refusing every
 * subsequent call because the ledger is unreachable would turn a database blip into a
 * total ingest outage — the monitoring taking down the thing it monitors, which
 * `sources.ts` refuses for the same reason. The in-memory tally is still correct for
 * THIS process, which is the process doing the spending; what is lost is only the
 * handover to the next one, and that loss is reported rather than acted on.
 */

import type {
  BudgetLine,
  Meter,
  Spend,
  SpendLedger,
  SpendTotals,
} from '@insidor/contracts/ports/meter.ts';
import type { Millis } from '@insidor/contracts';

import { dayStart, inMemoryMeter } from './in-memory.ts';
import type { InMemoryMeterOptions } from './in-memory.ts';

export interface DurableMeterOptions
  extends Omit<InMemoryMeterOptions, 'opening' | 'onRecord'> {
  /** Where spend is read from at boot and written to afterwards. */
  readonly ledger: SpendLedger;
  /**
   * Called when a spend could not be persisted. Reporting only — the meter has
   * already counted the dollars and does not act on the failure. Kept as a callback
   * rather than a logger so this package needs no logging dependency.
   */
  readonly onWriteFailure?: (spend: Spend, error: unknown) => void;
}

export interface DurableMeter extends Meter {
  /** Today's ledger as it stood when this meter was opened. Reported at boot. */
  readonly openedWith: SpendTotals;
  /** Dollars recorded by this process that are not on disk. Zero is the healthy value. */
  readonly unrecordedUsd: () => number;
  /**
   * Resolves when every write issued so far has settled. For a clean shutdown and for
   * tests — NEVER on the hot path, which is the whole reason `record` is synchronous.
   */
  readonly drain: () => Promise<void>;
}

/**
 * Read today's ledger, then build a meter seeded with it.
 *
 * ★ ASYNC, AND THE READ IS NOT OPTIONAL. A constructor that started empty and filled
 * itself in later would spend the first calls of every boot against a budget it had
 * not yet checked — and the first calls of a boot are exactly the calls a crash loop
 * consists of. So the read happens before the meter exists, and a failed read fails
 * the boot: a process that cannot find out what it has already spent must not start
 * spending. That is the one place in this money path that fails closed, and it is the
 * right one, because it happens before any work is in flight and its failure mode is
 * a process that does not start rather than an ingest that silently stops.
 */
export async function openDurableMeter(opts: DurableMeterOptions): Promise<DurableMeter> {
  const openedWith = await opts.ledger.totalsSince(dayStart(opts.now()) as Millis);

  let unrecordedUsd = 0;
  /* Every write issued, so a shutdown can wait for them. Settled writes are removed,
     so this is bounded by the writes actually in flight rather than by the day. */
  const inFlight = new Set<Promise<void>>();

  const persist = (spend: Spend): void => {
    /* Counted as unrecorded BEFORE the write is issued, and subtracted when it lands.
       The other order has a window in which a spend is on neither side of the books,
       and that window is exactly the moment a crash would land in. */
    unrecordedUsd += spend.usd;

    const write = opts.ledger
      .append(spend)
      .then(() => {
        unrecordedUsd -= spend.usd;
      })
      .catch((error: unknown) => {
        /* The dollars stay counted as unrecorded — that is the fact, and it is the
           number the next process will be missing. */
        opts.onWriteFailure?.(spend, error);
      })
      .finally(() => {
        inFlight.delete(write);
      });

    inFlight.add(write);
  };

  /* Spread rather than assigned, because `exactOptionalPropertyTypes` makes an
     explicitly-undefined optional a different type from an omitted one — and the
     difference matters here: an explicit `undefined` cap would read as a declared
     absence of a ceiling rather than as a question nobody asked. */
  const inner = inMemoryMeter({
    dailyCapUsd: opts.dailyCapUsd,
    ...(opts.perVendorCapUsd === undefined ? {} : { perVendorCapUsd: opts.perVendorCapUsd }),
    ...(opts.defaultVendorCapUsd === undefined ? {} : { defaultVendorCapUsd: opts.defaultVendorCapUsd }),
    softStop: opts.softStop,
    now: opts.now,
    opening: openedWith,
    onRecord: persist,
  });

  return {
    openedWith,
    unrecordedUsd: () => unrecordedUsd,
    drain: async () => {
      /* Awaited in a loop rather than once, because a write settling can be the thing
         that issues another. `allSettled` because a rejected write is already handled
         above; re-throwing it here would make a clean shutdown fail over a spend that
         has been correctly reported as unrecorded. */
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },

    record: (spend) => inner.record(spend),
    spentUsd: (vendor) => inner.spentUsd(vendor),
    mayspend: (vendor, usd) => inner.mayspend(vendor, usd),

    /**
     * The inner line, with the one number the inner meter cannot know.
     *
     * ★ `unrecordedUsd` IS NOT SUBTRACTED FROM `remainingUsd`, and that is deliberate.
     * Those dollars ARE spent and the tally already holds them, so subtracting them
     * again would charge for them twice and refuse calls that are affordable. It is
     * reported as a separate figure because it answers a different question — not "how
     * much is left" but "how much of what we know will the next process not know".
     */
    line: (vendor): BudgetLine => ({ ...inner.line(vendor), unrecordedUsd }),
  };
}
