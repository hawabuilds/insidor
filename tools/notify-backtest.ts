/**
 * `node --env-file=.env.local --experimental-strip-types tools/notify-backtest.ts [--days 3] [--minPerMin N] [--topN N]`
 *
 * THE NOTIFICATION DESIGN, BACKTESTED: how many pushes each kind would have sent per person per day
 * over the last `--days`, by the alert service's own rules (services/notify blowing-up.ts, core
 * `underDailyAllowance`, Policy.notify), next to what was actually pushed under the old list. Free
 * and read-only: the session is read only, stored rows only, nothing is queued or sent.
 *
 * Its own tool because the owner agreed the design on condition each push is worth opening, and
 * the bars (how fast a riser must gain, how many a day) need numbers from real days, not guesses.
 *
 * ★ WHAT CAN AND CANNOT BE REPLAYED, SAID. Blowing up is replayed every five minutes from each For
 * You card's own readings (cut at that moment), so it is the real rule on the real days, except that
 * a card's coin is as it is now, not as it was then. A narrative page keeps no history, so a
 * brand-new narrative's push and a starred one's speed are counted only as they would fire now. A
 * holding's double or half needs each wallet's chain history; a created coin's buyers its chain
 * transactions: neither is read here. Follows, replies, likes and saved posts are counted from the
 * people tables as they stand.
 */

import process from 'node:process';

import { DEFAULT_POLICY, type Policy } from '../contracts/src/policy.ts';
import { pacingOf, underDailyAllowance } from '../core/src/notify/alerts.ts';
import { blowingUpNarratives, blowingUpPosts, pickOrder, readNewNarratives, readRiserPosts, type RiserPost } from '../services/notify/src/blowing-up.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const days = Number(arg('--days') ?? 3);
const STEP_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const b = DEFAULT_POLICY.notify.blowingUp;
const policy: Policy = { ...DEFAULT_POLICY, notify: { ...DEFAULT_POLICY.notify, blowingUp: { ...b, minPerMin: Number(arg('--minPerMin') ?? b.minPerMin), topN: Number(arg('--topN') ?? b.topN) } } };
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-notify-backtest' });
pool.on('connect', (c) => void c.query('set default_transaction_read_only = on'));
const db = asDb(pool);
const nowMs = Date.now();
const fromMs = nowMs - days * DAY_MS;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

try {
  /* Every For You card shown in the window, with its whole series of readings. */
  const rows = await db.query<{ itemId: string; source: string | null; readings: unknown; postedMs: string | null; coins: unknown; author: string | null; excerpt: string | null; views: number | null; shown: Date; withdrawn: Date | null }>(
    `select f.item_id as "itemId", i.source, coalesce(f.payload #> '{sheet,counts}', f.payload #> '{sheet,views}') as readings, f.payload #>> '{postedAt,at}' as "postedMs",
            f.payload -> 'coins' as coins, f.payload ->> 'authorLabel' as author, f.payload ->> 'excerpt' as excerpt, (f.payload #>> '{reach,v}')::float8 as views,
            f.first_shown_at as shown, f.withdrawn_at as withdrawn
       from public.feed_post f left join public.item i on i.item_id = f.item_id
      where f.feed_id = 'fyp' and f.payload is not null and f.payload_at >= $1::timestamptz`,
    [new Date(fromMs - DAY_MS).toISOString()],
  );
  const listed = new Set((await db.query<{ id: string }>(`select distinct subject_id as id from public.same_name_coin where subject_kind = 'post'`)).map((r) => r.id));
  const all = rows.map((r) => {
    const raw = typeof r.readings === 'string' ? JSON.parse(r.readings) : r.readings;
    const readings = (Array.isArray(raw) ? raw : []).flatMap((x: { atMs?: unknown; value?: unknown }) => (typeof x.atMs === 'number' ? [{ atMs: x.atMs, value: typeof x.value === 'number' ? x.value : null }] : []));
    return { post: { itemId: r.itemId, source: r.source, postedMs: r.postedMs === null ? null : Number(r.postedMs), readings, coins: r.coins, listed: listed.has(r.itemId), author: r.author, excerpt: r.excerpt, views: r.views, image: null } satisfies RiserPost, shown: new Date(r.shown).getTime(), withdrawn: r.withdrawn === null ? null : new Date(r.withdrawn).getTime() };
  });

  /* Replay: every five minutes, the cards on For You then, their readings cut at that moment. */
  const seen = new Set<string>();
  const pushed: number[] = [];
  const perDay = new Map<string, { picks: number; noCoin: number; pushed: number; listed: number }>();
  const examples: string[] = [];
  for (let t = fromMs; t <= nowMs; t += STEP_MS) {
    const live = all.filter((a) => a.shown <= t && (a.withdrawn === null || a.withdrawn > t)).map((a) => ({ ...a.post, readings: a.post.readings.filter((x) => x.atMs <= t) }));
    const picks = pickOrder(blowingUpPosts(live, t, policy, seen), [], policy.notify.blowingUp.perPass);
    for (const p of picks) {
      seen.add(p.key);
      const d = perDay.get(dayOf(t)) ?? { picks: 0, noCoin: 0, pushed: 0, listed: 0 };
      d.picks += 1;
      if (p.noCoin) d.noCoin += 1;
      const lastDay = pushed.filter((x) => x > t - b.dayMs).length;
      const last = pushed[pushed.length - 1];
      if (underDailyAllowance({ lastDay, sinceLastMs: last === undefined ? null : t - last }, pacingOf('blowing_up', policy.notify)!)) {
        pushed.push(t);
        d.pushed += 1;
        if (examples.length < 12) examples.push(`  ${new Date(t).toISOString().slice(5, 16)}  ${p.facts['noCoin'] === true ? 'no coin ' : 'coin    '} ${String(p.facts['author'] ?? '').padEnd(18)} +${p.facts['gain']} in 30m  ${String(p.facts['excerpt'] ?? '').slice(0, 50).replace(/\s+/g, ' ')}`);
      } else d.listed += 1;
      perDay.set(dayOf(t), d);
    }
  }
  console.log(`Blowing up, replayed every 5 min over ${days} days (top ${policy.notify.blowingUp.topN} risers, at least ${policy.notify.blowingUp.minPerMin} views a minute, ${b.perDay} a day ${b.minGapMs / 3_600_000}h apart). Per person (everyone gets the same):`);
  for (const [d, x] of [...perDay].sort()) console.log(`  ${d}: ${x.picks} qualified (${x.noCoin} with no coin), ${x.pushed} pushed, ${x.listed} listed only`);
  console.log('First pushes it would have sent:');
  for (const e of examples) console.log(e);

  const narratives = blowingUpNarratives(await readNewNarratives(db), nowMs, policy, new Set());
  console.log(`\nNew narratives taking off right now (no history to replay): ${narratives.length}${narratives.length === 0 ? '' : ` — ${narratives.map((n) => n.facts['title']).join('; ')}`}`);
  const fast = (await readNewNarratives(db)).filter((s) => !s.dead && (s.newPosts ?? 0) >= policy.notify.starredSpeed.minNewPosts && (s.viewsGained ?? 0) >= policy.notify.starredSpeed.minReach);
  console.log(`Narratives over the starred-speed bars right now (${policy.notify.starredSpeed.minNewPosts}+ new posts, ${policy.notify.starredSpeed.minReach}+ views in the hour; a starrer gets at most one per ${policy.notify.starredSpeed.gapMs / 3_600_000}h): ${fast.length} of the live pages`);

  const big = await db.query<{ day: string; narratives: number; posts: number }>(
    `select to_char(i.posted_at, 'YYYY-MM-DD') as day, count(distinct m.narrative_id)::int as narratives, count(*)::int as posts
       from internal.narrative_member m join public.item i on i.item_id = m.item_id join public.author a on a.author_key = i.author_key
      where a.follower_count >= $1 and i.posted_at >= $2::timestamptz group by 1 order by 1`,
    [policy.notify.bigAccount.minFollowers, new Date(fromMs).toISOString()],
  );
  console.log(`\nBig accounts (${policy.notify.bigAccount.minFollowers}+ followers) posting in a narrative, per day (a starrer of that narrative gets one push per post):`);
  for (const r of big) console.log(`  ${r.day}: ${r.posts} posts in ${r.narratives} narratives`);
  const watch = await db.query<{ n: number }>('select count(*)::int as n from people.watch');
  const postWatch = await db.query<{ n: number }>('select count(*)::int as n from people.post_watch');
  console.log(`Starred narratives today: ${watch[0]?.n ?? 0}; saved posts: ${postWatch[0]?.n ?? 0}`);

  const social = await db.query<{ kind: string; day: string; people: number; n: number }>(
    `select 'follow' as kind, to_char(created_at, 'YYYY-MM-DD') as day, count(distinct followee_id)::int as people, count(*)::int as n from people.follow where created_at >= $1::timestamptz group by 2
     union all select 'like', to_char(l.created_at, 'YYYY-MM-DD'), count(distinct c.author_id)::int, count(*)::int from people.comment_like l join people.comment c on c.comment_id = l.comment_id where l.created_at >= $1::timestamptz group by 2
     union all select 'reply', to_char(created_at, 'YYYY-MM-DD'), count(distinct parent_id)::int, count(*)::int from people.comment where parent_id is not null and created_at >= $1::timestamptz group by 2
     order by 1, 2`,
    [new Date(fromMs).toISOString()],
  );
  console.log(`\nFollows, likes and replies (follows push at most one group an hour, likes one a day):`);
  if (social.length === 0) console.log('  none in the window');
  for (const r of social) console.log(`  ${r.day} ${r.kind}: ${r.n} to ${r.people} people`);

  const before = await db.query<{ kind: string; n: number; people: number }>(
    `select kind, count(*)::int as n, count(distinct user_id)::int as people from people.alert where delivery = 'push' and at >= $1::timestamptz group by 1 order by 2 desc`,
    [new Date(fromMs).toISOString()],
  );
  console.log(`\nWhat was actually pushed in the window, under the old list:`);
  for (const r of before) console.log(`  ${r.kind}: ${r.n} to ${r.people} ${r.people === 1 ? 'person' : 'people'} (${(r.n / days / Math.max(1, r.people)).toFixed(1)} a person a day)`);
} finally {
  await pool.end();
}
