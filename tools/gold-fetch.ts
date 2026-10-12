/**
 * `node --env-file=.env.local --experimental-strip-types tools/gold-fetch.ts <stage> [--yes]`
 *
 * GATHERS WHAT THE ORIGIN EVAL NEEDS ABOUT EACH GOLD COIN IN THE TUNING SET, ONE STAGE AT A TIME.
 *
 *   estimate  counts every call each stage would make and what it would cost. Free, no network.
 *   meta      each coin's name, ticker and picture, from its metadata on the chain. Free (RPC credits).
 *   posts     the creator's linked post and the founders' origin post, read by id.        Paid: X.
 *   search    one search back for the coin's name, ending at its launch.                  Paid: X.
 *   quotes    the post each read post quotes, one hop — the earliest-post search.          Paid: X.
 *   judge     the judge's "nameable subject?" for each creator post that reaches it.      Paid: Anthropic.
 *   images    every picture embedded; each post's similarity to the coin's picture.       Paid: Voyage.
 *   pairs     the judge's same-subject answer for each borderline picture that names the coin. Paid: Anthropic.
 *
 * ★ TUNING SET ONLY. The 30% held out is never fetched here: evidence gathered for it would
 * invite looking at it while choosing a bar. It is fetched once, for the final report.
 *
 * ★ A PAID STAGE REFUSES unless SPEND=live is set AND --yes is passed, prints its estimate
 * first, and runs under a meter capped at that estimate, so it cannot spend more than it
 * printed. Each stage saves after every coin, so a stopped run resumes where it stopped.
 * Results go to eval/src/gold/coin-evidence.json; the eval replays from there offline.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { storyId } from '../contracts/src/ids.ts';
import type { Author, Item } from '../contracts/src/vocabulary.ts';
import type { Meter } from '../contracts/src/ports/meter.ts';
import { voyageEmbed, httpClient as voyageClient } from '../adapters/embed/voyage/src/index.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup } from '../adapters/judge/anthropic/src/index.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { goldCoins, tuning, type GoldCoin } from '../eval/src/gold/coin-origins.ts';
import { EVIDENCE_FILE, loadEvidence, type CoinEvidence, type PostRead } from '../eval/src/gold/coin-evidence.ts';

const P = DEFAULT_POLICY;
const X_USD_PER_POST = 0.000_15;
const VOYAGE_USD_PER_IMAGE = (1_450 * 0.12) / 1e6;
const JUDGE_USD_PER_POST = 0.000_7;
const PAIR_USD = 0.003;
const SEARCH_LIMIT = P.backfill.searchResultCap;
const DEADLINE_MS = 120_000;

const evidence = loadEvidence();
const coins = tuning();
const save = (): void => {
  const order = goldCoins().map((c) => c.id);
  const list = order.flatMap((id) => evidence.get(id) ?? []);
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(list, null, 1)}\n`);
};
const put = (id: string, patch: Partial<CoinEvidence>): void => {
  evidence.set(id, { ...(evidence.get(id) ?? { id }), ...patch, id });
};

const xStatus = (url: string | null): string | null => (url === null ? null : /(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/.exec(url)?.[1] ?? null);
const isXAccount = (url: string): boolean => /(?:x|twitter)\.com\/[^/?#]+\/?(?:[?#].*)?$/.test(url) || /(?:x|twitter)\.com\/i\/communities\//.test(url);

function creatorKind(c: GoldCoin): 'none' | 'account' | 'post' | 'other' {
  if (c.creatorLink === null) return 'none';
  if (xStatus(c.creatorLink) !== null) return 'post';
  if (isXAccount(c.creatorLink)) return 'account';
  return /\/(?:video|photo|p|reel)\//.test(c.creatorLink) ? 'other' : 'account';
}

function refuse(message: string): never {
  console.error(`gold-fetch refused — ${message}`);
  process.exit(1);
}

function paid(estimateUsd: number, what: string): Meter {
  console.log(`${what}: estimated at most $${estimateUsd.toFixed(4)}.`);
  if (process.env['SPEND'] !== 'live') refuse('SPEND=live is not set. This stage spends money.');
  if (!process.argv.includes('--yes')) refuse('pass --yes to confirm you mean to spend money.');
  return inMemoryMeter({ dailyCapUsd: Math.max(estimateUsd * 1.5, 0.01), softStop: 1, now: Date.now });
}

const budget = (meter: Meter) => {
  const line = meter.line();
  return { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + DEADLINE_MS };
};

function toRead(item: Item, authors: ReadonlyMap<string, Author>, url: string): PostRead {
  const author = authors.get(item.authorKey);
  return {
    postId: item.sourceItemId,
    url,
    postedAt: item.postedAt,
    text: item.text,
    authorHandle: author?.handle ?? null,
    authorFollowers: author?.audience?.value ?? null,
    reach: item.counters.reach?.value ?? null,
    imageUri: item.media.find((m) => m.kind === 'image')?.uri ?? null,
    quotes: item.reproductionOf === null ? null : String(item.reproductionOf).split(':').slice(1).join(':'),
  };
}

function xAdapter(meter: Meter) {
  const apiKey = process.env['X_API_KEY'] ?? '';
  if (apiKey === '') refuse('X_API_KEY is not set.');
  return xPlatform({ client: xClient({ apiKey, baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter, now: () => Date.now() });
}

async function lookupX(ids: readonly string[], meter: Meter): Promise<Map<string, PostRead>> {
  const out = new Map<string, PostRead>();
  if (ids.length === 0) return out;
  const x = xAdapter(meter);
  const result = await x.lookup!(ids, budget(meter));
  const authors = new Map(result.value.authors.map((a) => [a.authorKey as string, a]));
  for (const item of result.value.items) out.set(item.sourceItemId, toRead(item, authors, `https://x.com/i/status/${item.sourceItemId}`));
  return out;
}

/* ── the stages ─────────────────────────────────────────────────────────── */

function counts() {
  const postLinks = coins.filter((c) => creatorKind(c) === 'post').length;
  const originX = coins.filter((c) => (c.origin.kind === 'post' || c.origin.kind === 'afterLaunch') && c.origin.platform === 'x').length;
  const searches = coins.length;
  return { postLinks, originX, searches, worstSearchPosts: searches * SEARCH_LIMIT };
}

function estimate(): void {
  const n = counts();
  const quoteGuess = Math.round(n.worstSearchPosts * 0.1);
  const images = coins.length + n.postLinks + n.originX + n.worstSearchPosts;
  const lines: [string, string, number][] = [
    ['meta', `${coins.length} metadata reads on the chain`, 0],
    ['posts', `${n.postLinks + n.originX} posts by id (${n.postLinks} creator links, ${n.originX} founders' X origins)`, (n.postLinks + n.originX) * X_USD_PER_POST],
    ['search', `${n.searches} searches, at most ${SEARCH_LIMIT} posts each`, n.worstSearchPosts * X_USD_PER_POST],
    ['quotes', `about ${quoteGuess} quoted posts, one hop (a guess: a tenth of what searches return)`, quoteGuess * X_USD_PER_POST],
    ['judge', `at most ${n.postLinks} creator posts, one at a time`, n.postLinks * JUDGE_USD_PER_POST],
    ['images', `at most ${images} pictures (coins, creator posts, origins, search results)`, images * VOYAGE_USD_PER_IMAGE],
    ['pairs', `borderline pictures that name the coin, capped at ${P.group.image.pairChecksPerDay}`, P.group.image.pairChecksPerDay * PAIR_USD],
  ];
  console.log(`Tuning set: ${coins.length} coins (the 30% held out is not fetched).\n`);
  for (const [stage, what, usd] of lines) console.log(`  ${stage.padEnd(7)} ${what.padEnd(92)} ${usd === 0 ? 'free' : `≤ $${usd.toFixed(2)}`}`);
  console.log(`\n  total at most $${lines.reduce((s, [, , u]) => s + u, 0).toFixed(2)} — search and images are worst cases; most searches return fewer than ${SEARCH_LIMIT}.`);
}

async function meta(): Promise<void> {
  const key = process.env['HELIUS_API_KEY'] ?? '';
  if (key === '') refuse('HELIUS_API_KEY is not set.');
  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  let done = 0;
  for (const c of coins) {
    if (evidence.get(c.id)?.meta !== undefined) continue;
    for (let attempt = 1; ; attempt++) {
      await new Promise((r) => setTimeout(r, 250));
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: c.mint } }) });
      if (r.status === 429 && attempt < 6) {
        await new Promise((res) => setTimeout(res, 1_000 * 2 ** attempt));
        continue;
      }
      if (!r.ok) refuse(`${c.id}: metadata read responded ${r.status}; stopped, ${done} read this run.`);
      const j = (await r.json()) as { result?: { content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string }; files?: { cdn_uri?: string }[] } } };
      const content = j.result?.content;
      put(c.id, { meta: { name: content?.metadata?.name ?? c.name, ticker: content?.metadata?.symbol ?? c.ticker, imageUri: content?.files?.[0]?.cdn_uri ?? content?.links?.image ?? null } });
      break;
    }
    done += 1;
    if (done % 25 === 0) save();
  }
  save();
  console.log(`meta: ${done} coins read.`);
}

async function posts(): Promise<void> {
  const want = new Map<string, string[]>();
  for (const c of coins) {
    const ev = evidence.get(c.id);
    const creatorId = creatorKind(c) === 'post' && ev?.creator === undefined ? xStatus(c.creatorLink) : null;
    const originId = ev?.origin === undefined && (c.origin.kind === 'post' || c.origin.kind === 'afterLaunch') && c.origin.platform === 'x' ? c.origin.postId : null;
    for (const id of [creatorId, originId]) if (id !== null) want.set(id, [...(want.get(id) ?? []), c.id]);
  }
  const meter = paid(want.size * X_USD_PER_POST, `posts: ${want.size} posts by id`);
  const read = await lookupX([...want.keys()], meter);
  for (const c of coins) {
    const ev = evidence.get(c.id);
    const kind = creatorKind(c);
    if (ev?.creator === undefined) {
      if (kind === 'none') put(c.id, { creator: { kind: 'none' } });
      else if (kind === 'account') put(c.id, { creator: { kind: 'account' } });
      /* A post on a source we cannot read by id here: a post, unread — never an account. */
      else if (kind === 'other') put(c.id, { creator: { kind: 'post', post: null } });
      else put(c.id, { creator: { kind: 'post', post: read.get(xStatus(c.creatorLink) ?? '') ?? null } });
    }
    if (ev?.origin === undefined && (c.origin.kind === 'post' || c.origin.kind === 'afterLaunch') && c.origin.platform === 'x') {
      put(c.id, { origin: { post: read.get(c.origin.postId) ?? null } });
    }
  }
  save();
  console.log(`posts: ${read.size} of ${want.size} read; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

async function search(): Promise<void> {
  const todo = coins.filter((c) => evidence.get(c.id)?.search === undefined);
  const meter = paid(todo.length * SEARCH_LIMIT * X_USD_PER_POST, `search: ${todo.length} searches`);
  const x = xAdapter(meter);
  let done = 0;
  for (const c of todo) {
    const term = (evidence.get(c.id)?.meta?.name ?? c.name).trim() || c.ticker;
    const result = await x.discover({ mode: 'keyword', term, sinceMs: null, untilMs: Date.parse(c.createdAt), limit: SEARCH_LIMIT, cursor: null }, budget(meter));
    const authors = new Map(result.value.authors.map((a) => [a.authorKey as string, a]));
    put(c.id, { search: { term, results: result.value.items.map((i) => toRead(i, authors, `https://x.com/i/status/${i.sourceItemId}`)) } });
    done += 1;
    if (done % 10 === 0) save();
  }
  save();
  console.log(`search: ${done} coins searched; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

async function quotes(): Promise<void> {
  const have = new Set<string>();
  const want = new Set<string>();
  for (const ev of evidence.values()) {
    const all = [...(ev.search?.results ?? []), ...(ev.creator?.kind === 'post' && ev.creator.post !== null ? [ev.creator.post] : [])];
    for (const p of all) have.add(p.postId);
    for (const p of all) if (p.quotes !== null) want.add(p.quotes);
  }
  const ids = [...want].filter((id) => !have.has(id));
  const meter = paid(ids.length * X_USD_PER_POST, `quotes: ${ids.length} quoted posts`);
  const read = await lookupX(ids, meter);
  /* Filed beside the search results of every coin whose results quote them. */
  for (const c of coins) {
    const ev = evidence.get(c.id);
    if (ev?.search === undefined) continue;
    const extra = ev.search.results.flatMap((p) => (p.quotes !== null && read.has(p.quotes) && !ev.search?.results.some((r) => r.postId === p.quotes) ? [read.get(p.quotes) as PostRead] : []));
    if (extra.length > 0) put(c.id, { search: { ...ev.search, results: [...ev.search.results, ...extra] } });
  }
  save();
  console.log(`quotes: ${read.size} of ${ids.length} read; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

function judgeFor(meter: Meter, maxOutputTokens: number) {
  const setup = readJudgeSetup(process.env);
  if (setup.state !== 'configured') refuse(`the judge is ${setup.state}; set ANTHROPIC_API_KEY and JUDGE_MODEL.`);
  const price = priceFor(setup.model);
  if (price === null) refuse(`JUDGE_MODEL ${setup.model} has no price.`);
  const client = judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  return anthropicJudge({ client, meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1 });
}

async function judge(): Promise<void> {
  const todo = coins.flatMap((c) => {
    const ev = evidence.get(c.id);
    const post = ev?.creator?.kind === 'post' ? ev.creator.post : null;
    return post === null || ev?.judged?.[post.postId] !== undefined ? [] : [{ c, post }];
  });
  const meter = paid(todo.length * JUDGE_USD_PER_POST * 3, `judge: ${todo.length} creator posts`);
  const j = judgeFor(meter, P.judge.postBatchMaxOutputTokens);
  for (const { c, post } of todo) {
    const subject = { storyId: storyId(`gold-${c.id.replace(':', '-')}`), texts: post.text.trim() === '' ? [] : [post.text.slice(0, P.judge.maxCharsPerText)], media: post.imageUri === null ? [] : [{ kind: 'image' as const, uri: post.imageUri, width: null, height: null, durationMs: null }], distinctAuthors: 1, distinctSources: 1 };
    const result = await j.judge([subject], budget(meter));
    const outcome = result.value[0];
    if (outcome?.kind === 'judged') {
      put(c.id, { judged: { ...(evidence.get(c.id)?.judged ?? {}), [post.postId]: { coinable: outcome.judgement.coinable, proposedName: outcome.judgement.proposedName } } });
    }
    save();
  }
  console.log(`judge: ${todo.length} posts; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

async function images(): Promise<void> {
  const key = process.env['VOYAGE_API_KEY'] ?? '';
  if (key === '') refuse('VOYAGE_API_KEY is not set.');
  const todo = coins.filter((c) => evidence.get(c.id)?.similarity === undefined && evidence.get(c.id)?.meta?.imageUri);
  const per = (c: GoldCoin) => {
    const ev = evidence.get(c.id);
    return [...(ev?.search?.results ?? []), ...(ev?.creator?.kind === 'post' && ev.creator.post ? [ev.creator.post] : []), ...(ev?.origin?.post ? [ev.origin.post] : [])].filter((p) => p.imageUri !== null);
  };
  const total = todo.reduce((n, c) => n + 1 + per(c).length, 0);
  const meter = paid(total * VOYAGE_USD_PER_IMAGE * 2, `images: ${total} pictures`);
  const embed = voyageEmbed({ client: voyageClient({ apiKey: key, baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
  for (const c of todo) {
    const posts = per(c);
    const media = [evidence.get(c.id)?.meta?.imageUri ?? '', ...posts.map((p) => p.imageUri ?? '')].map((uri) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null }));
    const result = await embed.embedMedia!(media, budget(meter));
    const [coinVec, ...postVecs] = result.value;
    const similarity: Record<string, number> = {};
    if (coinVec !== null && coinVec !== undefined) {
      postVecs.forEach((v, i) => {
        const p = posts[i];
        if (v === null || p === undefined) return;
        let dot = 0;
        for (let k = 0; k < v.values.length; k++) dot += (v.values[k] ?? 0) * (coinVec.values[k] ?? 0);
        similarity[p.postId] = Math.round(dot * 10_000) / 10_000;
      });
    }
    put(c.id, { similarity });
    save();
  }
  console.log(`images: ${todo.length} coins; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

async function pairs(): Promise<void> {
  const bars = P.group.image;
  const todo = coins.flatMap((c) => {
    const ev = evidence.get(c.id);
    if (ev?.meta?.imageUri == null || ev.similarity === undefined) return [];
    const name = { ticker: ev.meta.ticker, name: ev.meta.name };
    const posts = [...(ev.search?.results ?? []), ...(ev.creator?.kind === 'post' && ev.creator.post ? [ev.creator.post] : [])];
    return posts.flatMap((p) => {
      const s = ev.similarity?.[p.postId];
      const named = new RegExp(`\\b(${[name.ticker, name.name].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i').test(p.text);
      return s !== undefined && s >= bars.borderline && s < bars.likely && named && ev.sameSubject?.[p.postId] === undefined && p.imageUri !== null ? [{ c, p, coinImage: ev.meta?.imageUri as string }] : [];
    });
  }).slice(0, bars.pairChecksPerDay);
  const meter = paid(todo.length * PAIR_USD * 2, `pairs: ${todo.length} borderline pictures`);
  const j = judgeFor(meter, P.judge.pairMaxOutputTokens);
  for (const { c, p, coinImage } of todo) {
    const image = (uri: string) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null });
    const result = await j.sameSubject!(image(coinImage), image(p.imageUri as string), budget(meter));
    if (result.value !== null) put(c.id, { sameSubject: { ...(evidence.get(c.id)?.sameSubject ?? {}), [p.postId]: result.value } });
    save();
  }
  console.log(`pairs: ${todo.length} asked; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

const stages: Record<string, () => Promise<void> | void> = { estimate, meta, posts, search, quotes, judge, images, pairs };
const stage = process.argv[2] ?? '';
const run = stages[stage];
if (run === undefined) refuse(`stage must be one of: ${Object.keys(stages).join(', ')}`);
await run();
