/**
 * DISCOVER — what has the world published that we have not seen?
 *
 * ★ IT IS NOT A `makeStageLoop`, AND THE DIFFERENCE IS NOT COSMETIC. The shared stage
 * body exists to enforce one ordering: decide, log, act, mark. Discovery decides
 * nothing. It asks vendors what exists and writes the rows; whether any of it is worth
 * spending money on is ADMIT's judgement, made later, over exactly these rows, and
 * logged there. Routing discovery through the stage body would mean inventing a
 * Decision to satisfy the shape — a decision row for a verdict nobody reached, in the
 * one table whose whole value is that every row is a real judgement.
 *
 * So it implements `Loop` directly and gets everything the seven get: a run row opened
 * before the work and closed in a `finally`, an outcome of ok / empty / error, a
 * heartbeat, a health entry, backoff, and a watchdog that pages when it stops
 * finishing. What it does not get is a decision log, because it has nothing to log.
 *
 * ── ★ THE COUNTS IT REPORTS, AND WHY THEY ARE THE ONES THEY ARE ────────────
 *
 * `in` is items RETURNED BY SOURCES THAT ANSWERED and `out` is items STORED. A dark
 * source contributes to neither, ever — not as a zero, not as anything — because a
 * source we did not ask has no item count, and `internal.stage_runs.compression` is
 * computed from these two. A pass over one live source and a pass over three would
 * otherwise produce the same funnel ratio, and the ratio is the watchdog's earliest
 * signal that a stage changed behaviour without changing its exit code.
 *
 * ── ★ AND WHY `failed` COUNTS SOURCES RATHER THAN ITEMS ────────────────────
 *
 * In the seven stages a failure is one poisoned subject out of five hundred. Here it
 * is a whole vendor, so one failure is a third of our inputs — and a run whose
 * outcome went to 'error' because one of three sources was down is exactly right:
 * something is wrong, the other two still ran, and both facts are in the row.
 */

import type { Item, Policy } from '@insidor/contracts';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { DiscoveryConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import type { Loop, LoopContext, LoopCounts } from '../loop.ts';
import { declareSources, type WatchDeps } from '../sources.ts';
import { discoverPass, type DiscoveryPlan } from '../work/discover.ts';

/**
 * Five minutes.
 *
 * ★ IT MUST STAY COMFORTABLY BELOW `Policy.ingest.sourceFreshnessMs`, which is thirty,
 * or a perfectly healthy source crosses the freshness bar between passes and the
 * indicator flickers. Six cadences of headroom means a source has to miss five
 * consecutive passes before it is called failing — an outage rather than a slow
 * afternoon. Raise this and that bar has to move with it; they are one decision
 * spelled in two places and this comment is the link between them.
 *
 * It is also the cheapest cadence that matters commercially: two of the three sources
 * bill per call or per run, so a minute would be twelve times the bill for twelve
 * times less new material than an hour of arrivals contains.
 */
const EVERY_MS = 300_000;

/**
 * Last of the offsets. ADMIT is at 0 and reads what this wrote; starting discovery
 * after it means the first admit pass of a boot works on the rows already in the
 * store rather than on an empty table it then reports as a quiet minute.
 */
const OFFSET_MS = 45_000;

export interface DiscoverLoopDeps {
  readonly platforms: PlatformRegistry;
  readonly store: (items: readonly Item[]) => Promise<number>;
  readonly discovery: DiscoveryConfig;
  readonly policy: Policy;
  readonly log: Logger;
  readonly watch: WatchDeps;
}

export function discoverLoop(deps: DiscoverLoopDeps): Loop {
  const log = deps.log.child({ stage: 'discover' });

  return {
    stage: 'discover',
    everyMs: EVERY_MS,
    offsetMs: OFFSET_MS,

    async run(ctx: LoopContext): Promise<LoopCounts> {
      /* ★ FIRST, AND WHATEVER ELSE HAPPENS. What configuration says about each source
         is the half of the health record nothing else can observe, and it has to be
         true even on a pass that discovers nothing — including a pass with no live
         source at all, which is the pass most in need of an honest record. */
      await declareSources(deps.platforms, deps.watch);

      if (deps.discovery.kind === 'off') {
        /* A chosen silence, said out loud once per cadence. It is deliberately not a
           warning: somebody declared this, and a warning for a declared state is how a
           log stops being read. The sources' own health is still recorded above, so
           the indicator stays honest while nothing is being asked. */
        log.info('discovery is off; no source will be asked', {
          live: deps.platforms.all().length,
        });
        return { in: 0, out: 0, failed: 0, firstError: null };
      }

      const plan: DiscoveryPlan = { terms: deps.discovery.terms };

      const result = await discoverPass({
        platforms: deps.platforms,
        store: deps.store,
        plan,
        policy: deps.policy,
        log,
        now: ctx.now,
        signal: ctx.signal,
      });

      /* ★ THE COUNTS ARE PRINTED ON EVERY PASS INCLUDING THE HEALTHY ONES, and always
         all of them. A field that appears only when something is wrong is a field
         nobody knows the normal value of — the same rule the projector's run line
         follows for feed liveness. `dark` beside `answered` is what makes "one source
         answered" legible as either "two are off" or "two are broken". */
      log.info('discovery pass', {
        asked: result.asked,
        answered: result.answered,
        failed: result.failed,
        unasked: result.unasked,
        dark: result.dark,
        itemsSeen: result.itemsSeen,
        itemsStored: result.itemsStored,
      });

      return {
        in: result.itemsSeen,
        out: result.itemsStored,
        failed: result.failed,
        firstError: result.firstError,
      };
    },
  };
}
