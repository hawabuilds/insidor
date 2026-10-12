/**
 * One fresh reading of a post, turned into the observations the store appends: one row per
 * counter, each with the rate it supports against the previous reading of the same counter.
 *
 * Its own file because rate.ts decides ONE counter's rate and cannot see the others, while
 * "did a sibling counter rise" — the thing that tells a stale counter from a quiet post — is
 * a question about the whole reading. TRACK's re-read is the caller.
 *
 * What breaks if changed carelessly: `prev` must be the newest earlier reading of the same
 * counter on the same post. Handing it an older one stretches the interval and understates
 * the rate; handing it one from another post invents a rate out of two unrelated levels.
 */

import type { KineticsPolicy } from '@insidor/contracts/policy.ts';
import type { ItemId } from '@insidor/contracts/ids.ts';
import type { Counter, CounterKind, CounterSet, Millis, Observation } from '@insidor/contracts/vocabulary.ts';

import { emitRate } from './rate.ts';

function rose(prev: Counter | undefined, curr: Counter | undefined): boolean {
  return prev?.value != null && curr?.value != null && curr.value > prev.value;
}

/**
 * @param previous the newest earlier reading of each counter on this post; a counter with
 *                 no earlier reading is absent, and its rate is censored `no_prior`.
 */
export function observationsFrom(
  itemId: ItemId,
  counters: CounterSet,
  previous: Readonly<Partial<Record<CounterKind, Counter>>>,
  capturedAt: Millis,
  k: KineticsPolicy,
): readonly Observation[] {
  const kinds = Object.keys(counters) as CounterKind[];
  const out: Observation[] = [];
  for (const kind of kinds) {
    const counter = counters[kind];
    if (counter === undefined) continue;
    const siblingRose = kinds.some((other) => other !== kind && rose(previous[other], counters[other]));
    out.push({ itemId, capturedAt, kind, counter, rate: emitRate(previous[kind] ?? null, counter, siblingRose, k) });
  }
  return out;
}

/** The newest reading of each counter in a series, for `observationsFrom`'s `previous`. */
export function latestCounters(series: readonly Observation[]): Partial<Record<CounterKind, Counter>> {
  const latest: Partial<Record<CounterKind, Observation>> = {};
  for (const o of series) {
    const held = latest[o.kind];
    if (held === undefined || o.capturedAt > held.capturedAt) latest[o.kind] = o;
  }
  const out: Partial<Record<CounterKind, Counter>> = {};
  for (const [kind, o] of Object.entries(latest) as [CounterKind, Observation][]) out[kind] = o.counter;
  return out;
}
