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
 *   - Fixture mode must keep producing one whatever the fixture's own provenance says. The
 *     fixtures claim `observed` so the screens show their working shape, and this notice is
 *     the only thing on screen saying none of it is real.
 */

import type { BoardProvenance, StoryProvenance } from './api/index.ts';

export interface Notice {
  readonly headline: string;
  readonly detail: string;
}

const FIXTURES: Notice = {
  headline: 'Sample data',
  detail: 'No read service is connected, so every story, view count and price here is made up.',
};

const UNSTATED: Notice = {
  headline: 'Not confirmed as real',
  detail: 'This did not say whether its stories were seen or made up, so treat everything here as unverified.',
};

/** The feed. `provenance` is null until the first frame lands — no frame, nothing to say yet. */
export function boardNotice(usingFixtures: boolean, provenance: BoardProvenance | null): Notice | null {
  if (usingFixtures) return FIXTURES;
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
export function storyNotice(usingFixtures: boolean, provenance: StoryProvenance): Notice | null {
  if (usingFixtures) return FIXTURES;
  if (provenance.kind === 'observed') return null;
  if (provenance.kind === 'unstated') return UNSTATED;
  return {
    headline: 'Sample data',
    detail: `This story was written by hand, not seen anywhere: not the posts, the accounts or the views. Connect ${provenance.connectSourceLabel} (free) to find real ones.`,
  };
}

/** A screen with no read route behind it yet. Permanent: there is nothing that could be real. */
export const SAMPLE_SCREEN: Notice = {
  headline: 'Sample data',
  detail: 'Narratives are not connected to the read service yet. Everything on this screen is made up.',
};
