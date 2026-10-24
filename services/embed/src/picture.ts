/**
 * Fetching a post's picture by its address: with a deadline, a size cap, at most a few redirects,
 * and never to a private address.
 *
 * Its own file because it is the one place this service reaches outside itself, and the addresses
 * it is handed come from posts on the internet. The hosted vendor fetched pictures on its own
 * machines; here we fetch them from inside our private network, so an address that names
 * `runner.railway.internal`, 169.254.169.254 or 10.x would otherwise be read and its bytes
 * decoded — a way for a stranger's post to probe our network. Every hop of a redirect is checked,
 * and the hostname is resolved and its addresses checked too, not just its spelling.
 *
 * Known limit, stated rather than hidden: the check resolves the name, then the fetch resolves it
 * again; a name that answers public then private between the two (DNS rebinding) gets through.
 * The service is behind a shared secret and only decodes images, so what leaks is at most "a
 * picture-shaped reply existed", which is why this is not worth a custom resolver.
 *
 * What breaks if changed carelessly: a picture that cannot be read is `null`, never an error for
 * the batch — one dead link must cost one vector, as with the vendor before (2026-10-16).
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface PictureLimits {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
}

export type Lookup = (host: string) => Promise<readonly string[]>;

export const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Why a picture was not read: only ever logged as a count by reason, never with its address. */
export type Unread = 'address' | 'private' | 'status' | 'too-big' | 'timeout' | 'network';

function privateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  const [a = -1, b = -1] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function privateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('::ffff:')) return privateV4(s.slice(7));
  return /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}

/** True for an address we must never fetch from: loopback, private, link-local, CGNAT, multicast. */
export function privateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) return privateV6(ip);
  return true;
}

async function allowed(url: URL, lookup: Lookup): Promise<Unread | null> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'address';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return 'private';
  if (isIP(host) !== 0) return privateAddress(host) ? 'private' : null;
  try {
    const addresses = await lookup(host);
    if (addresses.length === 0 || addresses.some(privateAddress)) return 'private';
  } catch {
    return 'network';
  }
  return null;
}

/** The picture's bytes, or why not. */
export async function fetchPicture(
  address: string,
  limits: PictureLimits,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  lookup: Lookup = systemLookup,
): Promise<{ readonly bytes: Uint8Array } | { readonly unread: Unread }> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { unread: 'address' };
  }
  const signal = AbortSignal.timeout(limits.timeoutMs);
  try {
    for (let hop = 0; ; hop += 1) {
      const refused = await allowed(url, lookup);
      if (refused !== null) return { unread: refused };
      const response = await fetchFn(url, { redirect: 'manual', signal, headers: { accept: 'image/*' } });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (next === null || hop >= limits.maxRedirects) return { unread: 'status' };
        url = new URL(next, url);
        continue;
      }
      if (!response.ok || response.body === null) {
        await response.body?.cancel().catch(() => undefined);
        return { unread: 'status' };
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > limits.maxBytes) {
        await response.body.cancel().catch(() => undefined);
        return { unread: 'too-big' };
      }
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > limits.maxBytes) return { unread: 'too-big' };
        parts.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const part of parts) bytes.set(part, at), (at += part.byteLength);
      return { bytes };
    }
  } catch (error) {
    return { unread: error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network' };
  }
}
