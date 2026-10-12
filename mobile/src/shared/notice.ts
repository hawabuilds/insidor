/**
 * WHEN A SCREEN MUST SAY ITS NUMBERS ARE NOT THE WORLD, AND IN WHAT WORDS.
 *
 * One function per kind of surface, all returning the same shape or null, so every "Sample
 * data" bar in the app follows one grammar and one rule. Split from the component because
 * `node --test` cannot load a `.tsx`, and wording that lives in a component has no test.
 *
 * ★ NOTHING HERE DECIDES WHETHER A ROW IS REAL. That judgement is the projector's, made once
 * against the frame it commits and carried as `provenance` (see `app/src/features/feed/
 * board-provenance.ts`, whose rules these follow). So the feed's notice is not switched off by
 * anything in this app: it disappears by itself when the server says the board is observed,
 * and nobody here can silence it early.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY:
 *   - `unstated` must keep producing a notice. Folding it into the silent branch means a
 *     server that stopped sending the field re-certifies invented rows as real.
 *   - The app has no sample data of its own (src/no-sample-data.test.ts). A notice here only
 *     ever repeats what the server said about its own rows.
 */

import type { BoardProvenance, StoryProvenance } from './api/index.ts';

export interface Notice {
  readonly headline: string;
  readonly detail: string;
}

const UNSTATED: Notice = {
  headline: 'Not confirmed as real',
  detail: 'This did not say whether its stories were seen or made up, so treat everything here as unverified.',
};

/** The feed. `provenance` is null until the first frame lands — no frame, nothing to say yet. */
export function boardNotice(provenance: BoardProvenance | null): Notice | null {
  if (provenance === null || provenance.kind === 'observed') return null;
  if (provenance.kind === 'unstated') return UNSTATED;
  const { seededStories, totalStories, connectSourceLabel } = provenance;
  const which = seededStories === totalStories
    ? totalStories === 1 ? 'The story here was' : `All ${totalStories} stories here were`
    : `${seededStories} of the ${totalStories} stories here were`;
  return {
    headline: 'Sample data',
    detail:
      `${which} written by hand to fill the screen, not seen anywhere. ` +
      `Connect ${connectSourceLabel} (free) to find real ones. This goes away by itself when the first real story arrives.`,
  };
}

/** A story page. It carries its own provenance because a story link can be opened cold. */
export function storyNotice(provenance: StoryProvenance): Notice | null {
  if (provenance.kind === 'observed') return null;
  if (provenance.kind === 'unstated') return UNSTATED;
  return {
    headline: 'Sample data',
    detail: `This story was written by hand, not seen anywhere: not the posts, the accounts or the views. Connect ${provenance.connectSourceLabel} (free) to find real ones.`,
  };
}




/** A wallet joined for viewing: real, read from the chain, and not one Insidor trades from. */
export const LINKED_WALLET: Notice = {
  headline: 'View only',
  detail: 'A wallet you linked. Insidor reads it from the chain and never holds its key; Send and trading use your Insidor wallet.',
};
