/**
 * WHERE A COIN'S LOGO CAN BE FETCHED FROM: the picture its own metadata names (through a chain of
 * IPFS gateways when it is content-addressed), and the launchpad's own resized copy of it.
 *
 * Every coin this launchpad makes has a picture — a launch is refused without one — so a coin we
 * draw as a letter is a coin whose picture we failed to fetch. The logo mirror
 * (services/project/src/coin-logos.ts) asks this file for the links to try, in the owner's order,
 * and copies the first that answers with a real picture into our storage.
 *
 * Separate from metadata.ts, which reads a document for its FACTS (name, links) and keeps only a
 * content-addressed picture on one gateway: a logo wants the picture link as written, and wants
 * the next gateway when one is slow or rate-limited (on 2026-10-13 ipfs.io and dweb.link answered
 * 429 to plain requests while the launchpad's own gateway served the same file in a second).
 *
 * ★ THE GATEWAY LIST. The launchpad's own gateway first (the host its picture links are written
 * on), then the public ones. cloudflare-ipfs.com is NOT in it: Cloudflare retired that gateway and
 * the name no longer answers, so every try there would be a wasted timeout. A creator's link to a
 * host that is not a gateway is fetched behind declared-metadata.ts's fence, never directly.
 *
 * What breaks if changed carelessly: the order. The owner chose it (metadata picture, then the
 * launchpad's copy, then the market source's); and each try's timeout is the caller's, kept short,
 * because the mirror runs between the board's rebuilds on one schedule.
 */

import { VendorShapeError, VendorUnavailable, rec } from '@insidor/vendor-kit';

import { fetchDeclaredDocument } from './declared-metadata.ts';
import type { DeclaredFetchConfig } from './declared-metadata.ts';
import { boundedText, httpsUri } from './hostile.ts';
import { contentAddress, gatewayUrl } from './metadata.ts';

/** In the order tried. The first is the launchpad's own; its picture links are written on it. */
export const IPFS_GATEWAYS: readonly string[] = ['https://pump.mypinata.cloud', 'https://ipfs.io', 'https://dweb.link', 'https://gateway.pinata.cloud'];

/**
 * Gateways that resize on request. The launchpad's own does: a 97 KB picture comes back as a
 * 6 KB 256-pixel WebP, and a 4 MB animated one (over our copy cap) as 0.6 MB. The resized one is
 * tried first and the original after it, so a gateway that stops resizing costs one try.
 */
export const RESIZING_GATEWAYS: readonly string[] = ['https://pump.mypinata.cloud'];
const RESIZED = '?img-width=256&img-height=256&img-format=webp';

/** The launchpad's image service: its own copy of each coin's picture, resized on its side. */
export const LAUNCHPAD_IMAGE_ENDPOINT = 'https://images.pump.fun/coin-image';
/** The size asked for: sharp on the largest disc the app draws, a few kilobytes on the wire. */
export const LAUNCHPAD_IMAGE_SIZE = '256x256';

const LINK_MAX = 512;

/**
 * The URLs to try for one picture link, best first. A content-addressed link becomes one URL per
 * gateway — the host it was written on first when that host is itself a gateway, resized where
 * the gateway can — and an https link that names no content id is itself. Anything else (data:,
 * http:, junk) is nothing.
 */
export function pictureUrls(link: string | null | undefined): readonly string[] {
  if (typeof link !== 'string' || link.length > LINK_MAX) return [];
  const cid = contentAddress(link);
  if (cid === null) {
    const https = httpsUri(link, LINK_MAX);
    return https === null ? [] : [https];
  }
  const out: string[] = [];
  const add = (u: string) => {
    if (!out.includes(u)) out.push(u);
  };
  const gateway = (g: string) => {
    if (RESIZING_GATEWAYS.includes(g)) add(`${gatewayUrl(g, cid)}${RESIZED}`);
    add(gatewayUrl(g, cid));
  };
  try {
    const u = new URL(link.trim());
    if (u.protocol === 'https:' && u.pathname.startsWith('/ipfs/')) gateway(u.origin);
  } catch {
    /* ipfs://… has no host to prefer */
  }
  for (const g of IPFS_GATEWAYS) gateway(g);
  return out;
}

/** The picture link a metadata document names, as written; null when it names none. */
export function documentPicture(raw: unknown): string | null {
  return boundedText(rec(raw).image, LINK_MAX);
}

export type LogoFetchConfig = DeclaredFetchConfig;

/**
 * The picture link the coin's metadata document names. A content-addressed document is read from
 * each gateway in turn until one answers; any other is read from its own host behind the fence.
 * `null` when the document names no picture or the link is one we will not fetch; throws when no
 * host answered, so the caller records a failure to retry, never "no picture".
 */
export async function metadataPicture(uri: string | null, config: LogoFetchConfig): Promise<string | null> {
  if (uri === null) return null;
  /* A document is JSON: the resizing variants are for pictures only. */
  const urls = contentAddress(uri) === null ? [] : pictureUrls(uri).filter((u) => !u.endsWith(RESIZED));
  if (urls.length === 0) {
    const doc = await fetchDeclaredDocument(uri, config);
    return doc.kind === 'refused' ? null : documentPicture(doc.raw);
  }
  let failure: unknown = null;
  for (const url of urls) {
    try {
      return documentPicture(await getJson(url, config, 'ipfs-gateway', 'GET /ipfs/{cid}'));
    } catch (e) {
      failure = e;
    }
  }
  throw failure ?? new VendorUnavailable('ipfs-gateway', 'GET /ipfs/{cid}', 'no gateway answered');
}

/**
 * The launchpad's own copy of the coin's picture, from its image service, already resized
 * (`LAUNCHPAD_IMAGE_SIZE`). That service answers for coins the launchpad did not make too, and
 * sends a coin it knows nothing about to one shared placeholder, which is "no picture", never a
 * logo. Its coin API is not used: it refuses some regions with an HTML page, while the image
 * service answered from every place we tried.
 *
 * Returns the address the service sent us to (null for the placeholder); throws when it did not
 * answer, so that is a failure, never "no picture".
 */
export async function launchpadPicture(mint: string, config: { readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number }): Promise<string | null> {
  const url = `${LAUNCHPAD_IMAGE_ENDPOINT}/${encodeURIComponent(mint)}?variant=${LAUNCHPAD_IMAGE_SIZE}`;
  let response: Response;
  try {
    response = await config.fetch(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(config.timeoutMs) });
  } catch (e) {
    throw new VendorUnavailable('launchpad', 'GET /coin-image/{mint}', `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  await response.body?.cancel();
  if (response.status >= 300 && response.status < 400) {
    const to = response.headers.get('location');
    if (to === null) throw new VendorShapeError('launchpad', 'location', 'a redirect with no target');
    const target = new URL(to, url);
    if (/placeholder/i.test(target.pathname)) return null;
    return httpsUri(target.toString(), LINK_MAX);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new VendorUnavailable('launchpad', 'GET /coin-image/{mint}', `responded ${response.status}`, response.status);
  return url;
}

async function getJson(url: string, config: { readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number; readonly maxBytes: number }, vendor: string, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await config.fetch(url, { redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(config.timeoutMs) });
  } catch (e) {
    throw new VendorUnavailable(vendor, label, `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  if (!response.ok) throw new VendorUnavailable(vendor, label, `responded ${response.status}`, response.status);
  const text = await response.text();
  if (text.length > config.maxBytes) throw new VendorShapeError(vendor, 'body', `is over ${config.maxBytes} bytes`);
  try {
    return JSON.parse(text);
  } catch {
    throw new VendorShapeError(vendor, 'body', 'is not JSON');
  }
}
