/**
 * A PERSON'S OWN PICTURE AND BANNER, UPLOADED FROM EDIT PROFILE, and the name they type there.
 *
 *   POST   /me/picture { image }   their picture: a data URL, checked, stored, put on the profile
 *   POST   /me/banner  { image }   their banner, the same way
 *   DELETE /me/picture, /me/banner back to the X picture, or the default pattern
 *
 * Kept apart from routes.ts because it is the one place the social service writes to storage, and
 * because the rules for a file someone sends are their own: the type and size are checked before a
 * byte is stored (the launch metadata's readImage: really a PNG, JPEG, WebP or GIF, under 2 MB), and
 * the file name is ours, 32 random hex characters, so nothing a request says can become a path.
 *
 * ★ THE SAME FOLDER AS EVERY OTHER FACE. Stored at `author-pics/<file>` in the public bucket, with
 * the poster pictures (0079), so the app builds the path the way it already builds every face
 * (shared/poster-pic.ts) and no reply carries the storage host. A new upload is a new name, so a
 * phone never shows an old picture from its cache. The old file is left in place: a picture someone
 * replaced is not worth a delete that could race their next upload.
 *
 * ★ NO STORAGE, NO UPLOAD — SAID, NOT FAKED. Without the storage settings the routes answer 503 with
 * a sentence the sheet shows; name and bio still save.
 *
 * What breaks if changed carelessly: the 32-hex name. 0124's checks and the app's file rule refuse
 * anything else, so a different name would store a picture nobody can see.
 */

import { randomBytes } from 'node:crypto';

import { MetadataRejected, readImage } from '@insidor/storage-supabase';

import { json, type Reply } from './http.ts';

export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

/** Where pictures are put: one file by name. Null when this deploy has no storage settings. */
export type MediaStore = { put(file: string, picture: { readonly bytes: Uint8Array; readonly type: string }): Promise<void> } | null;

const COLUMN = { picture: 'picture_file', banner: 'banner_file' } as const;
export type MediaKind = keyof typeof COLUMN;

/** A file name of ours: 32 hex characters, nothing a request could steer. */
export const newFileName = (): string => randomBytes(16).toString('hex');

/** The image a request sent, checked; a refusal is the sentence the sheet shows. */
export function checkedImage(body: unknown): { readonly ok: true; readonly bytes: Uint8Array; readonly type: string } | { readonly ok: false; readonly why: string } {
  const image = typeof body === 'object' && body !== null ? (body as { image?: unknown }).image : undefined;
  if (typeof image !== 'string') return { ok: false, why: 'Pick a picture.' };
  try {
    const read = readImage(image);
    return { ok: true, bytes: read.bytes, type: read.type };
  } catch (e) {
    /* The launch check's sentences, but "for your coin" is not what this picture is for. */
    if (!(e instanceof MetadataRejected)) return { ok: false, why: 'That picture could not be read.' };
    return { ok: false, why: e.message.includes('for your coin') ? 'Pick a picture.' : e.message };
  }
}

/** POST or DELETE /me/picture and /me/banner for the signed-in `userId`. */
export async function mediaRoute(method: string, kind: MediaKind, body: unknown, userId: string, deps: { readonly db: Db; readonly media: MediaStore }): Promise<Reply> {
  const column = COLUMN[kind];
  if (method === 'DELETE') {
    await deps.db.query(`update people.profile set ${column} = null, updated_at = now() where user_id = $1`, [userId]);
    return json(200, { [kind === 'picture' ? 'pictureFile' : 'bannerFile']: null });
  }
  if (method !== 'POST') return json(405, { error: 'method not allowed' });
  if (deps.media === null) return json(503, { error: "Picture uploads aren't set up here yet. Your name and bio still save." });
  const image = checkedImage(body);
  if (!image.ok) return json(400, { error: image.why });
  const file = newFileName();
  try {
    await deps.media.put(file, { bytes: image.bytes, type: image.type });
  } catch {
    return json(503, { error: "That picture couldn't be stored just now. Try again in a moment." });
  }
  await deps.db.query(`update people.profile set ${column} = $2, updated_at = now() where user_id = $1`, [userId, file]);
  return json(200, { [kind === 'picture' ? 'pictureFile' : 'bannerFile']: file });
}

/**
 * The name someone typed: trimmed, 1 to 50 characters, or '' to go back to the sign-in's name
 * (stored as null). Null when it is not a string or too long.
 */
export function typedName(v: unknown): { readonly name: string | null } | null {
  if (typeof v !== 'string') return null;
  const name = v.trim().replace(/\s+/g, ' ');
  if (name.length > 50) return null;
  return { name: name === '' ? null : name };
}
