/**
 * "COIN FOR THIS STORY": the coin the owner confirmed on one post, shown on new posts about the same
 * story — and the coins the owner said were wrong, kept off them.
 *
 * The owner confirms a coin on a post ("This is the coin", a pasted address, the pick after "Wrong
 * coin"; core match/owner-coin-calls.ts). Each such post is an ANCHOR for its coin; each coin the
 * owner called wrong on a post is a WRONG anchor. A feed post is about the same story as an anchor
 * when the two posts' words-and-picture vectors are close (`similarity`, the runner's own vectors):
 *
 *   alone     at or above `bars.alone` to one confirmed post, on meaning alone
 *   together  at or above `bars.together` to at least `bars.togetherPosts` confirmed posts of the
 *             SAME coin: the more posts the owner confirmed a coin on, the more ways a new post
 *             can be close to the story, and two confirmations agreeing is more than one
 *   near      at or above `bars.near` to a confirmed post, AND the judge gave the post the same
 *             subject name as the confirmed post or as the coin itself (its ticker or name), or the
 *             post shares a story (the grouping's) with that confirmed post
 *             or with a post that met `alone` or `together` — the narrative carries the coin to
 *             its members, never past them
 *
 * ★ NOTHING HERE KNOWS A STORY. Every coin the owner confirms on any post is an anchor the moment
 * the call is saved, whatever the subject; the bars are the same numbers for every story.
 *
 * ★ THE NEWEST CALL WINS, PER COIN AND THEN ACROSS COINS. For each coin, the newest anchor the post
 * matched decides whether the coin is right or wrong for it (a later "wrong" on a post of the story
 * takes the coin off the story). Among the coins still right, the newest confirmation is the
 * story's coin: if the owner confirms a different coin for the same story later, it wins.
 *
 * Pure: the vectors' similarity is measured by the caller (services/project story-coins.ts) and
 * handed in; nothing here knows where a vector or a call came from. Its own file because the gold of
 * this rule is the owner's own labels: tests pin GTA 6 against GTA 5, the tiger story against other
 * viral animal posts, and the newest-wins order — examples of the one rule, not cases of it.
 *
 * What breaks if changed carelessly: an anchor's own post. The owner's call on that post decides it
 * directly (owner-coin-calls.ts); matching a post to itself here would let a story coin outrank
 * the owner's own later "No coin is from this" on it. And the bars come from Policy.postCoin.storyCoin,
 * measured on the owner's labels; a bar set elsewhere ships a rule nobody measured.
 */

import { compactName } from './post-coin.ts';

export interface StoryAnchor {
  readonly itemId: string;
  readonly coin: string;
  readonly atMs: number;
  readonly kind: 'right' | 'wrong';
  /** The subject's names for this anchor: the judge's name for the anchor's post, and the coin's own
      ticker and name — a new post the judge names "ALTAI" is named for the $ALTAI story. */
  readonly names: readonly string[];
  /** The stories (the grouping's) the anchor's post is a member of. */
  readonly stories: readonly string[];
}

export interface StoryPost {
  readonly itemId: string;
  readonly name: string | null;
  readonly stories: readonly string[];
}

export interface StoryCoinBars {
  readonly alone: number;
  readonly together: number;
  readonly togetherPosts: number;
  readonly near: number;
  /** A name shorter than this, run together, says too little to name a story ("GTA", "RIP"). */
  readonly minNameChars: number;
}

export interface StoryCoin {
  /** The story's coin for this post, from the newest confirmation it matched; null when none stands. */
  readonly coin: { readonly address: string; readonly fromItemId: string; readonly atMs: number } | null;
  /** Coins the owner called wrong on a post of the same story, newest call standing. */
  readonly wrong: ReadonlySet<string>;
}

const nameKeyOf = (n: string | null, min: number): string | null => {
  if (n === null) return null;
  const k = compactName(n);
  return k.length < min ? null : k;
};

/** Each post's story coin and story-level wrong coins; a post that matched no anchor is absent. */
export function storyCoins(
  posts: readonly StoryPost[],
  anchors: readonly StoryAnchor[],
  similarity: (postId: string, anchorItemId: string) => number | undefined,
  bars: StoryCoinBars,
): ReadonlyMap<string, StoryCoin> {
  const nameKey = (n: string | null) => nameKeyOf(n, bars.minNameChars);
  const anchorItems = new Map<string, StoryAnchor>();
  for (const a of anchors) if (!anchorItems.has(a.itemId)) anchorItems.set(a.itemId, a);
  const sim = (p: StoryPost, anchorItem: string): number | null => (p.itemId === anchorItem ? null : similarity(p.itemId, anchorItem) ?? null);

  /* How many confirmed posts of each coin a post is `together`-close to: the owner's confirmations agreeing. */
  const rightPosts = new Map<string, Set<string>>();
  for (const a of anchors) if (a.kind === 'right') rightPosts.set(a.coin, (rightPosts.get(a.coin) ?? new Set<string>()).add(a.itemId));
  const agreeing = (p: StoryPost, coin: string): number => {
    let n = 0;
    for (const id of rightPosts.get(coin) ?? []) {
      const v = sim(p, id);
      if (v !== null && v >= bars.together) n += 1;
    }
    return n;
  };
  const strong = (p: StoryPost, a: StoryAnchor): boolean => {
    const v = sim(p, a.itemId);
    if (v === null) return false;
    if (v >= bars.alone) return true;
    return a.kind === 'right' && v >= bars.together && agreeing(p, a.coin) >= bars.togetherPosts;
  };

  /* The stories that carry each anchor's coin: its own, and those of every post strongly close to it. */
  const carried = new Map<string, Set<string>>();
  for (const [id, a] of anchorItems) {
    const s = new Set(a.stories);
    for (const p of posts) if (strong(p, a)) for (const x of p.stories) s.add(x);
    carried.set(id, s);
  }

  const out = new Map<string, StoryCoin>();
  for (const p of posts) {
    const key = nameKey(p.name);
    const matches = (a: StoryAnchor): boolean => {
      if (strong(p, a)) return true;
      const v = sim(p, a.itemId);
      if (v === null || v < bars.near) return false;
      if (key !== null && a.names.some((n) => nameKey(n) === key)) return true;
      const stories = carried.get(a.itemId);
      return p.stories.some((x) => stories?.has(x) === true);
    };
    const newest = new Map<string, StoryAnchor>();
    for (const a of anchors) {
      if (!matches(a)) continue;
      const have = newest.get(a.coin);
      if (have === undefined || a.atMs > have.atMs) newest.set(a.coin, a);
    }
    if (newest.size === 0) continue;
    const standing = [...newest.values()];
    const right = standing.filter((a) => a.kind === 'right').sort((x, y) => y.atMs - x.atMs)[0];
    out.set(p.itemId, {
      coin: right === undefined ? null : { address: right.coin, fromItemId: right.itemId, atMs: right.atMs },
      wrong: new Set(standing.filter((a) => a.kind === 'wrong').map((a) => a.coin)),
    });
  }
  return out;
}
