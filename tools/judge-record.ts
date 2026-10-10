/**
 * `pnpm judge:record` — RECORD THE JUDGE'S REAL ANSWERS TO THE NEWS CONTRASTS, ONCE.
 *
 * Runs every case in adapters/judge/anthropic/fixtures/news-contrasts.json through the real
 * judge and writes the answers back into that file as `answerSource: "recorded"`. From then
 * on src/news-contrasts.test.ts checks the model's actual answers, not hand-written ones —
 * which is the test that catches a prompt edit the model reads differently.
 *
 * ★ IT SPENDS MONEY, SO IT IS HARD TO RUN BY ACCIDENT. It refuses unless BOTH `SPEND=live`
 * is set and `--yes` is passed, prints the estimated cost before asking anything, and caps
 * itself at the fixture count: it sends exactly the cases in the file, never more, and its
 * meter's cap is the estimate, so it cannot spend more than it printed. `pnpm test` and CI
 * never run it; nothing imports it.
 *
 * Its spend goes through a meter held in memory, NOT the durable ledger in the database, so
 * it does not count against the runner's DAILY_BUDGET_USD. It prints what it spent.
 *
 * A case the judge answers differently from its `expect` is written as answered, and named
 * on the way out — the test will then fail, and that failure is the finding.
 *
 *   SPEND=live pnpm judge:record --yes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { storyId } from '../contracts/src/ids.ts';
import { anthropicJudge, httpClient, priceFor, readJudgeSetup } from '../adapters/judge/anthropic/src/index.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'adapters/judge/anthropic/fixtures/news-contrasts.json');

interface Case {
  id: string;
  texts: string[];
  expect: { coinable: boolean };
  answerSource: string;
  answer: Record<string, unknown>;
  recordedWith?: string;
}

function refuse(message: string): never {
  console.error(`judge:record refused — ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env['SPEND'] !== 'live') refuse('SPEND=live is not set. This script spends money.');
  if (!process.argv.includes('--yes')) refuse('pass --yes to confirm you mean to spend money.');

  const setup = readJudgeSetup(process.env);
  if (setup.state !== 'configured') refuse(`the judge is ${setup.state}; set ANTHROPIC_API_KEY and JUDGE_MODEL.`);
  const price = priceFor(setup.model);
  if (price === null) refuse(`JUDGE_MODEL ${setup.model} has no price in prices.ts.`);

  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: Case[] };
  const cases = fixture.cases;
  const subjects = cases.map((c) => ({
    storyId: storyId(c.id),
    texts: c.texts,
    media: [],
    distinctAuthors: c.texts.length,
    distinctSources: 1,
  }));
  /* The cap: exactly the fixture cases, never more. */
  if (subjects.length !== cases.length || subjects.length === 0) refuse('the fixture file has no cases.');

  const P = DEFAULT_POLICY;
  const client = httpClient({
    apiKey: setup.apiKey,
    baseUrl: setup.baseUrl,
    model: setup.model,
    maxOutputTokens: P.judge.maxOutputTokens,
    effort: price.effort,
    timeoutMs: P.judge.timeoutMs,
    maxAttempts: P.judge.maxAttempts,
    backoffMs: P.judge.backoffMs,
    maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const probe = anthropicJudge({ client, meter: inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: Date.now }), now: Date.now, model: setup.model, policy: P.judge, maxBatch: P.qualify.batchSize });
  const estimate = probe.estimate(subjects);
  console.log(
    `judge:record — ${subjects.length} cases, ${estimate.estUnits} call(s) to ${setup.model}. ` +
      `Estimated at most $${estimate.usd.toFixed(4)} (a deliberately high estimate; the real cost is usually under a third of it).`,
  );

  /* A meter capped at the estimate: this run cannot spend more than it just printed. */
  const meter = inMemoryMeter({ dailyCapUsd: estimate.usd, softStop: 1, now: Date.now });
  const judge = anthropicJudge({ client, meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: P.qualify.batchSize });
  const result = await judge.judge(subjects, { capUsd: estimate.usd, spentUsd: 0, maxCalls: estimate.estUnits, deadline: Date.now() + P.judge.timeoutMs * P.judge.maxAttempts * estimate.estUnits });

  const disagreed: string[] = [];
  const missing: string[] = [];
  result.value.forEach((outcome, i) => {
    const c = cases[i];
    if (c === undefined) return;
    if (outcome.kind !== 'judged') {
      missing.push(`${c.id} (${outcome.detail})`);
      return;
    }
    const j = outcome.judgement;
    c.answer = {
      coinable: j.coinable,
      proposedName: j.proposedName,
      confidence: j.confidence,
      alternateNames: j.alternateNames,
      subjectSpans: j.subjectSpans,
    };
    c.answerSource = 'recorded';
    c.recordedWith = `${j.judgeId} at ${new Date(j.judgedAt).toISOString()}`;
    if (j.coinable !== c.expect.coinable) disagreed.push(`${c.id}: expected ${String(c.expect.coinable)}, got ${String(j.coinable)}`);
  });

  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`judge:record — the meter recorded $${meter.spentUsd().toFixed(5)} (a call that failed without an answer is counted at its estimate). Wrote ${cases.length - missing.length} recorded answers to ${path.relative(ROOT, FIXTURE)}.`);
  if (missing.length > 0) console.log(`Not recorded (kept as hand-written): ${missing.join('; ')}`);
  if (disagreed.length > 0) {
    console.log(`★ The judge disagreed with the expected answer on ${disagreed.length} case(s); the news-contrast test will now fail on them:\n  ${disagreed.join('\n  ')}`);
  }
}

main().catch((error: unknown) => {
  console.error(`judge:record failed — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
