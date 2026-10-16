/**
 * The meter a paid tool spends under: its own stage cap AND the jobs' daily lines
 * (Policy.budget.jobLines), in the jobs' own book on the ledger the live runner writes.
 *
 * Separate from the tools because every paid tool must take it the same way. A tool on a private
 * in-memory meter is invisible to the runner: both would spend the whole of a line each, and the
 * day's bill would be the sum. Here every call must pass both checks, is recorded in both, and the
 * shared side re-reads the ledger on the same timer as the runner, so each sees the other.
 *
 * Not paced over the day, unlike the runner: a one-off job is bounded by its stage cap and by
 * what is left of each line, and pacing it would stall it for hours after midnight. The runner,
 * paced, then sees the line as spent and slows — the line holds either way.
 *
 * ★ ON THE LEARNING BOOK, A TEST UNLESS SAID OTHERWISE (the owner, 2026-10-16: "reserve re-tune money
 * first"; "cap tests and experiments at $1/day total, and never let them block re-tunes"). Only the
 * scheduled re-tune passes `use: 'retune'` and may spend the whole book. Every other tool is a test:
 * its rows are `learn:test:`, it is held to the book less the re-tune's reserve AND to the tests'
 * own day (Policy.budget.learningLines.testsUsd, every vendor together), and a call that would cross
 * either is refused before it is made. Defaulting to "test" is the safe direction: a new tool that
 * forgets to say what it is can never eat the reserve.
 *
 * What breaks if changed carelessly: `close` drains the ledger writes before the pool ends.
 * Skipping it loses the last calls' spend, which the runner would then hand out again.
 */

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import { JOB_ENDPOINT_PREFIX, LEARN_ENDPOINT_PREFIX, LEARN_TEST_ENDPOINT_PREFIX, type Meter } from '../../contracts/src/ports/meter.ts';
import { inMemoryMeter, openDurableMeter } from '../../adapters/meter/spend/src/index.ts';
import { asDb, createPool, DB_ROLE, PgSpendRepo } from '../../store/src/index.ts';
import { jobVendorLines, learningDailyCapUsd, testsLineUsd, vendorLines, type LearningUse } from '../../services/runner/src/vendor-lines.ts';

const P = DEFAULT_POLICY;

export interface SharedMeter {
  readonly meter: Meter;
  readonly close: () => Promise<void>;
}

/* `live` is for a one-off the owner asked to bill to the live supplier lines (the crypto re-read of
   the test posts, 2026-10-13): no endpoint prefix, the runner's own lines and day's cap.
   `use` matters on the learning book only: 'retune' for the scheduled re-tune, else a test. */
export async function openSharedMeter(stageCapUsd: number, env: Record<string, string | undefined> = process.env, book: 'jobs' | 'learning' | 'live' = 'jobs', use: Extract<LearningUse, 'retune' | 'test'> = 'test'): Promise<SharedMeter> {
  const test = book === 'learning' && use === 'test';
  const dailyCapUsd = book === 'learning' ? learningDailyCapUsd(P, use) : book === 'live' ? P.budget.dailyUsd : P.budget.jobLines.dailyUsd;
  const prefix = book === 'learning' ? (test ? LEARN_TEST_ENDPOINT_PREFIX : LEARN_ENDPOINT_PREFIX) : book === 'live' ? '' : JOB_ENDPOINT_PREFIX;
  const url = env['DATABASE_URL_INTERNAL'] || env['DATABASE_URL'];
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-paid-job' });
  const ledger = new PgSpendRepo(asDb(pool));
  const durable = (b: 'jobs' | 'learning' | 'live' | 'learningTests', cap: number, perVendor: Readonly<Record<string, number>>) =>
    openDurableMeter({
      /* The tests' meter reads the ledger and never writes it: the book's meter writes each row once. */
      ledger: b === 'learningTests' ? { totalsSince: (since) => ledger.totalsSince(since), append: async () => undefined } : ledger,
      /* The jobs' own book and lines: a job never spends the live feed's money (Policy.budget.jobLines). */
      book: b,
      dailyCapUsd: cap,
      perVendorCapUsd: perVendor,
      defaultVendorCapUsd: P.budget.perSourceUsdPerDay,
      vendorLinesWarnOnly: !P.budget.vendorLinesStop,
      softStop: P.budget.softStopFraction,
      now: Date.now,
      onWriteFailure: (spend, error) => console.error(`a ${spend.vendor} spend of $${spend.usd.toFixed(4)} did not reach the ledger: ${error instanceof Error ? error.message : String(error)}`),
    });
  const shared = await durable(book, dailyCapUsd, book === 'live' ? vendorLines(P) : jobVendorLines(P, book));
  /* A test's own day, every vendor together: read from the ledger like the book, never written to (the book writes). */
  const tests = test ? await durable('learningTests', testsLineUsd(P), {}) : null;
  const own = inMemoryMeter({ dailyCapUsd: stageCapUsd, softStop: 1, now: Date.now });
  const timer = setInterval(() => {
    Promise.all([shared.refresh(), tests?.refresh()]).catch((error: unknown) => console.warn(`the spend ledger could not be re-read: ${error instanceof Error ? error.message : String(error)}`));
  }, P.budget.ledgerRefreshMs);
  timer.unref();

  const meter = combinedMeter({ own, shared, tests, prefix });

  return {
    meter,
    close: async () => {
      clearInterval(timer);
      await shared.drain();
      await pool.end();
    },
  };
}

/**
 * Every call must pass the stage's own cap, the book's line and (a test) the tests' line, and is
 * recorded in all three, labelled with the book's prefix. Separate so it can be tested on meters
 * held in memory: the tests' line refusing a call before it is made is the property that matters.
 */
export function combinedMeter(m: { readonly own: Meter; readonly shared: Meter; readonly tests: Meter | null; readonly prefix: string }): Meter {
  return {
    record: (spend) => {
      m.own.record(spend);
      /* Labelled as a job's (or a learning or test row), so the runner keeps it out of its pace (SpendTotals.jobs). */
      const labelled = { ...spend, endpoint: `${m.prefix}${spend.endpoint}` };
      m.shared.record(labelled);
      m.tests?.record(labelled);
    },
    /* The stage's own spend: what each tool reports as "spent". */
    spentUsd: (vendor) => m.own.spentUsd(vendor),
    mayspend: (vendor, usd) => m.own.mayspend(vendor, usd) && m.shared.mayspend(vendor, usd) && (m.tests === null || m.tests.mayspend(vendor, usd)),
    line: (vendor) => {
      const a = m.own.line(vendor);
      const b = m.shared.line(vendor);
      /* The tests' line is every vendor together: its total, whichever vendor is asked about. */
      const t = m.tests === null ? null : m.tests.line();
      return { ...a, remainingUsd: Math.min(a.remainingUsd, b.remainingUsd, t?.remainingUsd ?? Infinity), unrecordedUsd: b.unrecordedUsd };
    },
  };
}
