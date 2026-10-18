/**
 * THE NARRATIVE REBUILD (the owner, 2026-10-18: "bring back the missing ones: rebuild the narratives
 * from the last 7 days that dropped off, from the posts we have stored"). What the runner's
 * narratives pass would have made had narratives been permanent from the start, replayed over the
 * stored days and written as one pass.
 *
 * The replay: from `days` back, the regroup's own window (`narrative.windowMs`, newest first, at most
 * `maxPosts`) is moved forward `stepMs` at a time to now, and each step is grouped exactly as a pass
 * groups (the runner's `narrativePairs` and `postStanding`, core `groupNarratives` with the pins and
 * `keepNarratives`) — never a copy of the pass, so the rebuild makes what the pass would. What every
 * step made stays made, as it now does live: posts already in a narrative are pinned to it from the
 * first step, so no narrative open today loses a post or is folded into another.
 *
 *   back      a narrative the old regroup dropped ('gone') whose posts group again keeps its old id,
 *             so its old link, its title and the owner's calls on it come back with it
 *   opens     a narrative the old regroup folded into another ('merged') is not split back out —
 *             its posts are in the one it was folded into, and taking them out would remove posts
 *             from a live narrative, which the owner's rule forbids. Its link opens that narrative
 *             (public.story_alias, written by the projector)
 *   new       stories from before narratives were kept (before 0093, 16 Oct) or never grouped while
 *             their posts were in the window: new narratives, named after their oldest post
 *   grown     only with `growOpen`: open narratives given the stored posts they would have had. Off
 *             by default — on 18 Oct it gave the "viral cat" narrative, already holding 89 others'
 *             posts, 183 more — so by default the rebuild brings back and makes narratives and
 *             leaves every narrative open today exactly as it is
 *
 * Then the early match (core group/narrative-early.ts) for each narrative it made, against the
 * stored posts it left in no narrative, so each one's first post is the earliest we hold.
 *
 * ★ ONLY POSTS WITH A STORED VECTOR can be grouped; nothing is embedded (no paid call). Vectors are
 * kept three days by when they were embedded (store post-embeddings.ts), so the further back a day
 * is, the fewer of its posts can come back — the report counts them per day. No title is asked
 * either: a narrative that comes back keeps its old title, a new one shows the judge's name for its
 * posts until the runner titles it the next time it grows.
 *
 * What breaks if changed carelessly: the order of the replay. Each step's pins are what the steps
 * before it made; replayed out of order, a later story would claim an earlier one's posts.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { answerPolicies, earlyMatches, earlyShortlist, foldNarrativeCalls, groupNarratives, hiddenByOwner, keepNarratives, removedPosts, survivorOf, type NarrativeState } from '@insidor/core';
import { PgLearningRepo, PgNarrativeRepo, type Db, type NarrativePass, type NarrativePostRow } from '@insidor/store';
import { asNarrativePost, narrativePairs, postStanding } from './narratives.ts';

const POST_SPACE = 'multimodal-3.1024.post';
const DAY_MS = 86_400_000;
/** At most this many stored good posts are read: more than a week has ever held. */
const MAX_STORED = 200_000;

export interface MissingNarrative {
  readonly id: string;
  readonly title: string | null;
  readonly state: 'gone' | 'merged';
  readonly posts: number;
  readonly firstShownAtMs: number | null;
  readonly leftAtMs: number;
  /** What the rebuild does for it. */
  readonly outcome: { readonly kind: 'back'; readonly posts: number } | { readonly kind: 'opens'; readonly into: string; readonly intoTitle: string | null } | { readonly kind: 'not_back'; readonly why: string };
}

export interface RebuildPlan {
  readonly pass: NarrativePass;
  readonly missing: readonly MissingNarrative[];
  readonly created: readonly { readonly id: string; readonly posts: number; readonly early: number; readonly firstPostMs: number; readonly name: string | null; readonly reused: boolean }[];
  readonly grown: number;
  /** The open narratives it gives posts to, with their title and how many. */
  readonly grownList: readonly { readonly id: string; readonly title: string | null; readonly added: number }[];
  readonly addedToOpen: number;
  /** Per UTC day of posting: the good posts stored, and how many had a vector to group on. */
  readonly days: readonly { readonly day: string; readonly good: number; readonly withVector: number }[];
  readonly steps: number;
  readonly ms: number;
}

const toMs = (v: unknown): number | null => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

export async function planRebuild(db: Db, opts: { readonly policy: Policy; readonly nowMs: number; readonly days: number; readonly stepMs: number; readonly growOpen?: boolean }): Promise<RebuildPlan> {
  const started = Date.now();
  const p = opts.policy;
  const n = p.narrative;
  const repo = new PgNarrativeRepo(db);
  const applied = await new PgLearningRepo(db).latestApplied();
  const standing = postStanding(answerPolicies(p, { cutoff: applied?.cutoff ?? null, chosenOn: applied?.cutoffModel ?? null }), p);
  const fromMs = opts.nowMs - opts.days * DAY_MS;

  const rows = (await repo.storedGood(fromMs, opts.nowMs, MAX_STORED, n.searchedPosts)).filter((r) => standing(r) === 'good');
  const vec = new Map<string, Float32Array>();
  const pic = new Map<string, Float32Array>();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    for (const [k, v] of await repo.vectors(chunk.map((r) => r.itemId), POST_SPACE, 'post')) vec.set(k, v);
    for (const [k, v] of await repo.vectors(chunk.map((r) => r.itemId), p.group.image.space, 'picture')) pic.set(k, v);
  }
  const withVec = rows.filter((r) => vec.has(r.itemId)).sort((a, b) => b.atMs - a.atMs || a.itemId.localeCompare(b.itemId));
  const byDay = new Map<string, { good: number; withVector: number }>();
  for (const r of rows) {
    const d = new Date(r.atMs).toISOString().slice(0, 10);
    const x = byDay.get(d) ?? { good: 0, withVector: 0 };
    byDay.set(d, { good: x.good + 1, withVector: x.withVector + (vec.has(r.itemId) ? 1 : 0) });
  }

  /* What is stored: every post's narrative now, every id given out, and the owner's calls. */
  const pinned = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 5_000) for (const [k, v] of await repo.ofPosts(rows.slice(i, i + 5_000).map((r) => r.itemId))) pinned.set(k, v);
  const pinnedBefore = new Set(pinned.keys());
  type NarrRow = { narrative_id: string; state: 'open' | 'merged' | 'gone'; merged_into: string | null; anchor_item: string; title: string | null; first_shown_at: Date | string | null; updated_at: Date | string; member_count: number };
  const all = await db.query<NarrRow>(`select narrative_id, state, merged_into, anchor_item, title, first_shown_at, updated_at, member_count from internal.narrative`);
  const states = new Map<string, NarrativeState>(all.map((r) => [r.narrative_id, { state: r.state, mergedInto: r.merged_into }] as const));
  const taken = new Set(all.map((r) => r.narrative_id));
  const callRows = await repo.calls();
  const calls = foldNarrativeCalls(callRows);
  const removedFrom = removedPosts(callRows, states);
  /* A gone narrative comes back under its own id when a group holds the post it is named after, or its oldest post. */
  const goneOf = new Map<string, string>();
  for (const r of [...all].filter((x) => x.state === 'gone').sort((a, b) => (toMs(a.first_shown_at) ?? 0) - (toMs(b.first_shown_at) ?? 0))) {
    for (const item of [r.narrative_id.replace(/^n-/, ''), r.anchor_item]) if (!goneOf.has(item)) goneOf.set(item, r.narrative_id);
  }

  const made = new Map<string, { members: string[]; formedAtMs: number; reused: boolean }>();
  const grownOpen = new Map<string, string[]>();
  const reused = new Set<string>();
  let steps = 0;
  for (let t = fromMs + n.windowMs; ; t += opts.stepMs) {
    const at = Math.min(t, opts.nowMs);
    const window = withVec.filter((r) => r.atMs >= at - n.windowMs && r.atMs < at).slice(0, n.maxPosts);
    steps += 1;
    if (window.length > 1) {
      const pairs = narrativePairs(window, vec, pic, p);
      const g = groupNarratives({ posts: window.map(asNarrativePost), pairs, calls, previous: new Map(), single: new Set(), vectors: vec, pinned }, p);
      const kept = keepNarratives({ groups: g.narratives.map((x) => x.members), pinned, taken, removedFrom });
      for (const c of kept.created) {
        const back = c.members.map((m) => goneOf.get(m)).find((id): id is string => id !== undefined && !reused.has(id));
        const id = back ?? c.id;
        if (back !== undefined) reused.add(back);
        taken.add(id);
        made.set(id, { members: [...c.members], formedAtMs: at, reused: back !== undefined });
        for (const m of c.members) pinned.set(m, id);
      }
      for (const [id, added] of kept.grown) {
        const mine = made.get(id);
        if (mine !== undefined) mine.members.push(...added);
        else if (opts.growOpen === true) grownOpen.set(id, [...(grownOpen.get(id) ?? []), ...added]);
        else continue; // a narrative open today is left as it is: its would-be posts stay free
        for (const m of added) pinned.set(m, id);
      }
    }
    if (at >= opts.nowMs) break;
  }

  /* The early match for what it made, against the stored posts it left in no narrative. */
  const rowOf = new Map(rows.map((r) => [r.itemId, r] as const));
  const free = withVec.filter((r) => !pinned.has(r.itemId));
  const match = {
    narratives: [...made].map(([id, x]) => ({ id, members: x.members })),
    posts: new Map([...made.values()].flatMap((x) => x.members).flatMap((m) => {
      const r = rowOf.get(m);
      return r === undefined ? [] : [[m, asNarrativePost(r)] as const];
    })),
    stored: free.map(asNarrativePost),
    calls,
  };
  const found = made.size === 0 || free.length === 0 ? new Map<string, readonly string[]>() : earlyMatches(match, earlyShortlist(match, p), vec, p);
  const early = new Map<string, string[]>();
  for (const [id, list] of found) {
    const kept = list.filter((m) => !pinned.has(m));
    for (const m of kept) pinned.set(m, id);
    if (kept.length > 0) early.set(id, kept);
  }

  const atOf = (m: string) => rowOf.get(m)?.atMs ?? 0;
  const storedOpen = new Map((await repo.byIds([...grownOpen.keys()])).map((s) => [s.id, s] as const));
  const narratives: NarrativePass['narratives'][number][] = [];
  for (const [id, x] of made) {
    const members = [...x.members].sort((a, b) => atOf(a) - atOf(b) || a.localeCompare(b));
    const shown = members.length >= n.minPosts && !hiddenByOwner(id, members, calls, p);
    narratives.push({ id, members, added: members, early: early.get(id) ?? [], anchor: members[0] ?? '', newestPostAtMs: Math.max(...members.map(atOf)), shown, changed: true, firstShownAtMs: x.formedAtMs, restored: true });
  }
  for (const [id, added] of grownOpen) {
    const s = storedOpen.get(id);
    if (s === undefined) continue;
    narratives.push({ id, members: [...s.members.filter((m) => !(s.early ?? []).includes(m)), ...added], added, anchor: s.anchor, newestPostAtMs: Math.max(s.newestPostAtMs ?? 0, ...added.map(atOf)), shown: s.shown, changed: true });
  }

  /* The narratives that left the app in the last `days`, and what happens to each. */
  const titleOf = new Map(all.map((r) => [r.narrative_id, r.title] as const));
  const missing: MissingNarrative[] = all
    .filter((r): r is NarrRow & { state: 'gone' | 'merged' } => r.state !== 'open' && (toMs(r.first_shown_at) ?? 0) >= fromMs)
    .map((r) => {
      const base = { id: r.narrative_id, title: r.title, state: r.state, posts: r.member_count, firstShownAtMs: toMs(r.first_shown_at), leftAtMs: toMs(r.updated_at) ?? 0 };
      if (r.state === 'merged') {
        const into = survivorOf(r.narrative_id, states);
        return { ...base, outcome: into === null ? { kind: 'not_back' as const, why: 'merged into a narrative that is gone' } : { kind: 'opens' as const, into, intoTitle: titleOf.get(into) ?? null } };
      }
      const back = made.get(r.narrative_id);
      if (back !== undefined) return { ...base, outcome: { kind: 'back' as const, posts: back.members.length + (early.get(r.narrative_id)?.length ?? 0) } };
      const named = r.narrative_id.replace(/^n-/, '');
      const anchor = rowOf.get(named) ?? rowOf.get(r.anchor_item);
      const why = anchor === undefined
        ? 'its first post no longer passes the judge, or went up before the days replayed'
        : !vec.has(anchor.itemId)
          ? 'its first post has no stored vector (kept three days)'
          : pinnedBefore.has(anchor.itemId)
            ? `its posts are in ${pinned.get(anchor.itemId) ?? 'another narrative'} now`
            : pinned.has(anchor.itemId)
              ? `its posts went to ${pinned.get(anchor.itemId) ?? 'another narrative'} in the replay`
              : 'its posts do not group again';
      return { ...base, outcome: { kind: 'not_back' as const, why } };
    })
    .sort((a, b) => (b.firstShownAtMs ?? 0) - (a.firstShownAtMs ?? 0));

  const nameOf = (members: readonly string[]): string | null => {
    const count = new Map<string, number>();
    for (const m of members) {
      const name = rowOf.get(m)?.proposedName?.trim();
      if (name) count.set(name, (count.get(name) ?? 0) + 1);
    }
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };
  return {
    pass: { narratives, retired: [], removed: [] },
    missing,
    created: [...made].map(([id, x]) => ({ id, posts: x.members.length, early: early.get(id)?.length ?? 0, firstPostMs: Math.min(...[...x.members, ...(early.get(id) ?? [])].map(atOf)), name: titleOf.get(id) ?? nameOf(x.members), reused: x.reused })),
    grown: grownOpen.size,
    grownList: [...grownOpen].map(([id, l]) => ({ id, title: titleOf.get(id) ?? null, added: l.length })).sort((a, b) => b.added - a.added),
    addedToOpen: [...grownOpen.values()].reduce((s, l) => s + l.length, 0),
    days: [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, x]) => ({ day, ...x })),
    steps,
    ms: Date.now() - started,
  };
}

/** The plan as the owner reads it. */
export function rebuildLines(plan: RebuildPlan, mode: 'dry' | 'live'): string[] {
  const hm = (at: number | null) => (at === null ? '—' : new Date(at).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }));
  const back = plan.missing.filter((m) => m.outcome.kind === 'back').length;
  const opens = plan.missing.filter((m) => m.outcome.kind === 'opens').length;
  const lines = [
    `# Narrative rebuild (${mode === 'dry' ? 'dry run: nothing written' : 'written'}), ${new Date().toISOString().slice(0, 16)} UTC`,
    '',
    `Replayed ${plan.steps} steps in ${plan.ms} ms. Missing from the app (dropped or folded away, first shown in the days replayed): ${plan.missing.length} — ${back} come back under their own id, ${opens} open the narrative they were folded into, ${plan.missing.length - back - opens} do not come back.`,
    `Narratives made: ${plan.created.length} (${plan.created.filter((c) => c.reused).length} of them old ids back), with ${plan.created.reduce((s, c) => s + c.posts, 0)} posts and ${plan.created.reduce((s, c) => s + c.early, 0)} early posts; ${plan.grown} open narratives given ${plan.addedToOpen} posts.`,
    '',
    '| day | good posts | with a vector |',
    '|---|---|---|',
    ...plan.days.map((d) => `| ${d.day} | ${d.good} | ${d.withVector} |`),
    '',
    '## Missing narratives',
    '',
    '| narrative | title | posts then | first shown | left | what happens |',
    '|---|---|---|---|---|---|',
    ...plan.missing.map((m) => `| ${m.id} | ${(m.title ?? '—').replace(/\|/g, '/')} | ${m.posts} | ${hm(m.firstShownAtMs)} | ${hm(m.leftAtMs)} (${m.state}) | ${m.outcome.kind === 'back' ? `back, ${m.outcome.posts} posts` : m.outcome.kind === 'opens' ? `opens ${m.outcome.into} (${(m.outcome.intoTitle ?? '—').replace(/\|/g, '/')})` : `not back: ${m.outcome.why}`} |`),
    '',
    '## Open narratives given the posts they would have had',
    '',
    '| narrative | title | posts added |',
    '|---|---|---|',
    ...plan.grownList.map((g) => `| ${g.id} | ${(g.title ?? '—').replace(/\|/g, '/')} | ${g.added} |`),
    '',
    '## Narratives the rebuild makes, oldest first post first',
    '',
    '| narrative | name | posts | early | first post |',
    '|---|---|---|---|---|',
    ...[...plan.created].sort((a, b) => a.firstPostMs - b.firstPostMs).map((c) => `| ${c.id}${c.reused ? ' (back)' : ''} | ${(c.name ?? '—').replace(/\|/g, '/')} | ${c.posts} | ${c.early} | ${hm(c.firstPostMs)} |`),
  ];
  return lines;
}
