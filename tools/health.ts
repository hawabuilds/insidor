/**
 * THE AFTER-DEPLOY HEALTH CHECK (the owner, 2026-10-29: stop fixes going "a few steps back"). Reads the
 * outcomes the owner sees — For You's size and freshness, Popular's freshness, the Tape, judging, the
 * re-read backlog, finds by language — and the live services' error lines, compares them with the last
 * check, and says plainly what got worse. Run it before a deploy and again 30 minutes after:
 *
 *   node --env-file=.env.local --experimental-strip-types tools/health.ts
 *
 * ★ READ-ONLY, FREE. Selects only, one public read of the Tape, and `railway logs`. Each run
 * is kept in reports/health/ so the next one can compare.
 * What breaks if changed carelessly: a bar loosened to make a red line go away. A bar moves only when the
 * owner says what normal is.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const READ = process.env.READ_URL ?? 'https://read-production-a6c0.up.railway.app';
const DIR = new URL('../reports/health/', import.meta.url);
fs.mkdirSync(DIR, { recursive: true });

const pool = createPool(DB_ROLE.service, { applicationName: 'health', statementTimeoutMs: 120_000, env: { DATABASE_URL_SERVICE: process.env.DATABASE_URL } });
const db = asDb(pool);
const one = async (sql, p = []) => (await db.query(sql, p))[0];
const now = {};
const f = await one(`select count(*)::int n, count(*) filter (where o.last > now() - interval '30 minutes')::int fresh
  from public.rising_row r left join lateral (select max(captured_at) last from public.observation x where x.item_id = r.item_id and x.kind = 'reach') o on true where r.feed_id = 'fyp'`);
now.fypPosts = f.n; now.fypFreshPct = f.n ? Math.round((100 * f.fresh) / f.n) : 0;
const p = await one(`select count(*)::int n, count(*) filter (where o.last > now() - interval '78 minutes')::int fresh
  from public.rising_row r left join lateral (select max(captured_at) last from public.observation x where x.item_id = r.item_id and x.kind = 'reach') o on true where r.feed_id = 'popular'`);
now.popularPosts = p.n; now.popularFreshPct = p.n ? Math.round((100 * p.fresh) / p.n) : 0;
/* Minutes since For You last ADDED a post (its newest join), the freeze alarm: a post's own age only says
   how young the posts over the views bar are, which is naturally an hour or more at quiet times. */
now.lastFypJoinMin = Math.round(Number((await one(`select extract(epoch from now() - max(first_shown_at)) / 60 m from public.feed_post where feed_id = 'fyp'`)).m ?? -1));
now.newestFypPostMin = Math.round(Number((await one(`select extract(epoch from now() - max(i.posted_at)) / 60 m from public.rising_row r join public.item i using (item_id) where r.feed_id = 'fyp'`)).m ?? -1));
now.judgedLast30m = (await one(`select count(*)::int n from internal.post_judgement where judged_at > now() - interval '30 minutes'`)).n;
const shed = await one(`select count(*) filter (where reason = 'T2_budget_shed')::int shed, count(*) filter (where verdict = 'pass')::int pass from internal.decisions where stage = 'track' and decided_at > now() - interval '15 minutes'`);
now.rereadShedPct = shed.shed + shed.pass ? Math.round((100 * shed.shed) / (shed.shed + shed.pass)) : 0;
const langs = (await db.query(`select i.lang, count(*) filter (where f.found_at > now() - interval '3 hours')::int now3, count(*) filter (where f.found_at between now() - interval '27 hours' and now() - interval '24 hours')::int yday3
  from internal.item_found_by f join public.item i on i.item_id = f.item_id where f.found_at > now() - interval '27 hours' and f.lane <> 'judged' group by 1 order by 3 desc limit 12`));
now.findsByLang = Object.fromEntries(langs.map((r) => [r.lang ?? '-', `${r.now3}/${r.yday3}`]));
/* ★ PICTURES (2026-10-29: storage went over its transfer allowance at ~01:00 UTC and every coin logo, poster
   picture and post picture stopped loading; nothing here noticed for 13 hours). The mirror's last hour, and
   one stored logo fetched the way the app fetches it. */
const logos = (await db.query(`select count(*) filter (where outcome = 'failed')::int as failed, count(*)::int as n
  from internal.coin_logo where checked_at > now() - interval '1 hour'`))[0];
now.logoCopyFailPct = logos.n === 0 ? 0 : Math.round((100 * logos.failed) / logos.n);
const stored = (await db.query(`select address from internal.coin_logo where outcome = 'stored' order by checked_at desc limit 1`))[0];
try {
  const base = process.env.SUPABASE_URL;
  now.pictureStorage = !base || !stored ? -1 : (await fetch(`${base}/storage/v1/object/public/launch-metadata/coin-logos/${stored.address}`)).status;
} catch { now.pictureStorage = 0; }
await pool.end();
try { now.tapeCoins = (await (await fetch(`${READ}/running/coins`)).json()).coins.length; } catch { now.tapeCoins = -1; }
now.errors = {};
for (const s of ['chainwatch', 'runner', 'project', 'read', 'trade']) {
  try {
    const log = execSync(`railway logs --service ${s} 2>/dev/null | tail -400`, { encoding: 'utf8', maxBuffer: 64e6 });
    now.errors[s] = (log.match(/\[ERRO\]|429|max usage|statement timeout/g) ?? []).length;
  } catch { now.errors[s] = -1; }
}

/* What counts as worse: the owner's outcomes, against the last run and against a floor. */
const files = fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort();
const last = files.length ? JSON.parse(fs.readFileSync(new URL(files[files.length - 1], DIR), 'utf8')) : null;
const red = [];
const floor = (k, min) => { if (now[k] < min) red.push(`${k} ${now[k]} under ${min}`); };
floor('fypPosts', 40); floor('fypFreshPct', 80); floor('popularFreshPct', 50); floor('tapeCoins', 1); floor('judgedLast30m', 10);
if (now.lastFypJoinMin > 60) red.push(`For You has added no post for ${now.lastFypJoinMin} min`);
if (now.pictureStorage !== 200 && now.pictureStorage !== -1) red.push(`picture storage answers ${now.pictureStorage}: coin logos, poster and post pictures are not loading`);
if (now.logoCopyFailPct > 50) red.push(`coin-logo copies failing: ${now.logoCopyFailPct}% in the last hour`);
/* The shed share is information, not a failure: the re-read day is fixed, and the feeds' freshness above is the outcome. */
for (const [s, n] of Object.entries(now.errors)) if (last && n > Math.max(10, 3 * (last.errors?.[s] ?? 0))) red.push(`${s} errors ${n} (last check ${last.errors?.[s]})`);
if (last) for (const k of ['fypPosts', 'fypFreshPct', 'popularFreshPct', 'tapeCoins', 'judgedLast30m']) if (now[k] < 0.7 * last[k]) red.push(`${k} fell ${last[k]} → ${now[k]}`);

fs.writeFileSync(new URL(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, DIR), JSON.stringify(now, null, 1));
console.log(JSON.stringify(now, null, 1));
console.log(red.length === 0 ? '\nHEALTHY' : `\nWORSE:\n- ${red.join('\n- ')}`);
process.exit(red.length === 0 ? 0 : 1);
