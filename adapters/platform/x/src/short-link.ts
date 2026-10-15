/**
 * The text source's shortened links (`t.co/…`) followed to where they lead: the one request
 * that reads a link's target out of a post's text, since the post as we store it carries only
 * the short form.
 *
 * Its own file because it is the one place that knows the short-link host, and the runner's
 * reposts step (services/runner work/reposts.ts) needs the host's pattern for its database read
 * as well as the expansion. Free: the redirect is answered by the host itself, no API, no key.
 *
 * What breaks if changed carelessly: the redirect is read, never followed. Following it would
 * fetch whatever page the link leads to — a stranger's site, at our expense and in our name —
 * when all we want is its address. A non-redirect answer is "leads nowhere" (null), not an error.
 */

import { VendorUnavailable } from '@insidor/vendor-kit';

const VENDOR = 'x';
const LABEL = 'GET short link';
const HOST = 't.co';

/** The short form as a SQL and JS regular expression: `https://t.co/<code>`. */
export const SHORT_LINK_PATTERN = 'https://t\\.co/[A-Za-z0-9]+';

export function isShortLink(url: string): boolean {
  try {
    return new URL(url.trim()).hostname.toLowerCase() === HOST;
  } catch {
    return false;
  }
}

/** Where a short link leads; null when the host answered with no redirect. Any other URL comes back unchanged. */
export async function expandShortLink(url: string, fetch: typeof globalThis.fetch): Promise<string | null> {
  if (!isShortLink(url)) return url;
  let response: Response;
  try {
    response = await fetch(url.trim(), { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0' } });
  } catch (error) {
    throw new VendorUnavailable(VENDOR, LABEL, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status < 300 || response.status >= 400) return null;
  return response.headers.get('location');
}
