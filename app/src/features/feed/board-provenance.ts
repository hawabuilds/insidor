/**
 * WHAT THE BOARD SAYS ABOUT ITSELF WHEN ITS STORIES ARE NOT THE WORLD YET.
 *
 * ★ THE BUG THIS CLOSES, in the owner's words on being shown the running app: "everything
 * is just a placeholder". He was right, and the screen disagreed with him. `pnpm db:seed`
 * writes six hand-written stories; the projector published them and the app rendered them
 * under a heading reading **Trending**, with a live pip and a market-cap column. Nothing
 * distinguished that board from one showing the real world. A fiction is labelled a
 * fiction or it is not shown, and this was six of them presented as observations on the
 * first surface anybody opens.
 *
 * ── ★ WHY THE DECISION IS NOT MADE HERE ───────────────────────────────────
 *
 * This module cannot work out whether a row is invented, and that is deliberate: a story's
 * `origin` is not on the wire and is never going to be. The projector makes the call once,
 * against the frame it is committing, and commits the answer ON that frame — so there is
 * no state here that could get out of step with the rows, and no condition in this file
 * that somebody could later tighten into "do not show the banner".
 *
 * The consequence that was actually asked for: IT TURNS ITSELF OFF. The moment a story
 * assembled from real posts reaches the board, the projector emits `{ kind: 'observed' }`,
 * this returns null, and the notice is gone. No code change, no flag, no deploy — and
 * equally, nobody can silence it early without changing what the server says is true.
 *
 * ── ★ WHY IT IS SPLIT FROM THE COMPONENT ──────────────────────────────────
 *
 * `link-status.ts` and `sources.ts` are split from their `.tsx` for the same two reasons,
 * and the second one is mechanical: `node --test --experimental-strip-types` cannot load a
 * `.tsx` at all. Wording that lives in a component is wording with no test.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: `unstated` must keep returning a notice. It
 * is what a frame that did not say looks like, and folding it into the silent branch would
 * mean a server that stopped sending the field silently re-certifies every seeded row as
 * real — the original bug, restored through the module built to prevent it.
 */

import type { BoardProvenance } from '../../shared/api/wire/board.ts';

/**
 * The two parts of the sentence, or nothing at all.
 *
 * The same shape `sourceNotice` returns one feature over, so the shell's amber bars all
 * follow one grammar: `<b>` is the fact, and the body is what it means for what is on
 * screen.
 */
export interface ProvenanceNotice {
  readonly headline: string;
  readonly detail: string;
}

export function provenanceNotice(provenance: BoardProvenance | null): ProvenanceNotice | null {
  /* No frame has been applied yet. Not a fact about the board — there is no board — and a
     warning during the first fetch of every page load is a warning about nothing. */
  if (provenance === null) return null;
  if (provenance.kind === 'observed') return null;

  if (provenance.kind === 'unstated') {
    return {
      headline: 'provenance not stated',
      detail:
        ' — this board did not say whether its stories were discovered or seeded, so neither ' +
        'can we. Treat every row on it as unverified until the board says otherwise.',
    };
  }

  /* "All six" reads better than "6 of 6" and is the case that is true today; the counted
     form takes over the moment the board is mixed, which is the first thing that happens
     when a real source is connected and is exactly when the difference matters. */
  const { seededStories, totalStories, connectSourceLabel } = provenance;
  const one = seededStories === 1;
  const which = seededStories === totalStories
    ? totalStories === 1
      ? 'The one story on this board'
      : `All ${totalStories} stories on this board`
    : `${seededStories} of the ${totalStories} stories on this board`;

  return {
    headline: 'seeded demonstration data',
    detail:
      ` — ${which} ${one ? 'was' : 'were'} written by \`pnpm db:seed\`. ` +
      `${one ? 'It is' : 'They are'} here so the screen has something to show; nothing on ` +
      `${one ? 'it' : 'them'} was observed anywhere. ` +
      'No real story can be discovered until a post source is connected, and ' +
      `${connectSourceLabel} is free — no card, no plan. This notice disappears by itself ` +
      'the moment the first discovered story reaches the board.',
  };
}
