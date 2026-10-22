/**
 * A PICTURE OR BANNER PICKED IN EDIT PROFILE, CHECKED AND MADE SMALL BEFORE IT IS SENT.
 *
 * The social service checks every upload itself (a real PNG, JPEG, WebP or GIF under 2 MB,
 * services/social profile-media.ts); this is the phone's half, so a person hears at once that a file
 * will not do, and a twelve-megapixel photo goes up as a picture the profile can actually use:
 * the picture 400 by 400, the banner 1500 by 500, cropped to fill, as a JPEG.
 *
 * Split from the sheet so the type and size rule runs under `node --test`; the drawing needs a
 * browser and is not tested here.
 *
 * What breaks if changed carelessly: the 2 MB cap must stay at or under the service's. A file the
 * phone lets through and the service refuses is a save that fails after the wait.
 */

export type ImageKind = 'picture' | 'banner';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** The largest file we try to shrink: anything bigger is refused before it is opened. */
const MAX_PICKED_BYTES = 20 * 1024 * 1024;
/** What the service takes (profile-media.ts, through readImage). */
export const MAX_SENT_BYTES = 2 * 1024 * 1024;
const SIZE: Readonly<Record<ImageKind, { readonly w: number; readonly h: number }>> = { picture: { w: 400, h: 400 }, banner: { w: 1500, h: 500 } };
const QUALITY = 0.86;

/** The picked file's type and size, before anything is read: a sentence when it will not do. */
export function pickedProblem(type: string, bytes: number): string | null {
  if (!TYPES.includes(type)) return 'Use a PNG, JPEG, WebP or GIF picture.';
  if (bytes > MAX_PICKED_BYTES) return 'That picture is over 20 MB. Pick a smaller one.';
  if (bytes === 0) return 'That file is empty.';
  return null;
}

/** The size a data URL's bytes come to. */
export const dataUrlBytes = (url: string): number => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);

/** The picked file, cropped to fill its frame and encoded as a JPEG data URL; or why it could not be. */
export async function prepareImage(file: File, kind: ImageKind): Promise<{ readonly ok: true; readonly dataUrl: string } | { readonly ok: false; readonly why: string }> {
  const problem = pickedProblem(file.type, file.size);
  if (problem !== null) return { ok: false, why: problem };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, why: 'That picture could not be opened.' };
  }
  const { w, h } = SIZE[kind];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return { ok: false, why: 'That picture could not be opened.' };
  /* Cover: scale to fill the frame, centred, the overflow cut. */
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.fillStyle = '#131317';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  if (dataUrlBytes(dataUrl) > MAX_SENT_BYTES) return { ok: false, why: 'That picture is still over 2 MB. Pick a simpler one.' };
  return { ok: true, dataUrl };
}
