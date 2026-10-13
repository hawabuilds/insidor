/**
 * A COIN'S ABOUT READ, as the phone app holds it (services/read/src/coin-about.ts): the coin's own
 * links, the day's volume, liquidity and market cap, its holders, creator and launch, and the
 * feed posts it is weighed against with their evidence. The token page's Info tab and its link
 * buttons draw from it.
 *
 * Its own file beside decode.ts, the way missed.ts and owner.ts sit beside it: the shape and its
 * decoder in one place, run through the same censor first (`assertNoInternalVocabulary`), so a
 * leak at the server is loud here rather than drawn.
 *
 * ★ A LINK IS ONLY AN https URL OF A KIND THE PAGE HAS A BUTTON FOR. Anything else is dropped
 * here, so no other kind of link can reach an anchor. ★ AN ABSENT NUMBER IS PENDING WITH ITS
 * REASON, never zero; an evidence fact that is not a literal boolean is unknown, never a "no".
 */

import { instant, known, pending, pendingInstant, type Instant, type Measured, type PendingReason } from '../format/measure.ts';
import { assertNoInternalVocabulary, decodeCoinEvidence, WireShapeError } from './decode.ts';
import type { CoinEvidence } from './wire/coin.ts';

export type AboutLinkKind = 'x' | 'telegram' | 'website' | 'tiktok';

export interface AboutLink {
  readonly kind: AboutLinkKind;
  readonly url: string;
  /** The real domain or handle, shown on a long press. */
  readonly label: string;
}

/** A feed post that names this coin: the post's own coin (`own`), or one on its same-name list. */
export interface AboutPost {
  readonly postId: string;
  readonly own: boolean;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  readonly permalink: string | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  readonly postedAt: Instant;
  /** The narrative the post is on, when it is on one. `story` on the wire: the word is ours. */
  readonly story: { readonly storyId: string; readonly title: string } | null;
  readonly evidence: CoinEvidence;
}

export interface CoinAbout {
  readonly links: readonly AboutLink[];
  readonly volume24hUsd: Measured;
  readonly liquidityUsd: Measured;
  readonly marketCapUsd: Measured;
  readonly holders: Measured;
  readonly creator: string | null;
  readonly launchedAt: Instant;
  readonly posts: readonly AboutPost[];
}

const KINDS: readonly AboutLinkKind[] = ['x', 'telegram', 'website', 'tiktok'];
const REASONS: readonly PendingReason[] = ['not_minted', 'no_market', 'not_read_yet', 'not_reported', 'unreadable'];

const rec = (v: unknown, path: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WireShapeError(path, v);
  return v as Record<string, unknown>;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const reason = (v: unknown): PendingReason => REASONS.find((r) => r === v) ?? 'unreadable';

function measuredOf(v: unknown): Measured {
  if (typeof v !== 'object' || v === null) return pending('not_reported');
  const o = v as Record<string, unknown>;
  return typeof o['v'] === 'number' ? known(o['v']) : pending(reason(o['why']));
}

function instantOf(v: unknown): Instant {
  if (typeof v !== 'object' || v === null) return pendingInstant('not_reported');
  const o = v as Record<string, unknown>;
  return typeof o['at'] === 'number' ? instant(o['at']) : pendingInstant(reason(o['why']));
}

function linkOf(v: unknown): AboutLink | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const kind = KINDS.find((k) => k === o['kind']);
  const url = text(o['url']);
  if (kind === undefined || url === null) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { kind, url, label: text(o['label']) ?? new URL(url).hostname };
}

export function decodeCoinAbout(raw: unknown, path = '$.about'): CoinAbout {
  assertNoInternalVocabulary(raw, path);
  const o = rec(raw, path);
  const links = (Array.isArray(o['links']) ? o['links'] : []).flatMap((l) => {
    const link = linkOf(l);
    return link === null ? [] : [link];
  });
  const posts = (Array.isArray(o['posts']) ? o['posts'] : []).flatMap((p, i): AboutPost[] => {
    if (typeof p !== 'object' || p === null) return [];
    const r = p as Record<string, unknown>;
    const postId = text(r['postId']);
    if (postId === null) return [];
    const s = typeof r['story'] === 'object' && r['story'] !== null ? (r['story'] as Record<string, unknown>) : null;
    const storyId = text(s?.['storyId']);
    const title = text(s?.['title']);
    return [{
      postId,
      own: r['own'] === true,
      sourceLabel: text(r['sourceLabel']) ?? '',
      authorLabel: text(r['authorLabel']) ?? '',
      permalink: text(r['permalink']),
      excerpt: text(r['excerpt']) ?? '',
      thumbUrl: text(r['thumbUrl']),
      postedAt: instantOf(r['postedAt']),
      story: storyId !== null && title !== null ? { storyId, title } : null,
      evidence: r['evidence'] === null || r['evidence'] === undefined ? { linksPost: null, samePicture: null, launchedAfterMs: null } : decodeCoinEvidence(r['evidence'], `${path}.posts[${i}].evidence`),
    }];
  });
  return {
    links,
    volume24hUsd: measuredOf(o['volume24hUsd']),
    liquidityUsd: measuredOf(o['liquidityUsd']),
    marketCapUsd: measuredOf(o['marketCapUsd']),
    holders: measuredOf(o['holders']),
    creator: text(o['creator']),
    launchedAt: instantOf(o['launchedAt']),
    posts,
  };
}
