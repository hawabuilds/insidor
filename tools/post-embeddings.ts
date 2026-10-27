/**
 * KEEP A VECTOR FOR EVERY POST ALREADY ON THE FEEDS — the one-off fill of internal.post_embedding
 * (0074) for posts judged before the runner started keeping their vectors.
 *
 *   SPEND=live node --env-file=.env.local tools/post-embeddings.ts --yes [--cache <file>] [--cap <usd>]
 *   SPEND=live node --env-file=.env.local tools/post-embeddings.ts --yes --answered [--book jobs|learning] [--cap <usd>]
 *
 * From the day 0074 is applied the runner keeps each judged post's vector as it judges it
 * (services/runner work/precedents.ts). Posts judged before that have none, so the projector cannot
 * tell which story they are about and shows them no "Coin for this story" until they are judged
 * again. This embeds those posts once: every post inside the feed's window the judge said yes to
 * (only those can reach a feed) with no vector — about 2,000 a day, $0.25 at 2026-10-14's prices.
 *
 * ★ THE SAME VECTORS AS THE RUNNER'S: core `embedInput` over the post's words and core
 * `postPicture`, in the adapter's post space — or the bar (Policy.postCoin.storyCoin) means
 * something else. `--cache` reads vectors already paid for (a JSON object of item id to
 * `{ values }`, as the 2026-10-14 measurement wrote) and pays only for the rest.
 *
 * ★ PAID ON THE LEARNING BOOK (tools/lib/shared-meter.ts), capped by `--cap` (default $0.30).
 * Refuses without SPEND=live and --yes.
 *
 * ★ `--answered`: THE COIN MODEL'S POSTS. The coin model (tools/lib/coin-model.ts) reads a vector for
 * every post the live judge answered in its 14 days, said yes or no; a post with none is fitted on
 * its facts alone. This fills those, the posts its fit actually loads first (every post in its
 * validation and test time, every coined post, and the older never-coined posts its hash keeps),
 * newest first, then the rest. On the book `--book` names (default learning) under `--cap`; a
 * refused call ends the run with what was written kept, so running it again carries on.
 *
 * What breaks if changed carelessly: the window. Posts older than the feed's window are never on a
 * feed, and embedding them is money for nothing.
 */

import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { embedInput, postPicture } from '../core/src/qualify/precedents.ts';
import { ownEmbed } from './lib/own-embed.ts';
import { asDb, createPool, DB_ROLE, PgCoinModelRepo, PgPostEmbeddingRepo } from '../store/src/index.ts';
import { hashShare, TEST_SHARE } from './lib/coin-model.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const P = DEFAULT_POLICY;
/* The policy's post space: the one the runner keeps post vectors in, and the one our own service is built for here. */
const POST_SPACE = P.group.image.postSpace;
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('post-embeddings refused: embedding costs money. Set SPEND=live and pass --yes.');
  process.exit(1);
}
const capUsd = Number(arg('--cap') ?? '0.3');
const answered = process.argv.includes('--answered');
const book = arg('--book') === 'jobs' ? 'jobs' : 'learning';
/** The coin model's own window (tools/lib/coin-model.ts refitCoinModel's default `since`). */
const COIN_MODEL_DAYS = 14;
const cacheFile = arg('--cache');
const cache: Record<string, { values: number[] }> = cacheFile !== null && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-post-embeddings' });
const db = asDb(pool);
const repo = new PgPostEmbeddingRepo(db);
try {
  const posts = answered ? await answeredPosts() : await db.query<{ item_id: string; body: string | null; media: unknown }>(
    `select i.item_id, i.body, i.media from public.item i
      where i.origin = 'observed' and coalesce(i.posted_at, i.first_seen_at) >= $1
        and (select pj.coinable from internal.post_judgement pj
              where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
              order by pj.judged_at desc, pj.id desc limit 1) is true
        and not exists (select 1 from internal.post_embedding e where e.item_id = i.item_id and e.space = $2)`,
    [new Date(Date.now() - P.rising.windowMs).toISOString(), POST_SPACE],
  );
  const held = posts.filter((p) => cache[p.item_id] !== undefined);
  const todo = posts.filter((p) => cache[p.item_id] === undefined);
  console.log(`${posts.length} ${answered ? 'posts the live judge answered in the coin model\'s window' : 'posts the judge said yes to in the window'} with no vector: ${held.length} from the cache, ${todo.length} to embed.`);
  if (!(await repo.putMany(held.map((p) => ({ itemId: p.item_id, values: cache[p.item_id]!.values })), POST_SPACE))) {
    console.error('internal.post_embedding is not there yet: apply 0074 first.');
    process.exit(1);
  }
  let paid = 0;
  let kept = held.length;
  if (todo.length > 0) {
    const { meter, close } = await openSharedMeter(capUsd, process.env, answered ? book : 'learning');
    const embed = ownEmbed(meter);
    try {
      for (let k = 0; k < todo.length; k += embed.maxBatch) {
        const part = todo.slice(k, k + embed.maxBatch);
        const line = meter.line();
        let r;
        try {
          r = await embed.embedPosts!(part.map((p) => embedInput(p.body ?? '', postPicture(p.media), P)), { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
        } catch (e) {
          if (e instanceof Error && e.name === 'BudgetRefused') {
            console.log(`stopped at the cap after ${k} posts: ${e.message}`);
            break;
          }
          throw e;
        }
        paid += r.spend.usd;
        const rows = part.flatMap((p, j) => {
          const v = r.value[j];
          return v === null || v === undefined || v.space !== POST_SPACE ? [] : [{ itemId: p.item_id, values: v.values }];
        });
        await repo.putMany(rows, POST_SPACE);
        kept += rows.length;
        if ((k / embed.maxBatch) % 25 === 0) console.log(`  ${k + part.length}/${todo.length} asked, ${kept} kept, $${paid.toFixed(4)}`);
      }
    } finally {
      await close();
    }
  }
  console.log(`kept ${kept} vectors; paid $${paid.toFixed(4)} on the ${answered ? book : 'learning'} book.`);
} finally {
  await pool.end();
}

/**
 * Every post the live judge answered in the coin model's window with no vector, the ones its fit
 * loads first: in its validation and test time (the same split arithmetic), coined late, or kept by
 * its hash; newest first within each.
 */
async function answeredPosts(): Promise<{ item_id: string; body: string | null; media: unknown }[]> {
  const C = P.judge.coinModel;
  const now = Date.now();
  const rows = await db.query<{ item_id: string; first_at: Date; earliest: Date; body: string | null; media: unknown }>(
    `with a as (
       select item_id, min(judged_at) as first_at from internal.post_judgement
        where prompt_id not like 'post-kind%' and judge_id not like 'rule:%' and copied_from is null and judged_at >= $1
        group by item_id
     ), w as (select a.*, min(first_at) over () as earliest from a)
     select w.item_id, w.first_at, w.earliest, i.body, i.media from w join public.item i using (item_id)
      where not exists (select 1 from internal.post_embedding e where e.item_id = w.item_id and e.space = $2)
        and not exists (select 1 from internal.label_embedding l where l.item_id = w.item_id and l.space = $2)`,
    [new Date(now - COIN_MODEL_DAYS * 86_400_000), POST_SPACE],
  );
  const coined = await new PgCoinModelRepo(db).coinedLate({ lateMs: C.lateMs, deployerWindowMs: C.deployerWindowMs, deployerMinPosts: C.deployerMinPosts });
  const first = rows[0]?.earliest.getTime() ?? now;
  const testFrom = first + (now - first) * (1 - TEST_SHARE);
  const valFrom = first + (testFrom - first) * (1 - C.validationShare);
  const loaded = (r: (typeof rows)[number]): boolean => r.first_at.getTime() >= valFrom || coined.has(r.item_id) || hashShare(r.item_id) < C.negativeShare;
  const newest = (a: (typeof rows)[number], b: (typeof rows)[number]): number => b.first_at.getTime() - a.first_at.getTime();
  const a = rows.filter(loaded).sort(newest);
  const b = rows.filter((r) => !loaded(r)).sort(newest);
  console.log(`${a.length} of them the coin model's fit loads, ${b.length} it does not.`);
  return [...a, ...b];
}
