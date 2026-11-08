/**
 * THE PRIVATE ARCHIVE BUCKET ON CLOUDFLARE R2 (`R2_ARCHIVE_BUCKET`): launch facts, graduations and the
 * nightly smart-wallet lists, kept OUT of the database (the owner, 2026-11-08: "make sure it goes to
 * cheap storage" and "i dont want it to increase load database or performance").
 *
 * Its own file beside r2.ts, which only uploads to the PUBLIC picture bucket and builds public links.
 * This bucket has no public address: every read is signed, so it needs download and list as well as
 * upload, and nothing here may ever build a public link to it.
 *
 * Why R2 and not Supabase Storage: the nightly job reads 30 days of files back every night, and R2
 * charges nothing for reads; Supabase counts them against the plan's transfer, which cut storage off on
 * 2026-10-29. The owner's rule: never pay extra.
 *
 * ★ NO SDK. A hand-written AWS signature version 4, the same scheme r2.ts uses, extended to a query
 * string (list) and bodiless requests. Every failure throws with the status only; the keys and the
 * signed URL never reach a message.
 *
 * What breaks if changed carelessly: `encodeRfc3986`. S3 signs the query string with RFC 3986 encoding,
 * which differs from encodeURIComponent on ! ' ( ) *; a key with one of those then fails to sign.
 */

import { createHash, createHmac } from 'node:crypto';

export interface ArchiveConfig {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/** The archive from the environment: the three R2 keys and `R2_ARCHIVE_BUCKET`, or null unless all are set and look real. */
export function readArchiveConfig(env: Readonly<Record<string, string | undefined>>): ArchiveConfig | null {
  const accountId = env['R2_ACCOUNT_ID']?.trim() ?? '';
  const accessKeyId = env['R2_ACCESS_KEY_ID']?.trim() ?? '';
  const secretAccessKey = env['R2_SECRET_ACCESS_KEY']?.trim() ?? '';
  const bucket = env['R2_ARCHIVE_BUCKET']?.trim() ?? '';
  if (!/^[0-9a-f]{32}$/.test(accountId) || !/^[0-9a-f]{32}$/.test(accessKeyId) || !/^[0-9a-f]{64}$/.test(secretAccessKey)) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export class ArchiveError extends Error {
  readonly status: number | null;
  constructor(what: string, status: number | null) {
    super(`archive ${what} failed${status === null ? '' : ` (${status})`}`);
    this.name = 'ArchiveError';
    this.status = status;
  }
}

const sha256 = (d: Uint8Array | string): string => createHash('sha256').update(d).digest('hex');
const hmac = (k: Uint8Array | string, d: string): Buffer => createHmac('sha256', k).update(d).digest();
export const encodeRfc3986 = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (p: string): string => p.split('/').map(encodeRfc3986).join('/');

async function signed(
  a: ArchiveConfig,
  fetcher: typeof globalThis.fetch,
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  query: Readonly<Record<string, string>>,
  body: Uint8Array | null,
  extra: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<Response> {
  const host = `${a.accountId}.r2.cloudflarestorage.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? '');
  const headers: Record<string, string> = { ...extra, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const uri = path === '' ? `/${a.bucket}` : `/${a.bucket}/${encodePath(path)}`;
  const qs = Object.keys(query).sort().map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k] ?? '')}`).join('&');
  const canonical = [method, uri, qs, names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${a.secretAccessKey}`, day), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...sent } = headers;
  try {
    return await fetcher(`https://${host}${uri}${qs === '' ? '' : `?${qs}`}`, {
      method,
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${a.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
      ...(body === null ? {} : { body: new Blob([Buffer.from(body)]) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ArchiveError(`${method} request`, null);
  }
}

/** Store `body` at `path`, replacing any earlier object there. */
export async function archivePut(a: ArchiveConfig, fetcher: typeof globalThis.fetch, path: string, body: Uint8Array | string, contentType: string, timeoutMs = 30_000): Promise<void> {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const r = await signed(a, fetcher, 'PUT', path, {}, bytes, { 'content-type': contentType }, timeoutMs);
  if (!r.ok) throw new ArchiveError('PUT', r.status);
}

/** The object at `path`, or null when there is none. */
export async function archiveGet(a: ArchiveConfig, fetcher: typeof globalThis.fetch, path: string, timeoutMs = 60_000): Promise<Uint8Array | null> {
  const r = await signed(a, fetcher, 'GET', path, {}, null, {}, timeoutMs);
  if (r.status === 404) return null;
  if (!r.ok) throw new ArchiveError('GET', r.status);
  return new Uint8Array(await r.arrayBuffer());
}

export async function archiveDelete(a: ArchiveConfig, fetcher: typeof globalThis.fetch, path: string, timeoutMs = 30_000): Promise<void> {
  const r = await signed(a, fetcher, 'DELETE', path, {}, null, {}, timeoutMs);
  if (!r.ok && r.status !== 404) throw new ArchiveError('DELETE', r.status);
}

const unxml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Every object path under `prefix`, in key order, following continuation tokens up to `maxKeys`. */
export async function archiveList(a: ArchiveConfig, fetcher: typeof globalThis.fetch, prefix: string, maxKeys = 100_000, timeoutMs = 30_000): Promise<readonly string[]> {
  const out: string[] = [];
  let token: string | null = null;
  do {
    const q: Record<string, string> = { 'list-type': '2', prefix };
    if (token !== null) q['continuation-token'] = token;
    const r = await signed(a, fetcher, 'GET', '', q, null, {}, timeoutMs);
    if (!r.ok) throw new ArchiveError('LIST', r.status);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) out.push(unxml(m[1] ?? ''));
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
    token = truncated && next !== undefined ? unxml(next) : null;
  } while (token !== null && out.length < maxKeys);
  return out;
}
