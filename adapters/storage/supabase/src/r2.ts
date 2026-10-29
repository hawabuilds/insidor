/**
 * THE PICTURES' OTHER HOME: Cloudflare R2, written with the S3 request signature, read from its public
 * address. Every store in this package (coin-logo.ts, post-pic.ts, poster-pic.ts, member-pic.ts and the
 * Create flow's index.ts) writes here instead of Supabase Storage when `readR2Config` finds the four
 * settings, at the SAME path it always used — `coin-logos/<address>`, `post-pics/<file>`, `author-pics/<file>`
 * — so the app only swaps its base address and builds every path as before.
 *
 * Why (the owner, 2026-10-29): Supabase counts every picture a phone loads against the plan's monthly
 * transfer, and at ~01:00 UTC that day it cut storage off (`exceed_egress_quota`): every coin logo, poster
 * face and post picture stopped loading. R2 charges nothing for transfer, so the pictures — the part that
 * grows with users — can never run up a bill or hit a cap again. The owner's rule: never pay extra.
 *
 * ★ NO SDK. One signed PUT is all the stores need; a hand-written AWS signature version 4 (the scheme R2
 * speaks) keeps the dependency list as it was. The keys never leave this file's signing step and are
 * never logged.
 * ★ ALL FOUR OR NOTHING. A missing or placeholder setting (the owner's first try set the literal words
 * from the instructions) returns null and every store keeps writing to Supabase: a half-configured R2
 * must never send pictures somewhere the app does not read.
 *
 * What breaks if changed carelessly: the path. The app builds `<base>/<folder>/<file>` itself
 * (mobile shared/ui/CoinLogo.tsx, shared/post-pic.ts, shared/poster-pic.ts); a key written under another
 * name is a picture nobody ever loads.
 */

import { createHash, createHmac } from 'node:crypto';

import { VendorUnavailable } from '@insidor/vendor-kit';

const VENDOR = 'r2-storage';

export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** The bucket's public address, e.g. https://pub-….r2.dev — what the app's picture base starts with. */
  readonly publicBase: string;
}

/** R2 from the environment, or null unless all four settings are there and look real. */
export function readR2Config(env: Readonly<Record<string, string | undefined>>): R2Config | null {
  const accountId = env['R2_ACCOUNT_ID']?.trim() ?? '';
  const accessKeyId = env['R2_ACCESS_KEY_ID']?.trim() ?? '';
  const secretAccessKey = env['R2_SECRET_ACCESS_KEY']?.trim() ?? '';
  const publicBase = (env['R2_PUBLIC_BASE']?.trim() ?? '').replace(/\/+$/, '');
  const bucket = env['R2_BUCKET']?.trim() || 'insidor-pics';
  if (!/^[0-9a-f]{32}$/.test(accountId) || !/^[0-9a-f]{32}$/.test(accessKeyId) || !/^[0-9a-f]{64}$/.test(secretAccessKey)) return null;
  if (!/^https:\/\/[^/]+$/.test(publicBase)) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBase };
}

/** Where a stored object is read by anyone. */
export const r2PublicUrl = (r2: R2Config, path: string): string => `${r2.publicBase}/${path}`;

const sha256 = (d: Uint8Array | string): string => createHash('sha256').update(d).digest('hex');
const hmac = (k: Uint8Array | string, d: string): Buffer => createHmac('sha256', k).update(d).digest();
const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

/** Store one object at `path`, replacing any earlier one. Throws VendorUnavailable on any failure. */
export async function r2Put(
  r2: R2Config,
  fetcher: typeof globalThis.fetch,
  path: string,
  body: Uint8Array | string,
  contentType: string,
  cacheControl: string,
  timeoutMs: number,
): Promise<void> {
  const host = `${r2.accountId}.r2.cloudflarestorage.com`;
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(bytes);
  const signed: Record<string, string> = { 'cache-control': cacheControl, 'content-type': contentType, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(signed).sort();
  const uri = `/${r2.bucket}/${encodePath(path)}`;
  const canonical = ['PUT', uri, '', names.map((n) => `${n}:${signed[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${r2.secretAccessKey}`, day), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...headers } = signed;
  let response: Response;
  try {
    response = await fetcher(`https://${host}${uri}`, {
      method: 'PUT',
      headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
      body: new Blob([Buffer.from(bytes)], { type: contentType }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new VendorUnavailable(VENDOR, 'PUT object', `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  if (!response.ok) throw new VendorUnavailable(VENDOR, 'PUT object', `responded ${response.status}`, response.status);
}
