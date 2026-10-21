/**
 * A SHOWN POST'S PICTURE, COPIED INTO OUR OWN STORAGE, so a card's picture keeps loading after the
 * source's signed link has expired (the short-video source's covers expire about a day after the
 * read).
 *
 * Two copies per picture in the public launch-metadata bucket, beside the poster faces and the coin
 * logos: `post-pics/<file>` at the lists' size and `post-pics/sheet/<file>` at the post sheet's,
 * where `<file>` is 32 hex characters the copier chose and recorded (public.post_picture.file,
 * 0119). The app builds both paths from that name, so no reply carries a storage URL (the app's
 * censor refuses this vendor's name inside any value).
 *
 * Separate from poster-pic.ts because a post picture has two sizes and a poster's face one; the
 * download — real picture bytes only, by their first bytes, under the cap, never an SVG — is
 * coin-logo.ts's, one rule for every picture this bucket takes from the internet.
 *
 * What breaks if changed carelessly: the folders. The app builds the same paths
 * (mobile/src/shared/post-pic.ts); renaming one side without the other sends every card back to
 * the source's link, and the expired ones to the placeholder.
 */

import { VendorUnavailable } from '@insidor/vendor-kit';

import { coinLogoStore, LogoRefused, sniffPicture } from './coin-logo.ts';
import type { LogoStoreConfig } from './coin-logo.ts';

const VENDOR = 'supabase-storage';
const BUCKET = 'launch-metadata';
/** The folder in the bucket; the app's post-picture base ends in it. */
export const POST_PIC_FOLDER = 'post-pics';
/** The sheet's copies, inside it. "sheet" can never be a file name (those are 32 hex characters). */
export const POST_PIC_SHEET_FOLDER = 'sheet';
/** The only file names written: what the copier makes, and nothing a caller could steer into a path. */
export const POST_PIC_FILE = /^[0-9a-f]{32}$/;
/** Which copy: the lists' or the sheet's. */
export type PostPicCopy = 'card' | 'sheet';

export function postPicStore(config: LogoStoreConfig) {
  const base = config.url.replace(/\/+$/, '');
  const { download } = coinLogoStore(config);
  return {
    download,
    /** Store one copy under its file name. A new picture is a new name, so a file is never replaced with another picture. */
    async put(file: string, picture: { readonly bytes: Uint8Array; readonly type: string }, copy: PostPicCopy): Promise<void> {
      if (!POST_PIC_FILE.test(file)) throw new LogoRefused('not a picture file name');
      if (sniffPicture(picture.bytes) !== picture.type) throw new LogoRefused('not the picture it says it is');
      const path = copy === 'sheet' ? `${POST_PIC_FOLDER}/${POST_PIC_SHEET_FOLDER}/${file}` : `${POST_PIC_FOLDER}/${file}`;
      let response: Response;
      try {
        response = await config.fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'POST',
          headers: {
            apikey: config.serviceKey,
            authorization: `Bearer ${config.serviceKey}`,
            'content-type': picture.type,
            'x-upsert': 'true',
            'cache-control': 'max-age=31536000',
          },
          body: new Blob([Buffer.from(picture.bytes)], { type: picture.type }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (e) {
        throw new VendorUnavailable(VENDOR, 'POST /storage/v1/object', `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
      if (!response.ok) throw new VendorUnavailable(VENDOR, 'POST /storage/v1/object', `responded ${response.status}`, response.status);
    },
  };
}
