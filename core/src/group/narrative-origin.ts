/**
 * THE STARTING POST, AND ONE STORY ACROSS LANGUAGES — which earlier stored post started a narrative,
 * and which narratives already made are one story told from two sides.
 *
 * The owner, 2026-10-23: "find the posts that START the narratives first". The Chinese–Turkish meme
 * war began with @BarkinResmii's Turkish post (19 Oct, 4.95M views) and @LeLeluax's Chinese one (19
 * Oct, 8.9M), both judged yes. Four days later the English chatter about it formed four narratives
 * ("Turkey and China Meme War", "Cat Named Calajo", "Lele Starts China ... War", "Man Predicted
 * 2026 Meme War") and neither origin post joined any: the regroup links posts at most `maxGapMs` (a
 * day) apart, and the early step (narrative-early.ts) follows a story back one such link at a time,
 * so a post four days older, in another language, at 0.64, never joins. What did tie them is a fact
 * about the world, not a closeness: the English posts QUOTE the origin posts, and quote each other.
 *
 *   trace   a stored post, judged yes or tied to a coin (the caller's `eligible`), from before the
 *           narrative's first post and at most `origin.lookbackMs` before it, joins the narrative:
 *             quoted  one of its posts quotes or links it, at most `maxHops` steps away (through any
 *                     post, judged or not), and it is at `linkMeaning` from the narrative's average
 *                     — a narrative's post quoting an unrelated big post is not its start
 *             name    it shares a name with one of its posts (the judge's names, the same-subject
 *                     rule's form) at `narrative.nameMeaning`, the regroup's own shared-name bar, and
 *                     the narrative's average at `nameAverage`; no gap limit, the lookback is the bound
 *             picture its picture is the same as one of its posts' (`group.image.likely`), at
 *                     `narrative.nameMeaning`
 *           The earliest post a narrative holds is then its starting post (the projector says
 *           "Started by" only when its own posts quote it — services/project `projectEarliestPost`).
 *   merge   two narratives formed within `formedWithinMs`, whose averages are at `mergeMeaning`,
 *           are one story when they quote the same judged starting post, or when quotes join them
 *           through at least `minLinkPosts` of their posts. The newer merges into the older.
 *
 * ★ NO MERGE ON A NAME OR A COIN ALONE. Measured 2026-10-23 over five days of live narratives: a
 * shared coin joined "France Protests" (212 posts) to "Viral Cats and Dogs" (82) and a dozen more
 * blobs, and names alone are what folded 89 narratives into "viral cat" on 16-18 Oct. A single quote
 * is not enough either — "Gigadog" quoting a "Pitbull Dan" post to compare them (0.65), a pill post
 * quoting an AI lab's (0.66) — so one quote between two posts needs a third post behind it.
 *
 * Pure: the runner reads the posts, their links and vectors; this decides. Never a narrative the
 * owner made a call on (`untouchable`), and never a post he removed from beside, or kept apart from,
 * the narrative's posts.
 *
 * What breaks if changed carelessly: the shared start's own age. Two narratives quoting the same
 * three-year-old famous post are not one story ("Larp Final Boss" and "Tinfoil Cat" both quote one
 * from 2023); only a post inside the lookback, that the judge passed or a coin is tied to, is a
 * shared start.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { pairKey, type NarrativeCalls, type NarrativePost } from './narrative.ts';
import { subjectName } from './narrative-same.ts';
import { clearsReachBar, type ReachLevel } from '../qualify/reach-bar.ts';

export type OriginTie = 'quoted' | 'picture' | 'name';

export interface OriginNarrative {
  readonly id: string;
  readonly members: readonly string[];
  /** When it was first shown (or made): two narratives formed far apart are never merged by this. */
  readonly formedAtMs: number;
}

export interface OriginInput {
  readonly narratives: readonly OriginNarrative[];
  /** Every post named here: the narratives' posts and every post that may be taken. */
  readonly posts: ReadonlyMap<string, NarrativePost>;
  /** Every post named here that is already in an open narrative, and which. */
  readonly narrativeOf: ReadonlyMap<string, string>;
  /** Each post's quoted and linked posts of the same source (internal.post_reference); absent: never read. */
  readonly refs: ReadonlyMap<string, readonly string[]>;
  /** The posts that may be taken as a starting post: judged yes or tied to a coin, never "Not a meme". */
  readonly eligible: ReadonlySet<string>;
  /** Per narrative, the stored eligible posts sharing a name or topic word with one of its posts (core `earlyShortlist`). */
  readonly shortlist: ReadonlyMap<string, readonly string[]>;
  readonly vectors: ReadonlyMap<string, ArrayLike<number>>;
  readonly pictures: ReadonlyMap<string, ArrayLike<number>>;
  readonly calls: NarrativeCalls;
  /** The narratives the owner made a call on: never merged, never merged into. */
  readonly untouchable: ReadonlySet<string>;
}

export interface StoryMerge {
  readonly from: string;
  readonly into: string;
  readonly meaning: number;
  readonly why: 'shared_start' | 'quotes';
  /** The posts that tie them: the shared start, or the posts the quotes join. */
  readonly via: readonly string[];
}

export interface TracedPost {
  readonly itemId: string;
  readonly tie: OriginTie;
}

export interface StoryPlan {
  readonly merges: readonly StoryMerge[];
  /** Per narrative that leads after the merges: the earlier posts it takes, earliest first. */
  readonly starts: ReadonlyMap<string, readonly TracedPost[]>;
}

/** Every post `from` quotes or links, at most `maxHops` steps away (never itself). */
export function linkReach(from: string, refs: ReadonlyMap<string, readonly string[]>, maxHops: number): ReadonlySet<string> {
  const out = new Set<string>();
  let front = [from];
  for (let hop = 0; hop < maxHops && front.length > 0; hop += 1) {
    const next: string[] = [];
    for (const x of front) for (const y of refs.get(x) ?? []) if (y !== from && !out.has(y)) {
      out.add(y);
      next.push(y);
    }
    front = next;
  }
  return out;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
};

/** The unit average of the posts' vectors; null when none has one. */
function averageOf(members: readonly string[], vectors: ReadonlyMap<string, ArrayLike<number>>): Float64Array | null {
  let sum: Float64Array | null = null;
  for (const m of members) {
    const v = vectors.get(m);
    if (v === undefined) continue;
    sum ??= new Float64Array(v.length);
    for (let i = 0; i < v.length && i < sum.length; i += 1) sum[i] = (sum[i] ?? 0) + (v[i] ?? 0);
  }
  if (sum === null) return null;
  const norm = Math.sqrt(dot(sum, sum));
  if (norm === 0) return null;
  for (let i = 0; i < sum.length; i += 1) sum[i] = (sum[i] ?? 0) / norm;
  return sum;
}

const TIE_ORDER: Readonly<Record<OriginTie, number>> = { quoted: 0, picture: 1, name: 2 };

/**
 * The merges and each lead narrative's earlier posts. Narratives are merged first, so a starting
 * post two narratives quote goes to the one they become.
 */
export function traceStories(input: OriginInput, p: Policy): StoryPlan {
  const o = p.narrative.origin;
  if (!o.on) return { merges: [], starts: new Map() };
  const n = p.narrative;
  const atOf = (id: string): number | null => input.posts.get(id)?.atMs ?? null;
  const oldestOf = (members: readonly string[]): number => Math.min(...members.map((m) => atOf(m) ?? Number.POSITIVE_INFINITY));
  const byId = new Map(input.narratives.map((x) => [x.id, x] as const));

  /* What each narrative's posts quote: a post in another narrative, or a post in none (by which of its own posts). */
  const linksIn = new Map<string, Map<string, Set<string>>>(); // narrative → other narrative → posts involved
  const reachedBy = new Map<string, Map<string, Set<string>>>(); // outside post → narrative → its posts reaching it
  for (const x of input.narratives) {
    for (const m of x.members) {
      for (const r of linkReach(m, input.refs, o.maxHops)) {
        const other = input.narrativeOf.get(r);
        if (other === x.id) continue;
        if (other !== undefined) {
          const per = linksIn.get(x.id) ?? new Map<string, Set<string>>();
          per.set(other, new Set([...(per.get(other) ?? []), m, r]));
          linksIn.set(x.id, per);
        } else {
          const per = reachedBy.get(r) ?? new Map<string, Set<string>>();
          per.set(x.id, new Set([...(per.get(x.id) ?? []), m]));
          reachedBy.set(r, per);
        }
      }
    }
  }

  /* An outside post is a starting post for a narrative when it is eligible, earlier than the narrative's first post and inside the lookback. */
  const startable = (post: string, members: readonly string[]): boolean => {
    const at = atOf(post);
    const first = oldestOf(members);
    return input.eligible.has(post) && at !== null && at < first && at >= first - o.lookbackMs;
  };

  /* ── merge ── */
  const evidence = new Map<string, { a: string; b: string; posts: Set<string>; shared: Set<string> }>();
  const note = (a: string, b: string, posts: Iterable<string>, shared: string | null) => {
    if (a === b) return;
    const k = pairKey(a, b);
    const e = evidence.get(k) ?? { a: a < b ? a : b, b: a < b ? b : a, posts: new Set<string>(), shared: new Set<string>() };
    for (const x of posts) e.posts.add(x);
    if (shared !== null) e.shared.add(shared);
    evidence.set(k, e);
  };
  for (const [a, per] of linksIn) for (const [b, posts] of per) if (byId.has(b)) note(a, b, posts, null);
  for (const [r, per] of reachedBy) {
    const ids = [...per.keys()].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i] ?? '';
        const b = ids[j] ?? '';
        const xa = byId.get(a);
        const xb = byId.get(b);
        if (xa === undefined || xb === undefined) continue;
        const shared = startable(r, xa.members) || startable(r, xb.members) ? r : null;
        note(a, b, [...(per.get(a) ?? []), ...(per.get(b) ?? [])], shared);
      }
    }
  }
  /* Which pairs the evidence allows, before any closeness: the owner's calls and the formed times. */
  const allowed = [...evidence.values()].filter((e) => {
    const xa = byId.get(e.a);
    const xb = byId.get(e.b);
    if (!o.mergeOn || xa === undefined || xb === undefined) return false;
    if (input.untouchable.has(e.a) || input.untouchable.has(e.b)) return false;
    if (Math.abs(xa.formedAtMs - xb.formedAtMs) > o.formedWithinMs) return false;
    return e.shared.size > 0 || e.posts.size >= o.minLinkPosts;
  });
  const into = new Map<string, string>();
  const lead = (id: string): string => {
    let at = id;
    for (let next = into.get(at); next !== undefined; next = into.get(at)) at = next;
    return at;
  };
  const membersOf = new Map(input.narratives.map((x) => [x.id, [...x.members]] as const));
  const merges: StoryMerge[] = [];
  /* ★ ONE MERGE AT A TIME, CLOSENESS READ ON WHAT EACH SIDE HAS BECOME: "Lele Starts China
     ... War" is 0.53 from "Cat Named Calajo" alone and 0.69 from the meme war it is part of, once Calajo
     and the others have joined it. The strongest pair goes first (a shared start, then the closest).
     Each round merges two narratives into one, so it ends after at most as many rounds as pairs. */
  for (let round = 0; round < allowed.length; round += 1) {
    let best: { a: string; b: string; meaning: number; why: StoryMerge['why']; via: string[] } | null = null;
    for (const e of allowed) {
      const a = lead(e.a);
      const b = lead(e.b);
      if (a === b) continue;
      const va = averageOf(membersOf.get(a) ?? [], input.vectors);
      const vb = averageOf(membersOf.get(b) ?? [], input.vectors);
      if (va === null || vb === null) continue;
      const meaning = dot(va, vb);
      if (meaning < o.mergeMeaning) continue;
      const why: StoryMerge['why'] = e.shared.size > 0 ? 'shared_start' : 'quotes';
      const better =
        best === null ||
        (why === 'shared_start' && best.why === 'quotes') ||
        (why === best.why && (meaning > best.meaning || (meaning === best.meaning && `${a} ${b}` < `${best.a} ${best.b}`)));
      if (better) best = { a, b, meaning, why, via: why === 'shared_start' ? [...e.shared].sort() : [...e.posts].sort() };
    }
    if (best === null) break;
    const ma = membersOf.get(best.a) ?? [];
    const mb = membersOf.get(best.b) ?? [];
    /* The newer merges into the older (by its first post), so a story's first post and its link stay. */
    const older = oldestOf(ma) < oldestOf(mb) || (oldestOf(ma) === oldestOf(mb) && best.a < best.b) ? best.a : best.b;
    const newer = older === best.a ? best.b : best.a;
    into.set(newer, older);
    membersOf.set(older, [...(membersOf.get(older) ?? []), ...(membersOf.get(newer) ?? [])]);
    merges.push({ from: newer, into: older, meaning: best.meaning, why: best.why, via: best.via });
  }

  /* ── trace: each narrative's ties, then given to where it leads ── */
  const best = new Map<string, { narrative: string; tie: OriginTie; formedAtMs: number }>();
  const offer = (narrative: string, post: string, tie: OriginTie) => {
    const lid = lead(narrative);
    const members = membersOf.get(lid) ?? [];
    if (input.narrativeOf.has(post) || !startable(post, members)) return;
    /* The owner's calls: removed from beside these posts, or kept apart from one of them. */
    const set = new Set(members);
    if ([...(input.calls.removed.get(post) ?? [])].some((x) => set.has(x))) return;
    if (members.some((m) => input.calls.apart.has(pairKey(post, m)))) return;
    const formedAtMs = byId.get(lid)?.formedAtMs ?? 0;
    const had = best.get(post);
    if (had === undefined || TIE_ORDER[tie] < TIE_ORDER[had.tie] || (TIE_ORDER[tie] === TIE_ORDER[had.tie] && (formedAtMs < had.formedAtMs || (formedAtMs === had.formedAtMs && lid < had.narrative)))) {
      best.set(post, { narrative: lid, tie, formedAtMs });
    }
  };
  const averages = new Map<string, Float64Array | null>();
  const leadAverage = (id: string): Float64Array | null => {
    if (!averages.has(id)) averages.set(id, averageOf(membersOf.get(id) ?? [], input.vectors));
    return averages.get(id) ?? null;
  };
  for (const [r, per] of reachedBy) {
    for (const id of per.keys()) {
      const avg = leadAverage(lead(id));
      const v = input.vectors.get(r);
      if (avg === null || v === undefined || dot(v, avg) < o.linkMeaning) continue;
      offer(id, r, 'quoted');
    }
  }
  for (const x of input.narratives) {
    const avg = averageOf(x.members, input.vectors);
    if (avg === null) continue;
    const own = x.members.flatMap((m) => {
      const post = input.posts.get(m);
      return post === undefined ? [] : [{ id: m, names: new Set(post.names.map((nm) => subjectName(nm, p)).filter((s): s is string => s !== null)), v: input.vectors.get(m), pic: input.pictures.get(m) }];
    });
    for (const c of input.shortlist.get(x.id) ?? []) {
      const post = input.posts.get(c);
      const v = input.vectors.get(c);
      if (post === undefined || v === undefined) continue;
      const names = post.names.map((nm) => subjectName(nm, p)).filter((s): s is string => s !== null);
      const pic = input.pictures.get(c);
      const samePicture = pic !== undefined && own.some((m) => m.pic !== undefined && m.v !== undefined && dot(pic, m.pic) >= p.group.image.likely && dot(v, m.v) >= n.nameMeaning);
      if (samePicture) {
        offer(x.id, c, 'picture');
        continue;
      }
      const sameName = dot(v, avg) >= o.nameAverage && own.some((m) => m.v !== undefined && names.some((nm) => m.names.has(nm)) && dot(v, m.v) >= n.nameMeaning);
      if (sameName) offer(x.id, c, 'name');
    }
  }
  const starts = new Map<string, TracedPost[]>();
  for (const [post, b] of best) starts.set(b.narrative, [...(starts.get(b.narrative) ?? []), { itemId: post, tie: b.tie }]);
  const at = (t: TracedPost) => atOf(t.itemId) ?? 0;
  return {
    merges,
    starts: new Map([...starts].map(([id, list]) => [id, list.sort((a, b) => TIE_ORDER[a.tie] - TIE_ORDER[b.tie] || at(a) - at(b) || a.itemId.localeCompare(b.itemId)).slice(0, o.maxPerNarrative).sort((a, b) => at(a) - at(b) || a.itemId.localeCompare(b.itemId))] as const)),
  };
}

/**
 * ★ A NARRATIVE STANDS ON A VIRAL POST (the owner, 2026-10-23: "new narratives that are not based on
 * viral X posts and the posts themselves have low views" — 60, 25 and 9 views in all). A narrative is
 * listed only while at least one of its posts clears For You's own views bar (core `clearsReachBar`,
 * 'fyp': the total, or a growth path while young), so a small post can join a viral story but two
 * small posts are never one. A viral starting post traced back late counts like any of its posts.
 * `scale` is each post's bar scale (the short-video source's own); an unread post never clears.
 */
export function standsOnViralPost(posts: readonly { readonly readings: readonly ReachLevel[]; readonly postedAtMs: number | null; readonly scale: number }[], p: Policy): boolean {
  if (!p.narrative.origin.viralFloor) return true;
  return posts.some((x) => clearsReachBar('fyp', x.readings, x.postedAtMs, p, x.scale));
}

/** How long after a post its growth-path readings matter: the longest window the views bar looks in. */
export const barWindowMs = (p: Policy): number => {
  const r = p.rising;
  return Math.max(r.fypEarlyWindowMs, r.fypFastWindowMs, r.speedBar.horizonMs, r.shortVideoEarlyWindowMs, r.shortVideoFastWindowMs);
};
