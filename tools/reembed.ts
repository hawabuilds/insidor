/**
 * RE-EMBED WHAT IS STORED, IN OUR OWN MODEL'S SPACE — the one-off fill that lets the switch from the
 * hosted model (Policy.group.image.space 'multimodal-3.1024') to our own (services/embed,
 * 'siglip2-b16-224.768') start with neighbours instead of an empty space.
 *
 *   node --env-file=.env.local tools/reembed.ts                      dry: how many rows of each kind, and how long
 *   node --env-file=.env.local tools/reembed.ts --yes [--only posts,labels,names,pictures,coins,coined]
 *        [--concurrency 2] [--limit N] [--coin-days 30]
 *
 * ★ THE OLD VECTORS ARE NOT TOUCHED. Each row is written beside the old one under the new space (every
 * vector table's key includes `space`); nothing is updated or deleted. Until the policy names the new
 * space nobody reads these rows; after it does, nobody reads the old ones. Going back is a policy edit.
 *
 * ★ RESUMABLE. Each kind's work list is "rows with a vector in some other space and none in ours",
 * newest first, so a stopped run started again carries on where it stopped, and a run after the
 * switch fills only what the runner has not. Within a run the list is walked by key (never by offset)
 * so a picture that cannot be read is passed over once, not asked for forever; the next run asks again.
 *
 * ★ FREE, BUT NOT UNBOUNDED. The service costs nothing per call; its CPU is shared with the runner's
 * own embedding. `--concurrency` requests at once (default 2: the service runs one inference at a
 * time, and two keeps its queue fed while the next request's pictures download).
 *
 * Coin pictures (internal.image_embedding, subject 'asset') are by far the most rows and the least
 * worth: a coin's vector is archived after Policy.coinVectors.keepMs (tools/archive-coin-vectors.ts),
 * and new coins are embedded by the runner as they launch. Only coins embedded in the last
 * `--coin-days` (default: that keep, 30 days) are re-embedded, newest first.
 *
 * THE WORK ITSELF IS services/runner/src/work/reembed.ts (the runner also runs it at boot, in its own
 * process, when Policy.group.image.backfill is on); this file is only its command line: the flags,
 * the dry run's estimate, the pool, and the lines it prints.
 *
 * What breaks if changed carelessly: the inputs must be built as the runner builds them — core
 * `embedInput` over the post's words and `postPicture` of its media — or the stored vectors are a
 * different representation from the live ones under the same space id.
 */

import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { httpClient, POST_SPACE, selfEmbed, SPACE } from '../adapters/embed/selfhost/src/index.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { REEMBED_KINDS as KINDS, reembedKinds, reembedSources, type ReembedKind as Kind } from '../services/runner/src/work/reembed.ts';

const P = DEFAULT_POLICY;
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const live = process.argv.includes('--yes');
const only = new Set((arg('--only') ?? KINDS.join(',')).split(',').map((s) => s.trim()).filter((s): s is Kind => (KINDS as readonly string[]).includes(s)));
const concurrency = Math.max(1, Math.min(8, Number(arg('--concurrency') ?? '2')));
const limit = arg('--limit') === null ? Infinity : Math.max(1, Number(arg('--limit')));
const coinSinceMs = Date.now() - Number(arg('--coin-days') ?? String(P.coinVectors.keepMs / 86_400_000)) * 86_400_000;
/* For the dry run's estimate: measured per input on the service, 2026-10-24 (Apple M5: 39 ms a
   picture including its download, 11 ms a text). A shared Railway vCPU is assumed four times slower. */
const MS_PER_PICTURE = Number(arg('--ms-per-picture') ?? '160');
const MS_PER_TEXT = Number(arg('--ms-per-text') ?? '45');

async function run(): Promise<void> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-reembed' });
  if (!live) pool.on('connect', (c) => void c.query('set default_transaction_read_only = on'));
  const db = asDb(pool);
  const all = reembedSources({ policy: P, coinSinceMs });
  const kinds = KINDS.filter((k) => only.has(k));
  try {
    if (!live) {
      let totalMs = 0;
      console.log(`DRY RUN, read only: rows still to embed into ${SPACE} / ${POST_SPACE} (coins: embedded since ${new Date(coinSinceMs).toISOString().slice(0, 10)}).`);
      for (const k of kinds) {
        const c = await all[k].count(db);
        const ms = c.pictures * MS_PER_PICTURE + c.rows * MS_PER_TEXT;
        totalMs += ms;
        /* Two pages read, as the run would walk them, so a broken work-list query shows here and not mid-run. */
        const first = await all[k].page(db, null);
        const next = first.length === 0 ? [] : await all[k].page(db, first[first.length - 1]!.key);
        console.log(`  ${k.padEnd(9)} pages read: ${first.length} then ${next.length} (newest ${first[0]?.key[0] ?? '-'})`);
        console.log(`  ${k.padEnd(9)} ${String(c.rows).padStart(8)} rows (${c.pictures} with a picture, at most)  ≈ ${(ms / 3_600_000).toFixed(1)} h at one request at a time`);
      }
      console.log(`  total ≈ ${(totalMs / 3_600_000).toFixed(1)} h at the assumed rates (--ms-per-picture, --ms-per-text). The service runs one inference at a time, so --concurrency only overlaps the downloads with it; it does not divide this.`);
      console.log('Writes nothing. Pass --yes to embed (EMBED_SERVICE_URL and EMBED_SECRET set; `coined` needs 0136 applied).');
      return;
    }
    const baseUrl = (process.env['EMBED_SERVICE_URL'] ?? '').trim();
    const secret = (process.env['EMBED_SECRET'] ?? '').trim();
    if (baseUrl === '' || secret === '') throw new Error('EMBED_SERVICE_URL and EMBED_SECRET must be set');
    const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => Date.now() });
    const port = selfEmbed({ client: httpClient({ baseUrl, secret, fetch: globalThis.fetch }), meter, now: () => Date.now() as Millis });
    await reembedKinds(db, port, {
      kinds,
      concurrency,
      limit,
      sources: all,
      log: (e) =>
        console.log(
          e.event === 'page'
            ? `${e.kind}: ${e.done} done (${e.unread} unread), ${e.ratePerSec.toFixed(1)}/s`
            : `${e.kind}: finished, ${e.written} written, ${e.unread} could not be read (asked again next run).`,
        ),
    });
  } finally {
    await pool.end();
  }
}

await run();
