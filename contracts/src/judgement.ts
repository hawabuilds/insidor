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

/**
 * WHAT THE JUDGE LOOKED AT, as a closed list.
 *
 * A judge reading text and a judge reading a frame from a video are not equally sure of
 * the same thing, and the qualify bar is set per kind for that reason
 * (`Policy.qualify.minJudgeConfidence`). It names the EVIDENCE, never a source: the same
 * source can send either, and a source name in this package is a vendor leaking into
 * the vocabulary.
 *
 *   text        the judge read member text only (a still image, if any, was not judged on)
 *   videoFrame  the judge was shown at least one frame from a video member
 *
 * A story whose video the judge could not see is not judged as text instead: the adapter
 * returns it as unavailable, and QUALIFY abstains.
 */
export const JUDGE_EVIDENCE = ['text', 'videoFrame'] as const;
export type JudgeEvidence = (typeof JUDGE_EVIDENCE)[number];

/**
 * WHY A STORY REACHED QUALIFY WITHOUT A JUDGEMENT, as a closed list.
 *
 * Four different facts that all look like "no judgement", and each gets its own abstain
 * reason so the log can tell them apart a week later — whether the cap was too low, the
 * vendor was down, or nobody had switched spending on:
 *
 *   not_asked    the judge was never called for this story (nothing wired, or not yet)
 *   unavailable  it was called and gave nothing usable: timeout, error, bad reply, no frame
 *   budget       the call was not made because the daily cap or the vendor line was reached
 *   dry_run      SPEND=dry: the call was priced and not sent
 *
 * None of them is a "no". They all abstain.
 */
export const JUDGE_ABSENCES = ['not_asked', 'unavailable', 'budget', 'dry_run'] as const;
export type JudgeAbsence = (typeof JUDGE_ABSENCES)[number];

export interface Judgement {
  /** Opaque, versioned: 'judge:<name>@<version>'. Written into Decision.decider. */
  readonly judgeId: string;
  /** The exact prompt revision, so an answer can be replayed against what produced it. */
  readonly promptId: string;
  readonly judgedAt: Millis;

  /** The judge's own answer to the only question we asked it. */
  readonly coinable: boolean;
  /**
   * [0,1]. Self-reported, so it is never a gate ON ITS OWN: QUALIFY reads it only
   * alongside `coinable: true`, after its own deterministic gates, against a bar set per
   * `lookedAt` in Policy. A confident NO also has a high confidence; it is a confidence in
   * the answer, not in the subject.
   */
  readonly confidence: number;
  /** What the judge was shown. Decides which confidence bar applies. */
  readonly lookedAt: JudgeEvidence;

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
