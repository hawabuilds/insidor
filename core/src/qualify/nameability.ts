/**
 * Whether a proposed name actually names THIS story, and the ceiling that follows.
 *
 * The failure this exists to prevent is the expensive one: a plausible, confident,
 * generic name. "The dog one" scores well on every engagement signal and matches
 * four hundred unrelated assets, so a story named that way cannot be resolved to a
 * coin and must never be presented as though it could.
 *
 * The cap runs AFTER the score — including after a model's score, once there is one
 * — and can only lower it. That ordering is the whole guarantee: a model cannot
 * argue its way past a deterministic rule whose inputs are ours.
 */

import type { FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { clamp01 } from '../math.ts';

/**
 * How well the proposed name is anchored in the text the story is actually made of:
 * the share of evidence spans in which every significant token of the name appears.
 *
 * LIMIT, stated rather than hidden: the spans are supplied by the judge, so this is a
 * consistency check on the judge's own evidence rather than an independent
 * measurement. The independent version divides by corpus document frequency — a name
 * that is specific is one that is rare EVERYWHERE ELSE — and that number arrives with
 * the daily bucket table in group/persistence.ts. Until it does, this catches the
 * common case: a judge proposing a name that is not in the story it was shown.
 */
export function subjectSpecificity(proposed: string, spans: readonly string[]): number {
  const tokens = significantTokens(proposed);
  if (tokens.length === 0 || spans.length === 0) return 0;

  let anchored = 0;
  for (const span of spans) {
    const lowered = span.toLowerCase();
    if (tokens.every((t) => lowered.includes(t))) anchored++;
  }
  return clamp01(anchored / spans.length);
}

/**
 * The ceiling this story's score may not exceed, whatever produced the score.
 *
 * A generic name caps at zero — not low, zero — because there is no version of
 * "correct" for naming a story after a word that describes four hundred other
 * things. Otherwise the ceiling is the name's own specificity, floored by Policy so
 * that a genuinely new name whose specificity we cannot yet measure is not punished
 * for being new.
 */
export function nameabilityCap(f: FeatureVector, p: Policy): number {
  if (f.nameProposed === 0) return 0;
  if (f.nameIsGeneric === 1) return 0;
  return clamp01(Math.max(f.nameSpecificity ?? 0, p.qualify.nameabilityCapFloor));
}

/** Lowercased word-ish tokens, with a leading sigil stripped. Language-blind. */
function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/^\$+/, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}
