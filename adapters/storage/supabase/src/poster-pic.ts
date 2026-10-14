/**
 * A POSTER'S PROFILE PICTURE, COPIED INTO OUR OWN STORAGE, so a card's face keeps loading after the
 * source's signed link has expired (the short-video source's expire about a day after the read).
 *
 * Kept at `author-pics/<file>` in the public launch-metadata bucket, beside the coin logos, where
 * `<file>` is 32 hex characters the copier chose and stored on the account (public.author
 * .picture_copy, 0079). The app builds the public path from that name, as it builds a coin
 * logo's from the address, so no reply carries a storage URL (the app's censor refuses this
 * vendor's name inside any value).
 *
 * Separate from coin-logo.ts because the key is different (a name we made, not an address) and
 * the file never changes once written: a new picture gets a new name, so it is cached for a year.
 * The download — real picture bytes only, by their first bytes, under the cap, never an SVG — is
 * coin-logo.ts's, one rule for every picture this bucket takes from the internet.
 *
 * What breaks if changed carelessly: the folder. The app builds the same path
 * (mobile/src/shared/poster-pic.ts); renaming one side without the other turns every copied face
 * back into the source's link, and the expired ones into letters.
 */

import { VendorUnavailable } from '@insidor/vendor-kit';

import { coinLogoStore, LogoRefused } from './coin-logo.ts';
import type { LogoStoreConfig } from './coin-logo.ts';

const VENDOR = 'supabase-storage';
const BUCKET = 'launch-metadata';
/** The folder in the bucket; the app's poster-picture base ends in it. */
export const POSTER_PIC_FOLDER = 'author-pics';
/** The only file names written: what the copier makes, and nothing a caller could steer into a path. */
export const POSTER_PIC_FILE = /^[0-9a-f]{32}$/;

export { LogoRefused as PictureRefused };

export function posterPicStore(config: LogoStoreConfig) {
  const base = config.url.replace(/\/+$/, '');
  const { download } = coinLogoStore(config);
  return {
    download,
    /** Store one picture under its file name. The name is new for every new picture, so it is never replaced. */
    async put(file: string, picture: { readonly bytes: Uint8Array; readonly type: string }): Promise<void> {
      if (!POSTER_PIC_FILE.test(file)) throw new LogoRefused('not a picture file name');
      let response: Response;
      try {
        response = await config.fetch(`${base}/storage/v1/object/${BUCKET}/${POSTER_PIC_FOLDER}/${file}`, {
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
