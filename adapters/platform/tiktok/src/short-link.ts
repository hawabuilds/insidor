/**
 * A TikTok share link (`vm.tiktok.com/…`, `vt.tiktok.com/…`) expanded to the post it
 * names: a video (`www.tiktok.com/@user/video/<id>`) or a photo post (`…/photo/<id>`).
 *
 * People paste the short form; nothing downstream can read a post id out of it. The short
 * link redirects once to the full one, so the expansion is one request that follows nothing
 * and reads the `location` header. Its own file because it is the one place that knows the
 * short-link hosts and the video path shape.
 *
 * What breaks if changed carelessly: the tracking query string (`?_r=…&_t=…`) is dropped,
 * and only a redirect that lands on a post path counts. Keeping the query would make the
 * same video two different URLs; accepting any redirect would store a login wall or a
 * region page as a post.
 */

import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

const VENDOR = 'tiktok';
const LABEL = 'GET short link';
const SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const POST_PATH = /^\/@[^/]+\/(?:video|photo)\/\d+$/;

export function isShortLink(url: string): boolean {
  try {
    return SHORT_HOSTS.has(new URL(url.trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The full post URL for a short link. Any other URL comes back unchanged and unasked. */
export async function expandShortLink(url: string, fetch: typeof globalThis.fetch): Promise<string> {
  if (!isShortLink(url)) return url;
  let response: Response;
  try {
    response = await fetch(url.trim(), { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0' } });
  } catch (error) {
    throw new VendorUnavailable(VENDOR, LABEL, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  const location = response.headers.get('location');
  if (response.status < 300 || response.status >= 400 || location === null) {
    throw new VendorUnavailable(VENDOR, LABEL, `did not redirect (${response.status})`, response.status);
  }
  const target = new URL(location, url);
  if (!POST_PATH.test(target.pathname)) throw new VendorShapeError(VENDOR, 'location', `is not a post: ${target.pathname}`);
  return `https://www.tiktok.com${target.pathname}`;
}
