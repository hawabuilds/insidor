/**
 * The meter a paid tool spends under: its own stage cap AND the owner's daily lines, on the same
 * ledger (internal.spend) the live runner writes.
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
 * What breaks if changed carelessly: `close` drains the ledger writes before the pool ends.
 * Skipping it loses the last calls' spend, which the runner would then hand out again.
 */

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import { inMemoryMeter, openDurableMeter } from '../../adapters/meter/spend/src/index.ts';
import { asDb, createPool, DB_ROLE, PgSpendRepo } from '../../store/src/index.ts';
import { vendorLines } from '../../services/runner/src/vendor-lines.ts';

const P = DEFAULT_POLICY;

export interface SharedMeter {
  readonly meter: Meter;
  readonly close: () => Promise<void>;
}

export async function openSharedMeter(stageCapUsd: number, env: Record<string, string | undefined> = process.env): Promise<SharedMeter> {
  const url = env['DATABASE_URL_INTERNAL'] || env['DATABASE_URL'];
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-paid-job' });
  const asked = Number(env['DAILY_BUDGET_USD']);
  const shared = await openDurableMeter({
    ledger: new PgSpendRepo(asDb(pool)),
    dailyCapUsd: Number.isFinite(asked) && asked > 0 ? Math.min(asked, P.budget.dailyUsd) : P.budget.dailyUsd,
    perVendorCapUsd: vendorLines(P),
    defaultVendorCapUsd: P.budget.perSourceUsdPerDay,
    softStop: P.budget.softStopFraction,
    now: Date.now,
    onWriteFailure: (spend, error) => console.error(`a ${spend.vendor} spend of $${spend.usd.toFixed(4)} did not reach the ledger: ${error instanceof Error ? error.message : String(error)}`),
  });
  const own = inMemoryMeter({ dailyCapUsd: stageCapUsd, softStop: 1, now: Date.now });
  const timer = setInterval(() => {
    shared.refresh().catch((error: unknown) => console.warn(`the spend ledger could not be re-read: ${error instanceof Error ? error.message : String(error)}`));
  }, P.budget.ledgerRefreshMs);
  timer.unref();

  const meter: Meter = {
    record: (spend) => {
      own.record(spend);
      shared.record(spend);
    },
    /* The stage's own spend: what each tool reports as "spent". */
    spentUsd: (vendor) => own.spentUsd(vendor),
    mayspend: (vendor, usd) => own.mayspend(vendor, usd) && shared.mayspend(vendor, usd),
    line: (vendor) => {
      const a = own.line(vendor);
      const b = shared.line(vendor);
      return { ...a, remainingUsd: Math.min(a.remainingUsd, b.remainingUsd), unrecordedUsd: b.unrecordedUsd };
    },
  };

  return {
    meter,
    close: async () => {
      clearInterval(timer);
      await shared.drain();
      await pool.end();
    },
  };
}
