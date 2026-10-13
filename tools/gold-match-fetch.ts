/**
 * `node --env-file=.env.local --experimental-strip-types tools/gold-match-fetch.ts <stage> [--yes]`
 *
 * GATHERS WHAT THE POST-TO-COIN MATCHING EVAL NEEDS, ONE STAGE AT A TIME, into
 * eval/src/gold/match-evidence.json. The eval (eval/src/gold/run-matching.ts) replays it offline.
 *
 *   search   each case's name searched on both free market sources, as the runner's lookup does.  Free.
 *   meta     each found coin's metadata document — its links and picture — through our gateways. Free (RPC credits).
 *   posts    a picture for each origin post we never read: X posts by id, TikTok covers.        Paid: X (a few posts).
 *   images   each post's picture against each coin that could still be its coin (launched after it). Paid: Voyage.
 *   pairs    the judge's same-subject answer on borderline pairs, capped at `PAIRS_CAP`.        Paid: Anthropic.
 *
 * Why a separate tool from gold-fetch.ts: that one gathers evidence about a COIN (its origin);
 * this one gathers the coins a POST's name search finds, which is the other direction, and its
 * file is another shape. Sharing one file would make every stage of each re-read the other's.
 *
 * ★ A PAID STAGE REFUSES unless SPEND=live and --yes, prints its estimate, and runs on the
 * LEARNING book under a meter capped at that estimate (tools/lib/shared-meter.ts), so it cannot
 * outspend what it printed or the day's learning lines. Every stage saves as it goes and skips
 * what is already held, so a stopped run resumes.
 *
 * What breaks if changed carelessly: only coins launched after the post (with the origin rule's
 * grace) are pictured. A coin launched before the post can never be its coin, and embedding it
 * would spend most of the stage on pictures no rule reads.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { Meter } from '../contracts/src/ports/meter.ts';
import type { CoinSearch } from '../contracts/src/ports/coin-search.ts';
import { mergeHits } from '../core/src/search/merge.ts';
import { voyageEmbed, httpClient as voyageClient } from '../adapters/embed/voyage/src/index.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup } from '../adapters/judge/anthropic/src/index.ts';
import { xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { dexscreenerSearch } from '../adapters/market/dexscreener/src/index.ts';
import { geckoterminal } from '../adapters/market/geckoterminal/src/index.ts';
import { fetchMetadata } from '../adapters/venue/solana-pumpfun/src/index.ts';
import { pictureOf } from '../services/project/src/db.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { matchCases, MATCH_EVIDENCE_FILE, loadMatchEvidence, pairKey, type FoundCoin, type MatchCase } from '../eval/src/gold/match-cases.ts';

const P = DEFAULT_POLICY;
const X_USD_PER_POST = 0.000_15;
const VOYAGE_USD_PER_IMAGE = (1_450 * 0.12) / 1e6;
const PAIR_USD = 0.003;
/* The judge is asked about at most this many borderline pairs in one run. */
const PAIRS_CAP = 150;
const DEADLINE_MS = 120_000;
const SEARCH_TIMEOUT_MS = 8_000;
/* The free market-data plan answers about thirty requests a minute. */
const SEARCH_PAUSE_MS = 2_200;
const METADATA_GATEWAYS = ['https://pump.mypinata.cloud', 'https://gateway.pinata.cloud'];
const RPC_BATCH = 100;
const RPC_CONCURRENCY = 5;
const RPC_ATTEMPTS = 5;
const RPC_BACKOFF_MS = 1_000;
const EMBED_BATCH = 20;
/* A coin a search returns is kept when it launched within a week before the post, as the
   lookup keeps them (universe.lookup.withinMs), or within the timing window after it. */
const KEEP_BEFORE_MS = P.universe.lookup.withinMs;
const KEEP_AFTER_MS = P.universe.matchWindowMs;

const cases = matchCases();
const evidence = loadMatchEvidence();
const searches = { ...evidence.searches } as Record<string, readonly FoundCoin[]>;
const meta = { ...evidence.meta };
const launched = { ...evidence.launched };
const postImages = { ...evidence.postImages };
const similarity = { ...evidence.similarity };
const sameSubject = { ...evidence.sameSubject };
const save = (): void => {
  writeFileSync(MATCH_EVIDENCE_FILE, `${JSON.stringify({ searches, launched, meta, postImages, similarity, sameSubject }, null, 1)}\n`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function refuse(message: string): never {
  console.error(`gold-match-fetch refused — ${message}`);
  process.exit(1);
}

let closeMeter: (() => Promise<void>) | null = null;

async function paid(estimateUsd: number, what: string): Promise<Meter> {
  console.log(`${what}: estimated at most $${estimateUsd.toFixed(4)}.`);
  if (process.env['SPEND'] !== 'live') refuse('SPEND=live is not set. This stage spends money.');
  if (!process.argv.includes('--yes')) refuse('pass --yes to confirm you mean to spend money.');
  const shared = await openSharedMeter(Math.max(estimateUsd * 1.5, 0.01), process.env, 'learning');
  closeMeter = shared.close;
  return shared.meter;
}

const budget = (meter: Meter) => {
  const line = meter.line();
  return { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + DEADLINE_MS };
};

const imageOf = (c: MatchCase): string | null => c.imageUri ?? postImages[c.postId] ?? null;
const found = (c: MatchCase): readonly FoundCoin[] => searches[c.term] ?? [];
/** Coins that could still be the post's: launched after it, with the grace, inside the window. */
const launchOf = (f: FoundCoin): number | null => launched[f.address] ?? f.createdAt;
const possible = (c: MatchCase): readonly FoundCoin[] =>
  c.postedAt === null
    ? []
    : found(c).filter((f) => {
        const at = launchOf(f);
        return at !== null && at >= c.postedAt! - P.origin.launchAllowanceMs && at <= c.postedAt! + KEEP_AFTER_MS;
      });
const coinImage = (f: FoundCoin): string | null => meta[f.address]?.imageUri ?? f.imageUrl;

/* ── the stages ─────────────────────────────────────────────────────────── */

async function search(): Promise<void> {
  const sources: CoinSearch[] = [
    dexscreenerSearch({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS }),
    geckoterminal({ plan: 'free', baseUrl: 'https://api.geckoterminal.com/api/v2', fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS, now: Date.now }),
  ];
  const byTerm = new Map<string, MatchCase[]>();
  for (const c of cases) byTerm.set(c.term, [...(byTerm.get(c.term) ?? []), c]);
  let done = 0;
  for (const [term, mine] of byTerm) {
    if (searches[term] !== undefined) continue;
    const answers = await Promise.allSettled(sources.map((s) => s.search(term)));
    const read = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value.hits] : []));
    if (read.length === 0) {
      console.warn(`  ${term}: every source failed; left for the next run`);
      await sleep(SEARCH_PAUSE_MS);
      continue;
    }
    const times = mine.flatMap((c) => (c.postedAt === null ? [] : [c.postedAt]));
    const from = Math.min(...times) - KEEP_BEFORE_MS;
    /* Only the lower bound here: a market's time is never before its coin's launch, so a market
       older than the window is a coin launched before it. The upper bound waits for the chain's
       launch time (meta), since a bonded coin's pool can open days after its launch. */
    searches[term] = mergeHits(read)
      .filter((h) => times.length === 0 || h.createdAt === null || h.createdAt >= from)
      .map((h) => ({ address: h.address, name: h.name, ticker: h.ticker, createdAt: h.createdAt, imageUrl: h.imageUrl }));
    done += 1;
    if (done % 10 === 0) {
      save();
      console.log(`  ${done} names searched`);
    }
    await sleep(SEARCH_PAUSE_MS);
  }
  save();
  const right = cases.filter((c) => c.right !== null && found(c).some((f) => f.address === c.right)).length;
  console.log(`search: ${done} names searched this run; the right coin is among the results for ${right} of ${cases.filter((c) => c.right !== null).length} origin posts.`);
}

async function metaStage(): Promise<void> {
  const key = process.env['HELIUS_API_KEY'] ?? '';
  if (key === '') refuse('HELIUS_API_KEY is not set.');
  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  /* Each found coin's launch, from its oldest transaction: one call a coin, a few at a time. */
  const unlaunched = [...new Set(cases.flatMap((c) => found(c).map((f) => f.address)))].filter((a) => launched[a] === undefined);
  console.log(`meta: ${unlaunched.length} coins' launch times to read.`);
  for (let i = 0; i < unlaunched.length; i += RPC_CONCURRENCY) {
    await Promise.all(
      unlaunched.slice(i, i + RPC_CONCURRENCY).map(async (address) => {
        for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt++) {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransactionsForAddress', params: [address, { sortOrder: 'asc', limit: 1, transactionDetails: 'signatures' }] }) });
          if (r.status === 429) {
            await sleep(RPC_BACKOFF_MS * attempt);
            continue;
          }
          const j = r.ok ? ((await r.json()) as { result?: { data?: { blockTime?: number | null }[] } }) : {};
          const t = j.result?.data?.[0]?.blockTime ?? null;
          launched[address] = t === null ? null : t * 1_000;
          return;
        }
      }),
    );
    if (i % (RPC_CONCURRENCY * 20) === 0) {
      save();
      console.log(`  ${i} of ${unlaunched.length}`);
    }
  }
  save();
  const want = [...new Set(cases.flatMap((c) => possible(c).map((f) => f.address)))].filter((a) => meta[a] === undefined);
  console.log(`meta: ${want.length} coins to read.`);
  for (let i = 0; i < want.length; i += RPC_BATCH) {
    const batch = want.slice(i, i + RPC_BATCH);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAssetBatch', params: { ids: batch } }) });
    if (!r.ok) refuse(`the chain read responded ${r.status}; stopped.`);
    const j = (await r.json()) as { result?: ({ id?: string; content?: { json_uri?: string } } | null)[] };
    const uris = new Map((j.result ?? []).flatMap((a) => (a?.id === undefined ? [] : [[a.id, a.content?.json_uri ?? null] as const])));
    await Promise.all(
      batch.map(async (address) => {
        const uri = uris.get(address) ?? null;
        for (const gateway of METADATA_GATEWAYS) {
          try {
            const read = await fetchMetadata(uri, { gateway, fetch: globalThis.fetch, timeoutMs: P.universe.metadataTimeoutMs, maxBytes: P.universe.metadataMaxBytes });
            if (read.kind === 'notContentAddressed') {
              meta[address] = null;
              return;
            }
            const m = read.metadata;
            meta[address] = { links: [m.links.social, m.links.website, m.links.chat, m.description].filter((l): l is string => l !== null), imageUri: m.imageUri };
            return;
          } catch {
            /* the next gateway */
          }
        }
        meta[address] = null;
      }),
    );
    save();
    console.log(`  ${Math.min(i + RPC_BATCH, want.length)} of ${want.length}`);
  }
  const read = Object.values(meta).filter((m) => m !== null).length;
  console.log(`meta: ${read} of ${Object.keys(meta).length} coins' documents read.`);
}

async function posts(): Promise<void> {
  const xIds = cases.filter((c) => c.kind !== 'unrelated' && c.platform === 'x' && imageOf(c) === null && postImages[c.postId] === undefined).map((c) => c.postId);
  const tiktok = cases.filter((c) => c.platform === 'tiktok' && postImages[c.postId] === undefined);
  for (const c of tiktok) {
    try {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(c.postUrl)}`);
      const j = r.ok ? ((await r.json()) as { thumbnail_url?: string }) : {};
      postImages[c.postId] = j.thumbnail_url ?? null;
    } catch {
      postImages[c.postId] = null;
    }
  }
  save();
  console.log(`posts: ${tiktok.filter((c) => postImages[c.postId] !== null).length} of ${tiktok.length} TikTok covers found.`);
  if (xIds.length === 0) return;
  const meter = await paid(xIds.length * X_USD_PER_POST, `posts: ${xIds.length} X posts by id`);
  const apiKey = process.env['X_API_KEY'] ?? '';
  if (apiKey === '') refuse('X_API_KEY is not set.');
  const x = xPlatform({ client: xClient({ apiKey, baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter, now: () => Date.now() });
  const result = await x.lookup!(xIds, budget(meter));
  const got = new Map(result.value.items.map((i) => [i.sourceItemId, pictureOf(i.media)?.uri ?? null]));
  for (const id of xIds) postImages[id] = got.get(id) ?? null;
  save();
  console.log(`posts: ${[...got.values()].filter((u) => u !== null).length} of ${xIds.length} X posts have a picture; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

async function images(): Promise<void> {
  const key = process.env['VOYAGE_API_KEY'] ?? '';
  if (key === '') refuse('VOYAGE_API_KEY is not set.');
  const todo = cases.flatMap((c) => {
    const img = imageOf(c);
    if (img === null) return [];
    const coins = possible(c).filter((f) => coinImage(f) !== null && similarity[pairKey(c.postId, f.address)] === undefined);
    return coins.length === 0 ? [] : [{ c, img, coins }];
  });
  const uris = new Set(todo.flatMap((t) => [t.img, ...t.coins.map((f) => coinImage(f) as string)]));
  const meter = await paid(uris.size * VOYAGE_USD_PER_IMAGE * 2, `images: ${uris.size} pictures for ${todo.length} posts`);
  const embed = voyageEmbed({ client: voyageClient({ apiKey: key, baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
  const vectors = new Map<string, readonly number[] | null>();
  const list = [...uris];
  for (let i = 0; i < list.length; i += EMBED_BATCH) {
    const batch = list.slice(i, i + EMBED_BATCH);
    try {
      const result = await embed.embedMedia!(batch.map((uri) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null })), budget(meter));
      batch.forEach((uri, k) => vectors.set(uri, result.value[k]?.values ?? null));
    } catch (e) {
      /* One unreadable picture can fail a batch: ask one at a time, so the rest are not lost. */
      for (const uri of batch) {
        try {
          const one = await embed.embedMedia!([{ kind: 'image' as const, uri, width: null, height: null, durationMs: null }], budget(meter));
          vectors.set(uri, one.value[0]?.values ?? null);
        } catch {
          vectors.set(uri, null);
        }
      }
      if (!(e instanceof Error)) throw e;
    }
    console.log(`  ${Math.min(i + EMBED_BATCH, list.length)} of ${list.length} pictures`);
  }
  for (const { c, img, coins } of todo) {
    const pv = vectors.get(img);
    if (pv == null) continue;
    for (const f of coins) {
      const cv = vectors.get(coinImage(f) as string);
      if (cv == null) continue;
      let dot = 0;
      for (let k = 0; k < pv.length; k++) dot += (pv[k] ?? 0) * (cv[k] ?? 0);
      similarity[pairKey(c.postId, f.address)] = Math.round(dot * 10_000) / 10_000;
    }
  }
  save();
  console.log(`images: ${Object.keys(similarity).length} pairs compared; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

async function pairs(): Promise<void> {
  const bars = P.group.image;
  const todo = cases
    .flatMap((c) => {
      const img = imageOf(c);
      if (img === null) return [];
      return possible(c).flatMap((f) => {
        const k = pairKey(c.postId, f.address);
        const s = similarity[k];
        const coin = coinImage(f);
        return s !== undefined && s >= bars.borderline && s < bars.nearIdentical && sameSubject[k] === undefined && coin !== null ? [{ k, img, coin }] : [];
      });
    })
    .slice(0, PAIRS_CAP);
  const meter = await paid(todo.length * PAIR_USD * 2, `pairs: ${todo.length} borderline pictures`);
  const setup = readJudgeSetup(process.env);
  if (setup.state !== 'configured') refuse(`the judge is ${setup.state}.`);
  const price = priceFor(setup.model);
  if (price === null) refuse(`JUDGE_MODEL ${setup.model} has no price.`);
  const client = judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.pairMaxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep,
  });
  const j = anthropicJudge({ client, meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1 });
  const image = (uri: string) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null });
  for (const { k, img, coin } of todo) {
    try {
      const result = await j.sameSubject!(image(coin), image(img), budget(meter));
      if (result.value !== null) sameSubject[k] = result.value;
    } catch (e) {
      console.warn(`  ${k}: ${e instanceof Error ? e.message : String(e)}`);
    }
    save();
  }
  console.log(`pairs: ${todo.length} asked; spent $${meter.line().spentUsd.toFixed(4)}.`);
}

const stages: Record<string, () => Promise<void>> = { search, meta: metaStage, posts, images, pairs };
const stage = process.argv[2] ?? '';
const run = stages[stage];
if (run === undefined) refuse(`stage must be one of: ${Object.keys(stages).join(', ')}`);
try {
  await run();
} finally {
  if (closeMeter !== null) await closeMeter();
}
