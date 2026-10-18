/**
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-same.ts [dry] [--out <file.md>]`
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-same.ts live [--out <file.md>]`
 *
 * THE DUPLICATES ALREADY MADE (the owner, 2026-10-18: "the same narrative posted several times").
 * The regroup now joins a new group to the narrative of its subject and merges a newer duplicate
 * into the older (core group/narrative-same.ts), but only over the shown narratives with a post in
 * the last `narrative.same.lookbackMs`. This applies the same rule once over EVERY shown narrative,
 * and lists the narratives the two-accounts rule takes off the screen until they grow.
 *
 *   dry   (the default) reads only and prints: each merge (the newer → the older, how alike, the
 *         name they share, their posts) and each narrative under `minPosts` posts from
 *         `minAccounts` accounts (kept, not listed — the projector drops its page)
 *   live  the same merges, written in one transaction as automatic merges (0108 `merged_by`
 *         'same_subject'): the posts move, the merged one stays with where it went, and the
 *         projector writes its public.story_alias so its link opens the older narrative
 *
 * Never a narrative the owner made a call on, or hid. Free: stored posts, names and vectors;
 * nothing embedded, judged or titled. Safe to run again: a narrative merged is never planned again.
 *
 * What breaks if changed carelessly: run it after 0108. Before it the merge is written without
 * who made it, and reads as the owner's.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { foldNarrativeCalls, hiddenByOwner, sameSubjectMerges, subjectName, subjectOf, subjectPosts } from '../core/src/index.ts';
import { createPool, DB_ROLE, PgNarrativeRepo, withTransaction } from '../store/src/index.ts';

const SPACE = 'multimodal-3.1024.post';
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const mode = process.argv[2] === 'live' ? 'live' : 'dry';
if (process.argv[2] !== undefined && !['dry', 'live', '--out'].includes(process.argv[2])) {
  console.error('usage: tools/narrative-same.ts [dry|live] [--out <file.md>]');
  process.exit(2);
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-narrative-same' });
try {
  const plan = await withTransaction(pool, async (tx) => {
    await tx.query('set transaction read only');
    const repo = new PgNarrativeRepo(tx);
    const callRows = await repo.calls();
    const calls = foldNarrativeCalls(callRows);
    const all = (await repo.live(0)).filter((x) => !hiddenByOwner(x.id, x.members, calls, P));
    const ids = [...new Set(all.flatMap((x) => x.members))];
    const rawNames = await repo.postNames(ids);
    const names = new Map(ids.map((id) => [id, subjectName(rawNames.get(id)?.name ?? null, P)] as const));
    const now = Date.now();
    const oldest = (members: readonly string[]) => Math.min(now, ...members.map((m) => rawNames.get(m)?.atMs ?? now));
    const vectors = new Map<string, Float32Array>();
    for (let i = 0; i < ids.length; i += 2_000) for (const [k, v] of await repo.vectors(ids.slice(i, i + 2_000), SPACE, 'post')) vectors.set(k, v);
    const subjects = all.map((x) => subjectOf(x.id, subjectPosts(x.members, names, vectors), oldest(x.members)));
    const untouchable = new Set(callRows.flatMap((c) => [c.narrativeId, ...(c.otherId === null ? [] : [c.otherId])]));
    const merges = sameSubjectMerges(subjects, untouchable, P);
    const rows = await repo.standingRows(ids);
    const authorOf = new Map(rows.map((r) => [r.itemId, r.authorKey ?? `post:${r.itemId}`] as const));
    const merged = new Set(merges.map((m) => m.from));
    const growsInto = new Map<string, string[]>();
    for (const m of merges) growsInto.set(m.into, [...(growsInto.get(m.into) ?? []), m.from]);
    const byId = new Map(all.map((x) => [x.id, x] as const));
    const after = (x: (typeof all)[number]) => [...x.members, ...(growsInto.get(x.id) ?? []).flatMap((f) => byId.get(f)?.members ?? [])];
    const under = all
      .filter((x) => !merged.has(x.id))
      .map((x) => ({ x, posts: after(x).length, accounts: new Set(after(x).map((m) => authorOf.get(m) ?? `post:${m}`)).size }))
      .filter((u) => u.posts < P.narrative.minPosts || u.accounts < P.narrative.minAccounts);
    return { all, merges, byId, subjects: new Map(subjects.map((s) => [s.id, s] as const)), under };
  });
  if (mode === 'live' && plan.merges.length > 0) {
    await withTransaction(pool, (tx) => new PgNarrativeRepo(tx).save({ narratives: [], retired: plan.merges.map((m) => ({ id: m.from, into: m.into, by: 'same_subject' as const })), removed: [] }));
  }
  const t = (id: string) => {
    const x = plan.byId.get(id);
    return `${id} "${x?.title ?? '(no title yet)'}" (${x?.members.length ?? 0} posts)`;
  };
  const lines = [
    `# Same-subject merges (${mode}): ${plan.merges.length} of ${plan.all.length} shown narratives`,
    '',
    `Rule: the same most common judge name (at least ${P.narrative.same.nameShare} of each one's named posts) and posts' average vectors at least ${P.narrative.same.meaning} alike. Never a narrative the owner called on.`,
    '',
    ...plan.merges.map((m) => `- ${t(m.from)} → ${t(m.into)} — meaning ${m.meaning.toFixed(3)}, name "${plan.subjects.get(m.from)?.name ?? ''}"`),
    '',
    `# Not listed until they grow: ${plan.under.length} narratives under ${P.narrative.minPosts} posts from ${P.narrative.minAccounts} accounts (kept, never deleted)`,
    '',
    ...plan.under.map((u) => `- ${t(u.x.id)}, ${u.accounts} account${u.accounts === 1 ? '' : 's'}`),
  ];
  console.log(lines.join('\n'));
  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
