/**
 * `node --env-file=.env.local --experimental-strip-types tools/tiktok-backtest.ts [--days=7] [--out=<file.md>]`
 *
 * THE TIKTOK BACKTEST (the owner, 2026-10-16, point 4: "on all my missed TikToks … and every coined
 * TikTok from the last week. For each: caught or not, which source, age when found, and before or
 * after its first coin. Then the totals." — and the same for the TikToks of his backtest 2 and 3
 * sheets). Free and read-only: the training set (tools/lib/coined-videos.ts), our own records of
 * finding and showing, and nothing asked of any supplier.
 *
 * For each video:
 *   caught       whether we found it ourselves (a video the owner pasted as missed counts only if
 *                we held it before he pasted it), by which lane (internal.item_found_by), how old it was
 *                (our first sight against its post time), and whether that was before or after its
 *                first coin; whether For You showed it, and before or after the coin
 *   new setup    what the new setup adds that can be checked after the fact, each said as what it is:
 *                · learned word — a tag or sound on 2 or more, or the creator of any, coined video
 *                  whose first coin came BEFORE this video went up (the learned list as it could
 *                  have stood then); the newest-first search asks those words, so a video carrying
 *                  one is in reach of it. In reach, not caught: whether the ask returned it young
 *                  cannot be replayed.
 *                · speed bar — for a video we read, whether its readings clear For You's bar now
 *                  (live) and with the learned bar when there is one
 *                · trending feed — whether the feed's lane found it (on from 2026-10-16 00:16 UTC;
 *                  it keeps no history, so a video before that is a dash, not a no)
 *   words        held, fetched again, gone (too old or removed: learned from its coin's name and
 *                link only), or never fetched (over the 40-credit cap)
 *
 * What breaks if changed carelessly: "before the coin" is against the FIRST coin's launch (the set's
 * rule). And a learned word is only the ones known before the video went up: counting words learned
 * from later coins, or from this video's own coin, would let the backtest grade itself.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { learnWords } from '../services/runner/src/work/search-words.ts';
import { asDb, createPool, DB_ROLE, type CoinedVideo } from '../store/src/index.ts';
import { clearsBar, composeSet, learnBar, readingsOf, withBar } from './lib/coined-videos.ts';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const days = Number(arg('days') ?? '7');
const out = arg('out');
const MISSED = new Map([
  ['tiktok:7696516827739966738', 'batfish'],
  ['tiktok:7695856190563061006', 'porcupine'],
  ['tiktok:7695970441126579470', 'raccoon'],
  ['tiktok:7695781291517627662', 'cooking video'],
  ['tiktok:7690714003953175841', '28 Sept video'],
]);
/* When the trending feed's trial began: before it, the lane cannot have found anything. */
const TRENDING_FROM = Date.parse('2026-10-16T00:16:00Z');

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-tiktok-backtest' });
const db = asDb(pool);
const lines: string[] = [];
const say = (s = '') => {
  lines.push(s);
  console.log(s);
};
const mins = (ms: number) => `${Math.round(ms / 60_000).toLocaleString('en')} min`;
const rel = (at: number | null, coin: number | null) => (at === null || coin === null ? '—' : at < coin ? `before (${mins(coin - at)})` : `after (${mins(at - coin)})`);

try {
  const all = await composeSet(db, P);
  const since = Date.now() - days * 86_400_000;
  const inTest = all.filter((v) => MISSED.has(v.itemId) || v.foundFrom.some((f) => f.startsWith('sheet:')) || (v.firstCoinAt !== null && v.firstCoinAt.getTime() >= since));
  const ids = inTest.map((v) => v.itemId);
  const found = new Map((await db.query<{ item_id: string; lane: string; found_at: Date; first_seen_at: Date | null }>(
    `select i.item_id, fb.lane, fb.found_at, i.first_seen_at from public.item i left join internal.item_found_by fb on fb.item_id = i.item_id where i.item_id = any($1::text[])`, [ids])).map((r) => [r.item_id, r]));
  /* A video the owner pasted is held because he pasted it: caught only if we held it before (or a lane credits it). */
  const pasted = new Map((await db.query<{ item_id: string; at: Date }>(
    `select item_id, min(added_at) as at from internal.missed_post where item_id = any($1::text[]) group by 1`, [ids])).map((r) => [r.item_id, r.at.getTime()]));
  const shown = new Map((await db.query<{ item_id: string; at: Date }>(
    `select item_id, first_shown_at as at from public.feed_post where feed_id = 'fyp' and item_id = any($1::text[])`, [ids])).map((r) => [r.item_id, r.at]));
  const readings = await readingsOf(db, ids);
  const bar = learnBar(all, await readingsOf(db, all.map((v) => v.itemId)), P);
  const learnedP = bar.proposed === null ? null : withBar(P, bar.proposed);

  /* The learned list as it could have stood when the video went up: from coined videos whose first coin came before. */
  const wordsBefore = (v: CoinedVideo) => {
    const t = v.postedAt?.getTime() ?? null;
    if (t === null) return [];
    const earlier = all.filter((o) => o.itemId !== v.itemId && o.firstCoinAt !== null && o.firstCoinAt.getTime() < t && o.firstCoinAt.getTime() >= t - P.finders.learned.lookbackMs);
    return learnWords(earlier.map((o) => ({ source: o.source, handle: o.handle, body: [o.caption ?? '', ...o.tags.map((x) => `#${x}`)].join(' '), formatIds: o.sound === null ? [] : [o.sound] })), 'tiktok', P);
  };

  type Row = { v: CoinedVideo; label: string; caught: boolean; lane: string | null; ageMs: number | null; foundRel: string; shownRel: string; word: string | null; barLive: boolean | null; barLearned: boolean | null; trending: string; beforeCoin: boolean };
  const rows: Row[] = inTest.map((v) => {
    const held = found.get(v.itemId);
    const p0 = pasted.get(v.itemId);
    const f = held === undefined || (held.lane === null && p0 !== undefined && (held.first_seen_at?.getTime() ?? Infinity) >= p0) ? undefined : held;
    const posted = v.postedAt?.getTime() ?? null;
    const coin = v.firstCoinAt?.getTime() ?? null;
    const seen = f?.found_at?.getTime() ?? f?.first_seen_at?.getTime() ?? null;
    const words = wordsBefore(v);
    const tags = new Set(v.tags);
    const hit = words.find((w) => (w.kind === 'tag' && tags.has(w.value)) || (w.kind === 'sound' && w.value === v.sound) || (w.kind === 'creator' && w.value === v.handle));
    const rs = readings.get(v.itemId) ?? [];
    const label = MISSED.get(v.itemId) ?? (v.foundFrom.find((x) => x.startsWith('sheet:'))?.replace('sheet:', '') ?? 'coined this week');
    return {
      v, label, caught: f !== undefined, lane: f?.lane ?? null, ageMs: seen === null || posted === null ? null : seen - posted,
      foundRel: rel(seen, coin), shownRel: rel(shown.get(v.itemId)?.getTime() ?? null, coin),
      word: hit === undefined ? null : `${hit.kind} ${hit.value}`,
      barLive: rs.length === 0 ? null : clearsBar(rs, posted, P), barLearned: rs.length === 0 || learnedP === null ? null : clearsBar(rs, posted, learnedP),
      trending: f?.lane === 'trending' ? 'yes' : (coin ?? 0) < TRENDING_FROM && (posted ?? 0) < TRENDING_FROM ? '— (before the trial)' : 'no',
      beforeCoin: seen !== null && coin !== null && seen < coin,
    };
  });

  say(`# TikTok backtest — ${new Date().toISOString().slice(0, 16)} UTC`);
  say();
  say(`${rows.length} videos: the owner's ${rows.filter((r) => MISSED.has(r.v.itemId)).length} missed, ${rows.filter((r) => r.v.foundFrom.some((f) => f.startsWith('sheet:'))).length} from the backtest 2 and 3 sheets, and every TikTok first coined in the last ${days} days.`);
  say();
  say('| video | account | coin | first coin (UTC) | caught | lane | age when found | found vs coin | For You vs coin | learned word before it went up | speed bar now / learned | words |');
  say('|---|---|---|---|---|---|---|---|---|---|---|---|');
  const order = (r: Row) => (MISSED.has(r.v.itemId) ? 0 : r.label === 'backtest2' || r.label === 'backtest3' ? 1 : 2);
  for (const r of [...rows].sort((a, b) => order(a) - order(b) || (b.v.firstCoinAt?.getTime() ?? 0) - (a.v.firstCoinAt?.getTime() ?? 0))) {
    const coin = `${r.v.coinTicker ?? r.v.coinName ?? '—'} ${r.v.firstCoin.slice(0, 6)}…`;
    const barText = r.barLive === null ? '— (never read)' : `${r.barLive ? 'clears' : 'does not'} / ${r.barLearned === null ? '— (none learned)' : r.barLearned ? 'clears' : 'does not'}`;
    say(`| ${r.label}: ${r.v.sourceItemId} | @${r.v.handle ?? '—'} | ${coin} | ${r.v.firstCoinAt?.toISOString().slice(0, 16) ?? '—'} | ${r.caught ? 'yes' : 'no'} | ${r.lane ?? '—'} | ${r.ageMs === null ? '—' : mins(r.ageMs)} | ${r.foundRel} | ${r.shownRel} | ${r.word ?? '—'} | ${barText} | ${r.v.fetch} |`);
  }
  say();
  const groups: [string, (r: Row) => boolean][] = [
    ["the owner's missed", (r) => MISSED.has(r.v.itemId)],
    ['the sheets', (r) => r.v.foundFrom.some((f) => f.startsWith('sheet:'))],
    [`coined in the last ${days} days`, (r) => r.v.firstCoinAt !== null && r.v.firstCoinAt.getTime() >= since],
    ['all', () => true],
  ];
  say('## Totals');
  say();
  say('| set | videos | caught | caught before the coin | shown on For You before the coin | median age when found | in reach of a learned word | clears the bar now (of read) | words: held / fetched / gone / not fetched |');
  say('|---|---|---|---|---|---|---|---|---|');
  for (const [name, f] of groups) {
    const g = rows.filter(f);
    const ages = g.flatMap((r) => (r.ageMs === null ? [] : [r.ageMs])).sort((a, b) => a - b);
    const med = ages.length === 0 ? '—' : mins(ages[Math.floor((ages.length - 1) / 2)] ?? 0);
    const read = g.filter((r) => r.barLive !== null);
    const w = (s: string) => g.filter((r) => r.v.fetch === s).length;
    say(`| ${name} | ${g.length} | ${g.filter((r) => r.caught).length} | ${g.filter((r) => r.beforeCoin).length} | ${g.filter((r) => r.shownRel.startsWith('before')).length} | ${med} | ${g.filter((r) => r.word !== null).length} | ${read.filter((r) => r.barLive).length} of ${read.length} | ${w('held')} / ${w('fetched')} / ${w('gone')} / ${w('unfetched')} |`);
  }
  const lanes = rows.filter((r) => r.caught).reduce<Record<string, number>>((m, r) => ({ ...m, [r.lane ?? 'no lane']: (m[r.lane ?? 'no lane'] ?? 0) + 1 }), {});
  say();
  say(`Lanes that caught them: ${Object.entries(lanes).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`);
  say(`Learned speed bar: ${bar.proposed === null ? `none (${bar.why})` : `${bar.proposed.earlyReach} in 2 h or ${bar.proposed.fastReachPerMinute}/min`}.`);
  const sheetGone = rows.filter((r) => r.v.foundFrom.some((f) => f.startsWith('sheet:')) && r.v.fetch === 'gone').length;
  say(`Sheet TikToks too old to re-fetch (the source no longer serves them): ${sheetGone}; learned from their coin's name and link only.`);
  if (out !== null) writeFileSync(out, `${lines.join('\n')}\n`);
} finally {
  await pool.end();
}
