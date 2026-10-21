/**
 * The picture a card draws now from its ordered sources, and what to do when it fails: the next
 * source at once, one more round later, then the caller's placeholder (shared/picture-tries.ts
 * holds the rule and says why). Shared by the post picture (Thumb.tsx), the poster's face
 * (usePosterPic.ts) and the coin logo (CoinLogo.tsx), so every picture on a card recovers the
 * same way.
 *
 * Its own file because it waits on the page — on screen and online — which the pure rule must
 * not, so that `node --test` can hold the rule without a browser.
 *
 * What breaks if changed carelessly: `tryKey` must be the `<img>`'s key. A retry of the same
 * address on the same element is not a new request — the browser keeps the failed one — so the
 * element is made afresh for the retry round.
 */

import { useEffect, useState } from 'react';

import { afterFailure, freshTries, listKey, nextRound, pictureNow, retryOwed, type PictureTries } from '../picture-tries.ts';

/** How long a fully failed list waits before its one retry round. */
const RETRY_AFTER_MS = 4_000;

export interface PictureNow {
  /** The source to draw, or null for the placeholder. */
  readonly src: string | null;
  /** The `<img>`'s key: changes for the retry round, so the picture is asked for again. */
  readonly tryKey: string;
  /** `src` failed to load (or is too slow to wait for). */
  readonly fail: (src: string) => void;
}

const canLoad = (): boolean => document.visibilityState === 'visible' && navigator.onLine !== false;

export function usePictureTries(sources: readonly string[]): PictureNow {
  const [kept, setTries] = useState<PictureTries>(() => freshTries(sources));
  /* A new list of sources (a fresh read brought another link) starts over. */
  const tries = kept.of === listKey(sources) ? kept : freshTries(sources);
  if (tries !== kept) setTries(tries);
  const owed = retryOwed(sources, tries);
  useEffect(() => {
    if (!owed) return;
    let timer = 0;
    const again = () => {
      if (!canLoad()) return;
      setTries((t) => (retryOwed(sources, t) ? nextRound(t) : t));
    };
    timer = window.setTimeout(again, RETRY_AFTER_MS);
    /* Off screen or offline when the wait ran out: the round runs when the page is back. */
    document.addEventListener('visibilitychange', again);
    window.addEventListener('online', again);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('online', again);
    };
    /* `sources` is read through `tries.of`, its key: a new array with the same links is not a new list. */
  }, [owed, tries.of]);
  const src = pictureNow(sources, tries);
  return {
    src,
    tryKey: `${tries.round}:${src ?? ''}`,
    fail: (failed: string) => setTries((t) => (t.of === tries.of ? afterFailure(t, failed) : t)),
  };
}
