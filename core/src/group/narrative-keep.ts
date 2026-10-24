/**
 * KEEPING NARRATIVES — what one regroup may do to the narratives already made, and nothing more.
 *
 * The owner, 2026-10-18: "Narratives are permanent once made: the regroup only adds posts to a
 * narrative, creates new ones, or merges ones I merge. It never drops a narrative because its posts
 * are older than the window. A narrative only goes when I tap Not a narrative."
 *
 * The regroup (narrative.ts) still forms its groups afresh from the window's posts each pass; this
 * file turns those groups into changes to what is stored, and only these:
 *
 *   add      a group holding posts of one narrative gives that narrative its other posts — the
 *            ones in no narrative yet (narrative.ts `pinned` keeps two narratives' posts out of one
 *            group, so there is one narrative to give them to; under an owner's merge, the one
 *            holding most of them)
 *   create   a group holding no narrative's post is a new narrative, its id named after its oldest
 *            post and never one already given out
 *   merge    only the owner's "Merge with…": the narrative he merged moves all its posts into the
 *            one he chose and is kept as `merged` with where it went, so its link still opens the
 *            survivor (the projector writes public.story_alias)
 *   remove   only the owner's "Remove this post": that post leaves that narrative and is never
 *            added back to it
 *   add      the owner's "Add a post" (`ownerAdds`): the post is moved into the narrative he added
 *            it to (where that leads now) and kept there — the pins hold it from then on, so no
 *            regroup moves it, and a "Remove this post" he made of it from that narrative before
 *            is undone. Only his own later "Remove this post" or "Split" of it takes it out again
 *   split    only the owner's "Split": the posts he picked leave that narrative together and are a
 *            new one under the id the call named (`ownerSplits`); the narrative they left never
 *            takes them back. A split is applied once — the new id stored in any state is the mark
 *            that it was, so reading every call each pass never splits twice
 *
 * A narrative no group touched this pass is left exactly as stored — a narrative whose posts have
 * all aged out of the window is the normal case, not a narrative that ended. Whether it is still
 * picking up is `narrativeDead`, a fact read from its newest post, never a reason to remove it.
 *
 * Pure. The runner reads the pins, the ids already given out and the narratives' states, and
 * writes what this returns in one transaction.
 *
 * What breaks if changed carelessly: the id. A new narrative's id must never be one already given
 * out in any state — an open one would be overwritten, a merged one would stop redirecting, and a
 * hidden one would come back under its old link.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import type { NarrativeCallRow } from './narrative.ts';

export interface KeepInput {
  /** The regroup's groups (narrative.ts `groupNarratives`), each oldest post first. */
  readonly groups: readonly (readonly string[])[];
  /** Post → the narrative it is in now. */
  readonly pinned: ReadonlyMap<string, string>;
  /** Every narrative id already given out, in any state, that a new narrative could be named. */
  readonly taken: ReadonlySet<string>;
  /** Post → the narratives the owner removed it from: it is never added back to them. */
  readonly removedFrom: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface KeptPass {
  /** Narrative id → the posts added to it this pass, in the group's order. */
  readonly grown: ReadonlyMap<string, readonly string[]>;
  /** New narratives, each with its posts, oldest first. */
  readonly created: readonly { readonly id: string; readonly members: readonly string[] }[];
}

export function keepNarratives(input: KeepInput): KeptPass {
  const grown = new Map<string, string[]>();
  const created: { id: string; members: readonly string[] }[] = [];
  const taken = new Set(input.taken);
  for (const group of input.groups) {
    const counts = new Map<string, number>();
    for (const m of group) {
      const pin = input.pinned.get(m);
      if (pin !== undefined) counts.set(pin, (counts.get(pin) ?? 0) + 1);
    }
    const free = group.filter((m) => !input.pinned.has(m));
    if (counts.size === 0) {
      if (group.length === 0) continue;
      let id = group.map((m) => `n-${m}`).find((x) => !taken.has(x));
      for (let k = 1; id === undefined; k += 1) if (!taken.has(`n-${group[0]}-${k}`)) id = `n-${group[0]}-${k}`;
      taken.add(id);
      created.push({ id, members: group });
      continue;
    }
    const target = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (target === undefined) continue;
    const add = free.filter((m) => !(input.removedFrom.get(m)?.has(target) ?? false));
    if (add.length > 0) grown.set(target, [...(grown.get(target) ?? []), ...add]);
  }
  return { grown, created };
}

/** A stored narrative's state, as the owner's merges need it. */
export interface NarrativeState {
  readonly state: 'open' | 'merged' | 'gone';
  readonly mergedInto: string | null;
}

/** Where a narrative's link leads now: itself when open, the end of its merges when merged. */
export function survivorOf(id: string, states: ReadonlyMap<string, NarrativeState>): string | null {
  const seen = new Set<string>();
  let at: string | null = id;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const s = states.get(at);
    if (s === undefined) return null;
    if (s.state === 'open') return at;
    if (s.state !== 'merged') return null;
    at = s.mergedInto;
  }
  return null;
}

/**
 * The owner's merges still to apply, oldest first: each "Merge with…" whose narrative is still open,
 * into where the narrative he chose leads now. A merge already applied finds its narrative merged
 * and is skipped, so the calls can be read whole every pass.
 */
export function ownerMerges(rows: readonly NarrativeCallRow[], states: ReadonlyMap<string, NarrativeState>): readonly { readonly from: string; readonly into: string }[] {
  const now = new Map(states);
  const out: { from: string; into: string }[] = [];
  for (const r of [...rows].sort((x, y) => x.atMs - y.atMs || x.id - y.id)) {
    if (r.verdict !== 'merge' || r.otherId === null) continue;
    if (now.get(r.narrativeId)?.state !== 'open') continue;
    const into = survivorOf(r.otherId, now);
    if (into === null || into === r.narrativeId) continue;
    out.push({ from: r.narrativeId, into });
    now.set(r.narrativeId, { state: 'merged', mergedInto: into });
  }
  return out;
}

/**
 * The owner's "Remove this post" calls: each post and the narratives (where they lead now) it was
 * removed from — but not one he added the post back to later ("Add a post" into where it leads).
 */
export function removedPosts(rows: readonly NarrativeCallRow[], states: ReadonlyMap<string, NarrativeState>): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, Set<string>>();
  const addedLater = (r: NarrativeCallRow): boolean => {
    const lead = survivorOf(r.narrativeId, states) ?? r.narrativeId;
    return rows.some((a) => a.verdict === 'add_post' && a.otherId === r.otherId && (a.atMs > r.atMs || (a.atMs === r.atMs && a.id > r.id)) && (survivorOf(a.narrativeId, states) ?? a.narrativeId) === lead);
  };
  for (const r of rows) {
    if (r.verdict !== 'remove_post' || r.otherId === null || addedLater(r)) continue;
    const set = out.get(r.otherId) ?? new Set<string>();
    set.add(r.narrativeId);
    const lead = survivorOf(r.narrativeId, states);
    if (lead !== null) set.add(lead);
    out.set(r.otherId, set);
  }
  return out;
}

/** One owner's "Add a post": `itemId` belongs in `into` (where the narrative he added it to leads now). */
export interface OwnerAdd {
  readonly itemId: string;
  readonly into: string;
}

/**
 * The owner's "Add a post" calls that stand: per post, his newest call naming it — an add, a
 * "Remove this post" of it, or a "Split" that moved it — and only where that is an add into a
 * narrative that still leads somewhere open. Read whole every pass; the caller writes only the ones
 * whose post is not already there, so an add is applied once and re-applied only if something
 * moved the post away. A post not stored yet (queued for the runner to read) waits: the write skips
 * it until it is.
 */
export function ownerAdds(rows: readonly NarrativeCallRow[], states: ReadonlyMap<string, NarrativeState>): readonly OwnerAdd[] {
  const newest = new Map<string, NarrativeCallRow>();
  for (const r of [...rows].sort((x, y) => x.atMs - y.atMs || x.id - y.id)) {
    if ((r.verdict === 'add_post' || r.verdict === 'remove_post') && r.otherId !== null) newest.set(r.otherId, r);
    if (r.verdict === 'split') for (const m of r.members) newest.set(m, r);
  }
  const out: OwnerAdd[] = [];
  for (const [itemId, r] of newest) {
    if (r.verdict !== 'add_post') continue;
    const into = survivorOf(r.narrativeId, states);
    if (into !== null) out.push({ itemId, into });
  }
  return out.sort((a, b) => a.itemId.localeCompare(b.itemId));
}

/** One owner's "Split" still to apply: `members` leave `from` (where his narrative leads now) for the new narrative `into`. */
export interface OwnerSplit {
  readonly from: string;
  readonly into: string;
  readonly members: readonly string[];
}

/**
 * The owner's "Split" calls: the ones still to apply, oldest first, and each moved post with the
 * narratives (where they lead now) it was moved out of — the narratives it is never added back to.
 *
 * A split is still to apply while its new id is not given out (absent from `states`, which must
 * hold every split's new id the caller could read); once it is stored, in any state, it was applied,
 * so a split whose narrative the owner later merged back is never split again. A split whose
 * narrative no longer leads anywhere open (hidden, gone) is left: there is nothing to split.
 */
export function ownerSplits(rows: readonly NarrativeCallRow[], states: ReadonlyMap<string, NarrativeState>): { readonly pending: readonly OwnerSplit[]; readonly movedFrom: ReadonlyMap<string, ReadonlySet<string>> } {
  const pending: OwnerSplit[] = [];
  const movedFrom = new Map<string, Set<string>>();
  const named = new Set<string>();
  for (const r of [...rows].sort((x, y) => x.atMs - y.atMs || x.id - y.id)) {
    if (r.verdict !== 'split' || r.otherId === null || r.members.length === 0) continue;
    const lead = survivorOf(r.narrativeId, states);
    for (const m of r.members) {
      const set = movedFrom.get(m) ?? new Set<string>();
      set.add(r.narrativeId);
      if (lead !== null) set.add(lead);
      movedFrom.set(m, set);
    }
    if (states.has(r.otherId) || named.has(r.otherId) || lead === null || lead === r.otherId) continue;
    named.add(r.otherId);
    pending.push({ from: lead, into: r.otherId, members: [...new Set(r.members)] });
  }
  return { pending, movedFrom };
}

/**
 * ★ DEAD: NO NEW POST FOR `narrative.dead.afterMs` (the owner, 2026-10-18: 48 hours). A fact read
 * from its newest post's time, so it comes back to life the moment a new post joins it. A dead
 * narrative stays — its page, its posts, Most viewed and New — and is only left out of Trending.
 * No known post time is not dead: an unknown never ends a story.
 */
export function narrativeDead(newestPostAtMs: number | null, nowMs: number, p: Policy): boolean {
  return newestPostAtMs !== null && nowMs - newestPostAtMs >= p.narrative.dead.afterMs;
}
