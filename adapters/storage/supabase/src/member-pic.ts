/**
 * A MEMBER'S OWN PROFILE PHOTO, uploaded at sign-up, kept in our storage beside the posters' faces.
 *
 * Kept at `member-pics/<file>` in the public launch-metadata bucket, where `<file>` is 32 hex
 * characters the social service chose (services/social picture.ts). Unlike a poster's copy, the
 * full public link is stored on the profile (`people.profile.picture_url`), because every reply that
 * draws a person already carries that one field and reads it as a link; the social service's
 * replies are checked for our words in keys only, never in values.
 *
 * ★ ONLY A REAL PICTURE IS WRITTEN. The bytes must say PNG, JPEG or WebP by their first bytes
 * (coin-logo.ts's sniff), whatever the upload claimed, and be under the caller's cap. A GIF is
 * refused (a moving face beside every comment is not a photo), and an SVG always (it can carry
 * script, and this bucket is public).
 *
 * ★ NOTHING HERE CHECKS WHAT THE PHOTO SHOWS. There is no content check anywhere in the codebase
 * yet; this is a type and size check only. Separate from poster-pic.ts because a person, not the
 * internet, chose these bytes, and the rules for that are this file's to grow.
 *
 * What breaks if changed carelessly: the folder and the name rule. A name a caller could steer
 * would let one upload replace another member's photo, or a coin's logo.
 */

import { LogoRefused, pictureUrl, sniffPicture, writePicture } from './coin-logo.ts';
import type { R2Config } from './r2.ts';

export const MEMBER_PIC_FOLDER = 'member-pics';
export const MEMBER_PIC_FILE = /^[0-9a-f]{32}$/;
const TAKEN = new Set(['image/png', 'image/jpeg', 'image/webp']);

export { LogoRefused as PhotoRefused };

export interface MemberPicConfig {
  readonly url: string;
  readonly serviceKey: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  /** The largest photo written, in bytes. */
  readonly maxBytes: number;
  /** When set, photos are written to R2 at the same path (r2.ts); absent or null: Supabase Storage. */
  readonly r2?: R2Config | null;
}

/** The photo's type by its bytes, when it is one we keep; null otherwise. */
export function photoType(bytes: Uint8Array): string | null {
  const t = sniffPicture(bytes);
  return t !== null && TAKEN.has(t) ? t : null;
}

export function memberPicStore(config: MemberPicConfig) {
  return {
    /** The public link a stored photo is read from. */
    urlOf: (file: string): string => pictureUrl(config, `${MEMBER_PIC_FOLDER}/${file}`),
    /** Store one photo under a new name. Throws PhotoRefused for anything that is not a photo we keep. */
    async put(file: string, bytes: Uint8Array): Promise<void> {
      if (!MEMBER_PIC_FILE.test(file)) throw new LogoRefused('not a photo file name');
      if (bytes.length === 0 || bytes.length > config.maxBytes) throw new LogoRefused('too big');
      const type = photoType(bytes);
      if (type === null) throw new LogoRefused('not a PNG, JPEG or WebP photo');
      await writePicture(config, `${MEMBER_PIC_FOLDER}/${file}`, { bytes, type }, 'max-age=31536000');
    },
  };
}
