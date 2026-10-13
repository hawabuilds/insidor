/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/feed-pass-rates.ts --yes [--text-only] [--label=name]`
 *
 * HOW MANY REAL COIN POSTS, AND HOW MANY NON-MEME POSTS, WOULD REACH THE FEED UNDER THE JUDGE AS
 * IT IS NOW. Two groups, each post judged alone exactly as the live scorer judges it (its text and
 * its picture), and held to core's `postScore` (the confidence bar and the name test):
 *
 *   gold       each gold coin's origin post (eval/src/gold/coin-evidence.json) — these should PASS
 *   non-meme   the recorded sample of today's feed the owner would reject (eval/src/feed/
 *              non-meme-sample.json: sport, K-pop and fan accounts, celebrity and political) —
 *              these should FAIL
 *
 * `--text-only` withholds the pictures, to measure what the judge did before it was shown them.
 * `--refresh-pictures` first re-reads each gold origin post on X (a fraction of a cent) and records
 * the picture the feed would show — a video's preview included — in eval/src/feed/
 * gold-origin-pictures.json, which later runs use; the gold evidence kept still images only.
 * The picture boost is applied as the projector applies it: each post's picture against the
 * coined pictures (internal.coined_picture), a gold post never against its OWN coin's picture.
 * `--no-boost` leaves it out. Results go to var/pass-rates-<label>.json; the summary is printed,
 * with the judge's token usage summed from each reply (fresh input, cache writes, cache reads,
 * output, and input per post) so a change to what the judge is sent can be costed, not guessed.
 *
 * Separate from gold-rejudge because it measures the feed's gate on both sides at once: a prompt
 * that lets fewer non-memes through is only better if it does not shut out the coins too.
 *
 * What breaks if changed carelessly: the gold group must stay the ORIGIN posts and the prompt's
 * own "yes" examples must stay out of it — a test made of the prompt's examples grades nothing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { storyId } from '../contracts/src/ids.ts';
import { postScore } from '../core/src/qualify/post-score.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup, type JudgeClient } from '../adapters/judge/anthropic/src/index.ts';
import { tuning } from '../eval/src/gold/coin-origins.ts';
import { loadEvidence } from '../eval/src/gold/coin-evidence.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { voyageEmbed, httpClient as voyageClient } from '../adapters/embed/voyage/src/index.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { pictureOf } from '../services/project/src/db.ts';

const P = DEFAULT_POLICY;
const USD_PER_POST = 0.01;
const TEXT_ONLY = process.argv.includes('--text-only');
const LABEL = process.argv.find((a) => a.startsWith('--label='))?.slice('--label='.length) ?? (TEXT_ONLY ? 'text-only' : 'now');

if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('feed-pass-rates refused: this calls the paid judge. Set SPEND=live and pass --yes.');
  process.exit(1);
}
const setup = readJudgeSetup(process.env);
if (setup.state !== 'configured') throw new Error(`the judge is ${setup.state}`);
const price = priceFor(setup.model);
if (price === null) throw new Error(`JUDGE_MODEL ${setup.model} has no price`);

interface Post { readonly group: 'gold' | 'non-meme'; readonly id: string; readonly kind: string; readonly text: string; readonly imageUri: string | null }
const evidence = loadEvidence();
const PICTURES = new URL('../eval/src/feed/gold-origin-pictures.json', import.meta.url);
if (process.argv.includes('--refresh-pictures')) {
  const ids = tuning().flatMap((c) => {
    const p = evidence.get(c.id)?.origin?.post ?? null;
    return p === null ? [] : [p.postId];
  });
  const shared = await openSharedMeter(0.05);
  const x = xPlatform({ client: xClient({ apiKey: process.env['X_API_KEY'] ?? '', baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter: shared.meter, now: () => Date.now() });
  const line = shared.meter.line();
  const read = await x.lookup!(ids, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
  const pictures: Record<string, string | null> = {};
  for (const item of read.value.items) pictures[item.sourceItemId] = pictureOf(item.media)?.uri ?? null;
  await shared.close();
  writeFileSync(PICTURES, `${JSON.stringify({ about: 'Each gold origin post\'s picture as the feed would show it (a video\'s preview included), re-read on X by tools/feed-pass-rates.ts --refresh-pictures.', readAt: new Date().toISOString().slice(0, 10), pictures }, null, 1)}\n`);
  console.log(`re-read ${read.value.items.length} of ${ids.length} origin posts; ${Object.values(pictures).filter(Boolean).length} with a picture.`);
}
const recorded = existsSync(PICTURES) ? (JSON.parse(readFileSync(PICTURES, 'utf8')) as { pictures: Record<string, string | null> }).pictures : {};
const gold: Post[] = tuning().flatMap((c) => {
  const post = evidence.get(c.id)?.origin?.post ?? null;
  return post === null ? [] : [{ group: 'gold' as const, id: c.id, kind: 'origin', text: post.text, imageUri: recorded[post.postId] ?? post.imageUri }];
});
const sample = JSON.parse(readFileSync(new URL('../eval/src/feed/non-meme-sample.json', import.meta.url), 'utf8')) as { posts: { itemId: string; kind: string; text: string; imageUri: string | null }[] };
const nonMeme: Post[] = sample.posts.map((p) => ({ group: 'non-meme', id: p.itemId, kind: p.kind, text: p.text, imageUri: p.imageUri }));
const posts = [...gold, ...nonMeme];
console.log(`${gold.length} gold origin posts, ${nonMeme.length} non-meme posts${TEXT_ONLY ? ', text only' : ', with pictures'}; at most $${(posts.length * USD_PER_POST).toFixed(2)}.`);

const { meter, close } = await openSharedMeter(posts.length * USD_PER_POST);
const http = judgeClient({
  apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.postBatchMaxOutputTokens, effort: price.effort,
  timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
  maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});
/* Every reply's usage, summed, for the report. Read through, never changed. */
const used = { calls: 0, pictures: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, inputWithPicture: 0, inputWithout: 0 };
const client: JudgeClient = {
  ...http,
  async judge(request) {
    const reply = await http.judge(request);
    const pictured = request.subjects.filter((x) => request.frames.has(String(x.storyId))).length;
    const all = reply.usage.inputTokens + (reply.usage.cacheWriteTokens ?? 0) + (reply.usage.cacheReadTokens ?? 0);
    used.calls += 1;
    used.pictures += pictured;
    if (pictured > 0) used.inputWithPicture += all;
    else used.inputWithout += all;
    used.input += reply.usage.inputTokens;
    used.cacheWrite += reply.usage.cacheWriteTokens ?? 0;
    used.cacheRead += reply.usage.cacheReadTokens ?? 0;
    used.output += reply.usage.outputTokens;
    return reply;
  },
};
const judge = anthropicJudge({
  client,
  meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1, question: 'post',
});

/* The coined pictures, and each post's own picture embedded, for the boost. */
const BOOST = !process.argv.includes('--no-boost') && !TEXT_ONLY;
const coined: { coinRef: string; uri: string; v: number[] }[] = [];
const postVectors = new Map<string, number[] | null>();
if (BOOST) {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-pass-rates' });
  for (const r of await asDb(pool).query<{ coin_ref: string; uri: string; embedding: string }>('select coin_ref, uri, embedding::text as embedding from internal.coined_picture')) {
    coined.push({ coinRef: r.coin_ref, uri: r.uri, v: JSON.parse(r.embedding) as number[] });
  }
  await pool.end();
  const embed = voyageEmbed({ client: voyageClient({ apiKey: (process.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
  for (const p of posts) {
    if (p.imageUri === null || postVectors.has(p.imageUri)) continue;
    const line = meter.line();
    const r = await embed.embedMedia!([{ kind: 'image', uri: p.imageUri, width: null, height: null, durationMs: null }], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + 60_000 });
    const v = r.value[0];
    postVectors.set(p.imageUri, v === null || v === undefined ? null : Array.from(v.values));
  }
}
const similarityOf = (p: Post): number | null => {
  const v = p.imageUri === null ? null : (postVectors.get(p.imageUri) ?? null);
  if (v === null) return null;
  const others = coined.filter((c) => c.coinRef !== p.id && c.uri !== p.imageUri);
  return others.length === 0 ? null : Math.max(...others.map((c) => c.v.reduce((s, x, i) => s + x * (v[i] ?? 0), 0)));
};

const rows: (Post & { coinable: boolean | null; name: string | null; confidence: number | null; lookedAt: string | null; passes: boolean })[] = [];
try {
  for (const p of posts) {
    const subject = {
      storyId: storyId(`rate-${p.id.replaceAll(':', '-')}`),
      texts: p.text.trim() === '' ? [] : [p.text.slice(0, P.judge.maxCharsPerText)],
      media: TEXT_ONLY || p.imageUri === null ? [] : [{ kind: 'image' as const, uri: p.imageUri, width: null, height: null, durationMs: null }],
      distinctAuthors: 1,
      distinctSources: 1,
    };
    const line = meter.line();
    const result = await judge.judge([subject], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + 120_000 });
    const o = result.value[0];
    const j = o?.kind === 'judged' ? o.judgement : null;
    rows.push({ ...p, coinable: j?.coinable ?? null, name: j?.proposedName ?? null, confidence: j?.confidence ?? null, lookedAt: j?.lookedAt ?? null, passes: j !== null && postScore(j, P, similarityOf(p)) === 'passes' });
  }
} finally {
  await close();
}

const rate = (g: Post['group']) => {
  const of = rows.filter((r) => r.group === g);
  const pass = of.filter((r) => r.passes).length;
  return `${pass} of ${of.length} pass (${Math.round((100 * pass) / Math.max(of.length, 1))}%)`;
};
console.log(`\n[${LABEL}] gold origin posts:  ${rate('gold')}   — should pass`);
console.log(`[${LABEL}] non-meme posts:     ${rate('non-meme')}   — should fail`);
for (const k of [...new Set(nonMeme.map((p) => p.kind))]) {
  const of = rows.filter((r) => r.group === 'non-meme' && r.kind === k);
  console.log(`    ${k.padEnd(24)} ${of.filter((r) => r.passes).length} of ${of.length} pass`);
}
mkdirSync(new URL('../var/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../var/pass-rates-${LABEL}.json`, import.meta.url), `${JSON.stringify(rows, null, 1)}\n`);
const allInput = used.input + used.cacheWrite + used.cacheRead;
const pct = (n: number) => `${Math.round((100 * n) / Math.max(allInput, 1))}%`;
console.log(`judge usage: ${used.calls} calls, ${used.pictures} with a picture; input ${allInput} tokens = fresh ${used.input} (${pct(used.input)}) + cache write ${used.cacheWrite} (${pct(used.cacheWrite)}) + cache read ${used.cacheRead} (${pct(used.cacheRead)}); output ${used.output}`);
console.log(`judge input per post: ${Math.round(allInput / Math.max(used.calls, 1))} tokens (with a picture ${Math.round(used.inputWithPicture / Math.max(used.pictures, 1))}, without ${Math.round(used.inputWithout / Math.max(used.calls - used.pictures, 1))}); output per post: ${Math.round(used.output / Math.max(used.calls, 1))}`);
writeFileSync(new URL(`../var/pass-rates-${LABEL}.usage.json`, import.meta.url), `${JSON.stringify(used, null, 1)}\n`);
console.log(`spent $${meter.line().spentUsd.toFixed(4)}`);
