/**
 * ★ HOW AN OUTCOME IS CORRECTED WITHOUT EVER BEING EDITED.
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR: the one spelling of `Label.labelVersion`, and the
 * rule that says which of several rows about the same subject is the one still true.
 *
 * WHY IT EXISTS SEPARATELY FROM `ports/store.ts`, WHICH HOLDS THE `Label` TYPE ITSELF:
 * because a type cannot carry a rule. `internal.labels` is keyed by
 * (subject_kind, subject_id, label_name, label_version, window_days) and a settled row
 * is a fact about a window that has already closed — so a settled row is never updated.
 * A censored outcome that later becomes measurable, or a measurement recomputed after a
 * backfill, is a NEW ROW, and the only column in that key free to distinguish it is
 * `label_version`. That makes `label_version` do two jobs at once, and a column doing
 * two jobs with no vocabulary around it is a column two people spell differently.
 *
 * So the spelling is here, once:
 *
 *     v1        the first settlement under definition v1
 *     v1.r2     the same definition, observed again, superseding v1
 *     v1.r3     …and again
 *
 * THE DEFINITION half and the REVISION half mean genuinely different things and the
 * distinction is the whole point:
 *
 *   · A DEFINITION change is a change to what is being measured — a different window, a
 *     different bar for `y`, a different denominator. Rows under two definitions are
 *     two different measurements and MUST NOT be compared or pooled. `Policy.labels`
 *     carries the definition string next to the numbers that constitute it, so moving a
 *     threshold without moving the definition is a visible mistake rather than a silent
 *     one.
 *   · A REVISION change is the SAME measurement, taken again, because our own evidence
 *     improved: a coverage gap was backfilled, a market series arrived late. The two
 *     rows are comparable, the later one supersedes the earlier one, and both stay on
 *     disk because "we could not tell in March and could in April" is itself a fact
 *     about the pipeline that a deleted row destroys.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY. Two things, both silent.
 *
 *   1. A reader that takes any row rather than the latest revision will read a censored
 *      lower bound as if it were the measurement, months after a better one was written
 *      beside it. `latestRevisionOf` is the answer and every read path must go through
 *      it. Note that a *resolved* row is never superseded by the labeller — it is
 *      terminal — so at most one revision per key can ever be `resolved`, and a
 *      consumer that filters `status = 'resolved'` (as `internal.train_admit_v1` does)
 *      is already safe. Every OTHER consumer is not.
 *   2. Widening the separator, or letting a definition contain one, makes the parse
 *      ambiguous — and an ambiguous parse turns a supersession into a second, parallel
 *      measurement that double-counts through any view that does not filter the
 *      version. `labelVersion()` throws rather than let that be written.
 */

/** The outcome the whole system exists to learn from. Named here so the string is spelled once. */
export const LABEL_PEAK_MULTIPLE = 'peak_multiple';

/**
 * The separator between a definition and its revision.
 *
 * `.r` and not `.`: a bare dot is what a definition would plausibly use for its own
 * minor version (`v1.2`), and the day somebody writes that, every revision parse
 * silently reinterprets a definition as a revision of a definition that does not exist.
 * A two-character marker cannot be typed by accident.
 */
const REVISION_MARKER = '.r';

/** The revision every first settlement carries, implicitly, by carrying no marker at all. */
export const FIRST_REVISION = 1;

export interface LabelRevision {
  /** What was measured. Two definitions are two measurements; never pool them. */
  readonly definition: string;
  /** How many times that measurement has been taken for this subject. 1-based. */
  readonly revision: number;
}

/**
 * The stored `label_version` for a definition at a revision.
 *
 * Revision 1 is spelled as the bare definition, deliberately: the overwhelmingly common
 * row is a first settlement, and a table full of `v1.r1` would put the correction
 * machinery in front of every reader who will never meet a correction. It also keeps
 * every row written before this file existed parseable as what it is.
 */
export function labelVersion(definition: string, revision: number): string {
  if (definition.length === 0) throw new TypeError('labelVersion: empty definition');
  if (definition.includes(REVISION_MARKER)) {
    throw new TypeError(
      `labelVersion: definition ${JSON.stringify(definition)} contains ${JSON.stringify(
        REVISION_MARKER,
      )}, which would make the revision unparseable`,
    );
  }
  if (!Number.isInteger(revision) || revision < FIRST_REVISION) {
    throw new TypeError(`labelVersion: revision must be an integer >= ${FIRST_REVISION}`);
  }
  return revision === FIRST_REVISION ? definition : `${definition}${REVISION_MARKER}${revision}`;
}

/**
 * The inverse. Never throws — it parses stored data, and a version string this file did
 * not write is a definition we do not recognise rather than corruption. Such a string
 * comes back as revision 1 of itself, which keeps it distinct from everything else
 * instead of being silently folded into a revision chain it is not part of.
 */
export function parseLabelVersion(version: string): LabelRevision {
  const cut = version.lastIndexOf(REVISION_MARKER);
  if (cut <= 0) return { definition: version, revision: FIRST_REVISION };
  const tail = version.slice(cut + REVISION_MARKER.length);
  if (!/^[1-9][0-9]*$/.test(tail)) return { definition: version, revision: FIRST_REVISION };
  return { definition: version.slice(0, cut), revision: Number(tail) };
}

/**
 * The row that is still true, out of every revision of one definition.
 *
 * ★ THIS IS THE READ RULE, and it is the half of "a correction is a new row" that is
 * easy to leave unwritten. Writing the new row is obvious; every consumer knowing to
 * ignore the old one is not. Rows under a different definition are not candidates — they
 * are a different measurement, and picking the "latest" across definitions would silently
 * answer a question nobody asked.
 *
 * Returns null when the set holds nothing under this definition, which is a different
 * answer from "the subject was graded and the answer was nothing" and callers must keep
 * the two apart.
 */
export function latestRevisionOf<T extends { readonly labelVersion: string }>(
  rows: readonly T[],
  definition: string,
): T | null {
  let best: T | null = null;
  let bestRevision = 0;
  for (const row of rows) {
    const parsed = parseLabelVersion(row.labelVersion);
    if (parsed.definition !== definition) continue;
    if (parsed.revision > bestRevision) {
      best = row;
      bestRevision = parsed.revision;
    }
  }
  return best;
}

/** The revision a supersession of `previous` must be written at. */
export function nextRevision(previousVersion: string): number {
  return parseLabelVersion(previousVersion).revision + 1;
}
