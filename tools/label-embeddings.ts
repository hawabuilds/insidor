/**
 * EMBED EVERY POST THE OWNER HAS LABELLED, AND MEASURE THE NOT-A-MEME HOLD — the one-off (and
 * re-runnable) half of the judge's precedents (Policy.judge.precedents).
 *
 *   SPEND=live node --env-file=.env.local tools/label-embeddings.ts --yes [--cache <file>] [--cap <usd>]
 *   node --env-file=.env.local tools/label-embeddings.ts --measure [--cache <file>]
 *
 * Separate from the runner because the runner reads only the database's labels (taps, coin calls,
 * gold additions, missed posts); the committed ones — the hand-labelled live set
 * (eval/src/feed/live-labels.json), the gold sheets' origin posts (tuning split only: the holdout
 * is read to report, never to teach) and the owner's hand-gold list — reach internal.label_embedding
 * only through here. One label per post, by the same rank the runner uses (store `mergeLabels`).
 *
 * ★ NEVER PAYS TWICE. A post already stored (or in `--cache`) with the same words and picture is not
 * embedded again. Paid embeddings go on the LEARNING book (tools/lib/shared-meter.ts), capped by
 * `--cap` (default $0.50). Before 0069 is applied nothing is written to the table; `--cache` keeps
 * the vectors in a file so a later run writes them without paying again.
 *
 * ★ THE HOLD BAR, CHOSEN ON THE LABELS, LEAVE ONE OUT. For every labelled post: how close it is to
 * the closest OTHER "not a meme" label (never itself: not its id, picture or words). The bar printed
 * is the lowest, on a 0.01 grid, at which NO "meme" label of any kind (gold, coined, missed, the
 * owner's meme taps, the live set's memes) would be held; it then reports how many "not" labels it
 * holds. Policy.judge.precedents.holdNotSimilarity is set from it by hand.
 *
 * What breaks if changed carelessly: the words and picture embedded must come from core
 * `embedInput` and `postPicture`, as the live scorer's do, or a label and a live post are vectors of
 * different things and every similarity — and the hold bar — means something else.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { closestNot, embedInput, postPicture, type LabelledVector } from '../core/src/qualify/precedents.ts';
import { POST_SPACE, voyageEmbed, httpClient as voyageClient } from '../adapters/embed/voyage/src/index.ts';
import { loadEvidence } from '../eval/src/gold/coin-evidence.ts';
import { tuning } from '../eval/src/gold/coin-origins.ts';
import { asDb, createPool, DB_ROLE, PgLabelEmbeddingRepo, mergeLabels, type LabelledPost } from '../store/src/index.ts';
import { GOLD_PICTURES, HAND_GOLD } from './lib/pass-rates.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const P = DEFAULT_POLICY;
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const measureOnly = process.argv.includes('--measure');
const cacheFile = arg('--cache');
const capUsd = Number(arg('--cap') ?? '0.5');
if (!measureOnly && (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes'))) {
  console.error('label-embeddings refused: embedding costs money. Set SPEND=live and pass --yes, or pass --measure.');
  process.exit(1);
}

const LABELS = new URL('../eval/src/feed/live-labels.json', import.meta.url);
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-label-embeddings' });
const db = asDb(pool);
const repo = new PgLabelEmbeddingRepo(db);

/* ── 1. every label, one per post ────────────────────────────────────────────────────────────── */

const files: LabelledPost[] = [];
for (const p of (JSON.parse(readFileSync(LABELS, 'utf8')) as { posts: { itemId: string; text: string; imageUri: string | null; label: string; ownerLabel?: string; why: string }[] }).posts) {
  const label = p.ownerLabel ?? p.label;
  if (label !== 'meme' && label !== 'not') continue;
  files.push({ itemId: p.itemId, label, kind: 'labels', text: p.text, why: p.why, picture: p.imageUri });
}
const recorded = existsSync(GOLD_PICTURES) ? (JSON.parse(readFileSync(GOLD_PICTURES, 'utf8')) as { pictures: Record<string, string | null> }).pictures : {};
const evidence = loadEvidence();
for (const c of tuning()) {
  const post = evidence.get(c.id)?.origin?.post ?? null;
  if (post === null) continue;
  files.push({ itemId: `x:${post.postId}`, label: 'meme', kind: 'gold', text: post.text, why: `people made a coin of it (${c.name})`, picture: recorded[post.postId] ?? post.imageUri });
}
const handIds = (JSON.parse(readFileSync(HAND_GOLD, 'utf8')) as { itemIds: string[]; notes?: Record<string, string> });
const held = await db.query<{ item_id: string; body: string | null; media: unknown }>('select item_id, body, media from public.item where item_id = any($1)', [handIds.itemIds]);
for (const h of held) files.push({ itemId: h.item_id, label: 'meme', kind: 'gold', text: h.body ?? '', why: handIds.notes?.[h.item_id] ?? 'the owner put it in hand gold', picture: null, media: h.media });

const all = mergeLabels([...files, ...(await repo.fromDatabase())]);
const inputs = new Map(all.map((l) => [l.itemId, embedInput(l.text, l.picture ?? postPicture(l.media), P)] as const));
const counts = (xs: readonly LabelledPost[]) => Object.fromEntries([...new Set(xs.map((x) => `${x.kind}:${x.label}`))].sort().map((k) => [k, xs.filter((x) => `${x.kind}:${x.label}` === k).length]));
console.log(`${all.length} labelled posts:`, counts(all), `| with words ${[...inputs.values()].filter((i) => i.text !== '').length}, with a picture ${[...inputs.values()].filter((i) => i.picture !== null).length}`);

/* ── 2. vectors: stored, cached, or embedded now ─────────────────────────────────────────────── */

type Cached = { itemId: string; text: string; picture: string | null; values: number[] };
const cache = new Map<string, Cached>();
if (cacheFile !== null && existsSync(cacheFile)) for (const c of JSON.parse(readFileSync(cacheFile, 'utf8')) as Cached[]) cache.set(c.itemId, c);
for (const s of await repo.all(POST_SPACE)) if (!cache.has(s.itemId)) cache.set(s.itemId, { itemId: s.itemId, text: s.text, picture: s.picture, values: Array.from(s.values) });
const same = (c: Cached | undefined, i: { text: string; picture: string | null }): boolean => c !== undefined && c.text === i.text && (c.picture === i.picture || c.picture === null);
const todo = all.filter((l) => {
  const i = inputs.get(l.itemId)!;
  return (i.text !== '' || i.picture !== null) && !same(cache.get(l.itemId), i);
});
console.log(`${todo.length} to embed now (${all.length - todo.length} already held).`);

let paid = 0;
if (todo.length > 0 && !measureOnly) {
  const { meter, close } = await openSharedMeter(capUsd, process.env, 'learning');
  const embed = voyageEmbed({ client: voyageClient({ apiKey: (process.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
  try {
    for (let k = 0; k < todo.length; k += embed.maxBatch) {
      const part = todo.slice(k, k + embed.maxBatch);
      const line = meter.line();
      const asked = part.map((l) => inputs.get(l.itemId)!);
      const r = await embed.embedPosts!(asked, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
      paid += r.spend.usd;
      part.forEach((l, j) => {
        const v = r.value[j];
        /* A dead picture came back as the words alone: record it as embedded without one. */
        if (v !== null && v !== undefined) cache.set(l.itemId, { itemId: l.itemId, text: asked[j]!.text, picture: asked[j]!.picture, values: Array.from(v.values) });
      });
      if (cacheFile !== null) writeFileSync(cacheFile, JSON.stringify([...cache.values()]));
    }
  } finally {
    await close();
  }
  console.log(`embedded ${todo.length} for $${paid.toFixed(4)} on the learning book.`);
}

/* ── 3. written to the table (after 0069) ────────────────────────────────────────────────────── */

let written = 0;
let noTable = false;
if (!measureOnly) {
  const stored = new Map((await repo.all(POST_SPACE)).map((s) => [s.itemId, s] as const));
  for (const l of all) {
    const c = cache.get(l.itemId);
    if (c === undefined) continue;
    const s = stored.get(l.itemId);
    if (s !== undefined && s.label === l.label && s.kind === l.kind && s.text === c.text && s.picture === c.picture) continue;
    const ok = await repo.put({ itemId: l.itemId, label: l.label, kind: l.kind, text: c.text, why: l.why, picture: c.picture }, POST_SPACE, c.values);
    if (!ok) {
      noTable = true;
      break;
    }
    written += 1;
  }
  console.log(noTable ? 'internal.label_embedding is not there yet (0069): nothing written; the vectors are in --cache.' : `${written} rows written to internal.label_embedding.`);
}

/* ── 4. the hold bar, leave one out ──────────────────────────────────────────────────────────── */

const vectors: (LabelledVector & { kind: string })[] = all.flatMap((l) => {
  const c = cache.get(l.itemId);
  return c === undefined ? [] : [{ itemId: l.itemId, label: l.label, text: c.text, why: l.why, picture: c.picture, values: c.values, kind: l.kind }];
});
const norm = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase();
const closest = vectors.map((v) => {
  const words = norm(v.text);
  const self = (l: LabelledVector): boolean => l.itemId === v.itemId || (v.picture !== null && l.picture === v.picture) || (words !== '' && norm(l.text) === words);
  const n = closestNot(v.values, vectors, self);
  return { id: v.itemId, label: v.label, kind: v.kind, s: n?.similarity ?? null, like: n?.label.itemId ?? null, text: v.text.slice(0, 80) };
});
const memes = closest.filter((c) => c.label === 'meme' && c.s !== null);
const nots = closest.filter((c) => c.label === 'not' && c.s !== null);
const top = Math.max(...memes.map((m) => m.s!));
const STEP = 0.01;
const bar = Math.round((Math.floor(top / STEP) + 1) * STEP * 100) / 100;
console.log(`\nleave one out, ${vectors.length} labelled posts with a vector (${memes.length} meme, ${nots.length} not):`);
console.log('closest "not a meme" label to each meme label, highest first:');
for (const m of [...memes].sort((a, b) => b.s! - a.s!).slice(0, 8)) console.log(`  ${m.s!.toFixed(3)}  ${m.kind}  ${m.id}  like ${m.like}  ${JSON.stringify(m.text)}`);
for (const t of [0.8, 0.85, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98, bar].sort((a, b) => a - b)) {
  console.log(`  bar ${t.toFixed(2)}: holds ${memes.filter((m) => m.s! >= t).length} meme labels, ${nots.filter((n) => n.s! >= t).length} of ${nots.length} not labels`);
}
console.log(`\nTHE BAR: ${bar.toFixed(2)} (the highest meme label sits at ${top.toFixed(3)}); it holds ${nots.filter((n) => n.s! >= bar).length} of ${nots.length} "not a meme" labels and no meme label.`);
await pool.end();
