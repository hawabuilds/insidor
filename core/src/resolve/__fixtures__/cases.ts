/**
 * The frozen regression set: the adjudicated cases from the review of the previous
 * build, each one a way this stage has already been wrong in production.
 *
 * WHY frozen fixtures rather than generated ones: every case here was decided by a
 * human looking at the real evidence, and the value is entirely in the fact that the
 * answer is not derivable from the inputs by any rule we currently have. A generated
 * fixture tests the rule against itself.
 *
 * WHY they live in core and not in eval: they are inputs to a pure function, so they
 * cost nothing to run and belong to the thing they constrain. eval/ replays the whole
 * decision log; this is the four cases we already know the answer to.
 *
 * TO FILL IN — four cases, all carried over from the review, described by what each
 * one must prove rather than by the symbols involved, because a symbol string is not
 * what makes a case interesting:
 *
 *   1. SAME-SYMBOL COLLISION. One story, hundreds of assets carrying the same
 *      symbol, minted within minutes of each other. Expected: abstain on the margin.
 *      This is the case the product exists to get right, and the one a symbol-first
 *      retrieval gets wrong every time.
 *   2. ORDERING INVERSION. An asset whose vendor-reported origin time places it
 *      after the post and whose real origin time places it before. Expected: the
 *      bounded-confidence rule refuses it. Proves the gate cannot be fooled by a
 *      confident wrong number, which is the failure a null check cannot catch.
 *   3. GENERIC-SYMBOL TRAP. A story whose proposed name is on the generic list,
 *      matched against an asset that genuinely carries that symbol. Expected: never
 *      reaches this stage — QUALIFY drops it — and if it does, the symbol channel's
 *      collision statistic must drive the score to nothing.
 *   4. SHORT-SYMBOL AMBIGUITY. A three-character symbol shared by an unrelated
 *      established asset. Expected: the majors list eliminates it at G4, before any
 *      paid call.
 *
 * Each entry needs the recorded venue payloads that produced it, which live under
 * tapes/ and must be copied in verbatim rather than retyped: a fixture somebody
 * retyped is a fixture somebody corrected.
 */

import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Verdict } from '@insidor/contracts/decision.ts';

import type { ResolveInput } from '../stage.ts';

export interface ResolveCase {
  /** Stable, human-readable, never renumbered — it appears in failure output. */
  readonly id: string;
  /** What this case is evidence of. One sentence, in the reviewer's words. */
  readonly claim: string;
  readonly input: ResolveInput;
  readonly expectVerdict: Verdict;
  readonly expectReason: ReasonCode;
}

/** Empty until the recorded payloads are copied in. An empty set fails no test. */
export const RESOLVE_CASES: readonly ResolveCase[] = [];
