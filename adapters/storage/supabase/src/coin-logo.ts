/**
 * A COIN'S LOGO, COPIED INTO OUR OWN STORAGE so every list that shows coins loads their pictures
 * from one fast place instead of from a dozen creator-chosen hosts and IPFS gateways.
 *
 * Kept at a path the app can work out from the address alone — `coin-logos/<address>` in the
 * public launch-metadata bucket — so no reply has to carry a storage URL (the app's censor
 * refuses this vendor's name inside any value). The app asks for that path first and falls back
 * to the coin's own picture, then to its ticker's first letter, when the file is not there.
 *
 * Separate from index.ts (launch metadata) because it takes no person's input: the bytes come
 * from a picture a market source or the coin's metadata named, fetched by the mirror job.
 *
 * ★ ONLY A REAL PICTURE IS STORED. The first bytes must say PNG, JPEG, WebP or GIF, whatever the
 * host claimed, and the file must be under the cap; anything else is refused with the reason and
 * nothing is written. An SVG is refused on purpose: it can carry script, and this bucket is public.
 *
 * Two sizes since 2026-10-18 (services/project/src/logo-sizes.ts): the 256-pixel copy at
 * `coin-logos/<address>`, the path every existing reference already loads, and the 64-pixel copy
 * at `coin-logos/64/<address>` for the lists. "64" can never be an address (those are 32 to 44
 * characters), so the removal tool's path patterns cannot mistake one for the other.
 *
 * What breaks if changed carelessly: the paths. The app builds the same paths (mobile
 * shared/coin-logo.ts); renaming one side without the other turns every logo into a letter.
 */

import { VendorUnavailable } from '@insidor/vendor-kit';

import { r2Put, r2PublicUrl, type R2Config } from './r2.ts';

const VENDOR = 'supabase-storage';
const BUCKET = 'launch-metadata';
/** The folder in the bucket; the app's VITE_COIN_LOGO_BASE ends in it. */
export const COIN_LOGO_FOLDER = 'coin-logos';
/** The small copies' folder inside it. */
export const COIN_LOGO_SMALL_FOLDER = '64';
/** Which copy: `full` at the original path, `small` in the 64 folder. */
export type LogoCopy = 'full' | 'small';

export class LogoRefused extends Error {}

/** The picture's real type, read from its first bytes; null when it is none of the four. */
export function sniffPicture(bytes: Uint8Array): string | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return 'image/gif';
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
  return null;
}

export interface LogoStoreConfig {
  readonly url: string;
  readonly serviceKey: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  /** The largest picture copied, in bytes. A bigger one is left where it is. */
  readonly maxBytes: number;
  /** When set, pictures are written to R2 at the same paths (r2.ts); absent or null: Supabase Storage. */
  readonly r2?: R2Config | null;
}

/**
 * One picture written at `path` in whichever home is configured: R2 when `config.r2` is set, else the
 * Supabase bucket. Every store in this package writes through here, so the two can never disagree on a path.
 */
export async function writePicture(config: LogoStoreConfig, path: string, picture: { readonly bytes: Uint8Array; readonly type: string }, cacheControl: string): Promise<void> {
  if (config.r2) return r2Put(config.r2, config.fetch, path, picture.bytes, picture.type, cacheControl, config.timeoutMs);
  const base = config.url.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await config.fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}`, 'content-type': picture.type, 'x-upsert': 'true', 'cache-control': cacheControl },
      body: new Blob([Buffer.from(picture.bytes)], { type: picture.type }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    throw new VendorUnavailable(VENDOR, 'POST /storage/v1/object', `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  if (!response.ok) throw new VendorUnavailable(VENDOR, 'POST /storage/v1/object', `responded ${response.status}`, response.status);
}

/** Where anyone reads a stored picture at `path`. */
export const pictureUrl = (config: Pick<LogoStoreConfig, 'url' | 'r2'>, path: string): string =>
  config.r2 ? r2PublicUrl(config.r2, path) : `${config.url.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;

export function coinLogoStore(config: LogoStoreConfig) {
  const base = config.url.replace(/\/+$/, '');
  const headers = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };

  /** Fetch a picture, stopping at the cap. Throws LogoRefused for a file that is not a picture. */
  async function download(source: string): Promise<{ readonly bytes: Uint8Array; readonly type: string }> {
    let response: Response;
    try {
      response = await config.fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (e) {
      throw new VendorUnavailable('picture-host', 'GET picture', `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    if (!response.ok || response.body === null) throw new VendorUnavailable('picture-host', 'GET picture', `responded ${response.status}`, response.status);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > config.maxBytes) {
        await reader.cancel();
        throw new LogoRefused('larger than the cap');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    const type = sniffPicture(bytes);
    if (type === null) throw new LogoRefused('not a PNG, JPEG, WebP or GIF');
    return { bytes, type };
  }

  return {
    download,
    /** Where our own full copy of a coin's logo is served: the mirror reads it back to resize it. */
    ownCopyUrl(address: string): string {
      return pictureUrl(config, `${COIN_LOGO_FOLDER}/${address}`);
    },
    /** Store one copy of a coin's picture at its address, replacing any earlier one. */
    async put(address: string, picture: { readonly bytes: Uint8Array; readonly type: string }, copy: LogoCopy = 'full'): Promise<void> {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new LogoRefused('not an address');
      if (sniffPicture(picture.bytes) !== picture.type) throw new LogoRefused('not the picture it says it is');
      const path = copy === 'small' ? `${COIN_LOGO_FOLDER}/${COIN_LOGO_SMALL_FOLDER}/${address}` : `${COIN_LOGO_FOLDER}/${address}`;
      await writePicture(config, path, picture, 'max-age=604800');
    },
  };
}
