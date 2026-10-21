/**
 * The folder our stored post pictures are loaded from, read once from the build's settings
 * (shared/post-pic.ts says which and why). Shared by every list's square (Thumb.tsx) and the post
 * sheet's picture (PostMedia.tsx), so both look in the same place.
 *
 * Its own file because it reads the build's settings, which the pure order in post-pic.ts must
 * not, so that `node --test` can hold the order without a bundler.
 *
 * What breaks if changed carelessly: '' (neither setting) must stay "no copy to try", never a
 * relative path, or every card would first ask the app's own host for a picture it does not have.
 */

import { postPicBase } from '../post-pic.ts';

const env = import.meta.env as Record<string, string | undefined> | undefined;

export const POST_PIC_BASE = postPicBase(env?.['VITE_POST_PIC_BASE'], env?.['VITE_COIN_LOGO_BASE']);
