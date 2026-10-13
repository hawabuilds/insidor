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
 * Results go to var/pass-rates-<label>.json; the summary is printed.
 *
 * Separate from gold-rejudge because it measures the feed's gate on both sides at once: a prompt
 * that lets fewer non-memes through is only better if it does not shut out the coins too.
 *
 * What breaks if changed carelessly: the gold group must stay the ORIGIN posts and the prompt's
 * own "yes" examples must stay out of it — a test made of the prompt's examples grades nothing.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { storyId } from '../contracts/src/ids.ts';
import { postScore } from '../core/src/qualify/post-score.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup } from '../adapters/judge/anthropic/src/index.ts';
import { tuning } from '../eval/src/gold/coin-origins.ts';
import { loadEvidence } from '../eval/src/gold/coin-evidence.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

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
const gold: Post[] = tuning().flatMap((c) => {
  const post = evidence.get(c.id)?.origin?.post ?? null;
  return post === null ? [] : [{ group: 'gold' as const, id: c.id, kind: 'origin', text: post.text, imageUri: post.imageUri }];
});
const sample = JSON.parse(readFileSync(new URL('../eval/src/feed/non-meme-sample.json', import.meta.url), 'utf8')) as { posts: { itemId: string; kind: string; text: string; imageUri: string | null }[] };
const nonMeme: Post[] = sample.posts.map((p) => ({ group: 'non-meme', id: p.itemId, kind: p.kind, text: p.text, imageUri: p.imageUri }));
const posts = [...gold, ...nonMeme];
console.log(`${gold.length} gold origin posts, ${nonMeme.length} non-meme posts${TEXT_ONLY ? ', text only' : ', with pictures'}; at most $${(posts.length * USD_PER_POST).toFixed(2)}.`);

const { meter, close } = await openSharedMeter(posts.length * USD_PER_POST);
const judge = anthropicJudge({
  client: judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.postBatchMaxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }),
  meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1,
});

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
    rows.push({ ...p, coinable: j?.coinable ?? null, name: j?.proposedName ?? null, confidence: j?.confidence ?? null, lookedAt: j?.lookedAt ?? null, passes: j !== null && postScore(j, P) === 'passes' });
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
console.log(`spent $${meter.line().spentUsd.toFixed(4)}`);
