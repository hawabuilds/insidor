/**
 * A COIN'S LOGO, MADE INTO THE TWO SIZES THE APP DRAWS (the owner, 2026-10-18: "Resize each to
 * small sizes (64px and 256px)"). The mirror used to store the picture as the host served it,
 * about 50 KB on average and up to 4 MB, for a disc the app draws at 22 to 48 pixels. Measured on
 * 196 stored logos of shown coins the same day: 55 KB as stored, 8.6 KB at 256 pixels and 1.2 KB
 * at 64, both WebP.
 *
 *   full   at most 256 pixels on its longer side: written at the path every existing reference
 *          already uses, `coin-logos/<address>`, so nothing that points at a logo changes. The
 *          token page reads this one.
 *   small  at most 64 pixels: `coin-logos/64/<address>`, for the lists and cards.
 *
 * Separate from the mirror (coin-logos.ts) so its choices are tested on real pictures, and from the
 * storage adapter because the adapter only moves bytes.
 *
 * ★ NEVER ENLARGED, NEVER CROPPED. `inside` keeps the picture's shape and `withoutEnlargement`
 * keeps a picture smaller than the size as it is; the app crops to a circle itself (object-fit:
 * cover), so the disc looks as it did with the original. An animated picture keeps its first frame:
 * the app's discs are too small for the motion to be seen, and every frame would be stored.
 *
 * What breaks if changed carelessly: the output type. The adapter refuses to store bytes whose
 * first bytes are not PNG, JPEG, WebP or GIF, and the public bucket must never hold an SVG.
 */

import sharp from 'sharp';

/** The token page's size, and the path every existing reference already loads. */
export const FULL_PX = 256;
/** The lists' and cards' size. */
export const SMALL_PX = 64;
/** WebP quality: at 256 pixels a logo is about 9 KB, and no difference shows on a 48-pixel disc. */
const QUALITY = 80;
/** A picture with more pixels than this is not decoded: a decompression bomb, not a logo. */
const MAX_INPUT_PIXELS = 64_000_000;

export interface Picture {
  readonly bytes: Uint8Array;
  readonly type: string;
}

export class NotAPicture extends Error {}

async function sized(bytes: Uint8Array, px: number): Promise<Picture> {
  const out = await sharp(bytes, { animated: false, limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(px, px, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();
  return { bytes: new Uint8Array(out), type: 'image/webp' };
}

/** Both sizes of one picture. Throws NotAPicture when the bytes cannot be decoded. */
export async function logoSizes(bytes: Uint8Array): Promise<{ readonly full: Picture; readonly small: Picture }> {
  try {
    const [full, small] = await Promise.all([sized(bytes, FULL_PX), sized(bytes, SMALL_PX)]);
    return { full, small };
  } catch (e) {
    throw new NotAPicture(`picture not decoded: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120));
  }
}
