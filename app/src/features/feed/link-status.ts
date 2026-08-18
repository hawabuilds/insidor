/**
 * WHAT THE STATUS LINE IS ALLOWED TO SAY, and when.
 *
 * ★ THE FAILURE THIS FILE EXISTS TO PREVENT. A board whose live channel has died looks
 * exactly like a board on a quiet market: the same rows, the same numbers, nothing moving.
 * One of those is fine and the other is a screen full of figures that stopped being true
 * some minutes ago, and a user cannot tell them apart by looking at the rows. So the
 * difference has to be stated, in words, above the board — and it has to be stated in a way
 * that cannot drift out of step with reality, which is why this is a pure function of the
 * store's own facts and a clock rather than a flag somebody sets.
 *
 * Four things it can say, and the middle two are the ones the previous build could not:
 *
 *   off           there is no live channel. The board was read once and is a snapshot.
 *                 Honest, and NOT an error — this is what a fixtures build shows.
 *   streaming     subscribed, and updates arrive.
 *   reconnecting  the channel dropped moments ago and the transport is retrying. The board
 *                 is a few seconds stale at worst, and saying "broken" here would cry wolf
 *                 at every wifi hiccup.
 *   stale         it has been down long enough that the board can no longer be trusted as
 *                 current, and it is not obviously coming back. This is the sentence that
 *                 was missing.
 *
 * `reconnecting` and `stale` are the same fact — the channel is down — separated by how
 * long. That is deliberately a decision about the CLOCK rather than a fourth state in the
 * store: the transport knows whether it is subscribed and nothing more, and inventing a
 * "trying" state inside it would mean a transport that reports optimism it cannot verify.
 *
 * No number that is not a measurement appears in any of these strings. The board's freshness
 * is rendered separately, from `lastFrameAt`, because "when did this last move" is a fact
 * about the world and belongs beside the rows rather than inside a status word.
 */

import type { BoardMeta } from '../../shared/api/index.ts';

/**
 * How long a dropped channel is given before the board is called stale.
 *
 * The transport retries about every three seconds, so twenty covers half a dozen attempts —
 * long enough that a laptop waking up or a proxy recycling a connection never reaches the
 * alarming state, short enough that a genuinely dead stream is named while the numbers on
 * screen are still only slightly wrong. It is a display grace period and nothing branches on
 * it but this file.
 */
export const RECONNECT_GRACE_MS = 20_000;

export type LinkStatus = 'off' | 'streaming' | 'reconnecting' | 'stale';

export interface LinkReadout {
  readonly status: LinkStatus;
  /** The word on the toolbar. */
  readonly label: string;
  /** The hover text. A sentence, saying what is actually true of this board right now. */
  readonly title: string;
}

const READOUTS: Readonly<Record<LinkStatus, { label: string; title: string }>> = {
  off: {
    label: 'not streaming',
    title:
      'No live channel is connected, so this board was read once when the screen opened and is not updating on its own.',
  },
  streaming: {
    label: 'live',
    title: 'Updates are arriving on the live channel.',
  },
  reconnecting: {
    label: 'reconnecting',
    title:
      'The live channel dropped and is being reopened. Anything that changed in the meantime will be re-read as soon as it comes back, so this board may be a few seconds behind.',
  },
  stale: {
    label: 'not updating',
    title:
      'The live channel is down and has not come back. These rows are as they were when it dropped — they are not a quiet market, they are a board that has stopped being told what changed. Reload to read it again.',
  },
};

/**
 * Read the channel's state as a sentence.
 *
 * `now` is a parameter and never a call, for the reason every other clock in this app is:
 * two things rendered in the same paint must agree about what time it is, and a test has to
 * be able to state the time rather than sleep through it.
 */
export function readLink(meta: BoardMeta, now: number): LinkReadout {
  if (meta.link === 'live') return { status: 'streaming', ...READOUTS.streaming };
  if (meta.link === 'idle') return { status: 'off', ...READOUTS.off };

  /* Dropped. How long ago decides which of the two sentences is true.
     `>=` rather than `>`, so a test that states exactly the grace period gets the state the
     boundary is named for rather than the one before it. */
  const down = now - meta.linkChangedAt;
  const status: LinkStatus = down >= RECONNECT_GRACE_MS ? 'stale' : 'reconnecting';
  return { status, ...READOUTS[status] };
}
