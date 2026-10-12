/**
 * The social service's pure rules: what a comment may be about, what counts as proof, and the
 * words a comment may not carry. Apart from routes.ts so each rule is tested on its own.
 *
 * ★ PROOF IS CHECKED, NEVER CLAIMED. A link is proof only if it is an X post by the commenter's
 * own handle (the handle their sign-in vouched for), or a transaction the chain says moved the
 * coin. Any other link is kept and shown as a link, and earns no boost.
 *
 * ★ THE WORD FILTER IS BASIC, AND SAYS SO. It refuses a short list of slurs, matched as whole
 * words in any case; it is not moderation, which is what reports are for.
 */

export type SubjectKind = 'story' | 'coin' | 'post';
export interface Subject {
  readonly kind: SubjectKind;
  readonly id: string;
}

const ID = /^[A-Za-z0-9:_\-.]{1,200}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** "story:abc", "coin:solana:<mint>" or "coin:<mint>", "post:x:123". Null for anything else. */
export function parseSubject(raw: unknown): Subject | null {
  if (typeof raw !== 'string') return null;
  const at = raw.indexOf(':');
  if (at <= 0) return null;
  const kind = raw.slice(0, at);
  let id = raw.slice(at + 1);
  if (kind !== 'story' && kind !== 'coin' && kind !== 'post') return null;
  if (kind === 'coin') {
    id = id.startsWith('solana:') ? id.slice('solana:'.length) : id;
    return MINT.test(id) ? { kind, id } : null;
  }
  return ID.test(id) ? { kind, id } : null;
}

export type ProofLink =
  | { readonly kind: 'x_post'; readonly handle: string }
  | { readonly kind: 'tx'; readonly signature: string }
  | { readonly kind: 'other' };

/** What a link is, read from the URL alone; the service then checks it against the author or the chain. */
export function proofLinkOf(raw: string): ProofLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\.|^mobile\./, '');
  const parts = url.pathname.split('/').filter((s) => s !== '');
  if ((host === 'x.com' || host === 'twitter.com') && parts.length >= 3 && parts[1] === 'status' && /^\d+$/.test(parts[2] ?? '')) {
    return { kind: 'x_post', handle: (parts[0] ?? '').toLowerCase() };
  }
  if (host === 'solscan.io' && parts[0] === 'tx' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(parts[1] ?? '')) return { kind: 'tx', signature: parts[1] ?? '' };
  return { kind: 'other' };
}

/** A short, plain list. Extending it is a code change, reviewed like one. */
const BLOCKED = ['nigger', 'nigga', 'faggot', 'retard', 'kike', 'spic', 'chink', 'tranny', 'kys'];
const WORD = new RegExp(`\\b(${BLOCKED.join('|')})s?\\b`, 'i');

export const blockedWord = (text: string): boolean => WORD.test(text.normalize('NFKC'));

/** A comment body, trimmed; null when empty or over the limit. */
export function cleanBody(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== 'string') return null;
  const body = raw.replace(/\r\n/g, '\n').trim();
  return body.length === 0 || body.length > maxChars ? null : body;
}
