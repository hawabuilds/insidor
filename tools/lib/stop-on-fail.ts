/**
 * The re-tune's gradings stop paying once the run has already failed.
 *
 * The re-tune grades the new block and the block in use side by side (tools/retune.ts,
 * `Promise.all`), so a run finishes inside its start-ahead window. `Promise.all` rejects on the
 * first grading that throws — an embedding outage, a line too short — and the run is recorded as
 * failed, but the other gradings are not cancelled: they go on embedding and asking the judge for
 * minutes, and their answers are thrown away. Measured on the ledger: the 18 Oct run failed at
 * 10:57 and $0.455 of judge calls followed; the 27 Oct run failed at 00:19 and $0.627 of judge
 * calls and $0.201 of embeddings followed, all after `internal.judge_retune` said "failed".
 *
 * Here the run's gradings share one flag. The first to fail sets it, and from then on every other
 * grading's meter refuses before a call leaves (`mayspend` false → the adapter's BudgetRefused),
 * so the orphans end within one call. Separate from retune.ts because that file runs its command
 * when loaded and cannot be tested; separate from shared-meter.ts because this is about one run's
 * siblings, not about the books.
 *
 * ★ ZERO CHANGE TO ANY RUN THAT DOES NOT FAIL: until a grading rejects, the wrapped meter is the
 * meter — same record, same refusals, same line. A run that fails still fails, with the same first
 * error (`Promise.all` keeps the first rejection; later ones are swallowed as before), and nothing
 * the orphans would have produced was ever read.
 *
 * What breaks if changed carelessly: the flag must be set only on a REJECTION. Setting it on a
 * grading that merely returns unanswered rows would refuse the sibling's calls in a run that goes
 * on to be graded — the sibling would come back unanswered and the block would be kept for an
 * outage that never happened. And the flag is per run: shared across runs, one failure would
 * starve the next.
 */

import type { Meter } from '../../contracts/src/ports/meter.ts';

export interface RunStop {
  /** True once any grading of this run has rejected. */
  readonly stopped: () => boolean;
  /** The grading's own promise, marking the run stopped if it rejects; the rejection is passed on unchanged. */
  readonly watch: <T>(p: Promise<T>) => Promise<T>;
  /** The meter, refusing every call once the run is stopped; otherwise exactly the meter. */
  readonly meter: (m: Meter) => Meter;
}

export function runStop(): RunStop {
  let stopped = false;
  return {
    stopped: () => stopped,
    watch: (p) =>
      p.catch((error: unknown) => {
        stopped = true;
        throw error;
      }),
    meter: (m) => ({
      record: (spend) => m.record(spend),
      spentUsd: (vendor) => m.spentUsd(vendor),
      mayspend: (vendor, usd) => !stopped && m.mayspend(vendor, usd),
      line: (vendor) => m.line(vendor),
    }),
  };
}
