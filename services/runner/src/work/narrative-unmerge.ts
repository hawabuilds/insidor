/**
 * UNDO THE MERGES NOBODY ASKED FOR (the owner, 2026-10-18: merges happen only when he merges). On
 * 16-18 Oct the old regroup's "parts of one story" step folded 178 narratives into others — 91 into
 * one, "Neoncat Pumpfun Viral Cat Meme" — and he has never made a merge call. Each narrative merged
 * without an owner merge call comes back under its own id and title, with its own posts, and its
 * posts leave the narrative they were folded into.
 *
 * ★ ITS OWN POSTS ARE FOUND AGAIN, NOT READ BACK. Until 2026-10-18 a narrative's posts were rewritten
 * whole each pass and no history was kept, so which posts a folded narrative had is not stored.
 * What is stored: its id (named after one of its posts), its oldest post, its title, how many posts
 * it had, and when it was folded. So, per narrative that holds folded ones now (the holder of their
 * posts), its posts are regrouped by the regroup's own rule (core `groupNarratives`, the runner's
 * `narrativePairs`) with each folded narrative's own two posts pinned to it and the holder's pinned
 * to the holder — pins keep two narratives' posts out of one group — and each folded narrative gets
 * the posts that group with its own, that we had saved by the time it was folded (the posts it had
 * then; later ones stay in the holder). It needs two such posts to come back; otherwise it stays
 * merged and its link keeps opening the holder.
 *
 *   still good   a post the owner called "Not a meme", a shill or a held kind is not moved (the
 *                page's own listing rule, narrative-frame.ts); a post under today's judge bar is
 *   bounded      one holder at a time, its posts only (the largest, 351 posts on 18 Oct, pairs in
 *                well under a second), stored vectors only — nothing embedded, no paid call
 *   idempotent   a narrative open again is never planned again; posts move only from the holder
 *
 * What breaks if changed carelessly: the holder. Posts are only ever taken from the narrative that
 * holds the folded narrative's own posts now, never from any other narrative.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { answerPolicies, foldNarrativeCalls, groupNarratives, survivorOf, type NarrativeState } from '@insidor/core';
import { PgLearningRepo, PgNarrativeRepo, type Db, type NarrativePostRow } from '@insidor/store';

import { asNarrativePost, narrativePairs, postStanding } from './narratives.ts';

const POST_SPACE = 'multimodal-3.1024.post';
const toMs = (v: unknown): number | null => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

export interface UnmergePlan {
  /** What comes back: its id, title, the holder its posts leave, the posts it had then and the posts it gets. */
  readonly back: readonly { readonly id: string; readonly title: string | null; readonly from: string; readonly postsThen: number; readonly items: readonly string[] }[];
  readonly notBack: readonly { readonly id: string; readonly title: string | null; readonly from: string | null; readonly postsThen: number; readonly why: string }[];
  /** Each holder: its title, posts now, posts after. */
  readonly holders: readonly { readonly id: string; readonly title: string | null; readonly before: number; readonly after: number }[];
  readonly ms: number;
}

export async function planUnmerge(db: Db, opts: { readonly policy: Policy }): Promise<UnmergePlan> {
  const started = Date.now();
  const p = opts.policy;
  const repo = new PgNarrativeRepo(db);
  const applied = await new PgLearningRepo(db).latestApplied();
  const standing = postStanding(answerPolicies(p, { cutoff: applied?.cutoff ?? null, chosenOn: applied?.cutoffModel ?? null }), p);
  const listed = (r: NarrativePostRow | undefined) => {
    if (r === undefined) return false;
    const s = standing(r);
    return s !== 'owner_not_meme' && s !== 'shill' && s !== 'held_kind';
  };

  type Row = { narrative_id: string; state: 'open' | 'merged' | 'gone'; merged_into: string | null; anchor_item: string; title: string | null; member_count: number; updated_at: Date | string };
  const all = await db.query<Row>(`select narrative_id, state, merged_into, anchor_item, title, member_count, updated_at from internal.narrative`);
  const states = new Map<string, NarrativeState>(all.map((r) => [r.narrative_id, { state: r.state, mergedInto: r.merged_into }] as const));
  const callRows = await repo.calls();
  const calls = foldNarrativeCalls(callRows);
  const ownerMerged = new Set(callRows.filter((c) => c.verdict === 'merge').map((c) => c.narrativeId));
  const folded = all.filter((r) => r.state === 'merged' && !ownerMerged.has(r.narrative_id));
  const ownPosts = (r: Pick<Row, 'narrative_id' | 'anchor_item'>) => [...new Set([r.narrative_id.replace(/^n-/, ''), r.anchor_item])];
  const holderOfPost = await repo.ofPosts([...new Set(folded.flatMap(ownPosts))]);
  const titleOf = new Map(all.map((r) => [r.narrative_id, r.title] as const));

  /* Each folded narrative's holder: the narrative its own posts are in now, else the end of its merges. */
  const byHolder = new Map<string, Row[]>();
  const notBack: { id: string; title: string | null; from: string | null; postsThen: number; why: string }[] = [];
  for (const r of folded) {
    const holder = ownPosts(r).map((m) => holderOfPost.get(m)).find((h): h is string => h !== undefined) ?? survivorOf(r.narrative_id, states);
    if (holder === null) {
      notBack.push({ id: r.narrative_id, title: r.title, from: null, postsThen: r.member_count, why: 'its own posts are in no narrative, and what it was folded into is gone' });
      continue;
    }
    byHolder.set(holder, [...(byHolder.get(holder) ?? []), r]);
  }

  const back: { id: string; title: string | null; from: string; postsThen: number; items: string[] }[] = [];
  const holders: { id: string; title: string | null; before: number; after: number }[] = [];
  for (const [holder, list] of byHolder) {
    const [stored] = await repo.byIds([holder]);
    const members = stored?.members ?? [];
    const rows = new Map((await repo.standingRows(members)).map((r) => [r.itemId, r] as const));
    const posts = members.map((m) => rows.get(m)).filter((r): r is NarrativePostRow => listed(r));
    const vec = await repo.vectors(posts.map((r) => r.itemId), POST_SPACE, 'post');
    const pic = await repo.vectors(posts.map((r) => r.itemId), p.group.image.space, 'picture');
    const firstSeen = new Map((members.length === 0 ? [] : await db.query<{ item_id: string; first_seen_at: Date | string }>(`select item_id, first_seen_at from public.item where item_id = any($1::text[])`, [members])).map((r) => [r.item_id, toMs(r.first_seen_at) ?? 0] as const));
    const inHolder = new Set(members);
    /* Pins: each folded narrative's own posts, oldest fold first; then the holder's own. */
    const pinned = new Map<string, string>();
    for (const r of [...list].sort((a, b) => (toMs(a.updated_at) ?? 0) - (toMs(b.updated_at) ?? 0))) for (const m of ownPosts(r)) if (inHolder.has(m) && !pinned.has(m)) pinned.set(m, r.narrative_id);
    const own = all.find((r) => r.narrative_id === holder);
    if (own !== undefined) for (const m of ownPosts(own)) if (inHolder.has(m) && !pinned.has(m)) pinned.set(m, holder);
    const withVec = posts.filter((r) => vec.has(r.itemId));
    const g = groupNarratives({ posts: withVec.map(asNarrativePost), pairs: narrativePairs(withVec, vec, pic, p), calls, previous: new Map(), single: new Set(), vectors: vec, pinned }, p);
    const groupOf = new Map<string, readonly string[]>();
    for (const x of g.narratives) for (const m of x.members) {
      const pin = pinned.get(m);
      if (pin !== undefined && pin !== holder) groupOf.set(pin, x.members);
    }
    let moved = 0;
    for (const r of list) {
      const foldedAt = toMs(r.updated_at) ?? 0;
      const mine = (groupOf.get(r.narrative_id) ?? []).filter((m) => pinned.get(m) === r.narrative_id || (!pinned.has(m) && (firstSeen.get(m) ?? Infinity) <= foldedAt));
      if (mine.length < p.narrative.minPosts) {
        const why = !ownPosts(r).some((m) => inHolder.has(m))
          ? 'its own posts are not in the narrative it was folded into'
          : !ownPosts(r).some((m) => vec.has(m))
            ? 'its own posts have no stored vector (kept three days)'
            : 'fewer than two of its posts group with its own';
        notBack.push({ id: r.narrative_id, title: r.title, from: holder, postsThen: r.member_count, why });
        continue;
      }
      back.push({ id: r.narrative_id, title: r.title, from: holder, postsThen: r.member_count, items: mine });
      moved += mine.length;
    }
    holders.push({ id: holder, title: titleOf.get(holder) ?? null, before: members.length, after: members.length - moved });
  }
  return { back, notBack, holders: holders.sort((a, b) => b.before - a.before), ms: Date.now() - started };
}

/** The plan as the owner reads it. */
export function unmergeLines(plan: UnmergePlan, mode: 'dry' | 'live'): string[] {
  const t = (s: string | null) => (s ?? '—').replace(/\|/g, '/');
  return [
    `# Undoing the merges nobody asked for (${mode === 'dry' ? 'dry run: nothing written' : 'written'}), ${new Date().toISOString().slice(0, 16)} UTC`,
    '',
    `${plan.back.length + plan.notBack.length} narratives were folded into others with no merge call of mine; ${plan.back.length} come back with ${plan.back.reduce((s, b) => s + b.items.length, 0)} posts, ${plan.notBack.length} stay folded (their link keeps opening the narrative they are in). Planned in ${plan.ms} ms.`,
    '',
    '## What they leave',
    '',
    '| narrative | title | posts now | posts after |',
    '|---|---|---|---|',
    ...plan.holders.map((h) => `| ${h.id} | ${t(h.title)} | ${h.before} | ${h.after} |`),
    '',
    '## Back',
    '',
    '| narrative | title | posts when folded | posts back | leaves |',
    '|---|---|---|---|---|',
    ...[...plan.back].sort((a, b) => b.items.length - a.items.length).map((b) => `| ${b.id} | ${t(b.title)} | ${b.postsThen} | ${b.items.length} | ${b.from} |`),
    '',
    '## Not back',
    '',
    '| narrative | title | posts when folded | in | why |',
    '|---|---|---|---|---|',
    ...plan.notBack.map((b) => `| ${b.id} | ${t(b.title)} | ${b.postsThen} | ${b.from ?? '—'} | ${b.why} |`),
  ];
}
