/**
 * Two penalty terms for the admission score, both computed from our own text and
 * nothing else.
 *
 * WHY these are penalties rather than gates: both are heuristics over language, both
 * will be wrong sometimes, and a wrong gate silently deletes an item from the record
 * forever. A wrong penalty costs it some score and leaves it visible in the log with
 * its features attached, which is what a future model needs in order to learn that
 * the heuristic was wrong.
 *
 * No source is named here and none can be: the input is text, and text is the one
 * thing every source has.
 */

/**
 * Language that solicits interaction rather than reproducing anything.
 *
 * The distinction the product turns on is between an item people COPY and an item
 * people merely respond to. Solicitation manufactures the second and looks like the
 * first in every counter a source exposes.
 */
const SOLICITATIONS: readonly string[] = [
  'follow for more',
  'follow me for',
  'like if you',
  'like and follow',
  'comment below',
  'drop a comment',
  'tag someone who',
  'tag a friend',
  'link in bio',
  'check my profile',
  'giveaway',
  'sub for sub',
  'follow back',
];

/** Returns 1 when the text solicits, 0 when it does not. */
export function engagementBait(text: string): number {
  const lowered = text.toLowerCase();
  for (const phrase of SOLICITATIONS) {
    if (lowered.includes(phrase)) return 1;
  }
  return 0;
}

const DIGIT_LOW = '0'.charCodeAt(0);
const DIGIT_HIGH = '9'.charCodeAt(0);
const SEQUENCE_TERMINATORS: readonly string[] = ['/', ')', '.', ':'];

/**
 * Whether this item reads as a continuation of something the same author already
 * posted — the second panel of a sequence rather than a new thing.
 *
 * A continuation inherits its parent's attention and reproduces nothing of its own,
 * so it looks traction-shaped without being it.
 *
 * LIMIT, stated rather than hidden: this is the text-marker version, which catches
 * an explicit numbering and nothing else. The strong version compares the item's
 * lineage pointer against its own author key, and needs the parent item, which the
 * caller does not currently load.
 */
export function threadContinuation(text: string): number {
  const head = text.trimStart();
  let i = 0;
  while (i < head.length) {
    const code = head.charCodeAt(i);
    if (code < DIGIT_LOW || code > DIGIT_HIGH) break;
    i++;
  }
  if (i === 0) return 0;
  const terminator = head[i];
  return terminator !== undefined && SEQUENCE_TERMINATORS.includes(terminator) ? 1 : 0;
}
