/**
 * A MEMBER'S PHOTO AT SIGN-UP, SAVED: `POST /onboarding/picture { image }`, where `image` is the
 * square the phone cropped (or one of the app's preset pictures it drew), as a data URL.
 *
 * The bytes go to our storage under a name made here (adapters/storage/supabase member-pic.ts),
 * the profile's picture becomes that photo's public link, and `picture_chosen_at` is set so the X
 * picture from a later sign-in never replaces it (routes.ts syncProfile, 0123).
 *
 * ★ A TYPE AND SIZE CHECK, NOT A CONTENT CHECK. The photo must be a PNG, JPEG or WebP by its bytes
 * and under the cap; nothing looks at what it shows. There is no content check in the codebase
 * yet, and the app says nothing that suggests otherwise.
 *
 * ★ NO STORAGE, NO PHOTOS — SAID, NOT FAKED. A service without storage settings answers 503 and the
 * phone says photos can't be saved right now; it never keeps a link to nothing.
 *
 * Its own file because it is the one route whose body is a picture: the transport lets this path,
 * and only this path, carry more than the usual small JSON body (http.ts).
 */

import { randomBytes } from 'node:crypto';

import type { Person } from '@insidor/contracts/ports/people.ts';

import { json, type Reply } from './http.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

/** Where photos are kept: the storage adapter, behind the two calls this route makes. */
export interface PhotoStore {
  put(file: string, bytes: Uint8Array): Promise<void>;
  urlOf(file: string): string;
  /** Whether an error from `put` is the photo being refused (not a photo, too big), not storage being down. */
  refused(e: unknown): boolean;
}

/** The largest photo taken, in bytes: the phone sends a 512-pixel square, well under this. */
export const MAX_PHOTO_BYTES = 400_000;

const bad = (error: string, status = 400): Reply => json(status, { error });

/** The bytes in a data URL of a picture; null for anything else. The type it claims is not trusted. */
export function bytesOfDataUrl(v: unknown): Uint8Array | null {
  if (typeof v !== 'string') return null;
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (m?.[1] === undefined) return null;
  const bytes = Buffer.from(m[1], 'base64');
  return bytes.length === 0 ? null : new Uint8Array(bytes);
}

export async function pictureRoute(method: string, body: unknown, me: Person | null, deps: { readonly db: Db; readonly photos: PhotoStore | null }): Promise<Reply> {
  if (method !== 'POST') return bad('method not allowed', 405);
  if (me === null) return bad('Sign in first.', 401);
  if ((await deps.db.query('select 1 from people.member_access where user_id = $1', [me.userId])).length === 0) return bad('Add a photo once you are in.', 403);
  if (deps.photos === null) return bad("Photos can't be saved right now. Skip this and add one later.", 503);
  const bytes = bytesOfDataUrl((body as { image?: unknown } | null)?.image);
  if (bytes === null) return bad('Pick a photo first.');
  if (bytes.length > MAX_PHOTO_BYTES) return bad('That photo is too big. Pick a smaller one.', 413);
  const file = randomBytes(16).toString('hex');
  try {
    await deps.photos.put(file, bytes);
  } catch (e) {
    if (deps.photos.refused(e)) return bad('That file is not a photo. Pick a JPEG, PNG or WebP.');
    return bad("Your photo couldn't be saved just now. Try again.", 502);
  }
  const url = deps.photos.urlOf(file);
  await deps.db.query('update people.profile set picture_url = $2, picture_chosen_at = now(), updated_at = now() where user_id = $1', [me.userId, url]);
  return json(200, { pictureUrl: url });
}
