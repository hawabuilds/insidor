/**
 * THE COIN-FIRST ROUTE'S ORIGINAL (Policy.rising.coinFirst.origin): from the post a coin's own link
 * names to the viral post it points at — the post the route judges and For You shows — or the word
 * that the linked post is that post, or that it is only a launcher's pointer with nothing to follow.
 *
 * Its own file beside coin-first.ts because it answers a different question. coin-first.ts decides
 * what to do with a post (read, judge, credit, admit); this decides WHICH post, and the runner
 * (services/runner work/coin-first.ts) and the replay (tools/coin-origin-replay.ts) both call it, so
 * what the replay counts is what the route does.
 *
 * ★ THE LINKED POST IS USUALLY THE LAUNCHER'S EXPLANATION (the owner, 2026-10-20: "i want to see the
 * original viral post not the [post] a degen who launched the coin made to explain the viral post").
 * It quotes the viral post, names it in a link, or re-uploads its video. Each hop, in this order:
 *   repost  the post re-shares another: the same post, always followed
 *   quote   it quotes another
 *   link    its own links name another post of the source (the first one)
 *   media   an earlier post by another account carries the same first picture or video
 * up to `maxDepth` hops, never through a post twice.
 *
 * ★ THE VIRAL POST IS THE BIGGER ONE. A quote, link or re-upload is followed when the post it points
 * at was seen at least as widely (reach), or when the pointing post's author is a launcher (below),
 * or when either reach is unknown — the usual case is a launcher's pointer, and a pointer is never
 * the post to show. It is NOT followed when the pointing post was seen more widely: a big account
 * quoting a small one made the post people coined (elonmusk quoting an analyst, 20 Oct).
 *
 * ★ A LAUNCHER'S OWN POST IS NEVER THE VIRAL POST. An account most of whose recent posts coins link,
 * with many of them and a small following (`isLauncher`), posts to launch, not to go viral. Its post
 * is followed whatever the reach, and when it points at nothing the outcome is `pointer`: the route
 * leaves it alone. A large account most of whose posts are coined (a news account, elonmusk) is not
 * one: people coin it, it does not coin.
 *
 * ★ AN UNREAD POST IS ASKED FOR, NOT GUESSED. When the next post is not held, or the current one's
 * links were never read, the outcome is `read` with that post: the runner reads it by id (once, under
 * the day's cap) and the walk goes on next pass. A post read once that the source did not return is
 * `gone`, and the walk stops before it.
 *
 * ★ AT THE LAUNCH, ONE HOP (`promoPointsAt`, `promoFollows`; the owner, 2026-10-24). The coin-link
 * step (services/runner work/coin-links.ts) meets the post a coin's metadata names within seconds of
 * the launch, long before the coin runs. When that post re-shares, quotes or links another — repost,
 * then quote, then the first post its links name — the post it points at is taken as the coin's post
 * instead, under the same bigger-post rule, and never when both are by the same account (a launcher
 * quoting its own earlier promotion). One hop only, never this walk: a launch has no running coin to
 * pay for more reads, and the coin-first route walks further once one does.
 *
 * What breaks if changed carelessly: the order and the stop. Following a post that is not followed
 * would put a big account's coined words behind the small post they quoted; stopping early would
 * show the launcher's pointer again.
 */

/** What the walk knows of one held post. */
export interface OriginFacts {
  readonly itemId: string;
  readonly authorKey: string;
  /** Its newest reach reading; null when none. */
  readonly reach: number | null;
  readonly rebroadcastOf: string | null;
  readonly reproductionOf: string | null;
  /** The posts its own links name, in order; null when its links were never read (and may be). */
  readonly refersTo: readonly string[] | null;
  /** An earlier post by another account with the same first picture or video; null when none. */
  readonly sameMediaAs: string | null;
  /** Its author is a launcher (`isLauncher`). */
  readonly launcher: boolean;
}

/** One post as the walk can see it: held, not read yet (`unread`), or read once and not returned (`gone`). */
export type OriginLookup = (itemId: string) => OriginFacts | 'unread' | 'gone';

export type OriginHop = 'repost' | 'quote' | 'link' | 'media';

export type OriginOutcome =
  /** The linked post is the viral post: the route goes on with it as before. */
  | { readonly kind: 'self' }
  /** A launcher's post that points at nothing the walk can follow: never judged, credited or admitted. */
  | { readonly kind: 'pointer' }
  /** The original, `hops` away from the linked post. */
  | { readonly kind: 'original'; readonly itemId: string; readonly hops: readonly OriginHop[] }
  /** This post must be read (by id, or again for its links) before the walk can go on. */
  | { readonly kind: 'read'; readonly itemId: string; readonly hops: readonly OriginHop[] }
  /** The linked post itself was read once and not returned. */
  | { readonly kind: 'gone' };

export interface OriginBars {
  readonly maxDepth: number;
}

/** The next post this one points at, with how; null when none. */
export function pointsAt(p: OriginFacts): { readonly itemId: string; readonly hop: OriginHop } | null {
  if (p.rebroadcastOf !== null && p.rebroadcastOf !== p.itemId) return { itemId: p.rebroadcastOf, hop: 'repost' };
  if (p.reproductionOf !== null && p.reproductionOf !== p.itemId) return { itemId: p.reproductionOf, hop: 'quote' };
  const link = (p.refersTo ?? []).find((id) => id !== p.itemId);
  if (link !== undefined) return { itemId: link, hop: 'link' };
  if (p.sameMediaAs !== null && p.sameMediaAs !== p.itemId) return { itemId: p.sameMediaAs, hop: 'media' };
  return null;
}

/** Whether the walk goes from `from` to `to` by `hop` (the header's rule). */
export function follows(from: Pick<OriginFacts, 'reach' | 'launcher'>, to: Pick<OriginFacts, 'reach'>, hop: OriginHop): boolean {
  if (hop === 'repost' || from.launcher) return true;
  if (from.reach === null || to.reach === null) return true;
  return to.reach >= from.reach;
}

/** What the coin-link step knows of the post a coin's metadata named, at the launch. */
export interface PromoFacts {
  readonly itemId: string;
  readonly authorKey: string;
  /** Its newest reach reading; null when none. */
  readonly reach: number | null;
  readonly rebroadcastOf: string | null;
  readonly reproductionOf: string | null;
  /** The posts its own links name, in order; empty when none or never told. */
  readonly links: readonly string[];
}

/** The post a coin's named post points at, one hop: its re-share, else its quote, else its first link; null when none. */
export function promoPointsAt(p: PromoFacts): { readonly itemId: string; readonly hop: Exclude<OriginHop, 'media'> } | null {
  if (p.rebroadcastOf !== null && p.rebroadcastOf !== p.itemId) return { itemId: p.rebroadcastOf, hop: 'repost' };
  if (p.reproductionOf !== null && p.reproductionOf !== p.itemId) return { itemId: p.reproductionOf, hop: 'quote' };
  const link = p.links.find((id) => id !== p.itemId);
  return link === undefined ? null : { itemId: link, hop: 'link' };
}

/**
 * Whether the post a named post points at is taken as the coin's post (the header's launch rule):
 * another account's, and at least as widely seen unless either reach is unknown — a big account
 * quoting a small one made the post people coined.
 */
export function promoFollows(promo: PromoFacts, original: { readonly authorKey: string; readonly reach: number | null }, hop: Exclude<OriginHop, 'media'>): boolean {
  if (original.authorKey === promo.authorKey) return false;
  return follows({ reach: promo.reach, launcher: false }, original, hop);
}

/** The walk from the coin's linked post `start` (the header). */
export function resolveOrigin(start: string, lookup: OriginLookup, bars: OriginBars): OriginOutcome {
  const first = lookup(start);
  if (first === 'gone') return { kind: 'gone' };
  if (first === 'unread') return { kind: 'read', itemId: start, hops: [] };
  let cur = first;
  const hops: OriginHop[] = [];
  const seen = new Set([start]);
  while (hops.length < bars.maxDepth) {
    /* Links never read, and nothing earlier in the order to follow: read the post again first. */
    if (cur.refersTo === null && cur.rebroadcastOf === null && cur.reproductionOf === null) return { kind: 'read', itemId: cur.itemId, hops: [...hops] };
    const next = pointsAt(cur);
    if (next === null || seen.has(next.itemId)) break;
    const to = lookup(next.itemId);
    if (to === 'gone') break;
    if (to === 'unread') return { kind: 'read', itemId: next.itemId, hops: [...hops, next.hop] };
    if (!follows(cur, to, next.hop)) break;
    hops.push(next.hop);
    seen.add(to.itemId);
    cur = to;
  }
  if (cur.itemId !== start) return { kind: 'original', itemId: cur.itemId, hops };
  return first.launcher ? { kind: 'pointer' } : { kind: 'self' };
}

/** What the store counts of one account over the launcher lookback. */
export interface AccountCoinFacts {
  /** Its posts first seen in the lookback. */
  readonly posts: number;
  /** Of those, the ones some coin's own link names. */
  readonly linked: number;
  /** Its follower count as last read; null when never read. */
  readonly followers: number | null;
}

export interface LauncherBars {
  readonly minLinkedPosts: number;
  readonly minLinkedShare: number;
  readonly maxFollowers: number;
}

/**
 * Whether an account is a launcher: at least `minLinkedPosts` of its recent posts named by coins, at
 * least `minLinkedShare` of all its recent posts we hold, and under `maxFollowers`. An unknown
 * following is not a small one: such an account is not called a launcher.
 */
export function isLauncher(a: AccountCoinFacts, bars: LauncherBars): boolean {
  if (a.followers === null || a.posts <= 0) return false;
  return a.linked >= bars.minLinkedPosts && a.linked / a.posts >= bars.minLinkedShare && a.followers < bars.maxFollowers;
}
