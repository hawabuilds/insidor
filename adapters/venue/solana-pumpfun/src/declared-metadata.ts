/**
 * A coin's metadata document read FROM THE HOST ITS CREATOR NAMED, when the link carries no
 * content id — fenced so the creator picks a document, never a door into our network.
 *
 * metadata.ts reads only content-addressed links, through our own gateway, and records the rest
 * as `notContentAddressed`. On 2026-10-13 that was 40% of every new coin: the tweet-deploy tools
 * (one host alone took 3,000 a day) write their documents to their own servers. Those are the
 * coins most often launched straight from a viral post, and their documents carry that post's
 * link — so the matching evidence that settles a post's coin most cheaply ("links this post") and
 * the coin's picture were missing for exactly the coins that matter. The owner asked for the
 * metadata of every candidate coin (2026-10-13). This file narrows metadata.ts's refusal rather
 * than dropping it:
 *
 *   ★ ONLY https, ONLY A NAME, ONLY A PUBLIC ADDRESS. No IP literal, no single-label or local
 *     host, and every address the name resolves to must be public (no loopback, private,
 *     link-local, carrier-grade NAT, unique-local or multicast range). A redirect is refused, so
 *     a public host cannot hand the request on to a private one.
 *   ★ THE SAME CAPS AS THE GATEWAY READ: `timeoutMs` and `maxBytes`. One GET of a few hundred
 *     bytes per coin; a creator who points at someone else's server can buy one small request
 *     per coin he pays to launch, which amplifies nothing.
 *   The picture inside is kept when it is a well-formed https address (bounded): it is handed
 *     to the embedding service as an address, which fetches it on its side, never on ours.
 *
 * A residual risk, stated: a name that resolves public when checked and private when fetched
 * (rebinding) is not caught here; the fetch is a GET with no credentials and its answer is only
 * parsed as a bounded document, never forwarded.
 *
 * What breaks if changed carelessly: the address check. Dropping it turns a field anyone can
 * type into a request from our servers to anything they can reach.
 */

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

import { VendorShapeError, VendorUnavailable, rec, str } from '@insidor/vendor-kit';

import { boundedText, httpsUri } from './hostile.ts';
import type { CoinMetadata } from './metadata.ts';

const VENDOR = 'creator-host';
const LABEL = 'GET {declared metadata}';
const NAME_MAX = 128;
const TICKER_MAX = 32;
const DESCRIPTION_MAX = 1_000;
const LINK_MAX = 512;
const URI_MAX = 512;

export interface DeclaredFetchConfig {
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  /** Every address a host name resolves to. Injected so tests never touch the network. */
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}

export type DeclaredRead =
  | { readonly kind: 'read'; readonly metadata: CoinMetadata }
  /** The link is not one we will fetch: not https, an IP, a local name, or a private address. */
  | { readonly kind: 'refused'; readonly why: string };

const defaultResolve = async (host: string): Promise<readonly string[]> => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Whether an address is on the public internet. Anything we cannot parse is not. */
export function isPublicAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a = -1, b = -1] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (v === 6) {
    const s = address.toLowerCase();
    if (s === '::' || s === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s)?.[1];
    if (mapped !== undefined) return isPublicAddress(mapped);
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff')) return false;
    return true;
  }
  return false;
}

/** The link, if it is one we may fetch: https, a dotted name, no IP literal, no credentials. */
export function fetchableUrl(uri: string | null | undefined): URL | null {
  if (typeof uri !== 'string' || uri.length > URI_MAX) return null;
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  if (url.port !== '' && url.port !== '443') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 || !host.includes('.')) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet|railway)$/i.test(host)) return null;
  return url;
}

/** Read a fetched document; the picture is kept as a bounded https address. */
export function readDeclared(raw: unknown): CoinMetadata {
  const r = rec(raw);
  const link = (v: unknown) => httpsUri(v, LINK_MAX);
  return {
    name: boundedText(r.name, NAME_MAX),
    ticker: boundedText(r.symbol, TICKER_MAX),
    description: boundedText(r.description, DESCRIPTION_MAX),
    imageUri: httpsUri(str(r.image), URI_MAX),
    links: { social: link(r.twitter), website: link(r.website), chat: link(r.telegram) },
  };
}

export async function fetchDeclaredMetadata(uri: string | null, config: DeclaredFetchConfig): Promise<DeclaredRead> {
  const url = fetchableUrl(uri);
  if (url === null) return { kind: 'refused', why: 'not an https link to a public name' };
  let addresses: readonly string[];
  try {
    addresses = await (config.resolve ?? defaultResolve)(url.hostname);
  } catch (error) {
    throw new VendorUnavailable(VENDOR, LABEL, `name did not resolve: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) return { kind: 'refused', why: 'the name resolves to a private address' };
  let response: Response;
  try {
    response = await config.fetch(url.toString(), { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(config.timeoutMs) });
  } catch (error) {
    throw new VendorUnavailable(VENDOR, LABEL, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  if (!response.ok) throw new VendorUnavailable(VENDOR, LABEL, `responded ${response.status}`, response.status);
  const body = await readCapped(response, config.maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new VendorShapeError(VENDOR, 'body', 'is not JSON');
  }
  return { kind: 'read', metadata: readDeclared(parsed) };
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new VendorShapeError(VENDOR, 'body', `is over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
