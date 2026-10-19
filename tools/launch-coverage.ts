/**
 * `node --env-file=.env.local --experimental-strip-types tools/launch-coverage.ts [--days 3] [--cap 10000]`
 *
 * HOW MANY LAUNCHES REACHED US LIVE, HOW MANY LATE, AND WHY. Over the last `--days` days, from the
 * database alone (free, read-only):
 *
 *   gaps        the socket's coverage log (internal.mint_coverage): how many windows it declared
 *               dark and for how long, the longest first.
 *   arrivals    launches by how they reached us: the socket (`live_stream`), the launch listing
 *               (a `backfill` row first seen within `LISTED_WITHIN_MIN` minutes of its launch), or
 *               later (a `backfill` row a name search found). A late row is split by whether its
 *               launch fell inside a declared gap (an outage of ours) or not (the socket never
 *               sent it — on 19 Oct, a launch made in a version-1 transaction).
 *   runners     the same split for the coins that reached `--cap` dollars on any market reading,
 *               which is what the post-to-coin decision needs in minutes.
 *   opening     the share of socket launches carrying the creator's opening buy (0112).
 *
 * The address suffix is reported because the launchpad's own site gives its coins a `pump`
 * suffix; a late coin without one is often another launchpad's, which no source here watches.
 *
 * What it cannot see: a launch neither the socket, the listing nor a name search ever found is in
 * no row, so every share here is of the launches we hold, and the socket's true miss rate is at
 * least the late share. What breaks if changed carelessly: `LISTED_WITHIN_MIN`. The listing adds a
 * coin a few minutes after launch and a name search rarely within ten; raise it far and searches
 * count as the listing, lower it under the listing's lag and the listing counts as searches.
 */

import process from 'node:process';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const days = arg('--days', 3);
const cap = arg('--cap', 10_000);
/** A backfill row first seen this soon after launch came from the launch listing, not a search. */
const LISTED_WITHIN_MIN = 10;

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-launch-coverage' });
try {
  const db = asDb(pool);

  const gaps = await db.query<{ n: string; secs: string; longest: string | null }>(
    `select count(*)::text n, coalesce(sum(extract(epoch from window_to - window_from)), 0)::bigint::text secs,
            max(window_to - window_from)::text longest
       from internal.mint_coverage where gap and window_from > now() - make_interval(days => $1::int)`,
    [days],
  );
  const g = gaps[0];
  console.log(`Coverage log, last ${days} days: ${g?.n ?? 0} dark windows, ${g?.secs ?? 0} s in all, the longest ${g?.longest ?? '—'}.`);

  const rows = await db.query<{ how: string; suffix: string; n: string; ran: string; late_min: string | null }>(
    `with g as (select window_from, window_to from internal.mint_coverage where gap and window_from > now() - make_interval(days => $1::int + 1)),
     a as (
       select a.address, a.minted_at, a.first_seen_at,
              case when a.address like '%pump' then 'pump' else 'other' end suffix,
              case when a.origin = 'live_stream' then '1 socket'
                   when a.origin <> 'backfill' then '9 other origin'
                   when a.first_seen_at - a.minted_at <= make_interval(mins => $3::int) then '2 listing'
                   when exists (select 1 from g where a.minted_at between g.window_from - interval '10 seconds' and g.window_to + interval '10 seconds')
                     then '3 late: launched in a dark window'
                   else '4 late: socket never sent it' end how
         from public.asset a
        where a.minted_at > now() - make_interval(days => $1::int) and a.minted_at < now() - interval '1 hour'),
     m as (select address, max(market_cap_usd) mx from public.market_reading
            where taken_at > now() - make_interval(days => $1::int + 1) and market_cap_usd < 1e9 and liquidity_usd > 0 group by 1)
     select how, suffix, count(*)::text n, count(*) filter (where m.mx >= $2)::text ran,
            (percentile_cont(0.5) within group (order by extract(epoch from first_seen_at - minted_at) / 60))::int::text late_min
       from a left join m using (address) group by 1, 2 order by 1, 2`,
    [days, cap, LISTED_WITHIN_MIN],
  );
  const total = rows.reduce((n, r) => n + Number(r.n), 0);
  const totalRan = rows.reduce((n, r) => n + Number(r.ran), 0);
  console.log(`\nLaunches minted in the last ${days} days (to an hour ago): ${total}; reached $${cap.toLocaleString('en')}: ${totalRan}.`);
  console.log('  how it reached us                      suffix   launches   share   reached cap   share   median minutes after launch');
  for (const r of rows) {
    const share = (x: number, of: number) => (of === 0 ? '—' : `${((100 * x) / of).toFixed(1)}%`);
    console.log(
      `  ${r.how.slice(2).padEnd(38)} ${r.suffix.padEnd(6)} ${r.n.padStart(10)} ${share(Number(r.n), total).padStart(7)} ${r.ran.padStart(13)} ${share(Number(r.ran), totalRan).padStart(7)}   ${r.late_min ?? '—'}`,
    );
  }

  try {
    const opening = await db.query<{ n: string; with_buy: string; zero_buy: string }>(
      `select count(*)::text n, count(*) filter (where creator_buy_sol is not null)::text with_buy,
              count(*) filter (where creator_buy_sol = 0)::text zero_buy
         from public.asset where origin = 'live_stream' and first_seen_at > now() - make_interval(days => $1::int)`,
      [days],
    );
    const o = opening[0];
    console.log(`\nOpening buy (0112): ${o?.with_buy ?? 0} of ${o?.n ?? 0} socket launches carry it (${o?.zero_buy ?? 0} with no buy at all). Rows from before 0112 say NULL, not 0.`);
  } catch {
    console.log('\nOpening buy: not measurable here yet — migration 0112 has not run on this database.');
  }
} finally {
  await pool.end();
}
