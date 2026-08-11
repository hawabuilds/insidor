/**
 * What this source can and cannot do, declared once.
 *
 * The `absent` list is empty here and that is a claim, not a default: this
 * source exposes a first-class count for all six counter kinds, including the
 * reproduction count the product's central signal rests on. It is the only
 * source we have where reproduction is a cheap read off a single snapshot
 * rather than a corpus join, and core must not come to depend on that.
 */

import type { CounterKind, Fidelity } from '@insidor/contracts';
import { sourceId } from '@insidor/contracts/ids.ts';
import type { Capabilities } from '@insidor/contracts/ports/platform.ts';
import type { Price, PriceBook } from '@insidor/meter';

export const SOURCE = sourceId('x');
export const VENDOR = 'twitterapi.io';

/**
 * REACH IS QUANTIZED, AND SAYING SO IS THE POINT.
 *
 * This source rounds its reach counter once the number gets large — the
 * rounding step grows with magnitude, so a reading of 1,200,000 is one of
 * several hundred thousand possible true values while a reading of 843 is
 * exact. We declare the WEAKER claim for every reading rather than switching on
 * magnitude, for two reasons:
 *
 *   1. Where the rounding starts is a number, and numbers that decide things
 *      live in policy, not in an adapter.
 *   2. The kinetics rule already derives the rounding step from the value
 *      itself, so a uniform 3-significant-digit claim gives core exactly what
 *      it needs and nothing it has to guess.
 *
 * The consequence is deliberate and it is the correction this rebuild exists
 * for: when reach moves by less than its own rounding step, the rule emits NO
 * rate rather than a zero. A zero reads downstream as cooling and demotes the
 * item — the wrong answer, in the most expensive direction.
 */
export const FIDELITY = {
  reach: { kind: 'quantized', significantDigits: 3 },
  approval: { kind: 'exact' },
  conversation: { kind: 'exact' },
  rebroadcast: { kind: 'exact' },
  reproduction: { kind: 'exact' },
  retention: { kind: 'exact' },
} as const satisfies Readonly<Partial<Record<CounterKind, Fidelity>>>;

export const CAPABILITIES: Capabilities = {
  source: SOURCE,
  counters: ['reach', 'approval', 'conversation', 'rebroadcast', 'reproduction', 'retention'],
  absent: [],
  fidelity: FIDELITY,
  discovery: ['keyword', 'account'],
  /** The lookup endpoint takes up to this many ids in one request. */
  observeBatchSize: 100,
  /** A reproduction here is a first-class object with its own author and id. */
  lineage: true,
  /** Billed per item returned — the vendor's own header says so. */
  billing: 'per-item-returned',
};

/**
 * Measured rates. Both entries are per item returned because that is how this
 * vendor bills; a call that bills differently gets its own row and the meter
 * refuses to price one through the other.
 */
const price = (endpoint: string, usdPerUnit: number): Price => ({
  vendor: VENDOR,
  endpoint,
  unit: 'per-item-returned',
  usdPerUnit,
  unitName: 'item returned',
  measuredAt: '2026-08-05',
});

export const SEARCH = 'search';
export const LOOKUP = 'lookup';

export const PRICES: PriceBook = {
  [`${VENDOR}:${SEARCH}`]: price(SEARCH, 0.00015),
  [`${VENDOR}:${LOOKUP}`]: price(LOOKUP, 0.00015),
};
