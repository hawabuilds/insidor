/**
 * The title and picture a story is shown under, once QUALIFY has passed it.
 *
 * Split from stage.ts because the stage decides and this only shapes what a pass writes
 * through `StoryRepo.setPresentation`. Pure, so the runner never picks a title or an image
 * itself.
 *
 * ★ BOTH HALVES MAY BE NULL AND THAT IS A STATE, NOT A GAP. No proposed name means the
 * board quotes the earliest post instead (services/project's `projectTitle`); no picture
 * means the row has none. Neither is ever filled with a placeholder.
 *
 * ★ THE PICTURE IS A POST'S OWN IMAGE, the earliest post that has one. It is a fact about
 * the world — somebody posted it — and never something we generated or chose by taste.
 */

import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { Item } from '@insidor/contracts/vocabulary.ts';

export interface Presentation {
  readonly displayTitle: string | null;
  readonly thumbUri: string | null;
}

/** Earliest post first; a post with no post time goes last, never first. */
function byPostTime(a: Item, b: Item): number {
  if (a.postedAt === null) return b.postedAt === null ? 0 : 1;
  if (b.postedAt === null) return -1;
  return a.postedAt - b.postedAt;
}

export function presentationFor(judgement: Judgement | null, members: readonly Item[]): Presentation {
  const name = (judgement?.proposedName ?? '').trim();
  const pictured = [...members]
    .sort(byPostTime)
    .flatMap((item) => item.media)
    .find((media) => media.kind === 'image' && media.uri.trim() !== '');
  return {
    displayTitle: name === '' ? null : name,
    thumbUri: pictured?.uri ?? null,
  };
}
