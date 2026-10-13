/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/record-news-contrasts.ts --yes`
 *
 * RECORDS THE JUDGE'S REAL ANSWER TO EVERY NEWS-VERSUS-SUBJECT CASE, so the fixture's answers are
 * what the model said under today's prompts and not what we hoped it would say.
 *
 * Separate from the test because the test must never reach the network: it replays what this
 * wrote. Run it after any prompt edit; a case whose recorded answer disagrees with its expectation
 * is printed, and the test then fails on it — which is the point.
 *
 * One case is one judge call, on the shared ledger and lines (tools/lib/shared-meter.ts), capped
 * at a cent per case.
 *
 * What breaks if changed carelessly: each case is sent as the judge sees a story — its texts as
 * separate posts, no media. Sending them joined, or with media, records an answer to a question
 * the live judge is never asked.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { storyId } from '../contracts/src/ids.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup } from '../adapters/judge/anthropic/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const P = DEFAULT_POLICY;
const FILE = join(import.meta.dirname, '..', 'adapters', 'judge', 'anthropic', 'fixtures', 'news-contrasts.json');
const USD_PER_CASE = 0.01;

interface Case {
  readonly id: string;
  readonly texts: readonly string[];
  readonly expect: { readonly coinable: boolean };
  answerSource: string;
  answer: Record<string, unknown>;
}

if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('record-news-contrasts refused: this calls the paid judge. Set SPEND=live and pass --yes.');
  process.exit(1);
}
const setup = readJudgeSetup(process.env);
if (setup.state !== 'configured') throw new Error(`the judge is ${setup.state}`);
const price = priceFor(setup.model);
if (price === null) throw new Error(`JUDGE_MODEL ${setup.model} has no price`);

const fixture = JSON.parse(readFileSync(FILE, 'utf8')) as { about: string; cases: Case[] };
const { meter, close } = await openSharedMeter(fixture.cases.length * USD_PER_CASE);
const judge = anthropicJudge({
  client: judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.postBatchMaxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }),
  meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1,
});

let disagree = 0;
try {
  for (const c of fixture.cases) {
    const subject = { storyId: storyId(c.id), texts: c.texts, media: [], distinctAuthors: c.texts.length, distinctSources: 1 };
    const line = meter.line();
    const result = await judge.judge([subject], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + 120_000 });
    const outcome = result.value[0];
    if (outcome?.kind !== 'judged') {
      console.log(`${c.id.padEnd(22)} not judged (${outcome?.kind ?? 'no answer'}); left as it was`);
      continue;
    }
    const j = outcome.judgement;
    c.answer = { coinable: j.coinable, proposedName: j.proposedName, confidence: j.confidence };
    c.answerSource = 'recorded';
    const ok = j.coinable === c.expect.coinable;
    if (!ok) disagree += 1;
    console.log(`${c.id.padEnd(22)} ${ok ? 'agrees   ' : 'DISAGREES'} coinable=${j.coinable} ${j.confidence.toFixed(2)} ${j.proposedName ?? '-'}`);
  }
} finally {
  await close();
}
fixture.about = `The news-versus-subject contrasts the prompts teach. Each case is a story the judge could be asked about, the answer it should give, and the prompt lines that teach that answer. Answers marked "recorded" are the judge's real answers under the current prompts (${setup.model}, ${new Date().toISOString().slice(0, 10)}), written by tools/record-news-contrasts.ts; rerun it after any prompt edit.`;
writeFileSync(FILE, `${JSON.stringify(fixture, null, 1)}\n`);
console.log(`${fixture.cases.length} cases, ${disagree} disagree; spent $${meter.line().spentUsd.toFixed(4)}`);
