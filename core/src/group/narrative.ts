/**
 * NARRATIVES — which of the posts the judge passed are about the same story?
 *
 * The owner's rule (2026-10-16), and the reason this is not the GROUP stage in stage.ts: GROUP
 * seeds a story from every admitted item and joins on carriers — a shared hashtag, a shared name
 * span — before anyone has said the post is worth showing. Forty-six thousand candidate stories in
 * four days, and the board's narratives were built from ads, shills and posts the owner hid. A
 * narrative here is built only from GOOD posts, and only on two things at once:
 *
 *   meaning     the two posts' words-and-picture vectors are close (`narrative.sameMeaning`)
 *   a detail    they share a name, the same picture, or a topic word that is not a hashtag —
 *               the story coins' rule (match/story-coin.ts), so a narrative and a story coin
 *               agree on what "the same story" means
 *
 * within `maxGapMs` of each other. Posts join by AVERAGE LINKAGE on those links: two groups
 * become one only when at least `minLinkShare` of the post pairs across them link. Single
 * linkage — any one link joins — is how a chain of posts each a little further from the first
 * becomes one "narrative" about nothing; average linkage is what keeps a story from drifting.
 *
 * ★ EVERY PASS REGROUPS FROM SCRATCH, AND THE IDS ARE KEPT BY OVERLAP. Splitting a narrative
 * whose posts drifted, and merging two that turned out to be one, both fall out of regrouping
 * the current posts; nothing is patched in place. A new group keeps the id of the previous
 * narrative it shares the most posts with, so a link to a narrative, and the owner's calls on it,
 * survive its growth. A previous narrative no group took is retired — merged into the group that
 * took most of its posts, or gone.
 *
 * ★ THE OWNER OUTRANKS EVERY NUMBER HERE. "Not a narrative" keeps the posts he saw together from
 * being grouped together again; "Remove this post" keeps that post out of any group holding the
 * posts it was with; "Merge with…" joins the two narratives' posts whatever their links say. His
 * calls are folded oldest first, so a later merge undoes an earlier "apart" for the posts it names.
 *
 * Pure. The runner reads the posts, the vectors' closeness and the picture matches; this decides.
 * Every number is in Policy.narrative (and the detail rule's in Policy.postCoin.storyCoin).
 *
 * What breaks if changed carelessly: the eligibility gate. A post that has not passed the judge
 * is not "a narrative of one waiting for company" — it is never grouped at all, and a group with
 * one good post and four junk ones is one post, not a narrative of five.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_MINUTE } from '../math.ts';
import { compactName } from '../match/post-coin.ts';
import { isCommonWord, postWords, topicWords } from '../match/story-coin.ts';
import { heldKind } from '../qualify/kinds.ts';
import { postScoreReason } from '../qualify/post-score.ts';

/* ── who counts ───────────────────────────────────────────────────────── */

/** Why a post may or may not be in a narrative. Only `good` is grouped. */
export type NarrativeStanding = 'good' | 'owner_not_meme' | 'shill' | 'held_kind' | 'judge_no' | 'not_judged';

export interface StandingInput {
  /** The judge's newest answer to the post question; null when it has not answered. */
  readonly answer: {
    readonly coinable: boolean;
    readonly confidence: number;
    readonly lookedAt: 'text' | 'picture' | 'videoFrame';
    readonly proposedName: string | null;
  } | null;
  /** The kind question's label, when the newest answer of all is a kind answer. */
  readonly kindLabel: string | null;
  /** The owner's newest call on the post. */
  readonly ownerCall: 'meme' | 'not' | null;
  /** Its own words, or its author's own replies, name a coin. */
  readonly shill: boolean;
}

/**
 * ★ A NARRATIVE IS BUILT ONLY FROM POSTS THAT PASSED THE JUDGE. `p` is the policy the answer is
 * held to — its own model's cutoff (services/project judge-cutoff.ts). The owner's "Not a meme"
 * is never good and his "Is a meme" always is; otherwise a shill, a held kind (an ad, the
 * close-match hold) and anything the judge did not pass at its bar are left out. Other accounts'
 * coin talk, which can put a post on For You, does not make it a narrative's post: the owner
 * asked for posts that passed the judge.
 */
export function narrativeStanding(input: StandingInput, p: Policy): NarrativeStanding {
  if (input.ownerCall === 'not') return 'owner_not_meme';
  if (input.ownerCall === 'meme') return 'good';
  if (input.shill) return 'shill';
  if (heldKind(input.kindLabel, p.judge.heldKinds) !== null) return 'held_kind';
  if (input.answer === null) return 'not_judged';
  return postScoreReason(input.answer, p, null, input.kindLabel) === 'passes' ? 'good' : 'judge_no';
}

/* ── what two posts can share ─────────────────────────────────────────── */

export interface NarrativePost {
  readonly itemId: string;
  /** When it went up (or when we first saw it, when the source gave no time). */
  readonly atMs: number;
  readonly text: string;
  /** The judge's names for its subject: its proposed name and the alternates. */
  readonly names: readonly string[];
  readonly hasPicture: boolean;
}

/** What a post offers to be matched on, computed once per post. */
export interface PostDetail {
  readonly names: ReadonlySet<string>;
  /** Each name's own topic words, for a name one post says in plain words ("tiger" in "Altai the tiger"). */
  readonly nameWords: readonly (readonly string[])[];
  readonly topics: ReadonlySet<string>;
  readonly said: ReadonlySet<string>;
  /** Fewer words than the story coins' `minWords` once hashtags, mentions and links are gone. */
  readonly thin: boolean;
  readonly hasPicture: boolean;
}

export function detailOf(post: NarrativePost, p: Policy): PostDetail {
  const bars = p.postCoin.storyCoin;
  const generic = p.group.genericSpans;
  const genericKeys = new Set(generic.map((g) => compactName(g)));
  const words = postWords(post.text);
  const names = new Set<string>();
  const nameWords: string[][] = [];
  for (const n of post.names) {
    const key = compactName(n);
    if (key.length >= bars.minNameChars && !genericKeys.has(key)) names.add(key);
    const w = postWords(n).filter((x) => x.length >= bars.minTopicChars && !isCommonWord(x, generic));
    if (w.length > 0) nameWords.push(w);
  }
  return {
    names,
    nameWords,
    topics: topicWords(post.text, bars.minTopicChars, generic),
    said: new Set(words),
    thin: words.length < bars.minWords,
    hasPicture: post.hasPicture,
  };
}

/** A post that may be grouped: good, and not a thin post with no picture to match on. */
export const groupable = (d: PostDetail): boolean => !d.thin || d.hasPicture;

export type SharedDetailKind = 'name' | 'picture' | 'topic';

/**
 * The one detail two posts share besides their meaning, or null: the same name, the same picture
 * (the caller's picture check), a name one of them gives that the other says in plain words, or a
 * topic word both say. Hashtags are not words here, so two posts that share only hashtags share
 * nothing; a thin post (a picture and a few words) shares only a name or its picture.
 */
export function sharedDetail(a: PostDetail, b: PostDetail, samePicture: boolean): SharedDetailKind | null {
  for (const n of a.names) if (b.names.has(n)) return 'name';
  if (samePicture && a.hasPicture && b.hasPicture) return 'picture';
  const says = (names: readonly (readonly string[])[], said: ReadonlySet<string>) => names.some((ws) => ws.every((w) => said.has(w)));
  if (says(a.nameWords, b.said) || says(b.nameWords, a.said)) return 'name';
  if (a.thin || b.thin) return null;
  for (const w of a.topics) if (b.topics.has(w)) return 'topic';
  return null;
}

/* ── the owner's calls ────────────────────────────────────────────────── */

export type NarrativeCallVerdict = 'not_narrative' | 'merge' | 'remove_post' | 'right' | 'wrong' | 'cleared';

/** One stored call on a narrative (internal.owner_feedback, subject 'narrative', 0093). */
export interface NarrativeCallRow {
  readonly id: number;
  readonly atMs: number;
  readonly narrativeId: string;
  readonly verdict: NarrativeCallVerdict;
  /** merge: the narrative it was merged with; remove_post: the post removed. */
  readonly otherId: string | null;
  readonly coin: string | null;
  /** The narrative's posts when the call was made, as the server read them. */
  readonly members: readonly string[];
  /** merge: the other narrative's posts when the call was made. */
  readonly otherMembers: readonly string[];
}

export interface NarrativeCoinCall {
  readonly right: { readonly address: string; readonly atMs: number } | null;
  /** Address → when the owner said it is not the narrative's coin. */
  readonly wrong: ReadonlyMap<string, number>;
  /** The narrative's posts at its newest coin call: where the call still applies if the id moved. */
  readonly members: readonly string[];
}

export interface NarrativeCalls {
  /** Pairs of posts the owner keeps apart, as `pairKey`. */
  readonly apart: ReadonlySet<string>;
  /** Each removed post, and the posts it was removed from beside. */
  readonly removed: ReadonlyMap<string, ReadonlySet<string>>;
  /** Merges still standing: each side's posts. */
  readonly together: readonly { readonly posts: readonly string[]; readonly with: readonly string[] }[];
  /** Every "Not a narrative", with the posts it was said over: the hide rides on the posts, not the id. */
  readonly hidden: readonly NarrativeHide[];
  readonly coins: ReadonlyMap<string, NarrativeCoinCall>;
}

/** One "Not a narrative": the narrative it was said on and the posts it held then. */
export interface NarrativeHide {
  readonly narrativeId: string;
  readonly atMs: number;
  readonly members: ReadonlySet<string>;
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Every call folded, oldest first: what stands now. */
export function foldNarrativeCalls(rows: readonly NarrativeCallRow[]): NarrativeCalls {
  const apart = new Set<string>();
  const removed = new Map<string, Set<string>>();
  const together: { posts: readonly string[]; with: readonly string[] }[] = [];
  const hidden: NarrativeHide[] = [];
  const coins = new Map<string, { right: { address: string; atMs: number } | null; wrong: Map<string, number>; members: readonly string[] }>();
  for (const r of [...rows].sort((x, y) => x.atMs - y.atMs || x.id - y.id)) {
    if (r.verdict === 'not_narrative') {
      hidden.push({ narrativeId: r.narrativeId, atMs: r.atMs, members: new Set(r.members) });
      for (let i = 0; i < r.members.length; i += 1) for (let j = i + 1; j < r.members.length; j += 1) apart.add(pairKey(r.members[i] ?? '', r.members[j] ?? ''));
    } else if (r.verdict === 'remove_post' && r.otherId !== null) {
      const post = r.otherId;
      const was = removed.get(post) ?? new Set<string>();
      for (const m of r.members) if (m !== post) {
        apart.add(pairKey(post, m));
        was.add(m);
      }
      removed.set(post, was);
    } else if (r.verdict === 'merge') {
      /* A later merge undoes any earlier "apart" between the posts it names. */
      for (const a of r.members) for (const b of r.otherMembers) apart.delete(pairKey(a, b));
      const unremove = (post: string, others: readonly string[]): void => {
        const was = removed.get(post);
        if (was === undefined) return;
        for (const o of others) was.delete(o);
      };
      for (const a of r.members) unremove(a, r.otherMembers);
      for (const b of r.otherMembers) unremove(b, r.members);
      if (r.members.length > 0 && r.otherMembers.length > 0) together.push({ posts: r.members, with: r.otherMembers });
    } else {
      const c = coins.get(r.narrativeId) ?? { right: null, wrong: new Map<string, number>(), members: r.members };
      if (r.verdict === 'cleared') coins.set(r.narrativeId, { right: null, wrong: new Map(), members: r.members });
      else if (r.coin !== null && r.verdict === 'right') {
        c.wrong.delete(r.coin);
        coins.set(r.narrativeId, { ...c, right: { address: r.coin, atMs: r.atMs }, members: r.members });
      } else if (r.coin !== null && r.verdict === 'wrong') {
        c.wrong.set(r.coin, r.atMs);
        coins.set(r.narrativeId, { ...c, right: c.right?.address === r.coin ? null : c.right, members: r.members });
      }
    }
  }
  /* A merge whose posts were later kept apart stands only for the pairs still allowed: the union
     below skips a group the owner has since separated (see `groupNarratives`). */
  return { apart, removed, together, hidden, coins };
}

/** The coin calls that apply to a narrative: on its id, else on the posts it holds most of. */
export function coinCallFor(narrativeId: string, members: ReadonlySet<string>, calls: NarrativeCalls): NarrativeCoinCall | null {
  const own = calls.coins.get(narrativeId);
  if (own !== undefined) return own;
  for (const c of calls.coins.values()) {
    const held = c.members.filter((m) => members.has(m)).length;
    if (c.members.length > 0 && held * 2 > c.members.length) return c;
  }
  return null;
}

/* ── grouping ─────────────────────────────────────────────────────────── */

/** Two posts' closeness of meaning, and whether their pictures match; pairs not listed are not close. */
export interface NarrativePair {
  readonly a: string;
  readonly b: string;
  readonly meaning: number;
  readonly samePicture: boolean;
}

export interface FormedNarrative {
  readonly id: string;
  /** Oldest first. */
  readonly members: readonly string[];
  /** Its oldest post. */
  readonly anchor: string;
  /** Whether its post set differs from the previous narrative's of the same id. */
  readonly changed: boolean;
}

export interface GroupedNarratives {
  readonly narratives: readonly FormedNarrative[];
  /** Previous narratives no group took: merged into the one that took most of their posts, or gone. */
  readonly retired: readonly { readonly id: string; readonly into: string | null }[];
  /** How many post pairs linked, and on which detail: for the run's log. */
  readonly links: { readonly name: number; readonly picture: number; readonly topic: number };
}

export interface GroupNarrativesInput {
  /** Good posts only (`narrativeStanding`), each at most once. */
  readonly posts: readonly NarrativePost[];
  readonly pairs: readonly NarrativePair[];
  readonly calls: NarrativeCalls;
  /** The open narratives the last pass wrote: id → its posts. */
  readonly previous: ReadonlyMap<string, ReadonlySet<string>>;
  /** Posts that may stand alone as a narrative of one (huge and climbing, `hugeAndClimbing`). */
  readonly single: ReadonlySet<string>;
  /**
   * The posts' unit vectors (the space `pairs` was measured in), for the second step: parts of
   * one story joining by their average vectors, and drifted posts leaving. Absent: links only.
   */
  readonly vectors?: ReadonlyMap<string, Float32Array>;
}

interface Group {
  members: string[];
  minAt: number;
  maxAt: number;
}

export function groupNarratives(input: GroupNarrativesInput, p: Policy): GroupedNarratives {
  const n = p.narrative;
  const details = new Map<string, PostDetail>();
  const atOf = new Map<string, number>();
  for (const post of input.posts) {
    const d = detailOf(post, p);
    if (!groupable(d)) continue;
    details.set(post.itemId, d);
    atOf.set(post.itemId, post.atMs);
  }

  /* The links: meaning, a detail, inside the gap, and not a pair the owner keeps apart. */
  const links = { name: 0, picture: 0, topic: 0 };
  const edges: [string, string][] = [];
  for (const pair of input.pairs) {
    if (pair.a === pair.b || pair.meaning < n.sameMeaning) continue;
    const da = details.get(pair.a);
    const db = details.get(pair.b);
    if (da === undefined || db === undefined) continue;
    if (Math.abs((atOf.get(pair.a) ?? 0) - (atOf.get(pair.b) ?? 0)) > n.maxGapMs) continue;
    if (input.calls.apart.has(pairKey(pair.a, pair.b))) continue;
    const kind = sharedDetail(da, db, pair.samePicture);
    if (kind === null) continue;
    links[kind] += 1;
    edges.push([pair.a, pair.b]);
  }

  /* Every post starts alone; groups join by average linkage, best share first. */
  const groupOf = new Map<string, number>();
  const groups = new Map<number, Group>();
  let next = 0;
  for (const id of [...details.keys()].sort()) {
    const at = atOf.get(id) ?? 0;
    groups.set(next, { members: [id], minAt: at, maxAt: at });
    groupOf.set(id, next);
    next += 1;
  }
  const between = new Map<number, Map<number, number>>();
  const bump = (x: number, y: number, by: number): void => {
    const m = between.get(x) ?? new Map<number, number>();
    m.set(y, (m.get(y) ?? 0) + by);
    between.set(x, m);
  };
  for (const [a, b] of edges) {
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    if (ga === undefined || gb === undefined || ga === gb) continue;
    bump(ga, gb, 1);
    bump(gb, ga, 1);
  }
  const kept = (x: Group, y: Group): boolean => {
    const [small, big] = x.members.length <= y.members.length ? [x, y] : [y, x];
    const bigSet = new Set(big.members);
    for (const s of small.members) for (const t of bigSet) if (input.calls.apart.has(pairKey(s, t))) return true;
    return false;
  };
  const join = (into: number, from: number): void => {
    const gi = groups.get(into);
    const gf = groups.get(from);
    if (gi === undefined || gf === undefined) return;
    gi.members.push(...gf.members);
    gi.minAt = Math.min(gi.minAt, gf.minAt);
    gi.maxAt = Math.max(gi.maxAt, gf.maxAt);
    for (const m of gf.members) groupOf.set(m, into);
    for (const [other, count] of between.get(from) ?? []) {
      between.get(other)?.delete(from);
      if (other === into) continue;
      bump(into, other, count);
      bump(other, into, count);
    }
    between.delete(from);
    between.get(into)?.delete(from);
    groups.delete(from);
  };
  for (;;) {
    let best: { x: number; y: number; share: number; count: number; key: string } | null = null;
    for (const [x, row] of between) {
      const gx = groups.get(x);
      if (gx === undefined) continue;
      for (const [y, count] of row) {
        if (y <= x) continue;
        const gy = groups.get(y);
        if (gy === undefined) continue;
        const share = count / (gx.members.length * gy.members.length);
        if (share < n.minLinkShare) continue;
        if (Math.max(gx.maxAt, gy.maxAt) - Math.min(gx.minAt, gy.minAt) > n.maxSpanMs) continue;
        const key = [gx.members[0] ?? '', gy.members[0] ?? ''].sort().join('|');
        if (best !== null && (share < best.share || (share === best.share && (count < best.count || (count === best.count && key >= best.key))))) continue;
        if (kept(gx, gy)) continue;
        best = { x, y, share, count, key };
      }
    }
    if (best === null) break;
    join(best.x, best.y);
  }

  /* ★ ONE STORY TOLD IN PARTS. Average linkage keeps a story from drifting, and so leaves a big
     story in pieces: a new post must link to half of a hundred posts to join them. A group (or a
     post) whose posts are on average `mergeMeaning` from another's average, and that shares a link
     or a name with it, joins it,
     the closest first, a round at a time, each group at most once a round. */
  const vectors = input.vectors;
  const centroid = new Map<number, Float64Array>();
  const sumOf = (g: number): Float64Array | null => {
    const have = centroid.get(g);
    if (have !== undefined) return have;
    const members = groups.get(g)?.members ?? [];
    let sum: Float64Array | null = null;
    for (const m of members) {
      const v = vectors?.get(m);
      if (v === undefined) continue;
      sum ??= new Float64Array(v.length);
      for (let i = 0; i < v.length && i < sum.length; i += 1) sum[i] = (sum[i] ?? 0) + (v[i] ?? 0);
    }
    if (sum !== null) centroid.set(g, sum);
    return sum;
  };
  const cosine = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
    let d = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length && i < b.length; i += 1) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      d += x * y;
      na += x * x;
      nb += y * y;
    }
    return na === 0 || nb === 0 ? 0 : d / Math.sqrt(na * nb);
  };
  /* The mean of each post's cosine to an average (posts with no vector left out); null with none. */
  const meanTo = (members: readonly string[], sum: Float64Array): number | null => {
    let total = 0;
    let k = 0;
    for (const m of members) {
      const v = vectors?.get(m);
      if (v === undefined) continue;
      total += cosine(v, sum);
      k += 1;
    }
    return k === 0 ? null : total / k;
  };
  if (vectors !== undefined) {
    for (;;) {
      const candidates = new Set<string>();
      for (const [x, row] of between) for (const y of row.keys()) if (x < y) candidates.add(`${x}|${y}`);
      const byName = new Map<string, Set<number>>();
      for (const [g, group] of groups) for (const m of group.members) for (const name of details.get(m)?.names ?? []) {
        const set = byName.get(name) ?? new Set<number>();
        set.add(g);
        byName.set(name, set);
      }
      for (const set of byName.values()) {
        const list = [...set].sort((a, b) => a - b);
        for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) candidates.add(`${list[i]}|${list[j]}`);
      }
      const scored: { x: number; y: number; c: number }[] = [];
      for (const key of candidates) {
        const [x, y] = key.split('|').map(Number) as [number, number];
        const gx = groups.get(x);
        const gy = groups.get(y);
        if (gx === undefined || gy === undefined) continue;
        if (Math.max(gx.maxAt, gy.maxAt) - Math.min(gx.minAt, gy.minAt) > n.maxSpanMs) continue;
        /* The smaller part's posts, against the bigger part's average: an average of many posts drifts
           toward the feed's own average, so two big groups' averages look alike when their posts do not. */
        const [small, big] = gx.members.length <= gy.members.length ? [gx, y] : [gy, x];
        const sum = sumOf(big);
        if (sum === null) continue;
        const c = meanTo(small.members, sum);
        if (c === null) continue;
        if (c >= n.mergeMeaning) scored.push({ x, y, c });
      }
      scored.sort((a, b) => b.c - a.c || a.x - b.x || a.y - b.y);
      const touched = new Set<number>();
      let merged = 0;
      for (const { x, y } of scored) {
        if (touched.has(x) || touched.has(y)) continue;
        const gx = groups.get(x);
        const gy = groups.get(y);
        if (gx === undefined || gy === undefined || kept(gx, gy)) continue;
        join(x, y);
        centroid.delete(x);
        centroid.delete(y);
        touched.add(x);
        touched.add(y);
        merged += 1;
      }
      if (merged === 0) break;
    }
  }

  /* ★ The owner's merges join whatever the links say; then a removed post leaves any group that
     holds a post it was removed from beside. */
  for (const t of input.calls.together) {
    const sides = [t.posts, t.with].map((list) => new Set(list.map((id) => groupOf.get(id)).filter((g): g is number => g !== undefined)));
    const all = [...new Set([...(sides[0] ?? []), ...(sides[1] ?? [])])].sort((a, b) => a - b);
    if ((sides[0]?.size ?? 0) === 0 || (sides[1]?.size ?? 0) === 0) continue;
    const [first, ...rest] = all;
    if (first === undefined) continue;
    for (const g of rest) join(first, g);
  }
  for (const [post, beside] of input.calls.removed) {
    const g = groupOf.get(post);
    const group = g === undefined ? undefined : groups.get(g);
    if (group === undefined || group.members.length < 2 || !group.members.some((m) => m !== post && beside.has(m))) continue;
    group.members = group.members.filter((m) => m !== post);
    const at = atOf.get(post) ?? 0;
    groups.set(next, { members: [post], minAt: at, maxAt: at });
    groupOf.set(post, next);
    next += 1;
  }

  /* ★ A POST THE STORY DRIFTED AWAY FROM LEAVES IT: under `mergeMeaning` from its narrative's
     average (three posts or more; two posts are always close to their own average). A post the
     owner merged in stays. */
  const ownerMerged = new Set(input.calls.together.flatMap((t) => [...t.posts, ...t.with]));
  if (vectors !== undefined) {
    for (const [g, group] of [...groups]) {
      if (group.members.length <= 2) continue;
      centroid.delete(g);
      const sum = sumOf(g);
      if (sum === null) continue;
      const drifted = group.members.filter((m) => {
        const v = vectors.get(m);
        return v !== undefined && !ownerMerged.has(m) && cosine(v, sum) < n.mergeMeaning;
      });
      for (const m of drifted) {
        group.members = group.members.filter((x) => x !== m);
        const at = atOf.get(m) ?? 0;
        groups.set(next, { members: [m], minAt: at, maxAt: at });
        groupOf.set(m, next);
        next += 1;
      }
    }
  }

  /* The groups worth an id: two posts or more, or one that stands alone. */
  const formed = [...groups.values()]
    .filter((g) => g.members.length >= 2 || (g.members.length === 1 && input.single.has(g.members[0] ?? '')))
    .map((g) => ({ members: [...g.members].sort((a, b) => (atOf.get(a) ?? 0) - (atOf.get(b) ?? 0) || a.localeCompare(b)) }));

  /* ★ IDS BY OVERLAP: each previous narrative goes to the group holding most of its posts. */
  const prevOf = new Map<string, string>();
  for (const [id, posts] of input.previous) for (const post of posts) prevOf.set(post, id);
  const overlaps: { group: number; prev: string; count: number }[] = [];
  formed.forEach((g, i) => {
    const counts = new Map<string, number>();
    for (const m of g.members) {
      const prev = prevOf.get(m);
      if (prev !== undefined) counts.set(prev, (counts.get(prev) ?? 0) + 1);
    }
    for (const [prev, count] of counts) overlaps.push({ group: i, prev, count });
  });
  overlaps.sort((a, b) => b.count - a.count || a.prev.localeCompare(b.prev) || a.group - b.group);
  const idOf = new Map<number, string>();
  const used = new Set<string>();
  for (const o of overlaps) {
    if (idOf.has(o.group) || used.has(o.prev)) continue;
    idOf.set(o.group, o.prev);
    used.add(o.prev);
  }
  const taken = new Set<string>([...input.previous.keys(), ...used]);
  const narratives: FormedNarrative[] = formed.map((g, i) => {
    let id = idOf.get(i);
    if (id === undefined) {
      id = g.members.map((m) => `n-${m}`).find((x) => !taken.has(x)) ?? `n-${g.members[0] ?? ''}-${i}`;
      taken.add(id);
    }
    const before = input.previous.get(id);
    const changed = before === undefined || before.size !== g.members.length || g.members.some((m) => !before.has(m));
    return { id, members: g.members, anchor: g.members[0] ?? '', changed };
  });

  const retired: { id: string; into: string | null }[] = [];
  for (const [prev, posts] of input.previous) {
    if (used.has(prev)) continue;
    let into: string | null = null;
    let most = 0;
    for (const nar of narratives) {
      const held = nar.members.filter((m) => posts.has(m)).length;
      if (held > most) {
        most = held;
        into = nar.id;
      }
    }
    retired.push({ id: prev, into });
  }
  return { narratives, retired, links };
}

/* ── on screen ────────────────────────────────────────────────────────── */

/** One view reading: the count, or null when the reading carried none. */
export interface ReachPoint {
  readonly atMs: number;
  readonly reach: number | null;
}

/**
 * Views a minute between the newest reading (inside `single.growthWindowMs` of now) and the
 * earliest one in the window before it, at least `growthMinSpanMs` apart; null when the readings
 * cannot say. Measured between two of OUR readings, never from the post time: from the post time a
 * day-old post with a million views averages 700 a minute forever.
 */
export function climbPerMinute(points: readonly ReachPoint[], nowMs: number, p: Policy): number | null {
  const s = p.narrative.single;
  const counted = points.filter((v): v is { atMs: number; reach: number } => v.reach !== null).sort((a, b) => a.atMs - b.atMs);
  const newest = counted[counted.length - 1];
  if (newest === undefined || nowMs - newest.atMs > s.growthWindowMs) return null;
  const earliest = counted.find((v) => v.atMs >= newest.atMs - s.growthWindowMs);
  if (earliest === undefined) return null;
  const spanMs = newest.atMs - earliest.atMs;
  if (spanMs < s.growthMinSpanMs) return null;
  return (newest.reach - earliest.reach) / (spanMs / MS_PER_MINUTE);
}

/**
 * ★ ONE POST IS A NARRATIVE ONLY WHEN IT IS CLEARLY HUGE AND CLIMBING FAST: at least
 * `single.minReach` views and `single.minPerMinute` a minute now (a short video at
 * `rising.shortVideoReachScale` times both). An unread count or an unreadable climb is not huge.
 */
export function hugeAndClimbing(reach: number | null, perMinute: number | null, shortVideo: boolean, p: Policy): boolean {
  const scale = shortVideo ? p.rising.shortVideoReachScale : 1;
  const s = p.narrative.single;
  return reach !== null && perMinute !== null && reach >= s.minReach * scale && perMinute >= s.minPerMinute * scale;
}

/** Why a group is or is not shown as a narrative. */
export type NarrativeShown = 'shown' | 'too_few_posts' | 'hidden_by_owner';

/**
 * ★ "NOT A NARRATIVE" STAYS SAID. A hide applies to the narrative it was said on and to any
 * narrative holding one of the posts it was said over, and it lifts only when the narrative now
 * has `minPosts` good posts that were NOT among them: a genuinely different, bigger story.
 *
 * Why posts and not the id or a timestamp: the call itself keeps its posts apart, so the very
 * next regroup shrinks the narrative ("its posts changed"), and a regroup can give the same posts
 * a new id (an id is its earliest post). Both used to undo the hide within a pass — the owner
 * tapped, and the narrative came back as its one huge post. `members` are the posts that count
 * NOW (the runner's good posts, the projector's listed ones).
 */
export function hiddenByOwner(narrativeId: string, members: readonly string[], calls: NarrativeCalls, p: Policy): boolean {
  return calls.hidden.some((h) => {
    const applies = h.narrativeId === narrativeId || members.some((m) => h.members.has(m));
    if (!applies) return false;
    /* A call recorded without its posts can only be held on its id, and then it holds. */
    if (h.members.size === 0) return true;
    return members.filter((m) => !h.members.has(m)).length < p.narrative.minPosts;
  });
}

/**
 * ★ A NARRATIVE NEEDS `minPosts` GOOD POSTS, OR ONE POST THAT IS HUGE AND CLIMBING. Otherwise it
 * is just a post, and For You already shows posts. `goodPosts` are the posts still good NOW (the
 * projector re-reads their standing: an owner's "Not a meme" since the pass takes a post out at
 * once); `hidden` is the owner's "Not a narrative" as `hiddenByOwner` holds it.
 */
export function narrativeShown(goodPosts: number, single: boolean, hidden: boolean, p: Policy): NarrativeShown {
  if (hidden) return 'hidden_by_owner';
  if (goodPosts >= p.narrative.minPosts) return 'shown';
  return goodPosts === 1 && single ? 'shown' : 'too_few_posts';
}

/* ── the coin ─────────────────────────────────────────────────────────── */

export interface NarrativeMemberCoin {
  readonly itemId: string;
  /** The owner's own coin on the post ("This is the coin"), or the coin he confirmed for its story. */
  readonly confirmed: { readonly address: string; readonly atMs: number } | null;
  /** The coin the post's own evidence proves (it links the post, the same picture after it…). */
  readonly proven: string | null;
  /** The post's plausible coins by its name ("See N coins"), best first; null when not searched yet. */
  readonly listed: readonly string[] | null;
}

export type NarrativeCoin =
  | { readonly kind: 'confirmed'; readonly address: string }
  | { readonly kind: 'proven'; readonly addresses: readonly string[] }
  | { readonly kind: 'fitting'; readonly addresses: readonly string[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'pending' };

/**
 * ★ THE NARRATIVE'S COIN, IN THE OWNER'S ORDER (2026-10-16): the coin he confirmed for it — on the
 * narrative itself, newest first, else on one of its posts or their story — then a coin its posts'
 * own evidence proves (the one most posts prove; two proven equally often are both shown, never
 * one picked), else its top fitting coins by the "See N coins" rule: every post's plausible list,
 * the coins most posts list first, at most `maxListed`. A coin the owner called wrong on the
 * narrative is never any of these. No post searched yet is `pending`, a dash — not "no coin".
 */
export function narrativeCoin(
  members: readonly NarrativeMemberCoin[],
  call: NarrativeCoinCall | null,
  maxListed: number,
): NarrativeCoin {
  const wrong = call?.wrong ?? new Map<string, number>();
  if (call?.right !== null && call?.right !== undefined && !wrong.has(call.right.address)) return { kind: 'confirmed', address: call.right.address };
  const confirmed = members
    .map((m) => m.confirmed)
    .filter((c): c is { address: string; atMs: number } => c !== null && !wrong.has(c.address))
    .sort((a, b) => b.atMs - a.atMs)[0];
  if (confirmed !== undefined) return { kind: 'confirmed', address: confirmed.address };
  const provenBy = new Map<string, number>();
  for (const m of members) if (m.proven !== null && !wrong.has(m.proven)) provenBy.set(m.proven, (provenBy.get(m.proven) ?? 0) + 1);
  if (provenBy.size > 0) {
    const most = Math.max(...provenBy.values());
    return { kind: 'proven', addresses: [...provenBy].filter(([, c]) => c === most).map(([a]) => a).sort() };
  }
  const listedBy = new Map<string, { count: number; best: number }>();
  let searched = false;
  for (const m of members) {
    if (m.listed === null) continue;
    searched = true;
    m.listed.forEach((a, i) => {
      if (wrong.has(a)) return;
      const have = listedBy.get(a) ?? { count: 0, best: i };
      listedBy.set(a, { count: have.count + 1, best: Math.min(have.best, i) });
    });
  }
  if (listedBy.size > 0) {
    const addresses = [...listedBy].sort((x, y) => y[1].count - x[1].count || x[1].best - y[1].best || x[0].localeCompare(y[0])).slice(0, maxListed).map(([a]) => a);
    return { kind: 'fitting', addresses };
  }
  return searched ? { kind: 'none' } : { kind: 'pending' };
}

/* ── views ────────────────────────────────────────────────────────────── */

export interface MemberReach {
  /** When the post went up; null when the source gave no time. */
  readonly postedAtMs: number | null;
  /** Its view counts as read, any order; a null count is a reading that carried none. */
  readonly points: readonly ReachPoint[];
}

/** Views gained in each `stepMs` slot from `fromMs` to now; null where no post was being read. */
export interface GainedSeries {
  readonly fromMs: number;
  readonly stepMs: number;
  readonly values: readonly (number | null)[];
}

export interface NarrativeReach {
  /** The posts' gains added up, slot by slot, over the last `reach.spanMs`. Leading empty slots dropped. */
  readonly gained: GainedSeries;
  /** Each post's newest count, summed; null when no post has one. `counted` of `of` posts had one. */
  readonly total: { readonly value: number | null; readonly counted: number; readonly of: number };
  /** Views gained over the last `reach.gainWindowMs`, the same per-post sum; `counted` posts had a reading. */
  readonly lastHour: { readonly value: number | null; readonly counted: number; readonly of: number };
  /** Per post, in the members' order: its newest count and its own last-hour gain (null: never read). */
  readonly posts: readonly { readonly total: number | null; readonly lastHour: number | null }[];
}

/** One post's gains as runs between consecutive counted readings: [fromMs, toMs, views gained]. */
function gainRuns(points: readonly ReachPoint[]): { readonly runs: readonly (readonly [number, number, number])[]; readonly first: number | null; readonly last: number | null; readonly newest: number | null } {
  const pts = points.filter((x): x is { atMs: number; reach: number } => x.reach !== null).sort((a, b) => a.atMs - b.atMs);
  const runs: [number, number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined || b.atMs <= a.atMs) continue;
    /* A lower count than the one before is the source re-counting, not views lost: it adds nothing. */
    runs.push([a.atMs, b.atMs, Math.max(0, b.reach - a.reach)]);
  }
  return { runs, first: pts[0]?.atMs ?? null, last: pts[pts.length - 1]?.atMs ?? null, newest: pts[pts.length - 1]?.reach ?? null };
}

/** The part of a run's gain that falls in [from, to): spread evenly over the run's own time. */
function gainIn(run: readonly [number, number, number], from: number, to: number): number {
  const overlap = Math.min(run[1], to) - Math.max(run[0], from);
  return overlap <= 0 ? 0 : (run[2] * overlap) / (run[1] - run[0]);
}

/**
 * ★ PER POST, THEN ADDED UP (the owner, 2026-10-17). A post's gain between two of its readings is
 * spread evenly over the time between them (some sources are read less often, so one late jump
 * becomes the slope it was); before its first reading and after its last it adds nothing, never a
 * guess forward. So a post found late with a million views adds no spike: its gain counts from its
 * first reading. A slot no post was being read in (no reading in it and no run across it) is null,
 * an outage or the time before anything was read, never a zero. The total is every post's newest
 * count; how many posts had any reading is said beside the total and the last hour.
 */
export function narrativeReach(members: readonly MemberReach[], nowMs: number, p: Policy): NarrativeReach {
  const r = p.narrative.reach;
  const posts = members.map((m) => gainRuns(m.points));
  const slots = Math.floor(r.spanMs / r.stepMs);
  const start = nowMs - slots * r.stepMs;
  const values: (number | null)[] = [];
  for (let i = 0; i < slots; i++) {
    const from = start + i * r.stepMs;
    const to = from + r.stepMs;
    let sum = 0;
    let read = false;
    for (const g of posts) {
      if (g.first === null || g.last === null || g.last < from || g.first >= to) continue;
      read = true;
      for (const run of g.runs) sum += gainIn(run, from, to);
    }
    values.push(read ? Math.round(sum) : null);
  }
  const lead = values.findIndex((v) => v !== null);
  const gained = lead < 0 ? { fromMs: nowMs, stepMs: r.stepMs, values: [] } : { fromMs: start + lead * r.stepMs, stepMs: r.stepMs, values: values.slice(lead) };

  const hourFrom = nowMs - r.gainWindowMs;
  const perPost = posts.map((g) => ({
    total: g.newest,
    lastHour: g.first === null ? null : Math.round(g.runs.reduce((s, run) => s + gainIn(run, hourFrom, nowMs), 0)),
  }));
  const counted = perPost.filter((x) => x.total !== null);
  /* The hour is a number only when some post was being read in it: otherwise nobody read anything then. */
  const readInHour = posts.some((g) => g.first !== null && g.last !== null && g.last >= hourFrom);
  return {
    gained,
    total: { value: counted.length === 0 ? null : counted.reduce((a, b) => a + (b.total ?? 0), 0), counted: counted.length, of: members.length },
    lastHour: { value: readInHour ? perPost.reduce((a, b) => a + (b.lastHour ?? 0), 0) : null, counted: counted.length, of: members.length },
    posts: perPost,
  };
}

/**
 * Views gained in [fromMs, toMs) by the same per-post rule as `narrativeReach` (each post's gain
 * spread evenly between its own readings, nothing outside them), added up. Null when no post was
 * being read in the span at all — an outage, or before anything was read — never a zero. `counted`
 * posts were being read in it. The trending order's windows and the "All" line use this.
 */
export function reachGained(members: readonly MemberReach[], fromMs: number, toMs: number): { readonly value: number | null; readonly counted: number } {
  let sum = 0;
  let counted = 0;
  for (const m of members) {
    const g = gainRuns(m.points);
    if (g.first === null || g.last === null || g.last < fromMs || g.first >= toMs) continue;
    counted += 1;
    for (const run of g.runs) sum += gainIn(run, fromMs, toMs);
  }
  return { value: counted === 0 ? null : Math.round(sum), counted };
}

/**
 * The same gains in `stepMs` slots from `fromMs` to `nowMs` (the page's "All" line): the first slot
 * starts at or before `fromMs` on the step's grid ending at now. A slot no post was being read in is
 * null. The caller bounds the span; this never makes more than `maxSlots`.
 */
export function gainedSeries(members: readonly MemberReach[], fromMs: number, nowMs: number, stepMs: number, maxSlots: number): GainedSeries {
  const slots = Math.min(maxSlots, Math.max(1, Math.ceil((nowMs - fromMs) / stepMs)));
  const start = nowMs - slots * stepMs;
  const posts = members.map((m) => gainRuns(m.points));
  const values: (number | null)[] = [];
  for (let i = 0; i < slots; i++) {
    const from = start + i * stepMs;
    const to = from + stepMs;
    let sum = 0;
    let read = false;
    for (const g of posts) {
      if (g.first === null || g.last === null || g.last < from || g.first >= to) continue;
      read = true;
      for (const run of g.runs) sum += gainIn(run, from, to);
    }
    values.push(read ? Math.round(sum) : null);
  }
  const lead = values.findIndex((v) => v !== null);
  return lead < 0 ? { fromMs: nowMs, stepMs, values: [] } : { fromMs: start + lead * stepMs, stepMs, values: values.slice(lead) };
}
