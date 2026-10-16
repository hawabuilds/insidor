/**
 * `node --env-file=.env.local --experimental-strip-types tools/coined-videos.ts [report|refresh|fetch] [--max=<n>] [--yes]`
 *
 * THE TIKTOK TRAINING SET, BY HAND (tools/lib/coined-videos.ts does the work; the re-tune runs the
 * same every ten minutes and twice a day):
 *
 *   report   (default) every coined TikTok we know of — how many from each place, how many we hold the
 *            words of, how many had a view reading under two hours old — and what the set teaches:
 *            views at 30 minutes, 1 and 2 hours, the proposed speed bar, the tags, sounds and
 *            creators the runner's learned list would take, the kinds of video, how coins are named.
 *            Free, read-only.
 *   refresh  the same, written to internal.coined_video (0085). Free. Without 0085 it says so.
 *   fetch    reads again by id, through ScrapeCreators, up to `--max` (default 40) of the videos we
 *            never held: one credit each (~$0.0019), on the learning book, capped at `--max` credits.
 *            Needs SPEND=live and --yes. The answers are kept in var/ and, with 0085, in the table.
 *
 * What breaks if changed carelessly: `fetch` must stay on the learning book and capped: the live
 * book has under a dollar of room (2026-10-16).
 */

import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { composeSet, learn, readingsOf, refetch, refreshSet, SC_USD_PER_VIDEO } from './lib/coined-videos.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const command = process.argv[2] ?? 'report';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-coined-videos' });
const db = asDb(pool);

try {
  if (command === 'fetch') {
    if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
      console.error('fetch refused: it pays ScrapeCreators. Set SPEND=live and pass --yes.');
      process.exit(1);
    }
    const max = Number(arg('max') ?? '40');
    const shared = await openSharedMeter(max * SC_USD_PER_VIDEO + 0.001, process.env, 'learning');
    try {
      const rows = await composeSet(db, P);
      const got = await refetch(rows, max, shared.meter, process.env['SCRAPECREATORS_API_KEY'] ?? '');
      console.log(`asked ${got.asked} (${got.gone} gone), $${got.usd.toFixed(4)} on the learning book`);
    } finally {
      await shared.close();
    }
  }
  const { rows, added, stored } = command === 'refresh' || command === 'fetch' ? await refreshSet(db, new Date(), P) : { rows: await composeSet(db, P), added: 0, stored: false };
  if (command === 'refresh' || command === 'fetch') console.log(stored ? `written to internal.coined_video: ${rows.length} rows, ${added} new` : '0085 is not applied: nothing written');
  const readings = await readingsOf(db, rows.map((r) => r.itemId));
  const l = learn(rows, readings, P);
  const week = rows.filter((r) => r.firstCoinAt !== null && r.firstCoinAt.getTime() > Date.now() - 7 * 86_400_000);
  console.log(`TikTok training set: ${l.size} coined videos (${week.length} first coined in the last 7 days); words held for ${l.withWords}`);
  console.log(`  from: ${Object.entries(l.bySource).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  words: ${Object.entries(l.byFetch).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  highest market cap read: ${rows.filter((r) => r.peakUsd !== null).length} of ${rows.length}`);
  console.log(`  speed bar: ${l.bar.at.map((a) => `${a.ageMin} min: ${a.n} with a count, median ${a.medianViews === null ? '—' : Math.round(a.medianViews).toLocaleString('en')}`).join('; ')}`);
  console.log(`    read under 2 hours old: ${l.bar.earlyRead}; views a minute at the first reading inside 4 hours: ${l.bar.firstRatePerMin.map((x) => Math.round(x)).join(', ') || '—'}`);
  console.log(`    proposed: ${l.bar.proposed === null ? `none — ${l.bar.why}` : `${l.bar.proposed.earlyReach.toLocaleString('en')} in 2 h or ${l.bar.proposed.fastReachPerMinute}/min (${l.bar.why})`}; in use ${P.rising.shortVideoSpeedBar.earlyReach.toLocaleString('en')} or ${P.rising.shortVideoSpeedBar.fastReachPerMinute}/min`);
  console.log(`  tags: ${l.tags.map((t) => `${t.value} (${t.posts})`).join(', ') || '—'}`);
  console.log(`  sounds: ${l.sounds.map((t) => `${t.title ?? t.value} (${t.posts})`).join(', ') || '—'}`);
  console.log(`  creators: ${l.creators.length} — ${l.creators.slice(0, 15).map((t) => `${t.value} (${t.posts})`).join(', ')}`);
  console.log(`  kinds: ${Object.entries(l.kinds).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  naming: ${Object.entries(l.naming).map(([k, v]) => `${k} ${v}`).join(', ')}`);
} finally {
  await pool.end();
}
