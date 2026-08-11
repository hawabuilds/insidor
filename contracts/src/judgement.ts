/**
 * JUDGEMENT — what a judge returns when asked "is there a nameable thing here?".
 *
 * Vendor-neutral by construction: nothing here names a model, a provider or a
 * prompt. `judgeId` is an opaque string an adapter supplies, and swapping the judge
 * changes no file in core/.
 *
 * TWO SHAPES THAT ARE DELIBERATE:
 *
 * 1. The judge's prose is NOT in this type. Only `rationaleRef`, a blob key. In the
 *    build this replaces, the judge's plain-English reasoning sat in a table the
 *    public key could read, and two reviewers pulled verbatim sentences out of it.
 *    A field that does not exist cannot be granted by accident.
 *
 * 2. A judgement is advice, not a verdict. It is handed to the stage as data, and
 *    the deterministic caps run AFTER it and can only lower the outcome. Expect a
 *    majority of stories to come back not coinable; a design that optimises that
 *    number upward reintroduces the wrong-coin bug.
 */

import type { Millis } from './vocabulary.ts';

export interface Judgement {
  /** Opaque, versioned: 'judge:<name>@<version>'. Written into Decision.decider. */
  readonly judgeId: string;
  /** The exact prompt revision, so an answer can be replayed against what produced it. */
  readonly promptId: string;
  readonly judgedAt: Millis;

  /** The judge's own answer to the only question we asked it. */
  readonly coinable: boolean;
  /** [0,1]. Self-reported and therefore never a gate on its own. */
  readonly confidence: number;

  /** A short human-language name for the thing, or null when the judge found none. */
  readonly proposedName: string | null;
  /** Runners-up, best first. Used to measure the judge's own ambiguity, not shown. */
  readonly alternateNames: readonly string[];
  /** Spans of member text the name was drawn from. Our specificity check reads these. */
  readonly subjectSpans: readonly string[];

  /** Blob key for the reasoning. NEVER inlined, NEVER projected to a wire type. */
  readonly rationaleRef: string | null;

  /** Metered by the adapter and passed through as data; core never prices anything. */
  readonly costUsd: number;
}
