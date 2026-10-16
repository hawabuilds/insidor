/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/judge-open-eval.ts --yes
 *    [--models=a,b,c] [--cap=3] [--limit=<n>] [--rows=<file>]`
 *
 * OPEN MODELS AS THE JUDGE, TESTED AGAINST THE LIVE ONE — the owner's test of 2026-10-15. Nothing
 * live changes: no setting, no table but the spend ledger, no deploy. It asks each open model the
 * live judge's exact questions (adapters/judge/openai-compatible: the same prompt files, precedents,
 * ten posts a call, temperature 0, the post's picture) and prints, beside the live judge:
 *
 *   hand gold caught · live non-memes let through · missed posts caught   (the re-tune's three sets)
 *   seconds per post (median, p90) · $ a post · $ a day at today's volume and at For You's alone
 *   agreement with the live judge on the last 24 h of For You posts
 *   the cheap first pass: the open model decides, posts in a borderline confidence band go to the
 *   live judge — the same numbers and the blended cost
 *   and the verdict by the owner's rule: switch only if a model matches or beats the live judge on
 *   all three sets AND costs less.
 *
 * THE SETS. Hand gold, live non-memes and missed posts are composed exactly as tools/retune.ts
 * composes its gate (the same loaders: goldOriginPosts and handGoldIds from tools/lib/pass-rates.ts,
 * buildBlock from eval/src/feed/examples.ts, the same repo reads) — copied here, not imported,
 * because retune.ts runs its command when it is loaded. If retune's composition changes, change
 * `composeGate` with it. The fourth set is every post For You showed in the last 24 hours
 * (internal.feed_history), with the live judge's own stored answers (internal.post_judgement).
 *
 * ★ THE LIVE JUDGE IS RE-ASKED ON THE THREE SETS, NOT READ FROM ITS STORED ANSWERS (my call): every
 * live non-meme is a post the owner tapped "Not a meme" BECAUSE the live judge put it on For You, so
 * its stored answers let 100% of them through by construction, and they were given before the
 * owner's labels existed as precedent. Re-asked now, with the same precedents as the open models,
 * both sides answer the same question at the same moment — what the re-tune's "live now" does. On
 * the For You set its stored answers ARE the thing to compare with, and cost nothing.
 *
 * ★ MONEY: one meter for the whole test on the LEARNING book (`learn:` rows; the open models as
 * vendor `openrouter`, endpoint `learn:judge-open`), with a stage cap of `--cap` dollars (default 3)
 * across everything it pays for: the open models, the live judge's re-ask, and any post or picture
 * vector not already stored. Each call is priced before it leaves and refused past the cap; a model
 * cut short by the cap is reported as cut short, never as finished. Refuses unless SPEND=live and
 * --yes. Without OPENROUTER_API_KEY it says so and stops before reading anything; the key is never
 * printed.
 *
 * What breaks if changed carelessly: every judge must get the same `near` (precedents, picture
 * similarity) and the same posts. Working them out per judge would let two runs of the embedder
 * disagree and blame it on the model.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { MediaRef } from '../contracts/src/vocabulary.ts';
import { closestNot, embedInput, nearestLabelled, postPicture, precedentsFor, sourceOfItemId, type LabelledVector } from '../core/src/qualify/precedents.ts';
import { asDb, createPool, DB_ROLE, PgLabelEmbeddingRepo, PgLearningRepo } from '../store/src/index.ts';
import { buildBlock, type OwnerCall } from '../eval/src/feed/examples.ts';
import { anthropicJudge, httpClient as anthropicClient, priceFor, readJudgeSetup } from '../adapters/judge/anthropic/src/index.ts';
import { DEFAULT_BASE_URL, DEFAULT_VENDOR, ESTIMATE_MARGIN, closestModel, keyAllowance, listModels, openChatClient, openJudge, type HostModel } from '../adapters/judge/openai-compatible/src/index.ts';
import { POST_SPACE, SPACE as PICTURE_SPACE, voyageEmbed, httpClient as voyageClient } from '../adapters/embed/voyage/src/index.ts';
import { postTimeFromId } from '../adapters/platform/x/src/index.ts';
import { BudgetRefused } from '../adapters/kit/vendor/src/index.ts';
import { pictureOf } from '../services/project/src/db.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { goldOriginPosts, handGoldIds } from './lib/pass-rates.ts';
import { agreement, blend, chooseBand, fileRow, grade, ofN, pct, recommend, setRates, speed, subjectOf, timedClient, type Band, type Near, type OpenEvalPost, type Row, type SetRates, type Signal, type Timing } from './lib/judge-open.ts';

const P = DEFAULT_POLICY;
const KEY_VAR = 'OPENROUTER_API_KEY';
/** The owner's picks (2026-10-15), each checked against the host's model list at the start of a run. */
const DEFAULT_MODELS = ['meta-llama/llama-4-maverick', 'qwen/qwen2.5-vl-72b-instruct', 'google/gemma-3-27b-it'];
const DEFAULT_CAP_USD = 3;
/** What the open models' share of the test needs on the host's key, about (three models, all four sets). */
const MIN_KEY_USD = 2;
/** The owner's band for the first pass when the data picks none better. */
const OWNER_BAND: Band = [0.45, 0.85];

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const flag = (f: string) => process.argv.includes(f);
const say = (line = '') => console.log(line);

/* ── 0. the key, then the money switch — before anything is read ─────────────────────────────── */

const apiKey = (process.env[KEY_VAR] ?? '').trim();
if (apiKey === '') {
  say(`judge-open-eval: ${KEY_VAR} is not set, so nothing was run and nothing was spent. Add it to .env.local and run again.`);
  process.exit(0);
}
if (process.env['SPEND'] !== 'live' || !flag('--yes')) {
  console.error(`judge-open-eval refused: this calls paid judges (up to $${DEFAULT_CAP_USD} by default). Set SPEND=live and pass --yes.`);
  process.exit(1);
}
const capUsd = Number(arg('cap') ?? DEFAULT_CAP_USD);
if (!(capUsd > 0)) {
  console.error('judge-open-eval: --cap must be a positive number of dollars');
  process.exit(2);
}
const limit = arg('limit') === null ? null : Number(arg('limit'));
const baseUrl = process.env['OPENROUTER_BASE_URL'] ?? DEFAULT_BASE_URL;

/* ── 1. the models, as the host lists them ───────────────────────────────────────────────────── */

const listed = await listModels(globalThis.fetch, baseUrl, P.judge.timeoutMs);
const asked = (arg('models') ?? DEFAULT_MODELS.join(',')).split(',').map((m) => m.trim()).filter((m) => m !== '');
const models: HostModel[] = [];
for (const a of asked) {
  const m = closestModel(a, listed);
  if (m === null) {
    console.error(`judge-open-eval: the host lists nothing like ${a}; pass --models with ids from ${baseUrl}/models`);
    process.exit(2);
  }
  if (m.usdPerInputToken === null || m.usdPerOutputToken === null) {
    console.error(`judge-open-eval: the host lists no price for ${m.id}`);
    process.exit(2);
  }
  if (!models.some((x) => x.id === m.id)) models.push(m);
  say(`model ${a}${m.id === a ? '' : ` → closest offered: ${m.id}`}: ${m.vision ? 'reads pictures' : 'TEXT ONLY (run text-only)'}, $${(m.usdPerInputToken * 1e6).toFixed(3)}/M in, $${(m.usdPerOutputToken * 1e6).toFixed(3)}/M out`);
}

/* Cheapest first: if the cap stops the test, it stops on the dearest model, after the others are measured. */
models.sort((a, b) => (a.usdPerInputToken ?? 0) - (b.usdPerInputToken ?? 0));

/* The key's own spending limit, before anything is paid: a key capped at $0 stops here, not after the live judge's re-ask. */
const allowance = await keyAllowance(globalThis.fetch, baseUrl, apiKey, P.judge.timeoutMs);
if (allowance.remainingUsd !== null && allowance.remainingUsd < MIN_KEY_USD) {
  say(`judge-open-eval: the ${KEY_VAR} key may spend only $${allowance.remainingUsd.toFixed(2)} more (its limit on the host), so nothing was run and nothing was spent. Raise the key's limit (or add credit) and run again; the test needs about $${MIN_KEY_USD} on that key.`);
  process.exit(0);
}

/* ── 2. the sets ─────────────────────────────────────────────────────────────────────────────── */

const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
const env = { ...process.env, ...(url === undefined ? {} : { DATABASE_URL_INTERNAL: url }) };
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-judge-open-eval' });
const db = asDb(pool);
const repo = new PgLearningRepo(db);
const labelRepo = new PgLabelEmbeddingRepo(db);
const still = (uri: string | null): readonly MediaRef[] => (uri === null ? [] : [{ kind: 'image', uri, width: null, height: null, durationMs: null }]);

interface Labelled { readonly itemId: string; readonly text: string; readonly imageUri: string | null; readonly label: string; readonly ownerLabel?: string; readonly why: string }
const postedAtOf = (itemId: string): number | null => {
  const m = /^x:(\d+)$/.exec(itemId);
  return m === null ? null : postTimeFromId(m[1] ?? '');
};

/** tools/retune.ts `ownerCalls` and the gate half of its `run`, as of 2026-10-15 — see the header. */
async function composeGate(): Promise<{ posts: (OpenEvalPost & { coinRef: string; picture: string | null })[]; examples: string | null }> {
  const labels = (JSON.parse(readFileSync(new URL('../eval/src/feed/live-labels.json', import.meta.url), 'utf8')) as { posts: Labelled[] }).posts;
  const calls: OwnerCall[] = [];
  for (const p of labels) {
    const label = p.ownerLabel ?? p.label;
    if (label === 'meme' || label === 'not') calls.push({ itemId: p.itemId, text: p.text, imageUri: p.imageUri, label, why: p.why, at: postedAtOf(p.itemId), from: 'labels' });
  }
  for (const t of await repo.postCalls()) {
    if (t.body === null || t.body.trim() === '') continue;
    const why = t.note ?? (t.verdict === 'meme' ? "the owner's call: people could coin this" : "the owner's call: nothing to coin");
    calls.push({ itemId: t.itemId, text: t.body, imageUri: pictureOf(t.media)?.uri ?? t.shownPicture, label: t.verdict, why, at: t.at.getTime(), from: 'tap' });
  }
  for (const m of await repo.missedPosts()) {
    calls.push({ itemId: m.itemId, text: m.body, imageUri: pictureOf(m.media)?.uri ?? null, label: 'meme', why: 'a post the owner says we missed: people coined or could coin it', at: m.at.getTime(), from: 'missed' });
  }
  const names = (await repo.nameCalls()).flatMap((n) => (n.body === null ? [] : [{ itemId: n.itemId, text: n.body, name: n.name, verdict: n.verdict, betterName: n.betterName, at: n.at.getTime() }]));
  const block = buildBlock(calls, names, P.learning.maxExamples);
  /* The live judge's prompt: its applied block, or its rules alone. A post that block teaches cannot test it. */
  const inUse = await repo.latestApplied();
  const appliedIds = new Set(inUse === null ? [] : await repo.appliedExampleIds());
  const taught = new Set([...block.exampleIds, ...appliedIds]);
  const testMissedIds = new Set(block.testMissed.map((m) => m.itemId));
  const additions = await repo.goldAdditions();
  const listedIds = handGoldIds();
  const inAdditions = new Set(additions.map((g) => g.itemId));
  const listedHeld = await repo.heldPosts([...listedIds].filter((id) => !inAdditions.has(id) && !taught.has(id) && !testMissedIds.has(id)));
  const coinRight = (await repo.matchCalls()).filter((m) => m.verdict === 'right' && m.coinAddress !== null);
  type GatePost = OpenEvalPost & { coinRef: string; picture: string | null };
  const make = (group: GatePost['group'], id: string, text: string, picture: string | null, coinRef = id): GatePost => ({ group, id, text, media: still(picture), coinRef, picture });
  const posts: GatePost[] = [
    ...goldOriginPosts().map((g) => make('gold', g.id, g.text, g.imageUri, g.coinRef ?? g.id)),
    /* Hand gold only: auto gold is never gated, so it is not in the owner's three sets. */
    ...additions.filter((g) => !taught.has(g.itemId) && !testMissedIds.has(g.itemId) && !(g.source === 'recall' && !listedIds.has(g.itemId))).map((g) => make('gold', g.itemId, g.postText, g.imageUri, g.coinMint)),
    ...listedHeld.map((h) => make('gold', h.itemId, h.body, pictureOf(h.media)?.uri ?? null)),
    ...block.testNegatives.filter((c) => !taught.has(c.itemId)).map((c) => make('live-not', c.itemId, c.text, c.imageUri)),
    ...block.testMissed.filter((c) => !appliedIds.has(c.itemId)).map((c) => make('missed', c.itemId, c.text, c.imageUri)),
  ];
  const inTest = new Set(posts.map((p) => p.id));
  const fresh = (id: string) => !inTest.has(id) && !taught.has(id);
  for (const c of block.testMemes.filter((c) => fresh(c.itemId) && !/^teaching example/i.test(c.why ?? ''))) { posts.push(make('gold', c.itemId, c.text, c.imageUri)); inTest.add(c.itemId); }
  for (const h of await repo.heldPosts(coinRight.map((m) => m.itemId).filter(fresh))) posts.push(make('gold', h.itemId, h.body, pictureOf(h.media)?.uri ?? null, coinRight.find((m) => m.itemId === h.itemId)?.coinAddress ?? h.itemId));
  return { posts, examples: inUse?.text ?? null };
}

/** A media array as the store holds it, as the judge's MediaRefs. */
const mediaOf = (raw: unknown): readonly MediaRef[] =>
  (Array.isArray(raw) ? raw : []).flatMap((m): MediaRef[] => {
    const r = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
    const kind = r['kind'];
    const uri = r['uri'];
    if ((kind !== 'image' && kind !== 'video' && kind !== 'audio') || typeof uri !== 'string') return [];
    const n = (v: unknown) => (typeof v === 'number' ? v : null);
    return [{ kind, uri, width: n(r['width']), height: n(r['height']), durationMs: n(r['durationMs']) }];
  });

interface Stored { readonly coinable: boolean; readonly confidence: number; readonly lookedAt: 'text' | 'picture' | 'videoFrame'; readonly proposedName: string | null; readonly kind: string | null }

/** Every post For You showed in the last 24 hours, as held, with the live judge's newest answers. */
async function composeFyp(): Promise<{ posts: (OpenEvalPost & { coinRef: string; picture: string | null })[]; stored: Map<string, Stored> }> {
  const rows = await db.query<{ item_id: string; body: string | null; media: unknown }>(
    `select i.item_id, i.body, i.media from public.item i
      where i.item_id in (select distinct item_id from internal.feed_history where feed_id = 'fyp' and first_seen_at > now() - interval '24 hours')`,
  );
  const ids = rows.map((r) => r.item_id);
  const answers = await db.query<{ item_id: string; prompt_id: string; coinable: boolean; confidence: number; looked_at: string; proposed_name: string | null }>(
    `select distinct on (item_id, split_part(prompt_id, '@', 1)) item_id, prompt_id, coinable, confidence, looked_at, proposed_name
       from internal.post_judgement where item_id = any($1) and (prompt_id like 'post-coinability@%' or prompt_id like 'post-kind@%')
      order by item_id, split_part(prompt_id, '@', 1), judged_at desc`,
    [ids],
  );
  const stored = new Map<string, Stored>();
  for (const a of answers.filter((x) => x.prompt_id.startsWith('post-coinability@'))) {
    const kind = answers.find((x) => x.item_id === a.item_id && x.prompt_id.startsWith('post-kind@'));
    stored.set(a.item_id, { coinable: a.coinable, confidence: Number(a.confidence), lookedAt: a.looked_at as Stored['lookedAt'], proposedName: a.proposed_name, kind: kind === undefined ? null : (kind.proposed_name ?? '').trim().toUpperCase() || null });
  }
  return { posts: rows.map((r) => { const media = mediaOf(r.media); return { group: 'fyp' as const, id: r.item_id, text: r.body ?? '', media, coinRef: r.item_id, picture: postPicture(media) }; }), stored };
}

const gate = await composeGate();
const fyp = await composeFyp();
const cut = <T,>(xs: T[]): T[] => (limit === null ? xs : xs.slice(0, limit));
const byGroup = (g: string) => cut(gate.posts.filter((p) => p.group === g));
const gatePosts = [...byGroup('gold'), ...byGroup('missed'), ...byGroup('live-not')];
const fypPosts = cut(fyp.posts);
const allPosts = [...gatePosts, ...fypPosts];
say(`sets: hand gold ${gatePosts.filter((p) => p.group === 'gold' || p.group === 'missed').length} (of which missed ${gatePosts.filter((p) => p.group === 'missed').length}), live non-memes ${gatePosts.filter((p) => p.group === 'live-not').length}, For You last 24 h ${fypPosts.length} (${fyp.stored.size} with stored live answers); live prompt: ${gate.examples === null ? 'rules alone' : 'rules and the applied block'}, precedents on`);

/* ── 3. volume: how many posts the live judge answers a day ──────────────────────────────────── */

const [vol] = await db.query<{ posts: string; usd: string | null; kind_usd: string | null }>(
  `select count(*) filter (where prompt_id like 'post-coinability@%' and copied_from is null and judge_id like 'judge:%') as posts,
          sum(cost_usd) filter (where prompt_id like 'post-coinability@%') as usd,
          sum(cost_usd) filter (where prompt_id like 'post-kind@%') as kind_usd
     from internal.post_judgement where judged_at > now() - interval '24 hours'`,
);
const volumeDay = Number(arg('volume') ?? vol?.posts ?? 0);
const fypDay = fyp.posts.length;
const liveRealUsdPerPost = Number(vol?.posts ?? 0) > 0 ? (Number(vol?.usd ?? 0) + Number(vol?.kind_usd ?? 0)) / Number(vol?.posts) : null;
say(`volume: ${volumeDay} posts judged by the live judge in the last 24 h${liveRealUsdPerPost === null ? '' : ` at $${liveRealUsdPerPost.toFixed(5)} a post as billed`}; For You alone ${fypDay}`);

/* ── 4. the meter, and what every judge is given beside each post ────────────────────────────── */

const shared = await openSharedMeter(capUsd, env, 'learning');
const meter = shared.meter;
const budget = () => ({ capUsd: meter.line().capUsd, spentUsd: meter.line().spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
const ctxBase = { policy: P, maxBatch: P.qualify.batchSize, budget };
const signals: Map<string, Signal> = new Map(await repo.cryptoSignals(allPosts.map((p) => p.id)));
const near = new Map<string, Near>();
try {
  const labels: readonly LabelledVector[] = await labelRepo.all(POST_SPACE);
  const coined = await repo.coinedPictureVectors();
  const voyageKey = (process.env['VOYAGE_API_KEY'] ?? '').trim();
  const embed = voyageKey === '' ? null : voyageEmbed({ client: voyageClient({ apiKey: voyageKey, baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
  const parse = (t: string): number[] => JSON.parse(t) as number[];
  /* Vectors already stored: each For You post's own (0074), and every picture embedded before. */
  const storedPost = new Map((await db.query<{ item_id: string; e: string }>('select item_id, embedding::text as e from internal.post_embedding where space = $1 and item_id = any($2)', [POST_SPACE, fypPosts.map((p) => p.id)])).map((r) => [r.item_id, parse(r.e)] as const));
  const pictures = [...new Set(allPosts.flatMap((p) => (p.picture === null ? [] : [p.picture])))];
  const storedPic = new Map((await db.query<{ uri: string; e: string }>('select distinct on (uri) uri, embedding::text as e from internal.image_embedding where space = $1 and uri = any($2) order by uri, embedded_at desc', [PICTURE_SPACE, pictures])).map((r) => [r.uri, parse(r.e)] as const));
  const inputOf = (p: (typeof allPosts)[number]) => embedInput(p.text, p.picture, P);
  const postVec = new Map<string, ArrayLike<number>>();
  for (const p of allPosts) {
    const input = inputOf(p);
    const own = labels.find((l) => l.itemId === p.id && l.text === input.text && (l.picture ?? null) === input.picture);
    const v = own?.values ?? storedPost.get(p.id);
    if (v !== undefined) postVec.set(p.id, v);
  }
  const toEmbed = allPosts.filter((p) => !postVec.has(p.id) && (inputOf(p).text !== '' || inputOf(p).picture !== null));
  const toPicture = pictures.filter((u) => !storedPic.has(u));
  say(`vectors: ${postVec.size} posts and ${storedPic.size} pictures already stored; ${embed === null ? 'no embedding key, so the rest go without precedents and picture boost (for every judge alike)' : `${toEmbed.length} posts and ${toPicture.length} pictures to embed`}`);
  if (embed !== null) {
    for (let k = 0; k < toEmbed.length; k += embed.maxBatch) {
      const part = toEmbed.slice(k, k + embed.maxBatch);
      const r = await embed.embedPosts!(part.map(inputOf), budget());
      part.forEach((p, j) => { const v = r.value[j]; if (v !== null && v !== undefined && v.space === POST_SPACE) postVec.set(p.id, v.values); });
    }
    for (let k = 0; k < toPicture.length; k += embed.maxBatch) {
      const part = toPicture.slice(k, k + embed.maxBatch);
      const r = await embed.embedMedia!(part.flatMap((u) => still(u)), budget());
      part.forEach((u, j) => { const v = r.value[j]; if (v !== null && v !== undefined) storedPic.set(u, Array.from(v.values)); });
    }
  }
  const norm = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const p of allPosts) {
    const words = norm(inputOf(p).text);
    const self = (l: LabelledVector): boolean => l.itemId === p.id || (p.picture !== null && l.picture === p.picture) || (words !== '' && norm(l.text) === words);
    const v = postVec.get(p.id);
    const pv = p.picture === null ? undefined : storedPic.get(p.picture);
    const others = coined.filter((c) => c.coinRef !== p.coinRef && c.uri !== p.picture);
    const similarity = pv === undefined || others.length === 0 ? null : Math.max(...others.map((c) => c.v.reduce((s, x, i) => s + x * (pv[i] ?? 0), 0)));
    near.set(p.id, {
      precedents: v === undefined || P.judge.precedents.k <= 0 ? [] : precedentsFor(nearestLabelled(v, labels, P.judge.precedents.k, self, { source: sourceOfItemId(p.id), reserve: P.judge.precedents.sameSourceFirst }), P),
      closestNot: v === undefined ? null : (closestNot(v, labels, self)?.similarity ?? null),
      similarity,
    });
  }
} catch (e) {
  if (!(e instanceof BudgetRefused)) throw e;
  say('the cap was reached while embedding; nothing was judged');
}
const ctx = { ...ctxBase, near, signals };

/* ── 5. the live judge, re-asked on the three sets ───────────────────────────────────────────── */

/* `gateDone`: the three sets were finished, so its rates and its cost a post stand even if the cap stopped it later. */
interface Run { readonly name: string; readonly rows: Row[]; readonly gateUsd: number; readonly fypUsd: number; readonly timings: Timing[]; readonly cutShort: string | null; readonly gateDone: boolean }
const runs: Run[] = [];
let haiku: Run | null = null;
const setup = readJudgeSetup(env);
if (setup.state !== 'configured' || priceFor(setup.model) === null) {
  say(`the live judge is ${setup.state} here, so it cannot be re-asked: no verdict will be given`);
} else {
  const timings: Timing[] = [];
  const price = priceFor(setup.model)!;
  const client = anthropicClient({ apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.postBatchMaxOutputTokens, effort: price.effort, timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs, maxFrameBytes: P.judge.maxFrameBytes, pictureSize: 'small', fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  const policy = { ...P.judge, maxOutputTokens: P.judge.postBatchMaxOutputTokens };
  const post = anthropicJudge({ client: timedClient(client, timings), meter, now: Date.now, model: setup.model, policy, maxBatch: ctx.maxBatch, question: 'post', examples: gate.examples, precedents: P.judge.precedents.k > 0 });
  const kind = anthropicJudge({ client, meter, now: Date.now, model: setup.model, policy, maxBatch: ctx.maxBatch, question: 'kind' });
  const before = meter.spentUsd('anthropic');
  let rows: Row[] = [];
  let cutShort: string | null = null;
  try {
    rows = await grade(gatePosts, { post, kind }, ctx);
  } catch (e) {
    if (!(e instanceof BudgetRefused)) throw e;
    cutShort = 'stopped at the cap';
  }
  haiku = { name: `${setup.model} (live)`, rows, gateUsd: meter.spentUsd('anthropic') - before, fypUsd: 0, timings, cutShort, gateDone: cutShort === null };
  say(`live judge re-asked: $${haiku.gateUsd.toFixed(3)}${cutShort === null ? '' : `, ${cutShort}`}`);
}
const storedLive = new Map(fypPosts.map((p) => {
  const s = fyp.stored.get(p.id);
  return [p.id, fileRow(p, s === undefined ? null : s, s?.kind ?? null, ctx)] as const;
}));

/* ── 6. each open model, on all four sets ────────────────────────────────────────────────────── */

for (const m of models) {
  const timings: Timing[] = [];
  const client = openChatClient({ vendor: DEFAULT_VENDOR, apiKey, baseUrl, model: m.id, vision: m.vision, maxOutputTokens: P.judge.postBatchMaxOutputTokens, timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs, maxFrameBytes: P.judge.maxFrameBytes, pictureSize: 'small', fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  const deps = { meter, now: Date.now, model: m, vendor: DEFAULT_VENDOR, policy: { ...P.judge, maxOutputTokens: P.judge.postBatchMaxOutputTokens }, maxBatch: ctx.maxBatch };
  const post = openJudge({ ...deps, client: timedClient(client, timings), question: 'post', examples: gate.examples, precedents: P.judge.precedents.k > 0 });
  const kind = openJudge({ ...deps, client, question: 'kind' });
  const expected = (post.estimate(allPosts.map((p) => subjectOf(p, ctx))).usd / ESTIMATE_MARGIN) * 1.5;
  say(`${m.id}: expected about $${expected.toFixed(2)} for ${allPosts.length} posts; $${meter.line().remainingUsd.toFixed(2)} left under the cap`);
  const rows: Row[] = [];
  let cutShort: string | null = null;
  let gateUsd = 0;
  let fypUsd = 0;
  for (const [set, posts] of [['gate', gatePosts], ['fyp', fypPosts]] as const) {
    const before = meter.spentUsd(DEFAULT_VENDOR);
    try {
      rows.push(...(await grade(posts, { post, kind }, ctx)));
    } catch (e) {
      if (!(e instanceof BudgetRefused)) throw e;
      cutShort = `stopped at the cap during the ${set === 'gate' ? 'three sets' : 'For You set'}`;
    }
    if (set === 'gate') gateUsd = meter.spentUsd(DEFAULT_VENDOR) - before;
    else fypUsd = meter.spentUsd(DEFAULT_VENDOR) - before;
    if (cutShort !== null) break;
  }
  runs.push({ name: `${m.id}${post.textOnly ? ' (text-only)' : ''}`, rows, gateUsd, fypUsd, timings, cutShort, gateDone: cutShort === null || cutShort.includes('For You') });
  say(`${m.id}: $${(gateUsd + fypUsd).toFixed(3)}${cutShort === null ? '' : `, ${cutShort}`}`);
}
await shared.close();
await pool.end();

/* ── 7. the table ────────────────────────────────────────────────────────────────────────────── */

const gateN = gatePosts.length;
const perPost = (r: Run): number | null => (!r.gateDone || gateN === 0 ? null : r.gateUsd / gateN);
const day = (usd: number | null, n: number): string => (usd === null ? '-' : `$${(usd * n).toFixed(2)}`);
const secs = (x: number | null): string => (x === null ? '-' : `${x.toFixed(2)}s`);
const line = (name: string, r: SetRates, usdPost: number | null, t: Timing[] | null, fypAgree: string, note: string) => {
  const s = t === null ? null : speed(t);
  say(`${name.padEnd(44)} | ${ofN(r.hand).padEnd(22)} | ${ofN(r.negatives).padEnd(22)} | ${ofN(r.missed).padEnd(14)} | ${secs(s?.median ?? null).padStart(6)} ${secs(s?.p90 ?? null).padStart(6)} | ${usdPost === null ? '-'.padStart(9) : `$${usdPost.toFixed(5)}`} | ${day(usdPost, volumeDay).padStart(8)} ${day(usdPost, fypDay).padStart(7)} | ${fypAgree}${note === '' ? '' : ` | ${note}`}`);
};
say('');
say(`${'judge'.padEnd(44)} | ${'hand gold caught'.padEnd(22)} | ${'live non-memes through'.padEnd(22)} | ${'missed caught'.padEnd(14)} | ${'s/post med p90'.padStart(13)} | ${'$/post'.padStart(9)} | $/day all / FYP  | For You agreement with the live judge`);
const haikuRates = haiku === null ? null : setRates(haiku.rows);
const haikuPost = haiku === null ? null : perPost(haiku);
if (haiku !== null && haikuRates !== null) line(haiku.name, haikuRates, haikuPost, haiku.timings, 'itself (stored answers)', haiku.cutShort ?? '');
const verdicts: string[] = [];
const haikuMap = new Map((haiku?.rows ?? []).map((r) => [r.id, r] as const));
for (const r of runs) {
  const rates = setRates(r.rows);
  const fypRows = r.rows.filter((x) => x.group === 'fyp');
  const a = agreement(fypRows, storedLive);
  const agreeText = `shows ${a.alsoShown}/${a.liveShown} it showed; yes/no same ${a.coinable.same}/${a.coinable.of}`;
  line(r.name, rates, perPost(r), r.timings, agreeText, r.cutShort ?? '');
  if (haikuRates !== null) {
    const v = recommend(rates, haikuRates, perPost(r) === null ? null : perPost(r)! * volumeDay, haikuPost === null ? null : haikuPost * volumeDay);
    verdicts.push(`${r.name}: ${v.switch ? 'SWITCH — matches or beats the live judge on all three sets and costs less' : `do not switch (${v.why.join('; ')})`}`);
  }
  /* The cheap first pass: open model first, the live judge only for the borderline. */
  if (haiku !== null && haikuRates !== null && r.gateDone && haikuPost !== null) {
    const gateOpen = r.rows.filter((x) => x.group !== 'fyp');
    const chosen = chooseBand(gateOpen, haikuMap, haikuRates);
    for (const [label, band] of [[`first pass, band ${chosen.band[0]}–${chosen.band[1]} (${chosen.matches ? 'narrowest that matches the live judge' : 'none matches; best gold less non-memes'})`, chosen.band], [`first pass, band ${OWNER_BAND[0]}–${OWNER_BAND[1]}`, OWNER_BAND]] as const) {
      const g = blend(gateOpen, haikuMap, band);
      const f = blend(fypRows, storedLive, band);
      const handedShare = g.total === 0 ? 0 : g.handed / g.total;
      const usd = perPost(r)! + handedShare * haikuPost;
      const fa = agreement(f.rows, storedLive);
      line(`  ${label}`.slice(0, 44), setRates(g.rows), usd, null, `shows ${fa.alsoShown}/${fa.liveShown}; ${pct(handedShare)} of posts to the live judge (${pct(f.total === 0 ? null : f.handed / f.total)} on For You)`, '');
      const v = recommend(setRates(g.rows), haikuRates, usd * volumeDay, haikuPost * volumeDay);
      verdicts.push(`${r.name} as first pass, band ${band[0]}–${band[1]}: ${v.switch ? 'SWITCH — matches or beats the live judge on all three sets and costs less' : `do not switch (${v.why.join('; ')})`}`);
    }
  }
}
say('');
say(`$/post is what the test paid per post on the three sets (both questions, ten a call); $/day is that at ${volumeDay} posts a day (every post the live judge answered in the last 24 h) and at ${fypDay} (For You's alone).${liveRealUsdPerPost === null ? '' : ` The live judge as billed in the last 24 h: $${liveRealUsdPerPost.toFixed(5)} a post, $${(liveRealUsdPerPost * volumeDay).toFixed(2)} a day.`}`);
say(`Rates leave out posts a judge did not answer (shown as +n unanswered), as the re-tune does. Seconds per post: each call's answer time over its ten posts.`);
say('');
say(haikuRates === null ? 'no verdict: the live judge could not be re-asked' : 'verdict, by the owner\'s rule (switch only if it matches or beats the live judge on all three sets AND costs less):');
for (const v of verdicts) say(`  ${v}`);
for (const r of runs) {
  const rates = setRates(r.rows);
  /* Hand gold already holds the missed posts. */
  const un = rates.hand.unanswered + rates.negatives.unanswered;
  if (un > 0.05 * gateN) say(`  note: ${r.name} left ${un} of ${gateN} posts unanswered — its rates are on the rest`);
}
say(`spent: $${meter.spentUsd().toFixed(3)} of the $${capUsd} cap`);
const rowsFile = arg('rows');
if (rowsFile !== null) {
  writeFileSync(rowsFile, JSON.stringify({ live: haiku?.rows ?? [], liveStoredForYou: [...storedLive.values()], runs: runs.map((r) => ({ name: r.name, rows: r.rows })) }, null, 1));
  say(`rows written to ${rowsFile}`);
}
