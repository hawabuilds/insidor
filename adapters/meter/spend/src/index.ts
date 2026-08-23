/**
 * The public surface of `@insidor/meter`: the wrapper every vendor call passes
 * through, the price vocabulary it charges against, and a ledger that can answer
 * "may we spend this?" before the request goes out.
 *
 * Three modules behind one barrel because they are only true together. A wrapper
 * with no price book cannot cost a call; a price book nobody consults is a
 * document; a ledger with no wrapper in front of it records whatever callers
 * remember to tell it, which is the failure `meter.ts` was written to end. It
 * re-exports NAMES, never modules, so the import graph stays a list somebody
 * chose rather than a cycle nobody did. Deep imports (`@insidor/meter/units.ts`)
 * work and are the better choice inside a file that needs one corner.
 *
 * ★ `inMemoryMeter` IS EXPORTED BESIDE `metered` DELIBERATELY, AND IT IS NOT A
 * TEST DOUBLE. As of this writing it is the ONLY implementation of the Meter
 * port in the repository, and the runner and the market service both run on it —
 * `in-memory.ts` describes a store-backed sibling, which is the intended shape
 * and is not written yet. So anyone reading "in-memory" as "for tests" and hiding
 * this export behind a test-only path takes two live services with it, and the
 * consequence of the gap it names is worth stating plainly here: this ledger dies
 * with its process, so a daily cap is only enforced for as long as the process
 * lives. A restart is a fresh day's budget.
 */

export { metered, mergeSpend, freeSpend } from './meter.ts';
export type { Billed, CallSpec } from './meter.ts';
export { BillingMismatch, priceKey, priceOf, UnpricedCall, usdFor } from './units.ts';
export type { Price, PriceBook } from './units.ts';
export { inMemoryMeter } from './in-memory.ts';
export type { InMemoryMeter, InMemoryMeterOptions } from './in-memory.ts';
