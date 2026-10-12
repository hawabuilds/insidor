/**
 * A NEW COIN'S PICTURE AND METADATA, STORED WHERE THE CHAIN CAN POINT AT THEM — ported from
 * Trador's `launchMetadata.ts`: a public bucket in our own Supabase Storage, the picture first,
 * then the metadata document naming it. The document's address is what the coin's `uri` holds.
 *
 * Why not the launchpad's own upload: pump.fun's IPFS route refuses servers (403, "blocked",
 * checked 2026-10-12), as its other routes do. Trador stores the files itself, and so does this.
 *
 * ★ WHAT A CREATOR SENDS IS CHECKED BEFORE IT IS STORED: a picture that is really a PNG, JPEG,
 * WebP or GIF and under 2 MB, and links that are plain https. Anything else is refused with the
 * reason; nothing half-stored is pointed at.
 *
 * What breaks if changed carelessly: the bucket is public on purpose — the chain points at these
 * files forever and anyone must be able to read them — so nothing private may ever be put in it.
 */

import { rec, str, VendorUnavailable } from '@insidor/vendor-kit';

const VENDOR = 'supabase-storage';
const BUCKET = 'launch-metadata';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TYPES: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export class MetadataRejected extends Error {}

export interface StorageConfig {
  readonly url: string;
  readonly serviceKey: string;
  readonly fetch: typeof globalThis.fetch;
  readonly id: () => string;
}

export interface LaunchMetadataInput {
  readonly name: string;
  readonly symbol: string;
  readonly description: string;
  /** `data:image/png;base64,…` as the browser read it. */
  readonly imageDataUrl: string;
  readonly links: { readonly twitter?: string | undefined; readonly telegram?: string | undefined; readonly website?: string | undefined };
}

const https = (v: string | undefined): string | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** The checks, alone: a refusal says what to fix. Pure, so it is tested without a network. */
export function readImage(dataUrl: string): { readonly type: string; readonly extension: string; readonly bytes: Uint8Array } {
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (match === null) throw new MetadataRejected('Pick a picture for your coin.');
  const [, type = '', body = ''] = match;
  const extension = TYPES[type];
  if (extension === undefined) throw new MetadataRejected('Use a PNG, JPEG, WebP or GIF picture.');
  const bytes = Uint8Array.from(Buffer.from(body, 'base64'));
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new MetadataRejected('That picture is over 2 MB. Pick a smaller one.');
  return { type, extension, bytes };
}

export function metadataDocument(input: LaunchMetadataInput, imageUrl: string): Record<string, unknown> {
  const links = Object.fromEntries(
    Object.entries({ twitter: https(input.links.twitter), telegram: https(input.links.telegram), website: https(input.links.website) }).filter(([, v]) => v !== undefined),
  );
  return { name: input.name, symbol: input.symbol, description: input.description, image: imageUrl, showName: true, createdOn: 'https://insidor.app', ...links };
}

export function supabaseStorage(config: StorageConfig) {
  const base = config.url.replace(/\/+$/, '');
  const headers = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };
  const put = async (path: string, body: Uint8Array | string, contentType: string): Promise<string> => {
    let response: Response;
    try {
      response = await config.fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': contentType, 'x-upsert': 'false' },
        body: new Blob([typeof body === 'string' ? body : Buffer.from(body)], { type: contentType }),
      });
    } catch (e) {
      throw new VendorUnavailable(VENDOR, 'POST /storage/v1/object', `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    if (!response.ok) throw new VendorUnavailable(VENDOR, 'POST /storage/v1/object', `responded ${response.status}`, response.status);
    const key = str(rec(await response.json()).Key);
    if (key === null) throw new VendorUnavailable(VENDOR, 'POST /storage/v1/object', 'no key in the reply');
    return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  };

  return {
    /** Store the picture, then the document naming it. Returns the document's address for the coin. */
    async upload(input: LaunchMetadataInput): Promise<{ readonly uri: string; readonly image: string }> {
      const image = readImage(input.imageDataUrl);
      const id = config.id();
      const imageUrl = await put(`${id}.${image.extension}`, image.bytes, image.type);
      const uri = await put(`${id}.json`, JSON.stringify(metadataDocument(input, imageUrl)), 'application/json');
      return { uri, image: imageUrl };
    },
  };
}
