/**
 * KEEP A VECTOR FOR EVERY POST ALREADY ON THE FEEDS — the one-off fill of internal.post_embedding
 * (0074) for posts judged before the runner started keeping their vectors.
 *
 *   SPEND=live node --env-file=.env.local tools/post-embeddings.ts --yes [--cache <file>] [--cap <usd>]
 *
 * From the day 0074 is applied the runner keeps each judged post's vector as it judges it
 * (services/runner work/precedents.ts). Posts judged before that have none, so the projector cannot
 * tell which story they are about and shows them no "Coin for this story" until they are judged
 * again. This embeds those posts once: every judged post inside the feed's window with no vector.
 *
 * ★ THE SAME VECTORS AS THE RUNNER'S: core `embedInput` over the post's words and core
 * `postPicture`, in the adapter's post space — or the bar (Policy.postCoin.storyCoin) means
 * something else. `--cache` reads vectors already paid for (a JSON object of item id to
 * `{ values }`, as the 2026-10-14 measurement wrote) and pays only for the rest.
 *
 * ★ PAID ON THE LEARNING BOOK (tools/lib/shared-meter.ts), capped by `--cap` (default $0.20); a few
 * hundred posts cost a few cents. Refuses without SPEND=live and --yes.
 *
 * What breaks if changed carelessly: the window. Posts older than the feed's window are never on a
 * feed, and embedding them is money for nothing.
 */

import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { embedInput, postPicture } from '../core/src/qualify/precedents.ts';
import { POST_SPACE, voyageEmbed, httpClient as voyageClient } from '../adapters/embed/voyage/src/index.ts';
import { asDb, createPool, DB_ROLE, PgPostEmbeddingRepo } from '../store/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const P = DEFAULT_POLICY;
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('post-embeddings refused: embedding costs money. Set SPEND=live and pass --yes.');
  process.exit(1);
}
const capUsd = Number(arg('--cap') ?? '0.2');
const cacheFile = arg('--cache');
const cache: Record<string, { values: number[] }> = cacheFile !== null && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-post-embeddings' });
const db = asDb(pool);
const repo = new PgPostEmbeddingRepo(db);
try {
  const posts = await db.query<{ item_id: string; body: string | null; media: unknown }>(
    `select i.item_id, i.body, i.media from public.item i
      where i.origin = 'observed' and coalesce(i.posted_at, i.first_seen_at) >= $1
        and exists (select 1 from internal.post_judgement pj where pj.item_id = i.item_id)
        and not exists (select 1 from internal.post_embedding e where e.item_id = i.item_id and e.space = $2)`,
    [new Date(Date.now() - P.rising.windowMs).toISOString(), POST_SPACE],
  );
  const held = posts.filter((p) => cache[p.item_id] !== undefined);
  const todo = posts.filter((p) => cache[p.item_id] === undefined);
  console.log(`${posts.length} judged posts in the window with no vector: ${held.length} from the cache, ${todo.length} to embed.`);
  if (!(await repo.putMany(held.map((p) => ({ itemId: p.item_id, values: cache[p.item_id]!.values })), POST_SPACE))) {
    console.error('internal.post_embedding is not there yet: apply 0074 first.');
    process.exit(1);
  }
  let paid = 0;
  let kept = held.length;
  if (todo.length > 0) {
    const { meter, close } = await openSharedMeter(capUsd, process.env, 'learning');
    const embed = voyageEmbed({ client: voyageClient({ apiKey: (process.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
    try {
      for (let k = 0; k < todo.length; k += embed.maxBatch) {
        const part = todo.slice(k, k + embed.maxBatch);
        const line = meter.line();
        const r = await embed.embedPosts!(part.map((p) => embedInput(p.body ?? '', postPicture(p.media), P)), { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
        paid += r.spend.usd;
        const rows = part.flatMap((p, j) => {
          const v = r.value[j];
          return v === null || v === undefined || v.space !== POST_SPACE ? [] : [{ itemId: p.item_id, values: v.values }];
        });
        await repo.putMany(rows, POST_SPACE);
        kept += rows.length;
      }
    } finally {
      await close();
    }
  }
  console.log(`kept ${kept} vectors; paid $${paid.toFixed(4)} on the learning book.`);
} finally {
  await pool.end();
}
