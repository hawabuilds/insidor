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
 * ── ★ WHICH METER TO REACH FOR, BECAUSE BOTH ARE EXPORTED AND THEY DIFFER IN
 *      THE ONE PROPERTY THAT MATTERS ──────────────────────────────────────
 *
 *   openDurableMeter   A LONG-LIVED PROCESS USES THIS, ALWAYS. It reads today's
 *                      ledger at boot and writes behind every record, so the daily
 *                      cap bounds a DAY. Without it the cap bounds a process
 *                      lifetime, and a supervisor restarting a crashing process
 *                      hands out the whole budget once per crash — each allocation
 *                      individually enforced, the invoice a multiple of the cap.
 *
 *   inMemoryMeter      The tally engine underneath it, and the right choice on its
 *                      own for something that does not outlive its own pass: a
 *                      one-shot CLI, the conformance suite, a unit test. It is NOT a
 *                      test double, so anyone reading "in-memory" as "for tests" and
 *                      hiding it behind a test-only path takes real callers with it.
 *
 * The rule is the shape of the process, not the taste of the author: if it has a
 * supervisor, it needs the durable one.
 */

export { metered, mergeSpend, freeSpend } from './meter.ts';
export type { Billed, CallSpec } from './meter.ts';
export { BillingMismatch, priceKey, priceOf, estimateFor, UnpricedCall, usdFor } from './units.ts';
export type { Price, PriceBook } from './units.ts';
export { dayStart, inMemoryMeter } from './in-memory.ts';
export type { InMemoryMeter, InMemoryMeterOptions } from './in-memory.ts';
export { openDurableMeter } from './durable.ts';
export type { DurableMeter, DurableMeterOptions } from './durable.ts';
