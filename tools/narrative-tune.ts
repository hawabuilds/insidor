/**
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-tune.ts '[{"name":"x","n":{"sameMeaning":0.75}}]'`
 *
 * HOW TIGHT THE GROUPING IS, MEASURED (the owner, 2026-10-18: "a post joins a narrative only if
 * it's clearly about the same subject, tested against my past merges and Not a narrative calls").
 * Replays the regroup (core `groupNarratives`) over the window's good posts with no pins and none
 * of the owner's calls, under the live policy and each variant given, and prints for each:
 *
 *   groups / shown / biggest   how many narratives it would make, and the five biggest
 *   name purity                of a shown narrative's posts, the share carrying its most common name
 *   owner pairs together       of the post pairs in each "Not a narrative", how many it still groups
 *   good joins kept            same-name pairs from different accounts at 0.75 or closer that join,
 *                              and how many joined under the live policy but not under the variant
 *
 * The owner's merges and removed posts are the other lessons; on 18 Oct there were none to test on.
 * Read only; free (stored posts and vectors).
 *
 * What breaks if changed carelessly: the replay must pair posts as a pass does — it uses the
 * runner's own `narrativePairs`, `postStanding` and `asNarrativePost`, never a copy.
 */
import process from 'node:process';
import { DEFAULT_POLICY as P, type Policy } from '../contracts/src/policy.ts';
import { answerPolicies, foldNarrativeCalls, groupNarratives, compactName } from '../core/src/index.ts';
import { createPool, DB_ROLE, PgLearningRepo, PgNarrativeRepo, withTransaction } from '../store/src/index.ts';
import { asNarrativePost, narrativePairs, postStanding } from '../services/runner/src/work/narratives.ts';

const SPACE = P.group.image.postSpace;
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-tune' });
type V = { name: string; p: Policy };
const variant = (name: string, n: Partial<Policy['narrative']>): V => ({ name, p: { ...P, narrative: { ...P.narrative, ...n } } });
const variants: V[] = JSON.parse(process.argv[2] ?? '[]').map((x: { name: string; n: Partial<Policy['narrative']> }) => variant(x.name, x.n));
variants.unshift(variant('now', {}));
try {
  await withTransaction(pool, async (db) => {
    await db.query('set transaction read only');
    const repo = new PgNarrativeRepo(db);
    const applied = await new PgLearningRepo(db).latestApplied();
    const held = answerPolicies(P, { cutoff: applied?.cutoff ?? null, chosenOn: applied?.cutoffModel ?? null });
    const rows = await repo.candidates(Date.now() - P.narrative.windowMs, true);
    const st = postStanding(held, P);
    const good = rows.filter((r) => st(r) === 'good');
    const vec = await repo.vectors(good.map((r) => r.itemId), SPACE, 'post');
    const used = good.filter((r) => vec.has(r.itemId)).slice(0, P.narrative.maxPosts);
    const pics = await repo.vectors(used.filter((r) => r.media !== null).map((r) => r.itemId), P.group.image.space, 'picture');
    const authors = new Map((await db.query<{ item_id: string; author_key: string }>('select item_id, author_key from public.item where item_id = any($1::text[])', [used.map((r) => r.itemId)])).map((r) => [r.item_id, r.author_key]));
    const nameOf = new Map(used.map((r) => [r.itemId, r.proposedName === null ? null : compactName(r.proposedName)]));
    const calls = await repo.calls();
    const notNarr = calls.filter((c) => c.verdict === 'not_narrative').map((c) => c.members);
    const pairsOwner = notNarr.flatMap((ms) => ms.flatMap((a, i) => ms.slice(i + 1).map((b) => [a, b] as const)));
    const posts = used.map(asNarrativePost);
    console.log(`posts ${used.length}; owner not-a-narrative pairs ${pairsOwner.length} (${notNarr.length} calls)`);
    let base: Map<string, number> | null = null;
    for (const v of variants) {
      const pairs = narrativePairs(used, vec, pics, v.p);
      const g = groupNarratives({ posts, pairs, calls: foldNarrativeCalls([]), previous: new Map(), single: new Set(), vectors: vec }, v.p);
      const groupOf = new Map<string, number>();
      g.narratives.forEach((x, i) => { for (const m of x.members) groupOf.set(m, i); });
      const multi = g.narratives.filter((x) => x.members.length >= 2);
      const shown = multi.filter((x) => new Set(x.members.map((m) => authors.get(m) ?? m)).size >= 2);
      // purity: share of member posts whose judge name equals the group's most common name
      let pure = 0, tot = 0;
      for (const x of shown) {
        const c = new Map<string, number>();
        for (const m of x.members) { const k = nameOf.get(m); if (k) c.set(k, (c.get(k) ?? 0) + 1); }
        const top = Math.max(0, ...c.values());
        pure += top; tot += x.members.length;
      }
      const together = (a: string, b: string) => groupOf.has(a) && groupOf.get(a) === groupOf.get(b);
      const ownerBad = pairsOwner.filter(([a, b]) => together(a, b)).length;
      // good joins: same judge name, different accounts, posts close (>= 0.75)
      let goodPairs = 0, goodKept = 0, lost = 0;
      for (const pr of pairs) {
        const na = nameOf.get(pr.a), nb = nameOf.get(pr.b);
        if (!na || na !== nb || authors.get(pr.a) === authors.get(pr.b) || pr.meaning < 0.75) continue;
        goodPairs += 1;
        if (together(pr.a, pr.b)) goodKept += 1;
        else if (base !== null && base.get(pr.a) !== undefined && base.get(pr.a) === base.get(pr.b)) lost += 1;
      }
      const sizes = shown.map((x) => x.members.length).sort((a, b) => b - a);
      console.log(`${v.name.padEnd(14)} groups>=2 ${multi.length} shown ${shown.length} biggest ${sizes.slice(0, 5).join(',')} name-purity ${(pure / Math.max(1, tot)).toFixed(3)} owner-not-narrative pairs still together ${ownerBad}/${pairsOwner.length} good same-name joins kept ${goodKept}/${goodPairs} (lost vs now: ${lost}) links ${JSON.stringify(g.links)}`);
      if (base === null) base = groupOf;
    }
  });
} finally {
  await pool.end();
}
