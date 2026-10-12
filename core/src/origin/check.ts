/**
 * WHERE A COIN CAME FROM: the creator-link check and the matching decision, as pure rules.
 *
 * Two questions, in order, each answered from facts handed in — never fetched here:
 *
 *   1. The creator's own link (`checkCreatorLink`). Deterministic checks first — not a post,
 *      or a post made after the coin, or one that names the coin: none of those is an origin.
 *      Only what is left is read against the judge's answer: a statement by a big account is
 *      an influencer's origin; a nameable subject with real views is the viral post.
 *   2. Our own matching (`matchCandidates`), for a coin whose link did not settle it. A
 *      candidate post counts only with ALL THREE: made before the coin, naming it, and showing
 *      the same subject in its picture. The earliest such post wins.
 *
 * `decideOrigin` folds the two into one status from contracts/src/origin.ts.
 *
 * Pure and in core, because every bar it applies is a policy number and every outcome is a
 * claim the product will show. The runner and the gold eval hand it the same facts.
 *
 * What breaks if changed carelessly: ★ NEVER LINK ON A NAME ALONE. A coin's name is the one
 * thing every unrelated post that happens to say it shares; dropping the picture requirement
 * turns every common word into an origin. And a post made after the coin is never its origin,
 * however well it matches — the rule the founders' own gold set had to be corrected by.
 */

import type { Millis } from '@insidor/contracts';
import type { OriginStatus } from '@insidor/contracts/origin.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { nameKey } from '../group/picture.ts';

export interface CoinFacts {
  readonly address: string;
  readonly ticker: string;
  readonly name: string;
  /** The coin's first transaction. */
  readonly launchedAt: Millis;
}

/** One post, as read. Every field may be missing; missing is never read as zero. */
export interface PostFacts {
  readonly postId: string;
  readonly postedAt: Millis | null;
  readonly text: string;
  readonly authorFollowers: number | null;
  readonly reach: number | null;
  /** The judge, shown the post alone: is there a nameable subject. Null when not asked. */
  readonly judged: { readonly coinable: boolean; readonly proposedName: string | null } | null;
}

/** What the creator linked: nothing, an account or community, or a post (null when unreadable). */
export type CreatorLink = { readonly kind: 'none' } | { readonly kind: 'account' } | { readonly kind: 'post'; readonly post: PostFacts | null };

export type CreatorCheck =
  | { readonly kind: 'origin'; readonly status: 'linked_by_creator' | 'influencer_origin'; readonly postId: string }
  | { readonly kind: 'notOrigin'; readonly status: 'account_only' | 'promo_only'; readonly why: string }
  | { readonly kind: 'fallThrough'; readonly why: string };

/** Whether a post names the coin: its name, or its ticker, as whole words. */
export function namesCoin(text: string, coin: Pick<CoinFacts, 'ticker' | 'name'>): boolean {
  const haystack = ` ${nameKey(text)} `;
  return [coin.name, coin.ticker].map(nameKey).some((n) => n.length >= 2 && haystack.includes(` ${n} `));
}

export function checkCreatorLink(link: CreatorLink, coin: CoinFacts, p: Policy): CreatorCheck {
  if (link.kind === 'none') return { kind: 'fallThrough', why: 'no link' };
  if (link.kind === 'account') return { kind: 'notOrigin', status: 'account_only', why: 'the link is an account, not a post' };
  const post = link.post;
  if (post === null) return { kind: 'fallThrough', why: 'the linked post could not be read' };
  if (post.postedAt !== null && post.postedAt > coin.launchedAt + p.origin.launchAllowanceMs) {
    return { kind: 'notOrigin', status: 'promo_only', why: 'posted after the coin' };
  }
  const text = post.text;
  if (text.includes(coin.address) || new RegExp(`\\$${escape(coin.ticker)}(?![\\p{L}\\p{N}])`, 'iu').test(text)) {
    return { kind: 'notOrigin', status: 'promo_only', why: 'names the coin by ticker or address' };
  }
  if (post.postedAt === null) return { kind: 'fallThrough', why: 'the linked post has no time, so it cannot be shown to come first' };
  if (post.judged === null) return { kind: 'fallThrough', why: 'not judged' };
  const subject = post.judged.coinable && post.judged.proposedName !== null;
  if (!subject && post.authorFollowers !== null && post.authorFollowers >= p.origin.influencerFollowers) {
    return { kind: 'origin', status: 'influencer_origin', postId: post.postId };
  }
  if (subject && post.reach !== null && post.reach >= p.origin.viralReach) {
    return { kind: 'origin', status: 'linked_by_creator', postId: post.postId };
  }
  return { kind: 'fallThrough', why: subject ? 'a subject, but not enough reach' : 'a statement by a small account' };
}

/** A candidate post found by our own matching, with what its picture showed against the coin's. */
export interface Candidate {
  readonly postId: string;
  readonly postedAt: Millis | null;
  readonly text: string;
  /**
   * The picture, against the coin's: 'near' (the same image), 'likely' (likely the same
   * subject), 'confirmed' (borderline, and the judge said yes), or null (no picture, or not alike).
   */
  readonly picture: 'near' | 'likely' | 'confirmed' | null;
}

export type MatchResult =
  | { readonly kind: 'matched'; readonly postId: string }
  | { readonly kind: 'afterLaunch'; readonly postId: string; readonly afterLaunchMs: number }
  | { readonly kind: 'none'; readonly why: string };

export function matchCandidates(candidates: readonly Candidate[], coin: CoinFacts, p: Policy): MatchResult {
  const passing = candidates
    .filter((c) => c.postedAt !== null && c.picture !== null && namesCoin(c.text, coin))
    .sort((a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0));
  const before = passing.find((c) => (c.postedAt ?? 0) <= coin.launchedAt + p.origin.launchAllowanceMs);
  if (before !== undefined) return { kind: 'matched', postId: before.postId };
  const after = passing[0];
  if (after !== undefined) return { kind: 'afterLaunch', postId: after.postId, afterLaunchMs: (after.postedAt ?? 0) - coin.launchedAt };
  const named = candidates.some((c) => namesCoin(c.text, coin));
  return { kind: 'none', why: named ? 'posts name it, but none shows the same subject' : 'nothing found names it' };
}

/**
 * Where a matched post's meme started: follow what it quotes back while each quoted post is
 * known and earlier — the backfill's quote rule. The quote is the proof, so no name or
 * picture is asked of the posts behind it. A loop or an unknown post ends the walk.
 */
export function earliestByReproduction(
  postId: string,
  posts: ReadonlyMap<string, { readonly postedAt: Millis | null; readonly reproduces: string | null }>,
): string {
  let at = postId;
  const seen = new Set<string>([at]);
  for (;;) {
    const here = posts.get(at);
    const back = here?.reproduces ?? null;
    if (back === null || seen.has(back)) return at;
    const prior = posts.get(back);
    if (prior === undefined || prior.postedAt === null || here?.postedAt == null || prior.postedAt > here.postedAt) return at;
    seen.add(back);
    at = back;
  }
}

export interface OriginDecision {
  readonly status: OriginStatus;
  /** The post the status is about — the origin, or the post that went viral after launch. */
  readonly postId: string | null;
}

/** The creator's link first; then our matching; then what the link was, if it was anything. */
export function decideOrigin(creator: CreatorCheck, match: MatchResult): OriginDecision {
  if (creator.kind === 'origin') return { status: creator.status, postId: creator.postId };
  if (match.kind === 'matched') return { status: 'matched_by_insidor', postId: match.postId };
  if (match.kind === 'afterLaunch') return { status: 'viral_after_launch', postId: match.postId };
  if (creator.kind === 'notOrigin') return { status: creator.status, postId: null };
  return { status: 'unlinked', postId: null };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
