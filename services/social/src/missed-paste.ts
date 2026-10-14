/**
 * WHAT A MISSED-POSTS PASTE SAYS: its post links, the coin address the owner wrote beside each,
 * the links that are not posts, and the addresses that belong to no link.
 *
 * The owner pastes posts as they keep them in notes — "<link> <address>", the address first, or
 * the address on the next line — and before this every address was thrown away, because only
 * links were read. Here each address is paired with its nearest link:
 *
 *   1. an address on a line with exactly one link goes with that link;
 *   2. otherwise the paste's own order decides: when the paste opens with a link, an address
 *      goes with the link just above it; when it opens with an address, with the link just after.
 *      A link takes one address; a second one with no link of its own is left over.
 *
 * Left-over addresses are returned (`loose`), never dropped: the owner reads them before saving.
 *
 * A link that is not a post (an account page, a share link whose post is only known after a
 * request, another site) is refused here with what to paste instead, rather than queued for the
 * runner to fail a minute later. A coin site's link whose path is an address counts as that
 * address. Which links are posts is owner-coin.ts `postIdOf`, the same rule the coin label uses.
 *
 * Its own file, apart from the route, so the pairing runs under a test with no database.
 *
 * What breaks if changed carelessly: rule 2's direction. Pairing every address with the link
 * before it reads "<address> <link>" pastes one post off — every coin saved on the wrong post.
 */

import { mintOf, postIdOf } from './owner-coin.ts';

export interface PastedPost {
  readonly url: string;
  /** The id the post is stored under; null when the link was refused. */
  readonly itemId: string | null;
  /** The address the owner wrote beside it; null when none. */
  readonly address: string | null;
  /** Why the link is refused, in words; null when it is a post. */
  readonly refused: string | null;
}

export interface PasteRead {
  readonly posts: readonly PastedPost[];
  /** Addresses with no link to go with, in the order pasted. */
  readonly loose: readonly string[];
}

const MAX_URL_CHARS = 500;
const EDGE_PUNCTUATION = /^[("'<[]+|[)"'>\],;.]+$/g;
const TIKTOK_HOST = /^(?:www\.|m\.)?tiktok\.com$/i;
const TIKTOK_SHARE_HOST = /^(?:vm|vt)\.tiktok\.com$/i;
const X_HOST = /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i;

/** Why a link is not a post, in words the owner can act on. */
function refusalOf(u: URL): string {
  const path = u.pathname.replace(/\/+$/, '');
  if (TIKTOK_SHARE_HOST.test(u.hostname) || (TIKTOK_HOST.test(u.hostname) && /^\/t\//.test(path))) return "This is a share link. Open it and paste the video's full link.";
  if (TIKTOK_HOST.test(u.hostname)) return /^\/@[^/]+$/.test(path) ? "This is a profile link, not a post. Paste the video's link." : "This is not a video's link. Paste the video's link.";
  if (X_HOST.test(u.hostname)) return path !== '' && !path.slice(1).includes('/') ? "This is a profile link, not a post. Paste the post's link." : "This is not a post's link. Paste the post's link.";
  return 'This is not an X or TikTok post link.';
}

type Token = { readonly line: number; readonly kind: 'link'; readonly url: string; readonly itemId: string | null; readonly refused: string | null } | { readonly line: number; readonly kind: 'address'; readonly address: string };

/** One word of the paste: a link, an address, or nothing we read. */
function tokenOf(word: string, line: number): Token | null {
  const w = word.replace(EDGE_PUNCTUATION, '');
  if (w === '' || w.length > MAX_URL_CHARS) return null;
  let u: URL | null = null;
  if (/^https?:\/\//i.test(w)) {
    try {
      u = new URL(w);
    } catch {
      u = null;
    }
  }
  if (u !== null) {
    const itemId = postIdOf(u.protocol === 'http:' ? `https:${w.slice(5)}` : w);
    if (itemId !== null) return { line, kind: 'link', url: u.protocol === 'http:' ? `https:${w.slice(5)}` : w, itemId, refused: null };
    /* A coin site's page for the coin: the address in its path is what the owner meant. */
    const inPath = u.pathname.split('/').map((s) => mintOf(s)).find((m) => m !== null);
    if (inPath !== undefined) return { line, kind: 'address', address: inPath };
    return { line, kind: 'link', url: w, itemId: null, refused: refusalOf(u) };
  }
  /* "CA:<address>" and the like: the address is what follows the last colon. */
  const address = mintOf(w.includes(':') ? w.slice(w.lastIndexOf(':') + 1) : w);
  return address === null ? null : { line, kind: 'address', address };
}

/** The paste read: its posts with their addresses, and the addresses left over. */
export function readPaste(text: unknown): PasteRead {
  if (typeof text !== 'string') return { posts: [], loose: [] };
  const tokens: Token[] = text.split(/\r?\n/).flatMap((l, line) => l.split(/\s+/).flatMap((w) => tokenOf(w, line) ?? []));
  const links = tokens.flatMap((t, i) => (t.kind === 'link' ? [i] : []));
  const addresses = tokens.flatMap((t, i) => (t.kind === 'address' ? [i] : []));
  /** token index of an address → token index of its link */
  const pairOf = new Map<number, number>();
  const taken = new Set<number>();

  /* 1. Alone on a line with one link. */
  for (const a of addresses) {
    const line = tokens[a]?.line;
    const same = links.filter((l) => tokens[l]?.line === line);
    const only = same[0];
    if (same.length !== 1 || only === undefined || taken.has(only)) continue;
    pairOf.set(a, only);
    taken.add(only);
  }

  /* 2. The paste's order. The address nearest its link is paired first, so "<a> <a> <link>" pairs the second. */
  const linkFirst = (links[0] ?? Infinity) < (addresses[0] ?? Infinity);
  const rest = addresses.filter((a) => !pairOf.has(a));
  for (const a of linkFirst ? rest : [...rest].reverse()) {
    const near = linkFirst ? [...links].reverse().find((l) => l < a) : links.find((l) => l > a);
    if (near === undefined || taken.has(near)) continue;
    pairOf.set(a, near);
    taken.add(near);
  }

  const addressOf = new Map<number, string>();
  for (const [a, l] of pairOf) {
    const t = tokens[a];
    if (t?.kind === 'address') addressOf.set(l, t.address);
  }
  const loose: string[] = addresses.flatMap((a) => {
    const t = tokens[a];
    return !pairOf.has(a) && t?.kind === 'address' ? [t.address] : [];
  });

  /* A link pasted twice is one post; a second, different address for it is left over. */
  const posts: PastedPost[] = [];
  for (const l of links) {
    const t = tokens[l];
    if (t?.kind !== 'link') continue;
    const address = addressOf.get(l) ?? null;
    const at = posts.findIndex((p) => p.url === t.url);
    const seen = posts[at];
    if (seen === undefined) {
      posts.push({ url: t.url, itemId: t.itemId, address, refused: t.refused });
      continue;
    }
    if (address === null || address === seen.address) continue;
    if (seen.address === null) posts[at] = { ...seen, address };
    else loose.push(address);
  }
  return { posts, loose };
}
