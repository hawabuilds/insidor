/**
 * `SPEND=live node --env-file=.env.local tools/name-guess-eval.ts --yes [--cap 1.2] [--linked 120] [--cache <file>] [--out <file>]`
 *
 * THE NAMER, BEFORE VS AFTER, ON KNOWN PAIRS HELD OUT FROM ITS EXAMPLES. For each held-out post
 * — every post the owner confirmed a coin for (and the ones he called coinless, guessed but not
 * scored), the founders' known origin posts we can read, the gold additions, and the newest
 * `--linked` posts a coin's own links carry — it asks:
 *
 *   before   the judge's own names for the post (proposed, then alternates: what Create offers
 *            and what matching searches today), and Create's chips as the projector orders them
 *   after    the namer (adapters/judge/anthropic name-guess.ts) with the post's 10 nearest known
 *            pairs — ONLY pairs that existed before the post was made (the coin launched, the
 *            owner's call made), and never the post's own
 *
 * and reports how often the real coin's name or ticker is the first guess (top 1) or among the
 * first five (top 5), by core `guessHit` (case, accents, '$', spaces, one slip in a long word),
 * with 10 examples. It writes every post's guesses to `--out` for coin matching's own before/after.
 *
 * Paid: the namer's calls and the vectors no table already holds, on the LEARNING book, refused
 * past `--cap`. Vectors are cached in `--cache` and reused by tools/name-examples.ts.
 *
 * What breaks if changed carelessly: the time filter. Without it a held-out post is shown the
 * coins made of its own story after it, and the "after" number measures copying, not guessing.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import type { NameGuess, NameSubject } from '../contracts/src/ports/names.ts';
import { cleanGuesses, exampleShown, guessHit, nearestExamples, type ExampleVector } from '../core/src/create/name-guess.ts';
import { sourceOfItemId } from '../core/src/qualify/precedents.ts';
import { POST_SPACE } from '../adapters/embed/voyage/src/index.ts';
import { httpClient as judgeClient } from '../adapters/judge/anthropic/src/index.ts';
import { anthropicNamer } from '../adapters/judge/anthropic/src/name-guess.ts';
import { postNameIdeas } from '../services/project/src/post-match.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { allPairPosts, vectorsFor, type PairPost } from './lib/name-pairs.ts';
import { judgeSetup } from './lib/pass-rates.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const CAP = Number(arg('--cap', '1.2'));
const LINKED = Number(arg('--linked', '120'));
const CACHE = arg('--cache', 'var/name-vectors.json');
const OUT = arg('--out', 'var/name-guess-eval.json');
const MAX_PAID_VECTORS = Number(arg('--max-vectors', '1500'));

if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('name-guess-eval refused: the namer and the embeddings cost money. Set SPEND=live and pass --yes.');
  process.exit(2);
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-name-guess-eval' });
const db = asDb(pool);
const { meter, close } = await openSharedMeter(CAP, process.env, 'learning');

try {
  const posts = await allPairPosts(db);
  const ownerCalls = await db.query<{ item_id: string; verdict: string }>(
    `select distinct on (item_id) item_id, verdict from internal.owner_feedback where subject_kind = 'coin_match' order by item_id, created_at desc, id desc`,
  );
  const coinless = ownerCalls.filter((c) => c.verdict === 'none').map((c) => c.item_id).filter((id) => !(posts.get(id)?.coins.some((c) => !c.rejected) ?? false));
  for (const id of coinless) posts.delete(id);
  const coinlessRows = coinless.length === 0 ? [] : await db.query<{ item_id: string; body: string | null; media: unknown; posted_at: Date | null }>('select item_id, body, media, posted_at from public.item where item_id = any($1::text[])', [coinless]);
  const { postPicture } = await import('../core/src/qualify/precedents.ts');
  const none: PairPost[] = coinlessRows.map((r) => ({ itemId: r.item_id, text: r.body ?? '', picture: postPicture(r.media), postedAtMs: r.posted_at === null ? null : new Date(r.posted_at).getTime(), coins: [], sources: new Set() }));

  /* The held-out sets. A post in two is counted in the first that names it. */
  const all = [...posts.values()];
  const set = (s: PairPost): string =>
    s.sources.has('owner') ? 'owner' : s.sources.has('known') ? 'known' : s.sources.has('gold') ? 'gold' : s.sources.has('created') ? 'created' : s.sources.has('linked') ? 'linked' : 'sheet';
  const linkedNewest = all.filter((p) => set(p) === 'linked' && p.postedAtMs !== null).sort((a, b) => (b.postedAtMs ?? 0) - (a.postedAtMs ?? 0)).slice(0, LINKED);
  const held = [...all.filter((p) => ['owner', 'known', 'gold', 'created'].includes(set(p))), ...linkedNewest, ...none];
  console.log(`example posts ${all.length} (${all.reduce((n, p) => n + p.coins.length, 0)} coin names); held out ${held.length}: ` + ['owner', 'known', 'gold', 'created', 'linked'].map((s) => `${s} ${held.filter((p) => p.coins.length > 0 && set(p) === s).length}`).join(', ') + `, coinless ${none.length}`);

  const vectors = await vectorsFor(db, [...all, ...none], POST_SPACE, CACHE, meter, MAX_PAID_VECTORS);
  console.log(`vectors: ${vectors.size} of ${all.length + none.length} posts`);

  /* The judge's names for each held-out post: its newest answer to the post question. */
  const judged = await db.query<{ item_id: string; proposed_name: string | null; alternate_names: string[] | null }>(
    `select distinct on (item_id) item_id, proposed_name, alternate_names from internal.post_judgement
      where prompt_id not like 'post-kind%' and item_id = any($1::text[]) order by item_id, judged_at desc, id desc`,
    [held.map((p) => p.itemId)],
  );
  const { loadEvidence } = await import('../eval/src/gold/coin-evidence.ts');
  const evidenceNames = new Map<string, string>();
  for (const e of loadEvidence().values()) for (const [postId, j] of Object.entries(e.judged ?? {})) if (j.proposedName !== null) evidenceNames.set(postId, j.proposedName);
  const judgeNames = new Map<string, NameGuess[]>();
  for (const j of judged) judgeNames.set(j.item_id, [j.proposed_name, ...(j.alternate_names ?? [])].flatMap((n) => (n === null || n.trim() === '' ? [] : [{ name: n, ticker: n.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, P.names.maxTickerChars) }])));
  for (const p of held) {
    const postId = p.itemId.split(':')[1] ?? '';
    const n = evidenceNames.get(postId);
    if (!judgeNames.has(p.itemId) && n !== undefined) judgeNames.set(p.itemId, [{ name: n, ticker: n.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, P.names.maxTickerChars) }]);
  }

  /* The examples each held-out post may see: pairs that existed before it, never its own. */
  const examplesFor = (h: PairPost): ExampleVector[] => {
    const at = h.postedAtMs ?? Number.POSITIVE_INFINITY;
    return all.flatMap((e) => {
      const values = vectors.get(e.itemId);
      if (e.itemId === h.itemId || values === undefined || e.postedAtMs === null || e.postedAtMs >= at) return [];
      const ready = e.coins.filter((c) => c.availableAtMs !== null && c.availableAtMs < at);
      const coins = ready.filter((c) => !c.rejected).map((c) => ({ name: c.name, ticker: c.ticker }));
      const notCoins = ready.filter((c) => c.rejected).map((c) => ({ name: c.name, ticker: c.ticker }));
      return coins.length + notCoins.length === 0 ? [] : [{ itemId: e.itemId, text: e.text, seen: null, coins, notCoins, postedAtMs: e.postedAtMs, values }];
    });
  };

  const subjects: NameSubject[] = [];
  const shownCount = new Map<string, number>();
  for (const h of held) {
    const v = vectors.get(h.itemId);
    const near = v === undefined ? [] : nearestExamples(v, examplesFor(h), P.names.k, (e) => e.itemId === h.itemId, { source: sourceOfItemId(h.itemId), reserve: P.names.sameSourceFirst });
    shownCount.set(h.itemId, near.length);
    subjects.push({ ref: h.itemId, text: h.text.trim().slice(0, P.names.maxChars), picture: h.picture, examples: near.map((e) => exampleShown(e, P.names)) });
  }

  const { setup, price } = judgeSetup(process.env);
  const client = judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.names.maxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, pictureSize: 'small', fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  const namer = anthropicNamer({ client, meter, now: () => Date.now() as never, model: setup.model, judge: P.judge, names: P.names, effort: price.effort });
  const after = new Map<string, { guesses: readonly NameGuess[]; seen: string | null }>();
  let spentNames = 0;
  for (let i = 0; i < subjects.length; i += P.names.perCall) {
    const batch = subjects.slice(i, i + P.names.perCall);
    const r = await namer.guess(batch, { capUsd: CAP, spentUsd: 0, maxCalls: null, deadline: (Date.now() + 120_000) as never });
    spentNames += r.spend.usd;
    for (const o of r.value) if (o.kind === 'guessed') after.set(o.ref, { guesses: cleanGuesses(o.guesses, P.names), seen: o.seen });
    process.stdout.write(`\rguessed ${Math.min(i + batch.length, subjects.length)} of ${subjects.length} ($${spentNames.toFixed(3)})`);
  }
  process.stdout.write('\n');

  /* Scores. */
  const scored = held.filter((h) => h.coins.some((c) => !c.rejected));
  const createOrder = (h: PairPost): NameGuess[] => {
    const j = judgeNames.get(h.itemId) ?? [];
    return [...postNameIdeas(j[0]?.name ?? null, j.slice(1).map((g) => g.name))];
  };
  const pct = (n: number, d: number) => (d === 0 ? '—' : `${n}/${d} (${Math.round((100 * n) / d)}%)`);
  const line = (label: string, rows: PairPost[]) => {
    const real = (h: PairPost) => h.coins.filter((c) => !c.rejected).map((c) => ({ name: c.name, ticker: c.ticker }));
    const b1 = rows.filter((h) => guessHit(judgeNames.get(h.itemId) ?? [], real(h), 1, P.names)).length;
    const b5 = rows.filter((h) => guessHit(judgeNames.get(h.itemId) ?? [], real(h), P.names.guesses, P.names)).length;
    const c1 = rows.filter((h) => guessHit(createOrder(h), real(h), 1, P.names)).length;
    const a1 = rows.filter((h) => guessHit(after.get(h.itemId)?.guesses ?? [], real(h), 1, P.names)).length;
    const a5 = rows.filter((h) => guessHit(after.get(h.itemId)?.guesses ?? [], real(h), P.names.guesses, P.names)).length;
    console.log(`${label.padEnd(28)} n=${String(rows.length).padEnd(4)} before top1 ${pct(b1, rows.length).padEnd(13)} top5 ${pct(b5, rows.length).padEnd(13)} Create first ${pct(c1, rows.length).padEnd(13)} | after top1 ${pct(a1, rows.length).padEnd(13)} top5 ${pct(a5, rows.length)}`);
  };
  console.log('\nThe real coin\'s name or ticker among the guesses (a post with several coins counts when any one is guessed):');
  line('all held out', scored);
  for (const s of ['owner', 'known', 'gold', 'created', 'linked']) {
    const rows = scored.filter((h) => set(h) === s);
    if (rows.length > 0) line(`  ${s}`, rows);
  }
  line('  judged by the judge', scored.filter((h) => (judgeNames.get(h.itemId) ?? []).length > 0));
  line('  with examples shown', scored.filter((h) => (shownCount.get(h.itemId) ?? 0) > 0));
  console.log(`namer: ${after.size} of ${held.length} posts answered, $${spentNames.toFixed(4)} for ${held.length} posts = $${(spentNames / Math.max(1, held.length)).toFixed(5)} a post`);

  /* Ten examples: the first five hits and five misses of the owner's and known posts, then the rest. */
  const real = (h: PairPost) => h.coins.filter((c) => !c.rejected).map((c) => ({ name: c.name, ticker: c.ticker }));
  const order = [...scored].sort((a, b) => ['owner', 'known', 'gold', 'created', 'linked'].indexOf(set(a)) - ['owner', 'known', 'gold', 'created', 'linked'].indexOf(set(b)));
  const hits = order.filter((h) => guessHit(after.get(h.itemId)?.guesses ?? [], real(h), P.names.guesses, P.names));
  const misses = order.filter((h) => !guessHit(after.get(h.itemId)?.guesses ?? [], real(h), P.names.guesses, P.names));
  const ten = [...hits.slice(0, 6), ...misses.slice(0, 4)];
  console.log('\nTen examples:');
  for (const h of ten) {
    const a = after.get(h.itemId);
    console.log(`- ${h.itemId} [${set(h)}] "${h.text.replace(/\s+/g, ' ').slice(0, 110)}"${a?.seen ? ` (picture: ${a.seen})` : ''}`);
    console.log(`    ours:  ${(a?.guesses ?? []).map((g) => `${g.name} $${g.ticker}`).join(' | ') || '—'}`);
    console.log(`    judge: ${(judgeNames.get(h.itemId) ?? []).map((g) => g.name).join(' | ') || '—'}`);
    console.log(`    real:  ${real(h).map((c) => `${c.name} $${c.ticker}`).slice(0, 6).join(' | ')}${real(h).length > 6 ? ` (+${real(h).length - 6})` : ''}`);
  }

  writeFileSync(OUT, JSON.stringify(Object.fromEntries(held.map((h) => [h.itemId, {
    set: real(h).length === 0 ? 'coinless' : set(h),
    before: judgeNames.get(h.itemId) ?? [],
    after: after.get(h.itemId)?.guesses ?? null,
    seen: after.get(h.itemId)?.seen ?? null,
    real: h.coins.filter((c) => !c.rejected).map((c) => ({ name: c.name, ticker: c.ticker, address: c.address })),
    examplesShown: shownCount.get(h.itemId) ?? 0,
  }])), null, 1));
  console.log(`\nwrote ${OUT}; spent $${meter.spentUsd().toFixed(4)} on the learning book`);
} finally {
  await close();
  await pool.end();
}
