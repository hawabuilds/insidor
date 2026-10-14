/**
 * `node --env-file=.env.local --experimental-strip-types tools/translate-backfill.ts <estimate | run> …`
 *
 * THE FEED'S TRANSLATIONS, BACKFILLED ONTO EVERY CARD ALREADY ON FOR YOU, POPULAR AND THE SCROLL
 * (the owner, 2026-10-14: "i want to see the translation of posts not in english"). The runner
 * (services/runner work/translate-posts.ts) translates posts as they reach a feed, inside its six
 * hours; this does the ones already there, once.
 *
 *   estimate                         free: every feed card, sorted by core's `translateNeed`, how many
 *                                    would be sent, and the most the call could cost (every character
 *                                    at the judge's chars-per-token, the whole answer ceiling).
 *   run --yes [--cap <usd>] [--book jobs|learning|live] [--limit <n>] [--out <file.json>]
 *                                    the runner's own step on every card with no translation, the
 *                                    switch forced on for this run only, on the given book (default
 *                                    `jobs`) with SPEND=live, refused past --cap (default $0.10).
 *                                    Written to 0081 when it is applied; with --out, also to a file
 *                                    (the only place they go before 0081: nothing is written then).
 *
 * At 2026-10-14's mix (273 scroll members): 8 cards sent, one call, about $0.002.
 *
 * What breaks if changed carelessly: `run` must go through the runner's own step and the adapter,
 * never a copy: the words sent, the prompt and the rows written are then exactly what the live
 * feed would have, and a backfilled card cannot differ from a new one.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { DEFAULT_POLICY as P, type Policy } from '../contracts/src/policy.ts';
import { translateNeed } from '../core/src/index.ts';
import { httpClient as judgeClient } from '../adapters/judge/anthropic/src/index.ts';
import { anthropicTranslator, TRANSLATE_MODEL, translateRequestBody } from '../adapters/judge/anthropic/src/translate.ts';
import { priceFor, usdForTokens } from '../adapters/judge/anthropic/src/prices.ts';
import { createLogger } from '../services/runner/src/log.ts';
import { translatePosts, wordsToTranslate } from '../services/runner/src/work/translate-posts.ts';
import { asDb, createPool, DB_ROLE, PgTranslationRepo, type TranslateCandidate, type TranslationRow } from '../store/src/index.ts';
import { judgeSetup } from './lib/pass-rates.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const command = process.argv[2] ?? '';
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-translate-backfill' });
const db = asDb(pool);
const log = createLogger({ tool: 'translate-backfill' });

async function applied(): Promise<boolean> {
  const rows = await db.query<{ ok: boolean }>(`select to_regclass('public.post_translation') is not null as ok`);
  return rows[0]?.ok === true;
}

/** Every card on a feed now — the frame and every scroll member not withdrawn — with no translation yet. */
async function cards(limit: number): Promise<readonly TranslateCandidate[]> {
  const without = (await applied()) ? 'where not exists (select 1 from public.post_translation t where t.item_id = s.item_id)' : '';
  const rows = await db.query<{ item_id: string; body: string | null; lang: string | null }>(
    `with s as (select item_id from public.rising_row union select item_id from public.feed_post where withdrawn_at is null)
     select s.item_id, i.body, i.lang from s join public.item i on i.item_id = s.item_id ${without}
      order by s.item_id limit $1`,
    [limit],
  );
  return rows.map((r) => ({ itemId: r.item_id, text: r.body ?? '', lang: r.lang }));
}

async function estimate(): Promise<void> {
  const all = await cards(Number(arg('--limit', '100000')));
  const sent = all.filter((c) => translateNeed(wordsToTranslate(c.text, P.translate.maxChars), c.lang, P.translate) === 'ask');
  const price = priceFor(TRANSLATE_MODEL);
  if (price === null) throw new Error(`no price for ${TRANSLATE_MODEL}`);
  let usd = 0;
  for (let i = 0; i < sent.length; i += P.translate.perCall) {
    const batch = sent.slice(i, i + P.translate.perCall).map((c) => ({ ref: c.itemId, text: wordsToTranslate(c.text, P.translate.maxChars) }));
    usd += usdForTokens(price, Math.ceil(JSON.stringify(translateRequestBody(P.translate.maxOutputTokens, batch)).length / P.judge.charsPerToken), P.translate.maxOutputTokens);
  }
  console.log(`${all.length} feed cards with no translation${(await applied()) ? '' : ' (0081 not applied: every card counted)'}; ${sent.length} would be sent in ${Math.ceil(sent.length / P.translate.perCall)} call(s), at most $${usd.toFixed(4)} (the answer ceiling; real answers are a fraction of it)`);
  for (const c of sent) console.log(`  ${c.itemId} [${c.lang ?? 'no tag'}] ${wordsToTranslate(c.text, P.translate.maxChars).replace(/\s+/g, ' ').slice(0, 90)}`);
}

async function run(): Promise<void> {
  if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
    console.error('run refused: translations cost money. Set SPEND=live and pass --yes.');
    process.exitCode = 2;
    return;
  }
  const book = arg('--book', 'jobs');
  if (book !== 'jobs' && book !== 'learning' && book !== 'live') throw new Error(`--book ${book}: jobs, learning or live`);
  const cap = Number(arg('--cap', '0.10'));
  const out = arg('--out', '');
  const due = await cards(Number(arg('--limit', '100000')));
  const repo = new PgTranslationRepo(db);
  const isApplied = await applied();
  const written: TranslationRow[] = [];
  const { meter, close } = await openSharedMeter(cap, process.env, book);
  try {
    const { setup } = judgeSetup(process.env);
    const client = judgeClient({
      apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: TRANSLATE_MODEL, maxOutputTokens: P.translate.maxOutputTokens, effort: null,
      timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
      maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    const translator = anthropicTranslator({ client, meter, now: () => Date.now() as Millis, judge: P.judge, translate: P.translate });
    /* The runner's own step, its switch on for this run and its pass widened to every card. */
    const policy: Policy = { ...P, translate: { ...P.translate, on: true, perPass: due.length } };
    const r = await translatePosts({
      translator, meter, mode: 'live', policy, log, now: () => Date.now() as Millis,
      translations: {
        candidates: async () => due,
        put: async (rows) => {
          written.push(...rows);
          return isApplied ? repo.put(rows) : true;
        },
      },
    });
    if (out !== '') writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows: written }, null, 1));
    console.log(`${due.length} feed cards: ${r.translated} translated, ${r.kept} kept as written, ${r.absent} with no answer${r.skipped === null ? '' : `, skipped: ${r.skipped}`}; $${r.usd.toFixed(4)} on the ${book} book${isApplied ? ', written to public.post_translation' : ', NOT written (0081 not applied)'}${out === '' ? '' : `, rows → ${out}`}`);
    for (const w of written.filter((x) => x.textEn !== null)) console.log(`  ${w.itemId} [${w.from}] ${w.textEn?.replace(/\s+/g, ' ').slice(0, 100)}`);
  } finally {
    await close();
  }
}

try {
  if (command === 'estimate') await estimate();
  else if (command === 'run') await run();
  else {
    console.error('usage: translate-backfill.ts <estimate | run --yes [--cap <usd>] [--book jobs|learning|live] [--limit <n>] [--out <file.json>]>');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
