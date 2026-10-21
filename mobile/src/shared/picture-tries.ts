/**
 * WHICH PICTURE TO TRY NEXT, for every picture on a card: a post's own picture, a poster's face and
 * a coin's logo. Each surface hands over its sources in order (Thumb.tsx, poster-pic.ts,
 * coin-logo.ts decide the order); this decides how a failure moves along them. Apart from the hook
 * (shared/ui/usePictureTries.ts) so `node --test` holds the rule without a browser.
 *
 * ★ A FAILURE MOVES TO THE NEXT SOURCE AT ONCE, and the placeholder shows only when every source
 * has failed. Nothing is skipped on a guess: a source is given up on only after it failed to load.
 *
 * ★ ONE MORE ROUND, LATER, BEFORE THE PLACEHOLDER IS FINAL. The five tabs stay open now
 * (App.tsx), so a card is never drawn afresh; a picture that failed for a moment — the phone
 * offline, the app put in the background mid-load (iPhone cancels the request and the picture
 * reports an error) — would stay a placeholder until the app was closed and reopened, though the
 * picture loads fine. So once every source has failed, the whole list is tried once more when the
 * page is on screen and online. A second full failure is final: an expired or deleted picture
 * costs one extra request, never a loop.
 *
 * What breaks if changed carelessly: more than one extra round turns every dead link on a long
 * list into repeated requests; and a source list that changes (a fresh read brought a new link)
 * must start over, or the new link inherits the old one's failures.
 */

/** Rounds through the whole list: the first, and the one retry. */
export const PICTURE_ROUNDS = 2;

export interface PictureTries {
  /** The sources these tries are for, joined: a different list starts over. */
  readonly of: string;
  readonly failed: readonly string[];
  /** 0 for the first pass through the list, 1 for the retry. */
  readonly round: number;
}

export const listKey = (sources: readonly string[]): string => sources.join('\n');

export const freshTries = (sources: readonly string[]): PictureTries => ({ of: listKey(sources), failed: [], round: 0 });

/** The source to show now, or null for the placeholder. */
export function pictureNow(sources: readonly string[], tries: PictureTries): string | null {
  return sources.find((s) => !tries.failed.includes(s)) ?? null;
}

/** After `src` failed to load. */
export function afterFailure(tries: PictureTries, src: string): PictureTries {
  return tries.failed.includes(src) ? tries : { ...tries, failed: [...tries.failed, src] };
}

/** Every source failed and a retry round is still owed. */
export function retryOwed(sources: readonly string[], tries: PictureTries): boolean {
  return sources.length > 0 && pictureNow(sources, tries) === null && tries.round + 1 < PICTURE_ROUNDS;
}

/** The retry round: every source again, from the first. */
export function nextRound(tries: PictureTries): PictureTries {
  return { ...tries, failed: [], round: tries.round + 1 };
}
