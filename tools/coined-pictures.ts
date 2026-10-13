/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/coined-pictures.ts --yes`
 *
 * FILLS internal.coined_picture (0052): the picture of every gold coin's origin post — the post
 * people actually made the coin about — embedded once, for the feed's picture boost.
 *
 * The picture is the one the feed would show (a video's preview included): from
 * eval/src/feed/gold-origin-pictures.json when it was re-read there, else the gold evidence.
 * Paid: one image embedding each (a fraction of a cent), on the shared ledger as a job. Pictures
 * already held are skipped, so a rerun pays only for new ones.
 *
 * What breaks if changed carelessly: only ORIGIN pictures go in. A coin's own logo, or a post that
 * merely mentioned the coin, would make the boost reward looking like a token's logo.
 */

import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { voyageEmbed, httpClient as voyageClient, SPACE } from '../adapters/embed/voyage/src/index.ts';
import { loadEvidence } from '../eval/src/gold/coin-evidence.ts';
import { asDb, createPool, DB_ROLE, PgCoinedPictureRepo } from '../store/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const USD_PER_PICTURE = 0.001;

if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('coined-pictures refused: this embeds pictures, which costs money. Set SPEND=live and pass --yes.');
  process.exit(1);
}
const PICTURES = new URL('../eval/src/feed/gold-origin-pictures.json', import.meta.url);
const recorded = existsSync(PICTURES) ? (JSON.parse(readFileSync(PICTURES, 'utf8')) as { pictures: Record<string, string | null> }).pictures : {};
const wanted = new Map<string, string>();
for (const [coinId, ev] of loadEvidence()) {
  const post = ev.origin?.post ?? null;
  const uri = post === null ? null : (recorded[post.postId] ?? post.imageUri);
  if (uri !== null && !wanted.has(uri)) wanted.set(uri, coinId);
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-coined-pictures' });
const repo = new PgCoinedPictureRepo(asDb(pool));
const held = await repo.known();
const todo = [...wanted].filter(([uri]) => !held.has(uri));
console.log(`${wanted.size} origin pictures, ${todo.length} not yet held; at most $${(todo.length * USD_PER_PICTURE).toFixed(3)}.`);
const { meter, close } = await openSharedMeter(Math.max(todo.length * USD_PER_PICTURE, 0.01));
const embed = voyageEmbed({ client: voyageClient({ apiKey: (process.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
let stored = 0;
try {
  for (const [uri, coinId] of todo) {
    const line = meter.line();
    const r = await embed.embedMedia!([{ kind: 'image', uri, width: null, height: null, durationMs: null }], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + 60_000 });
    const v = r.value[0];
    if (v === null || v === undefined) continue;
    await repo.put(uri, coinId, SPACE, Array.from(v.values));
    stored += 1;
  }
} finally {
  await close();
  await pool.end();
}
console.log(`stored ${stored} of ${todo.length}; spent $${meter.line().spentUsd.toFixed(4)}.`);
