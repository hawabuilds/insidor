/**
 * A COIN PICTURE ALREADY EMBEDDED IS NOT PAID FOR AGAIN (Policy.group.image.reuseContentAddressed).
 *
 * Copycat coins launch with the very picture of the coin they copy, so the same picture address
 * reaches the coin universe and the coin-match step once per coin. Measured on 2026-10-17: of
 * 12,670 coin pictures embedded in 24 hours, 5,967 had an address already embedded for another
 * coin. Both steps ask here first; a vector found for the same address is written for this coin
 * too, for nothing, and only the rest go to the vendor.
 *
 * Its own file because the one judgement in it is easy to get wrong: WHICH ADDRESSES MAY SHARE A
 * VECTOR. Only an address that names its content (a content id in the path, or as the host's
 * first label): the same address is then the same bytes, and the stored vector is the one the
 * vendor would return (stored pairs at such addresses agree to 0.999 cosine or better, the
 * vendor's own run-to-run noise). A mutable address does not qualify, however stable it has
 * looked: on the same day one picture host served different pictures under one address, and its
 * stored pairs fell to 0.88 — under the near-identical bar, so a shared vector there would have
 * changed a coin match.
 *
 * What breaks if changed carelessly: widening `contentAddressed` to a host by name. A host that
 * later reuses an address would hand a coin another coin's picture, silently, and every
 * comparison against it would be wrong without any number looking odd.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgImageEmbeddingRepo } from '@insidor/store';

/* A content id: version 0 (base58, 46 characters from "Qm") or version 1 in base32 (from "b",
   59 characters for the usual 32-byte digest; 50 or more accepted). */
const CONTENT_ID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;

/** Whether an address names its picture by content: a content id after `/ipfs/`, or as the host's first label. */
export function contentAddressed(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === 'ipfs:') return CONTENT_ID.test(url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0] || '');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const segments = url.pathname.split('/');
  const at = segments.indexOf('ipfs');
  if (at >= 0 && CONTENT_ID.test(segments[at + 1] ?? '')) return true;
  return CONTENT_ID.test(url.hostname.split('.')[0] ?? '');
}

export interface PictureReuseDeps {
  readonly images: Partial<Pick<PgImageEmbeddingRepo, 'copyFromSameAddress'>>;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly now: () => Millis;
}

/**
 * The stored vector for this picture's address written for this coin, when the switch is on, the
 * run is live and the address names its content. True when the coin now has a vector and nothing
 * need be paid; false sends it to the vendor as before. A failed read is false: the cost of a
 * failure is one embedding, never a coin left without one.
 */
export async function reuseCoinPicture(deps: PictureReuseDeps, assetKey: string, uri: string, space: string): Promise<boolean> {
  if (!deps.policy.group.image.reuseContentAddressed || deps.mode !== 'live') return false;
  if (deps.images.copyFromSameAddress === undefined || !contentAddressed(uri)) return false;
  try {
    return await deps.images.copyFromSameAddress('asset', assetKey, uri, space, deps.now());
  } catch {
    return false;
  }
}
