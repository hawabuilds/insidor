/**
 * THE PLATFORM PORT — everything a source of items can do, in two verbs.
 *
 * `discover` finds things we have not seen. `observe` re-reads things we already
 * know about. Everything else an adapter does is translation: `toItem` is the only
 * function in the repository permitted to know one source's field names.
 *
 * ★ CAPABILITIES IS THE PART THAT USUALLY GETS LEFT OUT AND THEN COSTS A REWRITE.
 * A port with one implementation is always secretly shaped like that implementation.
 * Sources differ in what they even count: one has no reach figure at all, another
 * exposes reproduction as a pointer on the child rather than as a count. Declaring
 * what a source CANNOT do — `absent`, required, not optional — is what stops the
 * core assuming everyone can do what the first implementation could. The build this
 * replaces wrote a zero where the concept did not exist, and a zero is indistinguishable
 * from a measurement.
 */

import type { Item, CounterKind, CounterSet, Fidelity, Millis } from '../vocabulary.ts';
import type { SourceId } from '../ids.ts';
import type { Budget, BillingUnit, Metered } from './meter.ts';

export const DISCOVERY_MODES = ['keyword', 'hashtag', 'feed', 'catalog', 'account'] as const;

/**
 * Discovery verbs do not line up across sources, and pretending they do is worse
 * than admitting they do not: a uniform `search()` returns an empty result on the
 * source that cannot search, which reads downstream as "nothing is happening".
 */
export type DiscoveryMode = (typeof DISCOVERY_MODES)[number];

export interface Capabilities {
  readonly source: SourceId;
  /** Counters this source exposes at all. */
  readonly counters: readonly CounterKind[];
  /** ★ REQUIRED. Counters this source has no concept of. Absent is not zero. */
  readonly absent: readonly CounterKind[];
  /** Measured, per counter — sources round some fields and not others in one payload. */
  readonly fidelity: Readonly<Partial<Record<CounterKind, Fidelity>>>;
  readonly discovery: readonly DiscoveryMode[];
  /** Does re-reading by id work, and how many per call? null means it does not. */
  readonly observeBatchSize: number | null;
  /** Does this source expose a copy-with-authorship pointer at all? */
  readonly lineage: boolean;
  /** Differs in KIND across vendors and therefore cannot be averaged. */
  readonly billing: BillingUnit;
}

export interface DiscoveryQuery {
  readonly mode: DiscoveryMode;
  /** Interpreted by the adapter in its own terms; opaque to core. */
  readonly term: string;
  readonly sinceMs: Millis | null;
  /**
   * ★ THE ANTI-CONTAMINATION CUTOFF. Nothing published at or after this instant may
   * be returned, and an adapter that cannot enforce it must fail rather than filter
   * client-side — a result already counted against budget has already leaked.
   *
   * Live discovery passes null. Replay passes the decision instant, which is what
   * makes a historical run structurally blind rather than blind by good intentions.
   * Without it every backtest is contaminated: you go looking for the source post
   * knowing the coin exists, and the crowd's reaction to the coin is sitting in the
   * replies you are about to score. The previous build's backtest measured features
   * on exactly that contaminated surface, which is why its results could not be used
   * in either direction.
   */
  readonly untilMs: Millis | null;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface Discovered {
  readonly items: readonly Item[];
  readonly cursor: string | null;
  /** True when the vendor said there is more, not when we guessed there is. */
  readonly hasMore: boolean;
}

export interface PlatformAdapter {
  readonly id: SourceId;
  readonly capabilities: Capabilities;

  /** Costs money. The budget is handed in and never read from a global. */
  discover(query: DiscoveryQuery, budget: Budget): Promise<Metered<Discovered>>;

  /** The tracking path: re-read by id. Keys absent from the map were not returned. */
  observe(
    sourceItemIds: readonly string[],
    budget: Budget,
  ): Promise<Metered<ReadonlyMap<string, CounterSet>>>;

  /**
   * The ONLY function permitted to know this source's field names.
   * @param at the instant WE read it, INJECTED — an adapter never calls a clock, so
   *           two items from one response share one observedAt and a recorded
   *           fixture replays to a byte-identical Item.
   */
  toItem(raw: unknown, at: Millis): Item;

  /**
   * The cohort an item's numbers should be compared against — its own kind of post,
   * at this hour, on this source. Opaque to core, which only ever asks whether two
   * items share a key. This is what keeps every core feature relative rather than
   * absolute; no core feature may ever be a raw count.
   */
  baselineKey(item: Item, at: Millis): string;
}
