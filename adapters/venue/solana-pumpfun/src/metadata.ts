/**
 * A coin's metadata document — name, ticker, picture, description, the creator's links — read
 * by CONTENT ADDRESS through a gateway we choose, never from the host the creator named.
 *
 * stream.ts keeps the creation event's metadata link as a claim and does not fetch it, and the
 * reason stands: a fetch per mint to an address the creator supplies is a request-forgery
 * primitive and a load amplifier in one field. This file narrows that rule rather than
 * dropping it. A link is read only if it names an IPFS content id (`ipfs://<cid>`,
 * `…/ipfs/<cid>`, `<cid>.ipfs.…`); the id is then fetched from OUR gateway, so the creator
 * picks which document, never which server. The picture inside is held to the same rule.
 * Anything not content-addressed is `notContentAddressed` — recorded, not read.
 *
 * What breaks if changed carelessly: the size and time caps. A document is a few hundred
 * bytes; one that is not stops being read at `maxBytes`, and a gateway that stalls is
 * abandoned at `timeoutMs`. Removing either hands a creator the size of our work.
 */

import { VendorShapeError, VendorUnavailable, rec, str } from '@insidor/vendor-kit';

import { boundedText, httpsUri } from './hostile.ts';

const VENDOR = 'ipfs-gateway';
const LABEL = 'GET /ipfs/{cid}';
const NAME_MAX = 128;
const TICKER_MAX = 32;
const DESCRIPTION_MAX = 1_000;
const LINK_MAX = 512;

/* CIDv0 (base58, 46 chars from "Qm") or CIDv1 in base32 (from "b"). */
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;

/** The IPFS content id a link names, or null when it names none. */
export function contentAddress(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') return null;
  const s = uri.trim();
  const fromScheme = /^ipfs:\/\/(?:ipfs\/)?([^/?#]+)/i.exec(s)?.[1];
  if (fromScheme !== undefined) return CID.test(fromScheme) ? fromScheme : null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const fromPath = /^\/ipfs\/([^/?#]+)/.exec(url.pathname)?.[1];
  if (fromPath !== undefined) return CID.test(fromPath) ? fromPath : null;
  const fromHost = /^([^.]+)\.ipfs\./i.exec(url.hostname)?.[1];
  return fromHost !== undefined && CID.test(fromHost) ? fromHost : null;
}

/** What the document says, bounded and cleaned. Every field may be missing. */
export interface CoinMetadata {
  readonly name: string | null;
  readonly ticker: string | null;
  readonly description: string | null;
  /** On OUR gateway, by content id; null when the document's picture is not content-addressed. */
  readonly imageUri: string | null;
  /** The creator's links, as claims: their social account or post, their site, their chat. */
  readonly links: { readonly social: string | null; readonly website: string | null; readonly chat: string | null };
}

export type MetadataRead =
  | { readonly kind: 'read'; readonly cid: string; readonly metadata: CoinMetadata }
  | { readonly kind: 'notContentAddressed' };

export function gatewayUrl(gateway: string, cid: string): string {
  return `${gateway.replace(/\/+$/, '')}/ipfs/${cid}`;
}

/** Read a fetched document. Exported so the shape is tested against a recorded one with no network. */
export function readMetadata(raw: unknown, gateway: string): CoinMetadata {
  const r = rec(raw);
  const imageCid = contentAddress(str(r.image));
  const link = (v: unknown) => httpsUri(v, LINK_MAX);
  return {
    name: boundedText(r.name, NAME_MAX),
    ticker: boundedText(r.symbol, TICKER_MAX),
    description: boundedText(r.description, DESCRIPTION_MAX),
    imageUri: imageCid === null ? null : gatewayUrl(gateway, imageCid),
    links: { social: link(r.twitter), website: link(r.website), chat: link(r.telegram) },
  };
}

export interface MetadataFetchConfig {
  readonly gateway: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export async function fetchMetadata(uri: string | null, config: MetadataFetchConfig): Promise<MetadataRead> {
  const cid = contentAddress(uri);
  if (cid === null) return { kind: 'notContentAddressed' };
  let response: Response;
  try {
    response = await config.fetch(gatewayUrl(config.gateway, cid), { redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) });
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
  return { kind: 'read', cid, metadata: readMetadata(parsed, config.gateway) };
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
