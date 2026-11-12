/**
 * ONE STORY, ONE NARRATIVE — when two narratives (or a new group of posts and a narrative already
 * made) are clearly the same subject, and what to do about it.
 *
 * The owner, 2026-10-18: "the same narrative posted several times". Since narratives became
 * permanent (narrative-keep.ts) every window post already in a narrative is pinned to it, and a
 * group holding no pinned post becomes a new narrative. So a story whose first posts aged out of
 * the window, or whose new posts did not link to half of the old ones, came back as a second
 * narrative beside the first — Neo the raccoon three times, Comet the deer three times, Gus,
 * Konasu — and two narratives already made never join, so the second stayed.
 *
 * Two things at once make "the same subject", and both are strict:
 *
 *   the name     the judge's most common name for each one's posts is the same (compacted), and
 *                holds at least `same.nameShare` of each one's named posts — a name only one post
 *                in twenty carries is not what the narrative is about
 *   the meaning  their posts' average vectors are at least `same.meaning` alike
 *
 * The name decides and the meaning only confirms: on the 18 Oct narratives a shill's words read
 * alike whatever they are about (0.99 between "AI agents" and "Nakama"), while every close pair with
 * the same name was one story. A loosely related story — another cat, another protest figure —
 * has another name, and never joins.
 *
 * ★ ONE NAME, SEVERAL SPELLINGS (the owner, 2026-11-12: "every story about Jensen Huang should be
 * one"). The judge's name is the coin a post proposes, so one person's story arrives as JENSEN,
 * JENSENHUANG, DISHWASHERJENSEN; requiring the exact same name left a dozen Jensen narratives beside
 * the 270-post one. So:
 *
 *   one family   one name holding the other whole is the same name, when the shorter is at least
 *                `same.familyMinChars` long ("jensen" in "jensenhuang"; "max" reaches into nothing)
 *   the titles   when both titles also say the shared root, the shorter name (the titler read every post of each and named
 *                the subject), the meaning bar is the lower `same.titledMeaning`. A big narrative's
 *                average drifts toward the feed's, so the same story's small tellings read 0.785 to
 *                0.890 from the Jensen one, under the 0.877 that two small tellings of Neo clear
 *
 * ★ THE TITLE NEVER LINKS ON ITS OWN, AND NOTHING LINKS WITHOUT VECTORS. Dry-run over all 3,584 shown
 * narratives on 12 Nov: letting a name in the other's title link by itself merged 50, a third of them
 * wrong — "Red Panda Fuuta" into "Panda Pitbull Joins Parade", an AI model's release into the
 * same model's mishap — and letting it stand in for missing vectors merged 338, every common first name wrong
 * (Jeff the dog into "Anti AI Shark Jeff"). Meaning did not separate those; the posts' own name does.
 *
 * ★ NEVER THROUGH A NARRATIVE MERGED AWAY THIS PASS: a narrative merges straight into the oldest one
 * it matches that stays, so a match never chains from one spelling to the next.
 *
 * Pure: the runner reads the narratives, their posts' names and vectors; this decides.
 *
 * What breaks if changed carelessly: the name gate. Without it this is a centroid merge, and the
 * centroid merge is exactly what folded 89 narratives into one "viral cat" story on 16-18 Oct.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { compactName } from '../match/post-coin.ts';
import { isCommonWord } from '../match/story-coin.ts';

/** What a narrative (or a group) is about, for this rule: its average vector and its name. */
export interface NarrativeSubject {
  readonly id: string;
  /** The sum of its posts' unit vectors; null when none of its posts has one. */
  readonly sum: Float64Array | null;
  /** Its most common compacted judge name; null when its posts carry none. */
  readonly name: string | null;
  /** Of its named posts, the share carrying `name`. */
  readonly nameShare: number;
  /** When its oldest post went up (or it was made): the older of two is the one kept. */
  readonly oldestMs: number;
  /** Its title's words, compacted; empty for a group not yet titled. */
  readonly titleWords: readonly string[];
}

/** A post as this rule reads it: its judge's name and, if known, its vector. */
export interface SubjectPost {
  readonly name: string | null;
  readonly vector: ArrayLike<number> | undefined;
}

/** The judge's name in the form this rule compares: compacted, generic spans, generic names and short names out. */
export function subjectName(raw: string | null, p: Policy): string | null {
  if (raw === null) return null;
  const key = compactName(raw);
  const s = p.narrative.same;
  if (key.length < s.minNameChars) return null;
  if ([...p.group.genericSpans, ...s.genericNames].some((g) => compactName(g) === key)) return null;
  return key;
}

/** A title's words in the form names are compared in ("Jensen Huang's" → "jensen", "huangs"). */
export function titleWordsOf(title: string | null | undefined): readonly string[] {
  if (title == null) return [];
  return title.split(/[^\p{L}\p{N}$]+/u).map(compactName).filter((w) => w.length > 0);
}

/**
 * The name is one of the title's words, or several of them run together ("jensenhuang"), and
 * at least one of those words is not itself a generic name ("Elon Musk" is two generic names).
 */
function namedIn(name: string, words: readonly string[], generic: ReadonlySet<string>): boolean {
  for (let i = 0; i < words.length; i += 1) {
    let run = '';
    let own = false;
    for (let j = i; j < words.length; j += 1) {
      const w = words[j] ?? '';
      run += w;
      own ||= !generic.has(w) && !isCommonWord(w);
      if (run === name) return own;
      if (run.length >= name.length) break;
    }
  }
  return false;
}

/** The same name, or one holding the other whole with the shorter at least `familyMinChars` long. */
function oneFamily(a: string, b: string, minChars: number): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= minChars && long.includes(short);
}

export function subjectOf(id: string, posts: readonly SubjectPost[], oldestMs: number, title: string | null = null): NarrativeSubject {
  let sum: Float64Array | null = null;
  const names = new Map<string, number>();
  let named = 0;
  for (const post of posts) {
    if (post.vector !== undefined) {
      sum ??= new Float64Array(post.vector.length);
      for (let i = 0; i < post.vector.length && i < sum.length; i += 1) sum[i] = (sum[i] ?? 0) + (post.vector[i] ?? 0);
    }
    if (post.name !== null) {
      named += 1;
      names.set(post.name, (names.get(post.name) ?? 0) + 1);
    }
  }
  const top = [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return { id, sum, name: top?.[0] ?? null, nameShare: top === undefined || named === 0 ? 0 : top[1] / named, oldestMs, titleWords: titleWordsOf(title) };
}

const cosine = (a: Float64Array, b: Float64Array): number => {
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

/**
 * How alike two subjects are when they are the same subject by this rule; null when they are not,
 * and null when either has no stored vectors: the meaning cannot confirm, so it cannot tell.
 */
export function sameSubject(a: NarrativeSubject, b: NarrativeSubject, p: Policy): number | null {
  const s = p.narrative.same;
  if (!s.on || a.name === null || b.name === null) return null;
  if (a.nameShare < s.nameShare || b.nameShare < s.nameShare) return null;
  if (!oneFamily(a.name, b.name, s.familyMinChars)) return null;
  if (a.sum === null || b.sum === null) return null;
  const generic = new Set([...p.group.genericSpans, ...s.genericNames].map(compactName));
  /* The shared root (the shorter name) said in both titles: "jensen" in "Nvidia CEO Jensen Huang
     Affair Rumors" and in "Jensen Meme Dishwasher Joke". */
  const root = a.name.length <= b.name.length ? a.name : b.name;
  const titled = root.length >= s.familyMinChars && namedIn(root, a.titleWords, generic) && namedIn(root, b.titleWords, generic);
  const c = cosine(a.sum, b.sum);
  return c >= (titled ? s.titledMeaning : s.meaning) ? c : null;
}

/**
 * Each new group (by index) that is the same subject as a narrative already made → that narrative,
 * the closest when several are. `existing` are the narratives a group may join: open, shown, not
 * hidden by the owner (the caller's to filter).
 */
export function joinExisting(groups: readonly NarrativeSubject[], existing: readonly NarrativeSubject[], p: Policy): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  groups.forEach((g, i) => {
    if (g.name === null) return;
    let best: { id: string; c: number } | null = null;
    for (const e of existing) {
      const c = sameSubject(g, e, p);
      if (c !== null && (best === null || c > best.c || (c === best.c && e.id < best.id))) best = { id: e.id, c };
    }
    if (best !== null) out.set(i, best.id);
  });
  return out;
}

/**
 * The automatic merges: each narrative that is the same subject as an older one merges into the
 * oldest it matches that is not itself merged away, so a story told three times ends as one and a
 * link never chains through a narrative already folded (the header). `untouchable` are the
 * narratives the owner made a call on: never merged, and never merged into. Each pair is
 * `{ from, into, meaning }`, newest `from` last.
 */
export function sameSubjectMerges(narratives: readonly NarrativeSubject[], untouchable: ReadonlySet<string>, p: Policy): readonly { readonly from: string; readonly into: string; readonly meaning: number }[] {
  if (!p.narrative.same.on) return [];
  const list = narratives.filter((x) => !untouchable.has(x.id)).sort((a, b) => a.oldestMs - b.oldestMs || a.id.localeCompare(b.id));
  const gone = new Set<string>();
  const out: { from: string; into: string; meaning: number }[] = [];
  list.forEach((b, at) => {
    for (const a of list.slice(0, at)) {
      if (gone.has(a.id)) continue;
      const c = sameSubject(a, b, p);
      if (c === null) continue;
      gone.add(b.id);
      out.push({ from: b.id, into: a.id, meaning: c });
      return;
    }
  });
  return out;
}

/** Of a narrative's posts, the subject posts this rule reads, from the judge's names and the vectors held. */
export function subjectPosts(members: readonly string[], nameOf: ReadonlyMap<string, string | null>, vectors: ReadonlyMap<string, ArrayLike<number>>): readonly SubjectPost[] {
  return members.map((m) => ({ name: nameOf.get(m) ?? null, vector: vectors.get(m) }));
}
