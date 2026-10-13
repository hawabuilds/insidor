/**
 * The picture evidence for one (post, story) pair: is the post's picture the same picture,
 * edited — or likely the same subject, with the same name?
 *
 * Read from three inputs the runner resolves (core fetches nothing): the best image
 * similarity between the post and the story's pictures, in `group.image.space`; the judge's
 * answer to "is the main subject the same?" for a borderline pair; and the names — the
 * judge's name for the post and for the story's posts, normalised.
 *
 *   similarity ≥ nearIdentical                      'near'       joins on its own
 *   (≥ likely, or ≥ borderline and confirmed) AND
 *     a shared name                                 'nameImage'  joins
 *   anything else                                   null         no picture evidence
 *
 * ★ NEITHER HALF ALONE. A likely-same picture with no shared name is not evidence: two
 * different raccoons photographed alike are not one story. A shared name with no picture is
 * not either: two posts that both say "chill guy" may be about two different guys. Only the
 * pair is — or a picture so close it is the same image.
 *
 * What breaks if changed carelessly: a missing similarity is "not consulted", never zero.
 * Reading an absent vector as 0 would let an outage veto joins it knows nothing about.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { StoryId } from '@insidor/contracts/ids.ts';

/** The judge's names, normalised so "Jimothy!" and "jimothy" are one name. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface PictureInputs {
  /** The judge's names for the post (its proposed name and alternates). */
  readonly itemNames: readonly string[];
  /** The names already known for each candidate story's posts. */
  readonly storyNames: Readonly<Record<string, readonly string[]>>;
  /** Stories whose borderline picture the judge confirmed: "yes", the same subject. */
  readonly confirmed: Readonly<Record<string, boolean>>;
  /**
   * Stories whose picture the judge, shown both, said is NOT the same subject. An explicit
   * "no" outranks a shared name: the post's name carriers do not count against such a story
   * (match.ts `withoutDeniedNames`). Absent means nobody asked, which vetoes nothing.
   */
  readonly denied?: Readonly<Record<string, boolean>>;
}

export const NO_PICTURE_INPUTS: PictureInputs = Object.freeze({
  itemNames: Object.freeze([]) as readonly string[],
  storyNames: Object.freeze({}),
  confirmed: Object.freeze({}),
});

export interface PictureRead {
  readonly kind: 'near' | 'nameImage' | null;
  /** The similarity read in the image space, or null when none was supplied. */
  readonly similarity: number | null;
  readonly space: string;
  /** The shared name, when there is one. */
  readonly name: string | null;
  readonly confirmed: boolean;
}

export function readPicture(
  storyId: StoryId,
  similarityBySpace: Readonly<Record<string, number>>,
  inputs: PictureInputs,
  p: Policy,
): PictureRead {
  const bars = p.group.image;
  const similarity = similarityBySpace[bars.space] ?? null;
  const confirmed = inputs.confirmed[storyId] === true;
  const mine = new Set(inputs.itemNames.map(nameKey).filter((n) => n !== ''));
  const name = (inputs.storyNames[storyId] ?? []).map(nameKey).find((n) => n !== '' && mine.has(n)) ?? null;
  const base = { similarity, space: bars.space, name, confirmed };

  if (similarity === null) return { ...base, kind: null };
  if (similarity >= bars.nearIdentical) return { ...base, kind: 'near' };
  const likely = similarity >= bars.likely || (similarity >= bars.borderline && confirmed);
  return { ...base, kind: likely && name !== null ? 'nameImage' : null };
}
