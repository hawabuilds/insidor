/**
 * The poster's picture to draw now, and what to do when it fails to load: the next source, and
 * the handle's letter after the last (`src` null). Shared by the feed card's small face
 * (PostRow.tsx) and the post sheet's (PostSheet.tsx) so both try the same pictures in the same
 * order — our storage's copy, then the source's link (shared/poster-pic.ts says why).
 *
 * Its own file because it reads the build's settings, which the pure order in poster-pic.ts must
 * not, so that `node --test` can hold the order without a bundler.
 *
 * What breaks if changed carelessly: the failed list is per picture, not a single flag. With one
 * flag, a copy that is missing (the bucket answers 400) would drop straight to the letter and the
 * source's link — which still loads for a day — would never be tried.
 */

import { useState } from 'react';

import { posterPicBase, posterPicSources } from '../poster-pic.ts';

const env = import.meta.env as Record<string, string | undefined> | undefined;
const BASE = posterPicBase(env?.['VITE_POSTER_PIC_BASE'], env?.['VITE_COIN_LOGO_BASE']);

export function usePosterPic(file: string | null, link: string | null): { readonly src: string | null; readonly onError: () => void } {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const src = posterPicSources(file, link, BASE).find((s) => !failed.includes(s)) ?? null;
  return { src, onError: () => setFailed((f) => (src === null || f.includes(src) ? f : [...f, src])) };
}
