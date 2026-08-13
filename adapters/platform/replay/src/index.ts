/**
 * A platform backed by recorded JSON, shipped alongside the first real adapter.
 *
 * Two reasons it exists on day one rather than later:
 *
 *   1. A port with one implementation is always secretly shaped like that
 *      implementation. A second implementation that is deliberately NOT a
 *      social network — no network, no key, no cursor semantics, capabilities
 *      that come from a file — is what proves the shape is a shape.
 *
 *   2. It gives eval/ a source with no network in it, which is why CI can
 *      forbid eval from importing adapters at all: a replay that can reach the
 *      network is not a replay, and the harness this replaces derived its label
 *      from post-outcome state exactly that way.
 *
 * Every call reports a spend of zero. A replay costs nothing, and recording a
 * fictional cost would put fiction in the one ledger that has to stay factual.
 */

import type { CounterSet, Item, Millis } from '@insidor/contracts';
import type { SourceId } from '@insidor/contracts/ids.ts';
import type { Budget, Metered } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, Discovered, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { freeSpend } from '@insidor/meter';
import { discovered } from '@insidor/vendor-kit';

import { decodeItem, readingsFor } from './tape.ts';
import type { Tape } from './tape.ts';

export const VENDOR = 'replay';

export interface ReplayOptions {
  /**
   * The recorded source's cohort function. Supply the real adapter's when
   * replaying against real baselines; the default is a coarse stand-in and will
   * not match live keys.
   */
  readonly baselineKey?: (item: Item, at: Millis) => string;
  /** Injected, like everywhere else. A replay does not read a clock either. */
  readonly now: () => Millis;
}

export interface ReplayPlatform extends PlatformAdapter {
  /** Rewinds every observation cursor. Two eval runs must not interfere. */
  readonly rewind: () => void;
}

/**
 * The adapter answers as the source it RECORDED, and there is deliberately no
 * way to rename it: a replay presenting under a new id would emit Items whose
 * own `source` disagreed with the adapter that produced them, and every
 * baseline, carrier and id would then be filed under two names. Being
 * indistinguishable from the real source is the point.
 */
export function replayPlatform(tape: Tape, opts: ReplayOptions): ReplayPlatform {
  const id: SourceId = tape.source;
  let cursors = new Map<string, number>();

  return {
    id,
    // Straight off the recording. A replay that claimed a capability the
    // recording cannot honour would test a path the real source does not have.
    capabilities: tape.capabilities,
    rewind: () => {
      cursors = new Map();
    },

    /**
     * The recording decides what was discoverable. The query's mode and term
     * are accepted and NOT applied: a tape is the answer to the query that
     * produced it, and re-filtering it here would silently change what a replay
     * is replaying. Only `limit` and `cursor` are honoured, because those are
     * about paging rather than about selection.
     */
    async discover(query: DiscoveryQuery, _budget: Budget): Promise<Metered<Discovered>> {
      // The one query field a tape may NOT ignore. Everything else is selection and
      // a tape is already the answer to its own query — but the cutoff is a
      // correctness claim, and silently serving post-cutoff items would produce a
      // replay that looks blind and is not. A tape recorded without a cutoff cannot
      // be made clean retroactively, so the honest response is to refuse.
      if (query.untilMs !== null) {
        const leaked = tape.items.filter(
          (it) => it.postedAt !== null && it.postedAt >= query.untilMs!,
        );
        if (leaked.length > 0) {
          throw new Error(
            `replay: tape "${tape.name}" holds ${leaked.length} item(s) posted at or after the ` +
              `cutoff ${new Date(query.untilMs).toISOString()}. This tape was recorded without ` +
              `that cutoff and cannot be replayed blind against it — re-record it with ` +
              `untilMs set, or replay it with untilMs null and do not call the result blind.`,
          );
        }
      }

      const from = query.cursor === null ? 0 : Number.parseInt(query.cursor, 10);
      const start = Number.isFinite(from) && from > 0 ? from : 0;
      const page = tape.items.slice(start, start + query.limit);
      const next = start + page.length;
      const hasMore = next < tape.items.length;

      return {
        value: discovered(page, hasMore ? String(next) : null, hasMore),
        spend: freeSpend(VENDOR, 'discover', opts.now()),
      };
    },

    /**
     * Successive calls return successive recorded readings, which is what makes
     * a tape useful for replaying kinetics rather than just shapes.
     *
     * An id the tape never recorded THROWS. An id whose readings are exhausted
     * is omitted — a source legitimately stops answering for a deleted post,
     * and omission is how that arrives. The two are different facts and the
     * caller must be able to tell them apart.
     */
    async observe(
      sourceItemIds: readonly string[],
      _budget: Budget,
    ): Promise<Metered<ReadonlyMap<string, CounterSet>>> {
      const out = new Map<string, CounterSet>();
      for (const sourceItemId of sourceItemIds) {
        const readings = readingsFor(tape, sourceItemId); // throws TapeMiss
        const next = cursors.get(sourceItemId) ?? 0;
        const reading = readings[next];
        if (reading === undefined) continue;
        cursors.set(sourceItemId, next + 1);
        out.set(sourceItemId, reading.counters);
      }
      return { value: out, spend: freeSpend(VENDOR, 'observe', opts.now()) };
    },

    toItem(raw: unknown, at: Millis): Item {
      return decodeItem(raw, at);
    },

    baselineKey(item: Item, at: Millis): string {
      return opts.baselineKey === undefined ? `${id}|${item.lang ?? 'und'}` : opts.baselineKey(item, at);
    },
  };
}

export { decodeItem, decodeTape, readingsFor, TapeMiss, assertTapeHonoursCapabilities } from './tape.ts';
export type { Tape, TapeReading } from './tape.ts';
export { loadTape } from './load.ts';
