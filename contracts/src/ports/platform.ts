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

/**
 * What a source can do, DECLARED by its adapter rather than inferred from what it
 * happened to return.
 *
 * ★ THE POINT OF DECLARING IT IS `absent`. Inference cannot tell "this source has no
 * such counter" from "this source did not report it this time", and those two produce
 * opposite correct behaviour: one is a permanent structural fact a feature must be
 * built around, the other is a transient gap that must degrade a single decision. An
 * adapter is the only thing that knows which, so it is required to say, and the two
 * lists together are what let core refuse to score an absence as zero.
 *
 * `fidelity` is per counter and not per source because a single payload routinely
 * rounds one field and not another.
 */
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

/**
 * THE SOURCE PORT — everything the system is allowed to know about where items come
 * from, behind one interface with no vendor noun anywhere in it.
 *
 * ★ THE BOUNDARY IS `toItem`, AND IT IS THE ONLY FUNCTION IN THE SYSTEM PERMITTED TO
 * KNOW A SOURCE'S FIELD NAMES. Everything past it speaks the shared vocabulary. That
 * is what makes a second source an adapter and not a rewrite, and it is why the clock
 * is injected rather than called: an adapter that read its own clock would make a
 * recorded fixture unreplayable, and fixtures are how adapters are tested without
 * spending money.
 *
 * `baselineKey` is the other half of the same idea from the opposite direction. The
 * adapter knows what "the same kind of post at this hour" means for its source; core
 * only ever asks whether two keys are equal. Without it, every core feature would have
 * to be an absolute count, and absolute counts from two sources are not comparable.
 */
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
