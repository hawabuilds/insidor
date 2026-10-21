/**
 * A SHOWN POST'S PICTURE, MADE INTO THE TWO SIZES THE APP DRAWS: the lists' square (at most 84
 * points, so `postPictures.cardPx`) and the post sheet's picture across the phone (`sheetPx`).
 * Measured on 52 shown pictures on 2026-10-21: 15 KB and 64 KB a TikTok cover, 15 KB and 70 KB an
 * X picture, 8 KB and 28 KB an X video still, both WebP — against 63 to 290 KB as the hosts serve
 * them.
 *
 * Separate from the copier (post-pics.ts) so its choices are tested on real pictures, and from the
 * storage adapter because the adapter only moves bytes. Separate from logo-sizes.ts because the
 * sizes and the quality are the post pictures' own policy, not the logos' constants.
 *
 * ★ NEVER ENLARGED, NEVER CROPPED. `inside` keeps the picture's shape and `withoutEnlargement`
 * keeps a smaller picture as it is; the app crops the square itself (object-fit: cover), so a card
 * looks as it did with the source's link. An animated picture keeps its first frame: the cards and
 * the sheet's still show one frame, and every frame would be stored.
 *
 * What breaks if changed carelessly: the output type. The adapter refuses bytes whose first bytes
 * are not PNG, JPEG, WebP or GIF, and the public bucket must never hold an SVG.
 */

import sharp from 'sharp';

import type { PostPicturePolicy } from '@insidor/contracts/policy.ts';

import { NotAPicture, type Picture } from './logo-sizes.ts';

/** A picture with more pixels than this is not decoded: a decompression bomb, not a post picture. */
const MAX_INPUT_PIXELS = 64_000_000;

async function sized(bytes: Uint8Array, px: number, quality: number): Promise<Picture> {
  const out = await sharp(bytes, { animated: false, limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(px, px, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
  return { bytes: new Uint8Array(out), type: 'image/webp' };
}

/** Both copies of one picture. Throws NotAPicture when the bytes cannot be decoded. */
export async function postPicSizes(bytes: Uint8Array, policy: Pick<PostPicturePolicy, 'cardPx' | 'sheetPx' | 'quality'>): Promise<{ readonly card: Picture; readonly sheet: Picture }> {
  try {
    const [card, sheet] = await Promise.all([sized(bytes, policy.cardPx, policy.quality), sized(bytes, policy.sheetPx, policy.quality)]);
    return { card, sheet };
  } catch (e) {
    throw new NotAPicture(`picture not decoded: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120));
  }
}
