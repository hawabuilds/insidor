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
 *             root    the judge did NOT pass it (the caller's `rootable`: said no, or never asked), but
 *                     at least `rootMinQuoters` posts quote it — the narrative's, or viral loose posts
 *                     at `linkMeaning` that then join through it — and it is at `rootMeaning`
 *                     (policy.v145: @liistrk's "végéta est algérien" post, 14.9M views, judged "not a
 *                     meme" on its words alone, quoted by the Japanese and French posts it set off)
 *           The earliest post a narrative holds is then its starting post (the projector says
 *           "Started by" only when its own posts quote it — services/project `projectEarliestPost`).
 *   join    a good post in no narrative (the caller's `loose`) joins the narrative whose posts or
 *           starting posts it quotes, or whose rare phrase it says (narrative-phrase.ts), at any
 *           time — not only before its first post (see `joinLoose`).
 *   merge   two narratives formed within `formedWithinMs`, whose averages are at `mergeMeaning`,
 *           are one story when they quote the same judged starting post, or when quotes join them
 *           through at least `minLinkPosts` of their posts — or (policy.v149, `words*`) when both
 *           say the same rare words of their own, are alike at `wordsMeaning` and formed within
 *           `wordsFormedWithinMs` (the Yotsuya goats, see `wordsEvidence`). The newer merges into the
 *           older, so the merged story's first post is the earliest of all its sides.
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
 * ★ BUT A NARRATIVE HE MERGED STILL GROWS (`receiveOnly`, 2026-10-23). Once he merged the war's
 * narratives into one, it was untouchable, so a new narrative quoting its posts the next day could
 * never join it — the merge he made froze the story. A narrative in `receiveOnly` is never merged
 * away and never merged by a rule into anything, but a newer narrative may be merged INTO it on the
 * same evidence, unless that would put back together posts he kept apart or removed from beside each
 * other. For it, "formed within `formedWithinMs`" is read against its newest post rather than when
 * it formed: a story he merged days ago that is still being posted is live, not old.
 *
 * What breaks if changed carelessly: the shared start's own age. Two narratives quoting the same
 * three-year-old famous post are not one story ("Larp Final Boss" and "Tinfoil Cat" both quote one
 * from 2023); only a post inside the lookback, that the judge passed or a coin is tied to, is a
 * shared start.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { pairKey, type NarrativeCalls, type NarrativePost } from './narrative.ts';
import { contentWords, phrasesOf, rarePhrases, storyWords } from './narrative-phrase.ts';
import { subjectName } from './narrative-same.ts';
import { clearsReachBar, type ReachLevel } from '../qualify/reach-bar.ts';

export type OriginTie = 'quoted' | 'root' | 'picture' | 'name' | 'phrase' | 'words';

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
  /** The narratives the owner made a call on: never merged, never merged into (but see `receiveOnly`). */
  readonly untouchable: ReadonlySet<string>;
  /**
   * Posts the judge did not pass (said no, or never asked) that may still START a narrative as its
   * quote root (`origin.root*`): several of its posts quote it. Never the owner's "Not a meme", a
   * shill or a held kind (the caller's to leave out). Absent: none.
   */
  readonly rootable?: ReadonlySet<string>;
  /**
   * Good posts in no narrative that may JOIN one at any time (`origin.join*`): the window's posts
   * the regroup left alone, and the owner's pasted posts. Absent: none.
   */
  readonly loose?: readonly string[];
  /** More words of a post, for its phrases: its stored English translation. Absent: its own words only. */
  readonly english?: ReadonlyMap<string, string>;
  /** Of `loose`, the posts that clear For You's views bar (`origin.joinViral`). */
  readonly looseViral?: ReadonlySet<string>;
  /**
   * Each post's quoted post (public.item `reproduction_of`), read beside `refs` for the starts, the
   * roots and the joins — never for the merges, which read `refs` alone. Absent: `refs` only.
   */
  readonly reproductions?: ReadonlyMap<string, readonly string[]>;
  /** Of `untouchable`, the ones a newer narrative may still be merged into (the owner's merged and called narratives). Absent: none. */
  readonly receiveOnly?: ReadonlySet<string>;
  /** Narratives the single-word join never adds to (the meme wars, whose own rules hold). Absent: none. */
  readonly noWordsJoin?: ReadonlySet<string>;
}

/** `refs` with each post's quoted post added: what the starts, roots and joins follow. */
export function withReproductions(refs: ReadonlyMap<string, readonly string[]>, reproductions: ReadonlyMap<string, readonly string[]> | undefined): ReadonlyMap<string, readonly string[]> {
  if (reproductions === undefined || reproductions.size === 0) return refs;
  const out = new Map(refs);
  for (const [id, qs] of reproductions) out.set(id, [...new Set([...qs, ...(refs.get(id) ?? [])])].filter((q) => q !== id));
  return out;
}

export interface StoryMerge {
  readonly from: string;
  readonly into: string;
  readonly meaning: number;
  readonly why: 'shared_start' | 'quotes' | 'words';
  /** The posts that tie them: the shared start, the posts the quotes join, or the posts saying the shared words. */
  readonly via: readonly string[];
  /** `words` only: the rare words both narratives say. */
  readonly words?: readonly string[];
}

export interface TracedPost {
  readonly itemId: string;
  readonly tie: OriginTie;
}

export interface StoryPlan {
  readonly merges: readonly StoryMerge[];
  /** Per narrative that leads after the merges: the earlier posts it takes, earliest first. */
  readonly starts: ReadonlyMap<string, readonly TracedPost[]>;
  /** Per narrative that leads after the merges: the loose posts that join it (quoted or same words), earliest first. Absent: none. */
  readonly joins?: ReadonlyMap<string, readonly TracedPost[]>;
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

const TIE_ORDER: Readonly<Record<OriginTie, number>> = { quoted: 0, root: 1, picture: 2, name: 3, phrase: 4, words: 5 }; // policy-allow: an order of preference, not a threshold

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
  const reachOver = (refs: ReadonlyMap<string, readonly string[]>) => {
    const linksIn = new Map<string, Map<string, Set<string>>>(); // narrative → other narrative → posts involved
    const reachedBy = new Map<string, Map<string, Set<string>>>(); // outside post → narrative → its posts reaching it
    for (const x of input.narratives) {
      for (const m of x.members) {
        for (const r of linkReach(m, refs, o.maxHops)) {
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
    return { linksIn, reachedBy };
  };
  /* ★ The merges read the links alone, as they were measured (policy.v143); the starts and the joins
     read the quotes too (`reproductions`, policy.v145). With the quotes, the 5-day replay of 23 Oct merged
     nine pairs instead of two — some plainly one story, some not — so the merge keeps its evidence. */
  const { linksIn, reachedBy } = reachOver(input.refs);
  const traceRefs = withReproductions(input.refs, input.reproductions);
  const traced = input.reproductions === undefined || input.reproductions.size === 0 ? reachedBy : reachOver(traceRefs).reachedBy;

  /* An outside post is a starting post for a narrative when it is eligible (or a quote root), earlier than the narrative's first post and inside the lookback. */
  const startable = (post: string, members: readonly string[], asRoot = false): boolean => {
    const at = atOf(post);
    const first = oldestOf(members);
    return (asRoot || input.eligible.has(post)) && at !== null && at < first && at >= first - o.lookbackMs;
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
  const receives = (id: string): boolean => input.receiveOnly?.has(id) ?? false;
  const fixed = (id: string): boolean => input.untouchable.has(id) && !receives(id);
  const newestOf = (members: readonly string[]): number => Math.max(...members.map((m) => atOf(m) ?? Number.NEGATIVE_INFINITY));
  const allowed = [...evidence.values()].filter((e) => {
    const xa = byId.get(e.a);
    const xb = byId.get(e.b);
    if (!o.mergeOn || xa === undefined || xb === undefined) return false;
    if (fixed(e.a) || fixed(e.b) || (input.untouchable.has(e.a) && input.untouchable.has(e.b))) return false;
    /* A narrative the owner called is live while it is posted to: its newest post, not when it formed. */
    const when = (x: OriginNarrative, other: OriginNarrative): number => (receives(x.id) ? Math.min(Math.max(x.formedAtMs, newestOf(x.members)), other.formedAtMs) : x.formedAtMs);
    if (Math.abs(when(xa, xb) - when(xb, xa)) > o.formedWithinMs) return false;
    return e.shared.size > 0 || e.posts.size >= o.minLinkPosts;
  });
  /* ★ THE MERGE ON THE STORY'S OWN WORDS (`origin.words*`, policy.v149) — see `wordsEvidence`. */
  const said = wordsEvidence(input, p);
  type Candidate = { readonly a: string; readonly b: string; readonly why: StoryMerge['why']; readonly bar: number; readonly via: readonly string[]; readonly words?: readonly string[] };
  const candidates: Candidate[] = [
    ...allowed.map((e): Candidate => (e.shared.size > 0 ? { a: e.a, b: e.b, why: 'shared_start', bar: o.mergeMeaning, via: [...e.shared].sort() } : { a: e.a, b: e.b, why: 'quotes', bar: o.mergeMeaning, via: [...e.posts].sort() })),
    ...said.map((w): Candidate => ({ a: w.a, b: w.b, why: 'words', bar: o.wordsMeaning, via: w.posts, words: w.words })),
  ];
  /* Strongest first: a shared start, then the links, then the words. */
  const STRENGTH: readonly StoryMerge['why'][] = ['shared_start', 'quotes', 'words'];
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
     and the others have joined it. The strongest pair goes first (a shared start, then quotes, then
     words; the closest within each). Each round merges two narratives into one, so it ends after at
     most as many rounds as pairs. */
  for (let round = 0; round < candidates.length; round += 1) {
    let best: (Candidate & { meaning: number }) | null = null;
    for (const e of candidates) {
      const a = lead(e.a);
      const b = lead(e.b);
      if (a === b) continue;
      /* The words' merge reads the owner's calls on each side as it now stands: a side may have grown by an earlier merge. */
      if (e.why === 'words' && keptApart(input.calls, membersOf.get(a) ?? [], membersOf.get(b) ?? [])) continue;
      const va = averageOf(membersOf.get(a) ?? [], input.vectors);
      const vb = averageOf(membersOf.get(b) ?? [], input.vectors);
      if (va === null || vb === null) continue;
      const meaning = dot(va, vb);
      if (meaning < e.bar) continue;
      /* A narrative the owner called only ever takes the newer one in, never against his calls. */
      if (input.untouchable.has(a) || input.untouchable.has(b)) {
        const ma = membersOf.get(a) ?? [];
        const mb = membersOf.get(b) ?? [];
        const newerOne = oldestOf(ma) < oldestOf(mb) || (oldestOf(ma) === oldestOf(mb) && a < b) ? b : a;
        if (input.untouchable.has(newerOne) || keptApart(input.calls, ma, mb)) continue;
      }
      const better =
        best === null ||
        STRENGTH.indexOf(e.why) < STRENGTH.indexOf(best.why) ||
        (e.why === best.why && (meaning > best.meaning || (meaning === best.meaning && `${a} ${b}` < `${best.a} ${best.b}`)));
      if (better) best = { ...e, a, b, meaning };
    }
    if (best === null) break;
    const ma = membersOf.get(best.a) ?? [];
    const mb = membersOf.get(best.b) ?? [];
    /* The newer merges into the older (by its first post), so a story's first post and its link stay. */
    const older = oldestOf(ma) < oldestOf(mb) || (oldestOf(ma) === oldestOf(mb) && best.a < best.b) ? best.a : best.b;
    const newer = older === best.a ? best.b : best.a;
    into.set(newer, older);
    membersOf.set(older, [...(membersOf.get(older) ?? []), ...(membersOf.get(newer) ?? [])]);
    merges.push({ from: newer, into: older, meaning: best.meaning, why: best.why, via: [...best.via], ...(best.words === undefined ? {} : { words: [...best.words] }) });
  }

  /* ── trace: each narrative's ties, then given to where it leads ── */
  const best = new Map<string, { narrative: string; tie: OriginTie; formedAtMs: number }>();
  /* The owner's calls: removed from beside these posts, or kept apart from one of them. */
  const ownerKeepsOut = (post: string, members: readonly string[]): boolean => {
    const set = new Set(members);
    return [...(input.calls.removed.get(post) ?? [])].some((x) => set.has(x)) || members.some((m) => input.calls.apart.has(pairKey(post, m)));
  };
  const offer = (narrative: string, post: string, tie: OriginTie) => {
    const lid = lead(narrative);
    const members = membersOf.get(lid) ?? [];
    if (input.narrativeOf.has(post) || !startable(post, members, tie === 'root') || ownerKeepsOut(post, members)) return;
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
  /* ★ THE QUOTE ROOT (`origin.root*`, the owner, 2026-10-23): a post the judge said no to on its
     own words can still be the story's start when at least `rootMinQuoters` posts quote it, at most
     `maxHops` away — the narrative's own (after its merges), or loose posts that join through it —
     being what everyone reacts to is the evidence. "les japonais ils sont au courant que végéta est algérien ?" was judged "not a meme"
     alone; the Japanese and French posts quoting it are the meme. Its own bar to the average,
     `rootMeaning`: a words-only post reads far from the picture posts answering it (0.36). The
     caller holds it to the views bar like every start, so a small post quoted twice never is one. */
  const rootable = input.rootable ?? new Set<string>();
  /* The loose posts that could join, and what each quotes: a loose post quoting the root and close to
     the narrative counts as one of its quoters (it joins through the root, `joinLoose`). On 22 Oct the
     regroup made the narrative of @rayaneAlg00 and @Badr_13Block, and the Japanese post and
     @YanoxSaiyan's were left loose: only Badr's quote was a member's. */
  const joinable = o.rootOn && rootable.size > 0 ? looseJoinable(input, p) : [];
  const looseReach = new Map(joinable.map((c) => [c, linkReach(c, traceRefs, o.maxHops)] as const));
  const quotersOf = (post: string, lid: string): number => {
    const who = new Set<string>();
    for (const [id, ms] of traced.get(post) ?? []) if (lead(id) === lid) for (const m of ms) who.add(m);
    const avg = leadAverage(lid);
    for (const [c, reach] of looseReach) {
      const v = input.vectors.get(c);
      if (reach.has(post) && avg !== null && v !== undefined && dot(v, avg) >= o.linkMeaning) who.add(c);
    }
    return who.size;
  };
  for (const [r, per] of traced) {
    for (const id of per.keys()) {
      const avg = leadAverage(lead(id));
      const v = input.vectors.get(r);
      if (avg === null || v === undefined) continue;
      const meaning = dot(v, avg);
      if (input.eligible.has(r)) {
        if (meaning >= o.linkMeaning) offer(id, r, 'quoted');
      } else if (o.rootOn && rootable.has(r) && meaning >= o.rootMeaning && quotersOf(r, lead(id)) >= o.rootMinQuoters) {
        offer(id, r, 'root');
      }
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
  const kept = new Map([...starts].map(([id, list]) => [id, list.sort((a, b) => TIE_ORDER[a.tie] - TIE_ORDER[b.tie] || at(a) - at(b) || a.itemId.localeCompare(b.itemId)).slice(0, o.maxPerNarrative).sort((a, b) => at(a) - at(b) || a.itemId.localeCompare(b.itemId))] as const));
  return { merges, starts: kept, joins: joinLoose(input, p, { lead, membersOf, starts: kept, leadAverage, ownerKeepsOut, refs: traceRefs }) };
}

/** Whether the owner kept any post of one side apart from, or removed it from beside, a post of the other. */
function keptApart(calls: NarrativeCalls, as: readonly string[], bs: readonly string[]): boolean {
  return as.some((x) => bs.some((y) => calls.apart.has(pairKey(x, y)) || (calls.removed.get(x)?.has(y) ?? false) || (calls.removed.get(y)?.has(x) ?? false)));
}

/**
 * ★ ONE STORY BY ITS OWN WORDS (`origin.words*`, policy.v149; the owner, 2026-10-23: "they should all
 * come under one narrative"). JR East posted that goats were weeding in front of Yotsuya station (19
 * Oct, Japanese); by 23 Oct the posts about it sat in three narratives ("Japanese Goats Hired as
 * Grass Keepers", "Company Goats Become Office Pets", "JR Goats Work as Station Mascots"), all judged
 * yes, none quoting another. What ties them is what they SAY: ヤギ (goat), 除草 (weeding), 四ツ谷.
 *
 * The pairs of narratives that may merge on words, before any closeness (the caller holds each to
 * `wordsMeaning` on their averages, as each side stands after the merges before it):
 *
 *   rare      a word (narrative-phrase.ts `storyWords`: a phrase, or a two-character piece of a
 *             Japanese or Chinese run) is said by at most `phraseMaxShare` of the posts read, in their
 *             words or their stored English, and by at most `wordsMaxNarratives` of the narratives —
 *             a word many stories say marks none of them
 *   own       each side says it in at least `wordsMinCoverage` of its posts: one post of a 266-post
 *             blob saying "500k·views" does not make it the blob's word (measured: without this, a
 *             dozen stories were pulled into two blobs on such pairs)
 *   shared    the two narratives say at least `wordsMinShared` such words between them
 *   formed    within `wordsFormedWithinMs` of each other (first shown)
 *   calls     neither is one the owner made a call on, and no post of one is a post he kept apart
 *             from, or removed from beside, a post of the other
 *
 * ★ STILL NO MERGE ON A NAME OR A COIN. A judge's name or a coin's name is one word given to the posts;
 * these are several rare words the posts themselves say, AND close in meaning, AND days apart at most.
 */
function wordsEvidence(input: OriginInput, p: Policy): readonly { readonly a: string; readonly b: string; readonly words: readonly string[]; readonly posts: readonly string[] }[] {
  const o = p.narrative.origin;
  if (!o.on || !o.mergeOn || !o.wordsOn || input.narratives.length < 2) return [];
  const byId = new Map(input.narratives.map((x) => [x.id, x] as const));
  const wordsOf = new Map<string, ReadonlySet<string>>();
  for (const [id, post] of input.posts) wordsOf.set(id, storyWords([post.text, input.english?.get(id) ?? ''], p));
  const rare = rarePhrases(wordsOf.values(), p);
  /* Which narratives say each rare word, and by which of their posts. */
  const sayers = new Map<string, Map<string, string[]>>();
  for (const x of input.narratives) {
    for (const m of x.members) {
      for (const w of wordsOf.get(m) ?? []) {
        if (!rare.has(w)) continue;
        const per = sayers.get(w) ?? new Map<string, string[]>();
        per.set(x.id, [...(per.get(x.id) ?? []), m]);
        sayers.set(w, per);
      }
    }
  }
  const pairs = new Map<string, { a: string; b: string; words: Set<string>; posts: Set<string> }>();
  for (const [w, per] of sayers) {
    if (per.size < 2 || per.size > o.wordsMaxNarratives) continue;
    /* A narrative's own word: said by at least `wordsMinCoverage` of its posts, not one post in a blob. */
    const ids = [...per.keys()].filter((id) => (per.get(id)?.length ?? 0) >= o.wordsMinCoverage * (byId.get(id)?.members.length ?? Number.POSITIVE_INFINITY)).sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i] ?? '';
        const b = ids[j] ?? '';
        const k = pairKey(a, b);
        const e = pairs.get(k) ?? { a, b, words: new Set<string>(), posts: new Set<string>() };
        e.words.add(w);
        for (const m of [...(per.get(a) ?? []), ...(per.get(b) ?? [])]) e.posts.add(m);
        pairs.set(k, e);
      }
    }
  }
  return [...pairs.values()]
    .filter((e) => {
      const xa = byId.get(e.a);
      const xb = byId.get(e.b);
      if (xa === undefined || xb === undefined || e.words.size < o.wordsMinShared) return false;
      if (input.untouchable.has(e.a) || input.untouchable.has(e.b)) return false;
      if (Math.abs(xa.formedAtMs - xb.formedAtMs) > o.wordsFormedWithinMs) return false;
      return !keptApart(input.calls, xa.members, xb.members);
    })
    .map((e) => ({ a: e.a, b: e.b, words: [...e.words].sort(), posts: [...e.posts].sort() }));
}

/**
 * The loose posts that may join: in no narrative, with a vector and — ★ with `joinViral` — clearing
 * For You's views bar (the caller's `looseViral`): a small post joins by the regroup's own links, as
 * before. Measured 2026-10-23 on the 5-day replay, the same-words tie without it took 36 posts of 0 to
 * 3K views ("going viral on X", "polar bear") into 24 narratives; with it, none.
 */
function looseJoinable(input: OriginInput, p: Policy): readonly string[] {
  const o = p.narrative.origin;
  if (!o.joinOn) return [];
  const viral = input.looseViral ?? new Set<string>();
  return [...new Set(input.loose ?? [])].filter((c) => !input.narrativeOf.has(c) && input.vectors.has(c) && (!o.joinViral || viral.has(c)));
}

/** A content word as the single-word join reads it: a plural `s` off, then `wordStems` ("fawns" is "deer"). */
function stemWord(w: string, p: Policy): string {
  const stems = p.narrative.origin.wordStems;
  const one = w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w; // policy-allow: a plural "s" is cut only from a word longer than four letters (bus, gas stay)
  return stems[w] ?? stems[one] ?? one;
}

/**
 * ★ THE SINGLE RARE WORDS (`origin.looseWords*`, policy.v162; the Nara fawns): each post's content
 * words, own and English, stemmed; and per word the lead narratives whose own word it is — said by at
 * least `wordsMinCoverage` of its posts — when it is rare: said by at most `phraseMaxShare` of the
 * posts read (at least two of them) and the own word of at most `wordsMaxNarratives` narratives. Never
 * a narrative the owner called on (`untouchable`) or one of `noWordsJoin`. Off: no word ties anything.
 */
function looseWordsOf(input: OriginInput, p: Policy, t: { readonly loose: readonly string[]; readonly ownOf: ReadonlyMap<string, readonly string[]>; readonly leads: readonly string[] }): { readonly of: (id: string) => ReadonlySet<string>; readonly sayers: ReadonlyMap<string, readonly string[]>; readonly namesOf: (id: string) => ReadonlySet<string> } {
  const o = p.narrative.origin;
  const none = { of: () => new Set<string>(), sayers: new Map<string, readonly string[]>(), namesOf: () => new Set<string>() };
  if (!o.looseWordsOn || t.loose.length === 0) return none;
  const words = new Map<string, ReadonlySet<string>>();
  for (const [id, post] of input.posts) words.set(id, new Set([post.text, input.english?.get(id) ?? ''].flatMap((x) => contentWords(x, p)).map((w) => stemWord(w, p))));
  const df = new Map<string, number>();
  for (const set of words.values()) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const most = Math.max(2, Math.floor(words.size * o.phraseMaxShare));
  const by = new Map<string, string[]>();
  for (const l of t.leads) {
    if (input.untouchable.has(l) || (input.noWordsJoin?.has(l) ?? false)) continue;
    const own = t.ownOf.get(l) ?? [];
    if (own.length === 0) continue;
    const count = new Map<string, number>();
    for (const m of own) for (const w of words.get(m) ?? []) count.set(w, (count.get(w) ?? 0) + 1);
    for (const [w, k] of count) {
      const d = df.get(w) ?? 0;
      if (k >= o.wordsMinCoverage * own.length && d >= 2 && d <= most) by.set(w, [...(by.get(w) ?? []), l]);
    }
  }
  const sayers = new Map([...by].filter(([, ls]) => ls.length <= o.wordsMaxNarratives));
  const names = new Map<string, ReadonlySet<string>>();
  const namesOf = (id: string): ReadonlySet<string> => {
    let got = names.get(id);
    if (got === undefined) {
      const post = input.posts.get(id);
      got = post === undefined ? new Set<string>() : namesIn([post.text, input.english?.get(id) ?? ''], p);
      names.set(id, got);
    }
    return got;
  };
  return { of: (id) => words.get(id) ?? new Set<string>(), sayers, namesOf };
}

const TITLE_CASE = /^\p{Lu}\p{Ll}+$/u;
const SENTENCE_END = /[.!?:;]$/u;
const EDGE = /^[^\p{L}]+|[^\p{L}]+$/gu;

/**
 * The names a text writes: words in title case ("Nara", "Milei") that do not start a sentence, folded
 * and stemmed as `contentWords` and `stemWord` read them. A capital that only starts a sentence, and a
 * word in capitals throughout ("BREAKING"), say nothing. Han and kana have no case: none is a name here.
 */
function namesIn(texts: readonly string[], p: Policy): ReadonlySet<string> {
  const out = new Set<string>();
  for (const t of texts) {
    const toks = t.replace(/https?:\/\/\S+/giu, ' ').split(/\s+/u);
    toks.forEach((tok, i) => {
      const raw = tok.replace(EDGE, '');
      if (i === 0 || SENTENCE_END.test(toks[i - 1] ?? '') || !TITLE_CASE.test(raw)) return;
      for (const w of contentWords(raw, p)) out.add(stemWord(w, p));
    });
  }
  return out;
}

/**
 * ★ THE LOOSE POSTS JOIN (`origin.join*`): a good post in no narrative — the window's posts the
 * regroup left alone, the owner's pasted posts — joins the narrative it reacts to, once the merges
 * and the starting posts are known:
 *
 *   quoted  it quotes or links one of the narrative's posts or starting posts, at most `maxHops`
 *           away, and is at `linkMeaning` from its average (@Badr_13Block quotes @liistrk's post,
 *           the narrative's start, and is 0.53 from the posts that share no name with it)
 *   phrase  it says a rare phrase (narrative-phrase.ts) one of those posts says, in its own words or
 *           its stored English, and is at `phraseMeaning` from the average (@rayaneAlg00's
 *           "végéta est algérien", which quotes nothing and was named HOMER)
 *   words   (policy.v162) it says `wordsMinShared` of the narrative's single rare words
 *           (`looseWordsOf`) and is at `wordsMeaning` from the average (@hezuruy's "whoever killed the
 *           little deer… Nara", named PATROL, and "Four Baby Deer Found Dead in Nara Park": nara, deer)
 *
 * A post two narratives could take goes to the closer tie, then the nearer average. At most
 * `joinPerNarrative` a narrative a pass, nearest first; never against the owner's calls.
 */
function joinLoose(
  input: OriginInput,
  p: Policy,
  t: {
    readonly lead: (id: string) => string;
    readonly membersOf: ReadonlyMap<string, readonly string[]>;
    readonly starts: ReadonlyMap<string, readonly TracedPost[]>;
    readonly leadAverage: (id: string) => Float64Array | null;
    readonly ownerKeepsOut: (post: string, members: readonly string[]) => boolean;
    readonly refs: ReadonlyMap<string, readonly string[]>;
  },
): ReadonlyMap<string, readonly TracedPost[]> {
  const o = p.narrative.origin;
  const started = new Set([...t.starts.values()].flat().map((x) => x.itemId));
  const loose = looseJoinable(input, p).filter((c) => !started.has(c));
  if (!o.joinOn || loose.length === 0) return new Map();

  /* Each lead narrative's own posts: its members after the merges, and its starting posts. */
  const leads = [...new Set(input.narratives.map((x) => t.lead(x.id)))];
  const ownOf = new Map(leads.map((l) => [l, [...(t.membersOf.get(l) ?? []), ...(t.starts.get(l) ?? []).map((x) => x.itemId)]] as const));
  const leadOfPost = new Map<string, string>();
  for (const [l, own] of ownOf) for (const m of own) leadOfPost.set(m, l);

  /* Every post's phrases, the rare ones among all the posts read here, and which narratives say each. */
  const phrases = new Map<string, ReadonlySet<string>>();
  for (const [id, post] of input.posts) phrases.set(id, phrasesOf([post.text, input.english?.get(id) ?? ''], p));
  const rare = rarePhrases(phrases.values(), p);
  const sayers = new Map<string, Set<string>>();
  for (const [l, own] of ownOf) for (const m of own) for (const x of phrases.get(m) ?? []) if (rare.has(x)) sayers.set(x, (sayers.get(x) ?? new Set<string>()).add(l));

  const single = looseWordsOf(input, p, { loose, ownOf, leads });
  const offers: { post: string; lead: string; tie: OriginTie; meaning: number }[] = [];
  for (const c of loose) {
    const v = input.vectors.get(c);
    if (v === undefined) continue;
    const quoted = new Set([...linkReach(c, t.refs, o.maxHops)].flatMap((r) => {
      const l = leadOfPost.get(r);
      return l === undefined ? [] : [l];
    }));
    const said = new Set([...(phrases.get(c) ?? [])].flatMap((x) => [...(sayers.get(x) ?? [])]));
    /* ★ At least `wordsMinShared` rare words, and one of them a name both sides write (`namesIn`): "nara" + "deer", never "hospital" + "ambulance". */
    const shared = new Map<string, string[]>();
    for (const w of single.of(c)) for (const l of single.sayers.get(w) ?? []) shared.set(l, [...(shared.get(l) ?? []), w]);
    const named = (l: string, ws: readonly string[]): boolean => ws.some((w) => single.namesOf(c).has(w) && (ownOf.get(l) ?? []).some((m) => single.namesOf(m).has(w)));
    const worded = new Set([...shared].filter(([l, ws]) => ws.length >= o.wordsMinShared && named(l, ws)).map(([l]) => l));
    let best: { lead: string; tie: OriginTie; meaning: number } | null = null;
    for (const l of new Set([...quoted, ...said, ...worded])) {
      const avg = t.leadAverage(l);
      if (avg === null || t.ownerKeepsOut(c, ownOf.get(l) ?? [])) continue;
      const meaning = dot(v, avg);
      const tie: OriginTie | null = quoted.has(l) && meaning >= o.linkMeaning ? 'quoted' : said.has(l) && meaning >= o.phraseMeaning ? 'phrase' : worded.has(l) && meaning >= o.looseWordsMeaning ? 'words' : null;
      if (tie === null) continue;
      if (best === null || TIE_ORDER[tie] < TIE_ORDER[best.tie] || (tie === best.tie && (meaning > best.meaning || (meaning === best.meaning && l < best.lead)))) best = { lead: l, tie, meaning };
    }
    if (best !== null) offers.push({ post: c, ...best });
  }
  const out = new Map<string, TracedPost[]>();
  for (const x of offers.sort((a, b) => b.meaning - a.meaning || a.post.localeCompare(b.post))) {
    const list = out.get(x.lead) ?? [];
    if (list.length >= o.joinPerNarrative) continue;
    out.set(x.lead, [...list, { itemId: x.post, tie: x.tie }]);
  }
  const atOf = (id: string): number => input.posts.get(id)?.atMs ?? 0;
  return new Map([...out].map(([l, list]) => [l, [...list].sort((a, b) => atOf(a.itemId) - atOf(b.itemId) || a.itemId.localeCompare(b.itemId))] as const));
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
