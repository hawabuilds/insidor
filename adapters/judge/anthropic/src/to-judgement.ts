/**
 * The vendor's structured output, translated into a vendor-neutral Judgement.
 *
 * The judge returns EVIDENCE, not a decision. Whether a story qualifies is
 * decided in core, after our own deterministic caps, which the model cannot
 * argue with because they run afterwards and their inputs are ours.
 *
 * Absence is preserved as carefully as anywhere else in the repository: an
 * answer that did not arrive, or did not parse, becomes `unavailable` — a
 * distinct outcome from "judged, and the answer was no". The two are different
 * populations, and merging them poisons every recall number downstream.
 */

import type { Judgement, JudgeEvidence } from '@insidor/contracts';
import type { StoryId } from '@insidor/contracts/ids.ts';
import type { JudgeOutcome, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { arr, bool, num, rec, str } from '@insidor/vendor-kit';

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export interface JudgementContext {
  readonly judgeId: string;
  readonly promptId: string;
  readonly judgedAt: number;
  /**
   * The batch's cost, divided evenly across its subjects. Even attribution is
   * the honest default: the static prompt dominates the bill and is shared, so
   * a per-subject split by token count would charge the longest story for
   * everyone else's instructions.
   */
  readonly costUsdPerSubject: number;
}

/**
 * What the judge will be looking at for this subject, or null when it cannot look at all.
 *
 * Any video member means the judge is shown a frame, and the stricter bar applies. A video
 * member with no frame to show is NOT judged as if it were text: the old build scored that
 * case at a fixed 0.4, which is a missing input dressed as a reading. Here it is null, the
 * subject is never sent, and it comes back `unavailable` — so QUALIFY abstains.
 */
export function lookedAtFor(subject: JudgeSubject): JudgeEvidence | null {
  const videos = subject.media.filter((m) => m.kind === 'video');
  if (videos.length === 0) return 'text';
  return videos.some((m) => m.uri.trim() !== '') ? 'videoFrame' : null;
}

/** Said on every subject `lookedAtFor` refuses. */
export const NO_FRAME = 'a video member with no frame the judge could look at';

/** @returns null when the payload is not usable. A malformed answer is an absent one. */
export function toJudgement(raw: unknown, ctx: JudgementContext, lookedAt: JudgeEvidence): Judgement | null {
  const r = rec(raw);
  const coinable = bool(r.coinable);
  if (coinable === null) return null;

  const proposed = str(r.proposedName);
  const confidence = num(r.confidence);

  return {
    judgeId: ctx.judgeId,
    promptId: ctx.promptId,
    judgedAt: ctx.judgedAt,
    coinable,
    // A model that returns 1.7 has misunderstood the scale, not become certain.
    confidence: confidence === null ? 0 : clamp01(confidence),
    // Ours, from what we sent — never the model's claim about what it saw.
    lookedAt,
    // Trimmed, never rewritten: the name is meant to be what people in the
    // posts call the thing, and editing it here would silently change the
    // genericity and specificity checks core runs against it.
    proposedName: proposed === null ? null : proposed.trim(),
    alternateNames: arr(r.alternateNames)
      .map((n) => str(n))
      .filter((n): n is string => n !== null),
    subjectSpans: arr(r.subjectSpans)
      .map((s) => str(s))
      .filter((s): s is string => s !== null),
    // The judge's prose is NEVER inlined here. Only a blob key, and null until
    // the caller has stored it.
    rationaleRef: str(r.rationaleRef),
    costUsd: ctx.costUsdPerSubject,
  };
}

/**
 * One outcome per subject asked about, in the order they were asked.
 *
 * A subject the model did not answer for is `unavailable`, not missing: a
 * caller that had to notice an absent key would eventually stop noticing.
 */
export function toOutcomes(
  subjects: readonly JudgeSubject[],
  answers: readonly unknown[],
  ctx: JudgementContext,
): readonly JudgeOutcome[] {
  const byStory = new Map<string, unknown>();
  for (const answer of answers) {
    const storyId = str(rec(answer).storyId) ?? str(rec(answer).subjectId);
    if (storyId !== null) byStory.set(storyId, answer);
  }

  return subjects.map((subject): JudgeOutcome => {
    const lookedAt = lookedAtFor(subject);
    if (lookedAt === null) return { kind: 'unavailable', storyId: subject.storyId as StoryId, detail: NO_FRAME };
    const answer = byStory.get(String(subject.storyId));
    if (answer === undefined) {
      return { kind: 'unavailable', storyId: subject.storyId as StoryId, detail: 'no answer for this subject' };
    }
    const judgement = toJudgement(answer, ctx, lookedAt);
    if (judgement === null) {
      return { kind: 'unavailable', storyId: subject.storyId as StoryId, detail: 'answer did not parse' };
    }
    return { kind: 'judged', judgement };
  });
}

/** Every subject came back unavailable, with one reason. Used when a call fails. */
export function allUnavailable(subjects: readonly JudgeSubject[], detail: string): readonly JudgeOutcome[] {
  return subjects.map((subject) => ({ kind: 'unavailable', storyId: subject.storyId, detail }));
}
