/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/gold-rejudge.ts --yes [--origins]`
 *
 * DOES A PROMPT CHANGE DROP REAL COIN POSTS? Every gold creator post the judge already answered
 * (coin-evidence.json `judged`) is asked again under the prompts as they are now, and the two
 * answers are compared: how many real coin posts each prompt calls coinable, how many would reach
 * the feed (coinable, confident enough, a name of at most `rising.maxNameWords` words), and which
 * posts flipped.
 *
 * Separate from gold-fetch because it must not overwrite the evidence: the eval replays the
 * answers recorded there, and a comparison that rewrote its own "before" would compare nothing.
 * The "after" goes to var/gold-rejudge.json.
 *
 * `--origins` asks about each coin's ORIGIN post instead — the meme the coin was made from, which
 * the feed exists to catch. No answer was recorded for those, so it prints this prompt's answers
 * only; run it once on a checkout with the old prompts and once now, and compare the two files.
 *
 * Every gold coin is a real coin, so every post here is one the feed should keep. A drop is the
 * cost of the change, in coins it would have hidden.
 *
 * What breaks if changed carelessly: each post is sent exactly as gold-fetch sent it (its text and
 * its picture, alone). Sending it differently compares two questions, not two prompts.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
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

if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('gold-rejudge refused: this calls the paid judge. Set SPEND=live and pass --yes.');
  process.exit(1);
}
const setup = readJudgeSetup(process.env);
if (setup.state !== 'configured') throw new Error(`the judge is ${setup.state}`);
const price = priceFor(setup.model);
if (price === null) throw new Error(`JUDGE_MODEL ${setup.model} has no price`);

const ORIGINS = process.argv.includes('--origins');
const evidence = loadEvidence();
const todo = tuning().flatMap((c) => {
  const ev = evidence.get(c.id);
  if (ORIGINS) {
    const post = ev?.origin?.post ?? null;
    return post === null ? [] : [{ id: c.id, post, before: { coinable: false, proposedName: null } }];
  }
  const post = ev?.creator?.kind === 'post' ? ev.creator.post : null;
  const before = post === null ? undefined : ev?.judged?.[post.postId];
  return post === null || before === undefined ? [] : [{ id: c.id, post, before }];
});
console.log(`${todo.length} gold ${ORIGINS ? 'origin posts' : 'creator posts with a recorded answer'}; at most $${(todo.length * USD_PER_POST).toFixed(2)}.`);

const { meter, close } = await openSharedMeter(todo.length * USD_PER_POST);
const judge = anthropicJudge({
  client: judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.postBatchMaxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }),
  meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1,
});

/* The recorded "before" holds no confidence, so "reaches the feed" is compared on the after side only. */
const rows: { id: string; text: string; before: boolean; beforeName: string | null; after: boolean | null; afterName: string | null; afterConfidence: number | null; feed: boolean }[] = [];
try {
  for (const { id, post, before } of todo) {
    const subject = {
      storyId: storyId(`gold-${id.replace(':', '-')}`),
      texts: post.text.trim() === '' ? [] : [post.text.slice(0, P.judge.maxCharsPerText)],
      media: post.imageUri === null ? [] : [{ kind: 'image' as const, uri: post.imageUri, width: null, height: null, durationMs: null }],
      distinctAuthors: 1,
      distinctSources: 1,
    };
    const line = meter.line();
    const result = await judge.judge([subject], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + 120_000 });
    const o = result.value[0];
    const j = o?.kind === 'judged' ? o.judgement : null;
    rows.push({
      id, text: post.text.slice(0, 120).replace(/\s+/g, ' '),
      before: before.coinable, beforeName: before.proposedName,
      after: j?.coinable ?? null, afterName: j?.proposedName ?? null, afterConfidence: j?.confidence ?? null,
      feed: j !== null && postScore(j, P) === 'passes',
    });
  }
} finally {
  await close();
}

const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
if (ORIGINS) {
  console.log(`\norigin posts coinable: ${count((r) => r.after === true)} of ${count((r) => r.after !== null)}; would reach the feed: ${count((r) => r.feed)}`);
  for (const r of rows) console.log(`  ${r.after === null ? '?' : r.after ? 'yes' : 'no '} ${r.feed ? 'feed' : '    '} ${r.id}  ${r.afterName ?? '-'}  — ${r.text}`);
  mkdirSync(new URL('../var/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../var/gold-rejudge-origins.json', import.meta.url), `${JSON.stringify(rows, null, 1)}\n`);
  console.log(`spent $${meter.line().spentUsd.toFixed(4)}`);
  process.exit(0);
}
const asked = count((r) => r.after !== null);
console.log(`\nbefore (the recorded prompt):  ${count((r) => r.before)} of ${rows.length} real coin posts coinable`);
console.log(`after  (the prompt now):       ${count((r) => r.after === true)} of ${asked} coinable; ${count((r) => r.feed)} would reach the feed (confidence and name test)`);
console.log(`flipped to not coinable:       ${count((r) => r.before && r.after === false)}`);
console.log(`flipped to coinable:           ${count((r) => !r.before && r.after === true)}`);
for (const r of rows.filter((x) => x.before && x.after === false)) console.log(`  lost  ${r.id}  was "${r.beforeName}"  — ${r.text}`);
for (const r of rows.filter((x) => !x.before && x.after === true)) console.log(`  won   ${r.id}  now "${r.afterName}"  — ${r.text}`);
mkdirSync(new URL('../var/', import.meta.url), { recursive: true });
writeFileSync(new URL('../var/gold-rejudge.json', import.meta.url), `${JSON.stringify(rows, null, 1)}\n`);
console.log(`\nspent $${meter.line().spentUsd.toFixed(4)}; every row in var/gold-rejudge.json`);
