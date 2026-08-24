/**
 * WHETHER THIS ONE STORY HAPPENED, in words.
 *
 * The board's `board-provenance.ts` makes the same statement about a whole frame. This is
 * the page's copy, and it exists because the page is reachable without the board: a story
 * link survives being shared, bookmarked and opened cold, and none of those arrive with a
 * frame whose notice the page could borrow. A page honest only when clicked through from
 * the list is dishonest exactly where the reader has the least context.
 *
 * Shorter than the board's on purpose. The board's notice has to explain a whole screen and
 * name the count; this one is about the thing already in front of you, and the rest of the
 * argument is one click away on the board it came from.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: `unstated` must keep returning a notice. See
 * `board-provenance.ts` — folding it into the silent branch means a server that stopped
 * sending the field silently republishes seeded stories as real ones.
 */

import type { StoryProvenance } from '../../shared/api/wire/story.ts';

export interface StoryNotice {
  readonly headline: string;
  readonly detail: string;
}

export function storyNotice(provenance: StoryProvenance): StoryNotice | null {
  if (provenance.kind === 'observed') return null;
  if (provenance.kind === 'unstated') {
    return {
      headline: 'provenance not stated',
      detail:
        ' — this page did not say whether the story was discovered or seeded, so neither ' +
        'can we. Treat every number on it as unverified.',
    };
  }
  return {
    headline: 'seeded demonstration data',
    detail:
      ' — this story was written by `pnpm db:seed`. Nothing on this page was observed ' +
      'anywhere: not the posts, not the accounts, not the view counts. No real story can ' +
      `be discovered until a post source is connected, and ${provenance.connectSourceLabel} ` +
      'is free — no card, no plan.',
  };
}
