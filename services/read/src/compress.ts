/**
 * THE BYTES OF A REPLY: compressed once (brotli, else gzip, as the caller accepts) and tagged with a
 * weak ETag, so server.ts can answer a repeat with a bodiless 304 and everything else in the fewest
 * bytes the caller can read.
 *
 * ★ WHY THIS PROCESS COMPRESSES. The platform in front of it (Railway's edge) passes bytes through
 * as they are, and the Narratives list was 1.3 MB of JSON on every read, crossing a continent to the
 * Vercel function and then to a phone. JSON packs about five to one.
 *
 * ★ WEAK ETags. The Vercel function in front decodes and re-encodes what it forwards, so the bytes a
 * phone receives are not the bytes hashed here; a weak tag promises the same meaning, which is what
 * a 304 needs. It is a hash of the body, so two processes building the same reply give the same tag.
 *
 * What breaks if changed carelessly: brotli's quality. 11 (the library's default) takes seconds on
 * the largest replies and would stall the process; 5 is a few milliseconds per hundred kilobytes.
 */

import { createHash } from 'node:crypto';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

/** What `handle` returns: a status and an already-serialised body. */
export interface PlainReply {
  readonly status: number;
  readonly body: string;
}

/** A reply ready to write: its bytes, each encoding's bytes where worth having, and its ETag. */
export interface Prepared {
  readonly status: number;
  readonly body: Buffer;
  readonly br: Buffer | null;
  readonly gzip: Buffer | null;
  /** Weak (`W/"…"`): the proxy in front may re-encode the bytes, and a weak tag survives that. Only on a 200. */
  readonly etag: string | null;
}

/** Below this a reply is sent as is: compressing a dozen bytes costs more than it saves. */
export const COMPRESS_FROM_BYTES = 1024;
/** Brotli's quality for a reply. 5 packs the 1.3 MB narratives list to ~210 KB in ~25 ms; 11 takes seconds. */
const BROTLI_QUALITY = 5;
const GZIP_LEVEL = 6;

const brotliP = promisify(brotliCompress);
const gzipP = promisify(gzip);

export type Encoding = 'br' | 'gzip' | null;

/** The encoding to send for an Accept-Encoding header: brotli, else gzip, else none; `q=0` refuses. */
export function encodingFor(acceptEncoding: string | undefined): Encoding {
  if (acceptEncoding === undefined || acceptEncoding === '') return null;
  const ok = new Set<string>();
  for (const part of acceptEncoding.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (name !== undefined && name !== '' && !(q !== undefined && Number(q.slice(2)) === 0)) ok.add(name.trim());
  }
  if (ok.has('br')) return 'br';
  if (ok.has('gzip') || ok.has('*')) return 'gzip';
  return null;
}

/** A reply as bytes, compressed into `encodings` when it is large enough, with its ETag. */
export async function prepare(reply: PlainReply, encodings: readonly ('br' | 'gzip')[] = ['br', 'gzip']): Promise<Prepared> {
  const body = Buffer.from(reply.body, 'utf8');
  const etag = reply.status === 200 ? `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 27)}"` : null;
  if (body.length < COMPRESS_FROM_BYTES) return { status: reply.status, body, br: null, gzip: null, etag };
  const [br, gz] = await Promise.all([
    encodings.includes('br')
      ? brotliP(body, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
      : Promise.resolve(null),
    encodings.includes('gzip') ? gzipP(body, { level: GZIP_LEVEL }) : Promise.resolve(null),
  ]);
  return { status: reply.status, body, br, gzip: gz, etag };
}
