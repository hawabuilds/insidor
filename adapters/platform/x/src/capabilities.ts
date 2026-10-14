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
  discovery: ['keyword', 'account', 'catchall'],
  /** The lookup endpoint takes up to this many ids in one request. 50, not 100: the vendor
      answers 400 "max 50 tweet_ids per request" above it (measured 2026-10-12). */
  observeBatchSize: 50,
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
/* A post's replies and reproductions (responses.ts): the same search, billed the same, under its
   own label so the ledger says what the posts line was spent on. */
export const RESPONSES = 'responses';

export const PRICES: PriceBook = {
  [`${VENDOR}:${SEARCH}`]: price(SEARCH, 0.00015),
  [`${VENDOR}:${LOOKUP}`]: price(LOOKUP, 0.00015),
  [`${VENDOR}:${RESPONSES}`]: price(RESPONSES, 0.00015),
};

/**
 * ★ THE FLOOR THIS VENDOR CHARGES PER REQUEST, WHICH THE LEDGER USED TO MISS.
 *
 * The price above is per item returned, and reporting the count of returned items as
 * the billed units is the obvious reading of that — and it is wrong at the bottom of
 * the range. The vendor states a minimum: "$0.00015 per request (even if no data
 * returned)", and "if the API returns 0 or 1 tweet, you will be charged 15 credits",
 * which is one item's price either way.
 *
 * So a call that returns nothing booked $0.00 against a real charge. That
 * understatement is not evenly spread: it lands entirely on the calls that come back
 * empty, which is the TRACKING path — where a deleted post returning nothing is
 * ordinary, and where most of this source's money is spent. The one record whose
 * whole job is to be factual was therefore quietly optimistic in exactly the place
 * the budget binds.
 *
 * It lives here, beside the price it corrects, because it is a fact about how this
 * vendor bills — the same kind of fact as `usdPerUnit` — rather than something
 * either call path invented. Both call paths use it, so there is one definition.
 */
export const MIN_BILLED_UNITS = 1;

/** Units to report for a call that returned `returned` items. Never below the floor. */
export const billedUnits = (returned: number): number => Math.max(returned, MIN_BILLED_UNITS);

/**
 * ★ A LOOKUP BY ID IS BILLED FOR EVERY ID ASKED, NOT EVERY POST RETURNED — measured, because the
 * vendor's pages say only "per returned tweet". On 2026-10-14, against the account's balance with
 * the live runner's own ledger as the background: 20 lookups of 5 live ids and 5 ids that were
 * never posts returned 4.75 posts each and were billed 146 credits each (10 ids at 15, not 4.75);
 * 20 of 10 live and 10 very old ids, 17.6 returned, 300 billed (20 ids); 100 of one live id and
 * 100 of one missing id, 15 each; and a full search page of 20, about 280 (per post, as published).
 * So a post deleted or gone private since it was found still costs its id on every re-read, and
 * booking only what came back left the tracking path low by exactly those ids. Searches stay
 * `billedUnits`: a search has no ids to ask, and is billed for what it returns.
 */
export const lookupBilledUnits = (asked: number): number => Math.max(asked, MIN_BILLED_UNITS);
