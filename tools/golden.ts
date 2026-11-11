/**
 * THE MUST-STILL-WORK GATE (the owner, 2026-10-29: "every time we fixed something we have gone a few
 * steps back"). Replays For You's own decision (services/project `buildRising`, the code the projector
 * ships) for each case in tools/golden-cases.json at the moment the case names, and fails when a case
 * no longer comes out as expected. Run before every ship of the project or the runner:
 *
 *   node --env-file=.env.local --experimental-strip-types tools/golden.ts
 *
 * ★ READ-ONLY. It opens a read-only transaction and writes nothing; it calls no paid service.
 * ★ EXCEPT WITH --coins: the `coins` cases put the runner's coin-and-post question (services/runner
 *   work/coin-post-check.ts) to the judge, live — five calls, about $0.001. Run it whenever that prompt
 *   (adapters/judge/anthropic/prompts/coin-post-subject.txt) or the open model changes. `--only-coins`
 *   asks those alone, without the For You replays.
 * ★ THE `narratives` CASES (the owner, 2026-11-11, the boxing cat): posts he said are one story must be
 *   in ONE narrative, and that narrative's coin must be the one he named. Read from the runner's own
 *   narrative tables as they are now, so a regroup, a split or a coin pick that pulls the story apart
 *   again fails the ship. Each case also checks the posts that carry the same uploaded file still get
 *   the same video key (adapters/platform/x video-key.ts), the link that keeps new posts with them.
 * ★ TODAY'S CODE, TODAY'S POLICY, THE STORE AS IT IS. A case is replayed with the post alone (`only`),
 *   so a case checks every gate a post must pass, not where it sorts among the others. Readings taken
 *   after the case's moment are in the store too: a case states a moment the post was clearly in or
 *   out, never one on the edge.
 *
 * What breaks if changed carelessly: a case edited to match a new result. A case changes only when the
 * owner says the expected answer changed; a failing case is a finding, never a typo.
 */

import fs from 'node:fs';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { DEFAULT_BASE_URL, DEFAULT_VENDOR, KNOWN_MODELS, openChatClient, openCoinPostCheck } from '../adapters/judge/openai-compatible/src/index.ts';
import { openProviders, ROUTER_PRIMARY_MODEL } from '../adapters/judge/openai-compatible/src/setup.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { asDb, createPool, DB_ROLE, PgCoinPostCheckRepo } from '../store/src/index.ts';
import { buildRising } from '../services/project/src/rising.ts';
import { videoKeyOf } from '../adapters/platform/x/src/video-key.ts';

interface Case { readonly post: string; readonly at: string; readonly expect: 'on' | 'off'; readonly why: string }

interface NarrativeCase { readonly posts: readonly string[]; readonly coin: string; readonly why: string }

interface CoinCase { readonly post: string; readonly coin: string; readonly expect: 'yes' | 'no'; readonly why: string }

const file = JSON.parse(fs.readFileSync(new URL('./golden-cases.json', import.meta.url), 'utf8'));
const cases: readonly Case[] = process.argv.includes('--only-coins') ? [] : file.forYou;
const narrativeCases: readonly NarrativeCase[] = process.argv.includes('--only-coins') ? [] : (file.narratives ?? []);
const coinCases: readonly CoinCase[] = process.argv.includes('--coins') || process.argv.includes('--only-coins') ? file.coins : [];
const url = process.env['DATABASE_URL_SERVICE'] ?? process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set');
const pool = createPool(DB_ROLE.service, { applicationName: 'golden', statementTimeoutMs: 120_000, env: { DATABASE_URL_SERVICE: url } } as never);

let failed = 0;
for (const c of cases) {
  const frame = await buildRising(asDb(pool) as never, Date.parse(c.at) as never, new Map(), 30 * 60_000, DEFAULT_POLICY, null, undefined as never, [c.post]);
  const on = frame.fyp.some((p: { readonly post?: { readonly id: string }; readonly id?: string }) => (p.post?.id ?? p.id) === c.post);
  const why = frame.whyNot.get(c.post) ?? frame.heldBy.get(c.post) ?? null;
  const ok = (c.expect === 'on') === on;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.expect.padEnd(3)} ${on ? 'on ' : 'off'}  ${c.post}  ${c.why}${!ok && why !== null ? `  (now: ${String(why)})` : ''}`);
}

/* One story, one narrative, its coin: the runner's narrative tables as they are now. */
for (const c of narrativeCases) {
  const client = await pool.connect();
  let problem: string | null = null;
  try {
    await client.query('begin read only');
    const rows = (await client.query<{ item_id: string; narrative_id: string | null; media: unknown }>(
      `select i.item_id, m.narrative_id, i.media from public.item i left join internal.narrative_member m on m.item_id = i.item_id where i.item_id = any($1::text[])`,
      [c.posts],
    )).rows;
    const homes = new Set(rows.map((r) => r.narrative_id));
    const home = homes.size === 1 ? [...homes][0] ?? null : null;
    if (rows.length !== c.posts.length) problem = `${c.posts.length - rows.length} post(s) not stored`;
    else if (home === null) problem = `split across ${[...homes].map((h) => h ?? 'none').join(', ')}`;
    else {
      const coin = (await client.query<{ address: string }>(
        `select address from internal.narrative_coin_pick where narrative_id = $1 and outcome = 'picked'`,
        [home],
      )).rows[0]?.address ?? null;
      if (coin !== c.coin) problem = `${home} carries coin ${coin ?? 'none'}`;
    }
    /* Posts carrying one uploaded file must share its key: the link new posts join by. */
    const byFile = new Map<string, Set<string | null>>();
    for (const r of rows) {
      const file = Array.isArray(r.media) ? String((r.media[0] as { uri?: unknown } | undefined)?.uri ?? '') : '';
      if (file === '') continue;
      byFile.set(file, (byFile.get(file) ?? new Set()).add(videoKeyOf(r.media)));
    }
    for (const [f, keys] of byFile) if (keys.has(null) || keys.size !== 1) problem ??= `no shared video key for ${f}`;
    await client.query('rollback');
  } finally {
    client.release();
  }
  if (problem !== null) failed += 1;
  console.log(`${problem === null ? 'PASS' : 'FAIL'}  one narrative  ${c.posts.length} posts  ${c.why}${problem !== null ? `  (now: ${problem})` : ''}`);
}

/* The coin-and-post question, asked as the runner asks it: the same sides read, the same prompt, the post question's model. */
if (coinCases.length > 0) {
  const key = process.env['OPENROUTER_API_KEY'];
  const model = KNOWN_MODELS.find((m) => m.id === ROUTER_PRIMARY_MODEL);
  if (!key || model === undefined) throw new Error('--coins needs OPENROUTER_API_KEY and the post question\'s model');
  const P = DEFAULT_POLICY.judge;
  /* The runner's own hosts (its OPEN_JUDGE_PROVIDERS, 29 Oct): left to the router, another host answered two cases the other way. */
  const providers = process.env['OPEN_JUDGE_PROVIDERS'] === undefined ? ['together', 'coreweave', 'deepinfra'] : openProviders(process.env);
  const meter = inMemoryMeter({ dailyCapUsd: 0.05, softStop: 1, now: () => Date.now() });
  const client = openChatClient({ vendor: DEFAULT_VENDOR, apiKey: key, baseUrl: DEFAULT_BASE_URL, model: model.id, vision: true, maxOutputTokens: P.pairMaxOutputTokens, timeoutMs: P.timeoutMs, maxAttempts: P.maxAttempts, backoffMs: P.backoffMs, maxWaitMs: P.maxWaitMs, maxFrameBytes: P.maxFrameBytes, pictureSize: null, providers, router: true, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  const judge = openCoinPostCheck({ client, meter, now: () => Date.now() as never, model, vendor: DEFAULT_VENDOR, providers, router: true, judge: P });
  const sides = new Map((await new PgCoinPostCheckRepo(asDb(pool) as never).sides(coinCases.map((c) => ({ itemId: c.post, address: c.coin })))).map((d) => [`${d.itemId}|${d.address}`, d] as const));
  const image = (uri: string) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null });
  console.log('');
  for (const c of coinCases) {
    const d = sides.get(`${c.post}|${c.coin}`);
    const r = d === undefined ? null : await judge.check({ coin: { name: d.coinName, ticker: d.coinTicker, description: d.coinDescription, linkedText: d.linkedText, picture: image(d.coinPicture) }, post: { text: d.postText, picture: image(d.postPicture) } }, { capUsd: 0.05, spentUsd: 0, maxCalls: 1, deadline: (Date.now() + 60_000) as never });
    /* "unsure" keeps the coin, so it fails a "no" case and passes a "yes" one. */
    const answer = r?.value ?? (d === undefined ? 'not readable' : 'no answer');
    const ok = c.expect === 'no' ? answer === 'no' : answer === 'yes' || answer === 'unsure';
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.expect.padEnd(3)} ${String(answer).padEnd(6)} ${c.post}  ${c.why}`);
  }
}

await (pool as unknown as { end: () => Promise<void> }).end();
const total = cases.length + narrativeCases.length + coinCases.length;
console.log(failed === 0 ? `\nall ${total} cases hold` : `\n${failed} of ${total} cases FAILED — do not ship`);
process.exit(failed === 0 ? 0 : 1);
