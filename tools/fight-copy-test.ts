/**
 * `node --env-file=.env.local --experimental-strip-types tools/fight-copy-test.ts [--days 5] [--cap 0.10] [--out <file>] [--resume <file>]`
 *
 * THE MEME-WAR QUESTION, COPY-TESTED ON REAL NARRATIVES (policy.v153 Policy.narrative.fight; the
 * owner, 2026-10-23: one "Twitter World War" for the country beefs on X). Every shown narrative with
 * a post in the last `--days` is sent to the runner's own titler (adapters/judge/openai-compatible
 * titles.ts, the prompt that asks the title and the question in one call), with the posts the runner
 * would send, and the answers are listed: every narrative tagged, with its countries, and every
 * narrative whose title reads like real-world politics, with what it was answered.
 *
 * PASS when "China Turkey Meme War Over Patrick Star" (n-x:2113282719744741743, or where it was
 * merged) is tagged China and Turkey, and no narrative about riots, protests, bans, elections,
 * governments or real wars is tagged.
 *
 * ★ READ-ONLY on the database: one read-only transaction, nothing written but the spend rows the
 * shared meter books on the LEARNING book as a test (tools/lib/shared-meter.ts), capped at `--cap`
 * dollars. A call the test line refuses (it may be spent until 01:00 London) stops the run with exit
 * code 3, so a wrapper can wait and run it again with `--resume <the --out file>`: the narratives
 * already answered are not asked again. The beef and the titles that read like news are asked first,
 * so a short day still answers the two checks.
 *
 * What breaks if changed carelessly: this must call the runner's titler with the runner's settings
 * (`maxCountries`, the answer allowance), never a copy of the prompt, or it tests a question nobody asks.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/vocabulary.ts';
import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { DEFAULT_OPEN_MODEL, KNOWN_MODELS, openChatClient, openTitler, readOpenJudgeSetup } from '../adapters/judge/openai-compatible/src/index.ts';
import { BudgetRefused } from '../adapters/kit/vendor/src/index.ts';
import { createPool, DB_ROLE, PgNarrativeRepo, withTransaction } from '../store/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const days = Number(arg('--days') ?? 5);
const capUsd = Number(arg('--cap') ?? 0.1);
const out = arg('--out');
const resume = arg('--resume');
const DAY_MS = 86_400_000;
/** The beef the owner named, and the titles that read like real-world news: none of those may be tagged. */
const BEEF = 'n-x:2113282719744741743';
const POLITICS = /\b(riot|riots|protest|protests|protesters|ban|banned|bans|election|elections|vote|government|president|minister|parliament|police|army|military|missile|strike|strikes|sanction|sanctions|tariff|tariffs|diplomat|embassy|invasion|ceasefire|bomb|bombing|killed|shooting)\b/i;

const setup = readOpenJudgeSetup(process.env);
if (setup.state !== 'configured') {
  console.error('the open model is not configured in this environment');
  process.exit(2);
}
const model = KNOWN_MODELS.find((m) => m.id === (setup.model || DEFAULT_OPEN_MODEL)) ?? null;
if (model === null) {
  console.error(`no listed price for ${setup.model}`);
  process.exit(2);
}
const t = P.narrative.title;
const f = P.narrative.fight;
const tokens = Math.max(t.maxOutputTokens, f.maxOutputTokens);

const shared = await openSharedMeter(capUsd, process.env, 'learning');
const meter = shared.meter;
const client = openChatClient({ vendor: setup.vendor, apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: model.id, vision: false, maxOutputTokens: tokens, timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs, maxFrameBytes: P.judge.maxFrameBytes, providers: setup.providers, router: setup.router !== false, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
const titler = openTitler({ client, meter, now: () => Date.now() as Millis, model, vendor: setup.vendor, providers: setup.providers, router: setup.router !== false, charsPerToken: P.judge.charsPerToken, maxOutputTokens: tokens, maxTitleChars: t.maxTitleChars, maxCountries: f.maxCountries });

interface Subject {
  readonly id: string;
  readonly title: string | null;
  readonly size: number;
  readonly firstShownAtMs: number | null;
  readonly posts: readonly string[];
  readonly names: readonly string[];
}

/* ── the narratives and their posts, read-only ── */
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-fight-copy-test' });
const nowMs = Date.now();
let subjects: Subject[] = [];
let beefLead: string = BEEF;
try {
  await withTransaction(pool, async (db) => {
    await db.query('set transaction read only');
    const repo = new PgNarrativeRepo(db);
    const live = await repo.live(nowMs - days * DAY_MS);
    const states = await repo.states([BEEF]);
    if (states[0]?.state === 'merged' && states[0].mergedInto !== null) beefLead = states[0].mergedInto;
    const ids = [...new Set(live.flatMap((x) => x.members))];
    const rows = new Map((await repo.standingRows(ids)).map((r) => [r.itemId, r] as const));
    const reach = (await repo.reach(ids, nowMs - days * DAY_MS)).latest;
    subjects = live.map((x) => {
      const members = x.members.map((m) => rows.get(m)).filter((r) => r !== undefined);
      const seen = [...members].sort((a, b) => (reach.get(b.itemId) ?? -1) - (reach.get(a.itemId) ?? -1) || b.atMs - a.atMs);
      const names = [...new Set(members.map((m) => m.proposedName).filter((n): n is string => n !== null && n.trim() !== ''))];
      return { id: x.id, title: x.title, size: x.members.length, firstShownAtMs: x.firstShownAtMs, posts: seen.slice(0, t.postsSent).map((m) => m.body.slice(0, t.maxChars)), names };
    }).filter((s) => s.posts.length > 0);
    /* The two checks first: the beef, then every title that reads like news; the rest after, biggest first. */
    const rank = (s: Subject): number => (s.id === beefLead ? 0 : POLITICS.test(s.title ?? '') ? 1 : 2);
    subjects.sort((a, b) => rank(a) - rank(b) || b.size - a.size || a.id.localeCompare(b.id));
  });
} finally {
  await pool.end();
}
console.log(`${subjects.length} shown narratives with a post in the last ${days} days; the beef is ${beefLead}`);

/* ── the question, one narrative a call, as the runner asks it ── */
type Answer = { title: string | null; fight: readonly string[] | null };
const answers = new Map<string, Answer>();
let spentBefore = 0;
if (resume !== null && existsSync(resume)) {
  const was = JSON.parse(readFileSync(resume, 'utf8')) as { spent?: number; subjects?: { id: string; answer: Answer | null }[] };
  for (const x of was.subjects ?? []) if (x.answer !== null) answers.set(x.id, x.answer);
  spentBefore = was.spent ?? 0;
  console.log(`resumed: ${answers.size} answered before, $${spentBefore.toFixed(5)} spent`);
}
let refused = false;
for (const s of subjects) {
  if (answers.has(s.id)) continue;
  try {
    const r = await titler.title([{ ref: s.id, posts: s.posts, names: s.names }], { capUsd: meter.line().capUsd, spentUsd: meter.line().spentUsd, maxCalls: null, deadline: (Date.now() + P.judge.timeoutMs) as Millis });
    const o = r.value[0];
    answers.set(s.id, o?.kind === 'titled' ? { title: o.title, fight: o.fight ?? null } : { title: null, fight: null });
  } catch (e) {
    if (!(e instanceof BudgetRefused)) throw e;
    console.error(`refused for money after ${answers.size} narratives: ${e.message}`);
    refused = true;
    break;
  }
}
const spent = spentBefore + meter.spentUsd();
await shared.close();

/* ── the report ── */
/* As the app shows it: the answer, on a narrative with at least `fight.minPosts` posts (services/project `countriesOf`). */
const tagged = subjects.filter((s) => (answers.get(s.id)?.fight ?? []).length >= 2 && s.size >= f.minPosts);
const thin = subjects.filter((s) => (answers.get(s.id)?.fight ?? []).length >= 2 && s.size < f.minPosts);
const unread = subjects.filter((s) => answers.has(s.id) && answers.get(s.id)?.fight === null);
const political = subjects.filter((s) => POLITICS.test(`${s.title ?? ''} ${answers.get(s.id)?.title ?? ''}`));
console.log(`\nTAGGED (${tagged.length}):`);
for (const s of tagged) {
  console.log(`  ${(answers.get(s.id)?.fight ?? []).join(' vs ')}  |  ${s.title ?? '(no title)'}  |  ${s.id}, ${s.size} posts`);
  for (const p of s.posts.slice(0, 2)) console.log(`      · ${p.replace(/\s+/g, ' ').slice(0, 160)}`);
}
console.log(`\nANSWERED YES ON FEWER THAN ${f.minPosts} POSTS, NOT SHOWN (${thin.length}):`);
for (const s of thin) {
  console.log(`  ${(answers.get(s.id)?.fight ?? []).join(' vs ')}  |  ${s.title ?? '(no title)'}  |  ${s.id}, ${s.size} posts`);
  for (const p of s.posts.slice(0, 2)) console.log(`      · ${p.replace(/\s+/g, ' ').slice(0, 160)}`);
}
console.log(`\nREADS LIKE REAL-WORLD NEWS (${political.length}), each must be untagged:`);
for (const s of political) console.log(`  ${!answers.has(s.id) ? 'NOT ASKED' : tagged.includes(s) ? 'TAGGED ✗' : (answers.get(s.id)?.fight ?? []).length >= 2 ? 'yes, too few posts to show' : 'not tagged'}  |  ${s.title ?? '(no title)'}  |  ${s.id}`);
console.log(`\nunreadable answers: ${unread.length}${unread.length > 0 ? ` (${unread.map((s) => s.id).join(', ')})` : ''}`);
const beef = answers.get(beefLead)?.fight ?? null;
const beefOk = beef !== null && beef.includes('China') && beef.includes('Turkey');
const politicsOk = political.every((s) => answers.has(s.id) && !tagged.includes(s));
const perCall = answers.size === 0 ? 0 : spent / answers.size;
const shownPerDay = subjects.filter((s) => s.firstShownAtMs !== null && s.firstShownAtMs >= nowMs - days * DAY_MS).length / days;
console.log(`\nbeef ${beefLead}: ${beef === null ? 'not answered' : beef.length === 0 ? 'not tagged' : beef.join(' vs ')} → ${beefOk ? 'PASS' : 'FAIL'}`);
console.log(`politics untagged → ${politicsOk ? 'PASS' : 'FAIL'}`);
console.log(`answered ${answers.size} of ${subjects.length}`);
console.log(`spent $${spent.toFixed(5)} for ${answers.size} calls ($${perCall.toFixed(6)} a call); about ${shownPerDay.toFixed(0)} new narratives a day → about $${(perCall * shownPerDay * 2).toFixed(4)} a day with one re-title each`);
if (out !== null) writeFileSync(out, JSON.stringify({ days, beefLead, spent, perCall, shownPerDay, subjects: subjects.map((s) => ({ id: s.id, title: s.title, size: s.size, posts: s.posts.slice(0, 2), answer: answers.get(s.id) ?? null })) }, null, 2));
process.exit(refused ? 3 : 0);
