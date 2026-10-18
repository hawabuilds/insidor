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
 *   join     a new group (it holds no narrative's post) that is the same subject as a narrative
 *            already made adds its posts to that narrative instead of becoming another; the
 *            closest such narrative when there are several
 *   merge    of two narratives already made that are the same subject, the newer merges into the
 *            older: an automatic merge, recorded as one (`merged_by` 'same_subject', 0108), its
 *            link redirected like an owner's merge. Never a narrative the owner made any call on
 *            — his calls outrank this rule, in both directions
 *
 * Pure: the runner reads the narratives, their posts' names and vectors; this decides.
 *
 * What breaks if changed carelessly: the name gate. Without it this is a centroid merge, and the
 * centroid merge is exactly what folded 89 narratives into one "viral cat" story on 16-18 Oct.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { compactName } from '../match/post-coin.ts';

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

export function subjectOf(id: string, posts: readonly SubjectPost[], oldestMs: number): NarrativeSubject {
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
  return { id, sum, name: top?.[0] ?? null, nameShare: top === undefined || named === 0 ? 0 : top[1] / named, oldestMs };
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

/** How alike two subjects are when they are the same subject by this rule; null when they are not. */
export function sameSubject(a: NarrativeSubject, b: NarrativeSubject, p: Policy): number | null {
  const s = p.narrative.same;
  if (!s.on || a.name === null || a.name !== b.name) return null;
  if (a.nameShare < s.nameShare || b.nameShare < s.nameShare) return null;
  if (a.sum === null || b.sum === null) return null;
  const c = cosine(a.sum, b.sum);
  return c >= s.meaning ? c : null;
}

/**
 * Each new group (by index) that is the same subject as a narrative already made → that narrative,
 * the closest when several are. `existing` are the narratives a group may join: open, shown, not
 * hidden by the owner (the caller's to filter).
 */
export function joinExisting(groups: readonly NarrativeSubject[], existing: readonly NarrativeSubject[], p: Policy): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  const byName = new Map<string, NarrativeSubject[]>();
  for (const e of existing) if (e.name !== null) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  groups.forEach((g, i) => {
    let best: { id: string; c: number } | null = null;
    for (const e of g.name === null ? [] : byName.get(g.name) ?? []) {
      const c = sameSubject(g, e, p);
      if (c !== null && (best === null || c > best.c || (c === best.c && e.id < best.id))) best = { id: e.id, c };
    }
    if (best !== null) out.set(i, best.id);
  });
  return out;
}

/**
 * The automatic merges: each narrative that is the same subject as an older one merges into it —
 * into the oldest it matches directly, followed to where that one goes, so a story told three
 * times ends as one. `untouchable` are the narratives the owner made a call on: never merged, and
 * never merged into. Each pair is `{ from, into, meaning }`, newest `from` last.
 */
export function sameSubjectMerges(narratives: readonly NarrativeSubject[], untouchable: ReadonlySet<string>, p: Policy): readonly { readonly from: string; readonly into: string; readonly meaning: number }[] {
  if (!p.narrative.same.on) return [];
  const list = narratives.filter((x) => !untouchable.has(x.id)).sort((a, b) => a.oldestMs - b.oldestMs || a.id.localeCompare(b.id));
  const into = new Map<string, string>();
  const lead = (id: string): string => {
    let at = id;
    for (let next = into.get(at); next !== undefined; next = into.get(at)) at = next;
    return at;
  };
  const out: { from: string; into: string; meaning: number }[] = [];
  /* Only narratives with the same name can be the same subject: compared within a name, never all pairs. */
  const byName = new Map<string, NarrativeSubject[]>();
  for (const x of list) if (x.name !== null) byName.set(x.name, [...(byName.get(x.name) ?? []), x]);
  for (const b of list) {
    const same = b.name === null ? [] : byName.get(b.name) ?? [];
    for (const a of same) {
      if (a === b) break;
      const c = sameSubject(a, b, p);
      if (c === null) continue;
      const target = lead(a.id);
      if (target === b.id) continue;
      into.set(b.id, target);
      out.push({ from: b.id, into: target, meaning: c });
      break;
    }
  }
  return out;
}

/** Of a narrative's posts, the subject posts this rule reads, from the judge's names and the vectors held. */
export function subjectPosts(members: readonly string[], nameOf: ReadonlyMap<string, string | null>, vectors: ReadonlyMap<string, ArrayLike<number>>): readonly SubjectPost[] {
  return members.map((m) => ({ name: nameOf.get(m) ?? null, vector: vectors.get(m) }));
}
