/**
 * THE EARLY POSTS — which stored posts the regroup could not see belong to a narrative it made?
 *
 * The regroup (narrative.ts) sees only the last `narrative.windowMs`, newest first, at most
 * `narrative.maxPosts`. A story that runs for days loses its first posts from it as it ages: on
 * 2026-10-18 the Tesla Roadster narrative began at Saturday 13:00 while its own first post (Thursday
 * 15:38, the post its id is named after) and 40 more of its good posts were stored and outside the
 * window, and 49 more were in the window but over the cap. The owner's rule: a narrative's first
 * post is the earliest post we know of, so these are matched back in.
 *
 * Why a step after the regroup and not a wider regroup: the regroup's span and gap limits are what
 * keep an old story and a new one with the same word apart, and widening them would let every
 * week-old post join every new story. Here a post may join only a narrative the regroup already
 * made, only by the regroup's own rules — a link (meaning at `sameMeaning` and a shared name or topic
 * word, `sharedDetail`, inside `maxGapMs`) AND the narrative's average at `mergeMeaning` — so an
 * early post is one the regroup would have put there had it been in the window. The story is
 * followed back one link at a time: a post links to the narrative's posts or to an early post
 * already taken, never across a gap longer than the regroup's.
 *
 * Two steps, so the caller reads vectors only for posts that can match: `earlyShortlist` (words
 * only: a post sharing a name or topic word with some post of a narrative) and `earlyMatches`
 * (with the vectors). Pure.
 *
 * What breaks if changed carelessly: the owner's calls. A post he removed from beside a narrative's
 * posts, or a pair he kept apart, never comes back through here; and an early post goes to one
 * narrative only, the one whose average it is closest to.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { detailOf, groupable, pairKey, sharedDetail, type NarrativeCalls, type NarrativePost, type PostDetail } from './narrative.ts';

/** A narrative the regroup made, as the matcher needs it. */
export interface EarlyNarrative {
  readonly id: string;
  /** Its grouped posts (never its earlier early posts). */
  readonly members: readonly string[];
}

export interface EarlyInput {
  /** The narratives to match, in the order they are served (the caller's per-pass cap applied). */
  readonly narratives: readonly EarlyNarrative[];
  /** The narratives' own posts, by id. */
  readonly posts: ReadonlyMap<string, NarrativePost>;
  /** Good posts the regroup did not see, inside the lookback (the caller's filter). */
  readonly stored: readonly NarrativePost[];
  readonly calls: NarrativeCalls;
}

const keysOf = (d: PostDetail): string[] => [...d.names].map((n) => `n:${n}`).concat([...d.topics].map((t) => `t:${t}`), d.nameWords.map((ws) => `w:${ws[0] ?? ''}`));

/**
 * The stored posts that share a name or a topic word with at least one post of a narrative, per
 * narrative: the only ones whose vectors are worth reading. A thin post with no picture is never
 * grouped, so never shortlisted.
 */
export function earlyShortlist(input: EarlyInput, p: Policy): ReadonlyMap<string, readonly string[]> {
  /* An index of the stored posts by what they can share: names, topic words, and the first word of
     each name they give (checked against the other post's words below). */
  const stored = new Map<string, { post: NarrativePost; d: PostDetail }>();
  const byKey = new Map<string, Set<string>>();
  const bySaid = new Map<string, Set<string>>();
  const add = (index: Map<string, Set<string>>, key: string, id: string) => {
    const set = index.get(key) ?? new Set<string>();
    set.add(id);
    index.set(key, set);
  };
  for (const post of input.stored) {
    const d = detailOf(post, p);
    if (!groupable(d)) continue;
    stored.set(post.itemId, { post, d });
    for (const k of keysOf(d)) add(byKey, k, post.itemId);
    for (const w of d.said) add(bySaid, w, post.itemId);
  }
  const out = new Map<string, readonly string[]>();
  for (const n of input.narratives) {
    const hits = new Set<string>();
    for (const m of n.members) {
      const post = input.posts.get(m);
      if (post === undefined) continue;
      const d = detailOf(post, p);
      const near = new Set<string>();
      for (const name of d.names) for (const id of byKey.get(`n:${name}`) ?? []) near.add(id);
      for (const t of d.topics) for (const id of byKey.get(`t:${t}`) ?? []) near.add(id);
      for (const ws of d.nameWords) for (const id of bySaid.get(ws[0] ?? '') ?? []) near.add(id);
      for (const w of d.said) for (const id of byKey.get(`w:${w}`) ?? []) near.add(id);
      for (const id of near) {
        const s = stored.get(id);
        if (s !== undefined && !hits.has(id) && sharedDetail(s.d, d, false) !== null) hits.add(id);
      }
    }
    if (hits.size > 0) out.set(n.id, [...hits].sort());
  }
  return out;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
};

/**
 * Each narrative's early posts, earliest first, at most `early.maxPerNarrative`: shortlisted posts
 * at `mergeMeaning` from its average that link (meaning at `sameMeaning` with a shared detail,
 * inside `maxGapMs`) to one of its posts or to an early post already taken, newest first. Vectors are unit vectors; a post or narrative with none matches
 * nothing. A post several narratives would take goes to the one whose average it is closest to.
 */
export function earlyMatches(input: EarlyInput, shortlist: ReadonlyMap<string, readonly string[]>, vectors: ReadonlyMap<string, Float32Array>, p: Policy): ReadonlyMap<string, readonly string[]> {
  const n = p.narrative;
  const storedById = new Map(input.stored.map((s) => [s.itemId, s] as const));
  const best = new Map<string, { narrative: string; c: number }>();
  for (const nar of input.narratives) {
    const ids = shortlist.get(nar.id) ?? [];
    if (ids.length === 0) continue;
    const members = new Set(nar.members);
    const withVectors = nar.members.filter((m) => vectors.has(m));
    if (withVectors.length === 0) continue;
    const dims = vectors.get(withVectors[0] ?? '')?.length ?? 0;
    const sum = new Float64Array(dims);
    for (const m of withVectors) {
      const v = vectors.get(m) ?? new Float32Array(dims);
      for (let i = 0; i < dims; i += 1) sum[i] = (sum[i] ?? 0) + (v[i] ?? 0);
    }
    const norm = Math.sqrt(dot(sum, sum));
    if (norm === 0) continue;
    /* The posts a candidate may link to: the narrative's own, then each early post taken, newest
       first, so the story is followed back one link at a time and never jumps a gap. */
    const linkable: { readonly id: string; readonly atMs: number; readonly d: PostDetail; readonly v: Float32Array }[] = withVectors.flatMap((m) => {
      const post = input.posts.get(m);
      const v = vectors.get(m);
      return post === undefined || v === undefined ? [] : [{ id: m, atMs: post.atMs, d: detailOf(post, p), v }];
    });
    const newestFirst = [...ids].sort((a, b) => (storedById.get(b)?.atMs ?? 0) - (storedById.get(a)?.atMs ?? 0) || a.localeCompare(b));
    for (const id of newestFirst) {
      const v = vectors.get(id);
      const post = storedById.get(id);
      if (v === undefined || post === undefined || members.has(id)) continue;
      /* The owner's calls first: removed from beside these posts, or kept apart from one of them. */
      if ([...(input.calls.removed.get(id) ?? [])].some((x) => members.has(x))) continue;
      if (nar.members.some((m) => input.calls.apart.has(pairKey(id, m)))) continue;
      const c = dot(v, sum) / norm;
      if (c < n.mergeMeaning) continue;
      const d = detailOf(post, p);
      /* ★ The regroup's own pair rule, gap included: a link counts only inside `maxGapMs`. Without the
         gap, a post that shares the word "Tesla" four days before the Roadster's first post (a dog
         named Tesla, a bus ticket) became the story's first post on the live data of 2026-10-18. */
      const linked = linkable.some((l) => Math.abs(l.atMs - post.atMs) <= n.maxGapMs && dot(v, l.v) >= n.sameMeaning && sharedDetail(d, l.d, false) !== null);
      if (!linked) continue;
      linkable.push({ id, atMs: post.atMs, d, v });
      const had = best.get(id);
      if (had === undefined || c > had.c || (c === had.c && nar.id < had.narrative)) best.set(id, { narrative: nar.id, c });
    }
  }
  const out = new Map<string, string[]>();
  for (const [id, b] of best) out.set(b.narrative, [...(out.get(b.narrative) ?? []), id]);
  const atOf = (id: string) => storedById.get(id)?.atMs ?? 0;
  return new Map([...out].map(([id, list]) => [id, list.sort((a, b) => atOf(a) - atOf(b) || a.localeCompare(b)).slice(0, p.narrative.early.maxPerNarrative)] as const));
}
