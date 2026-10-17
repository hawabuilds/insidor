/**
 * `node --env-file=.env.local --experimental-strip-types tools/trending-backtest.ts [--days 3] [--regroup-min 20] [--rank-min 10] [--out <file.md>]`
 *
 * THE TRENDING BACKTEST the owner asked for before Trending goes live (2026-10-17): the last
 * `--days`, replayed. Free and read-only: one read-only transaction, nothing embedded, judged or read
 * from outside.
 *
 * ★ NARRATIVES AS THE CURRENT GROUPING WOULD HAVE FORMED THEM FROM STORED DATA. The narrative
 * tables keep only the narratives open now, not their history, so every `--regroup-min` the runner's
 * own pass (services/runner work/narratives.ts `group`, never a copy) is run as of that moment: the
 * posts we had found and judged by then, their readings up to then, the owner's narrative calls up
 * to then, and the narratives of the replay's previous pass as the ones to keep ids from. What is
 * NOT as of then: each post's newest judge answer, the owner's post calls and the cutoff are today's
 * (a post judged twice is held to its later answer from its first judging), so the replay's posts are
 * the ones the current judge passes.
 *
 * Every `--rank-min`, three orders over the narratives shown then, each from readings up to then
 * only (core `trendFacts`, `reachGained`, the projector's own functions):
 *   Trending 1h       core `trendOrder` over the 1h window, the tab's default
 *   Most viewed 24h   views gained in the last 24 hours, the Most viewed chip's default
 *   Gained 1h         plain views gained in the last hour, the old board's order
 *
 * And for every narrative that later got a coin — a coin whose metadata names one of its posts
 * (internal.coin_post_link), launched on a clock we trust (the chain's own, or the live notice with
 * its few seconds; services/read post-sheet.ts `launchClock`) — when each order first put it in its
 * top 10, against the coin's launch: how many minutes earlier Trending had it than Most viewed.
 *
 * What breaks if changed carelessly: the as-of filter. A post found after a replay moment, or a
 * reading taken after it, leaking into that moment makes every order look earlier than it was.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/vocabulary.ts';
import { DEFAULT_POLICY, type Policy } from '../contracts/src/policy.ts';
import { reachGained, trendFacts, trendOrder, type MemberReach, type TrendCoin, type TrendFacts } from '../core/src/index.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { createPool, DB_ROLE, PgLearningRepo, PgNarrativeRepo, withTransaction } from '../store/src/index.ts';
import type { NarrativePostRow } from '../store/src/index.ts';
import { narrativeGrouper } from '../services/runner/src/work/narratives.ts';

const arg = (name: string, d: string): string => {
  const i = process.argv.indexOf(name);
  return i < 0 ? d : (process.argv[i + 1] ?? d);
};
const DAYS = Number(arg('--days', '3'));
const REGROUP_MS = Number(arg('--regroup-min', '20')) * 60_000;
const RANK_MS = Number(arg('--rank-min', '10')) * 60_000;
const OUT = arg('--out', '');
/* `--try reachWeight=1,postWeight=0.4`: the same replay under other trend weights, to compare. */
const tried = Object.fromEntries(arg('--try', '').split(',').filter((x) => x.includes('=')).map((x) => [x.split('=')[0] ?? '', Number(x.split('=')[1])]));
const P: Policy = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, trend: { ...DEFAULT_POLICY.narrative.trend, ...tried } } };
const TOP = 10;
const HOUR = 3_600_000;
const POST_SPACE = 'multimodal-3.1024.post';
const quiet = { info: () => {}, warn: () => {}, error: (m: string, f?: unknown) => console.error(m, f ?? ''), child: () => quiet };

const toMs = (v: Date | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

const NOW = Date.now();
/* On the hour, so the six-hourly tables fall on 00:00, 06:00, 12:00 and 18:00. */
const START = Math.ceil((NOW - DAYS * 86_400_000) / HOUR) * HOUR;

interface Shown {
  readonly id: string;
  readonly members: readonly string[];
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-trending-backtest' });
try {
  await withTransaction(pool, async (db) => {
    await db.query('set transaction read only');
    const real = new PgNarrativeRepo(db);
    const learning = new PgLearningRepo(db);

    /* ── everything the replay needs, read once ── */
    const all = await real.candidates(START - P.narrative.windowMs, P.narrative.searchedPosts);
    const ids = all.map((r) => r.itemId);
    const items = await db.query<{ item_id: string; first_seen_at: Date; author_key: string; source: string }>(
      `select item_id, first_seen_at, author_key, source from public.item where item_id = any($1::text[])`, [ids]);
    const itemOf = new Map(items.map((r) => [r.item_id, r] as const));
    const judged = await db.query<{ item_id: string; at: Date }>(
      `select item_id, min(judged_at) as at from internal.post_judgement where item_id = any($1::text[]) and prompt_id not like 'post-kind%' group by item_id`, [ids]);
    const judgedAt = new Map(judged.map((r) => [r.item_id, toMs(r.at) ?? Infinity] as const));
    const obs = await db.query<{ item_id: string; captured_at: Date; value: string | number }>(
      `select item_id, captured_at, value from public.observation
        where item_id = any($1::text[]) and kind = 'reach' and value is not null and fidelity_kind <> 'absent' and captured_at >= $2
        order by item_id, captured_at`, [ids, new Date(START - P.narrative.windowMs - 86_400_000).toISOString()]);
    const readings = new Map<string, { atMs: number; reach: number }[]>();
    for (const o of obs) {
      const list = readings.get(o.item_id) ?? [];
      list.push({ atMs: toMs(o.captured_at) ?? 0, reach: Number(o.value) });
      readings.set(o.item_id, list);
    }
    const calls = await real.calls();
    const block = await learning.latestApplied();
    const titles = new Map((await db.query<{ narrative_id: string; title: string | null }>(`select narrative_id, title from internal.narrative where title is not null`)).map((r) => [r.narrative_id, r.title] as const));
    /* Coins whose metadata names a post we replay, with a launch on a trusted clock. */
    const links = await db.query<{ item_id: string; address: string; symbol: string | null; minted_at: Date; source: string | null; bound: string | number | null }>(
      `select l.source || ':' || l.source_item_id as item_id, l.address, a.symbol, a.minted_at, a.minted_at_source as source, a.minted_at_bound_s as bound
         from internal.coin_post_link l join public.asset a on a.address = l.address
        where (l.source || ':' || l.source_item_id) = any($1::text[]) and a.minted_at is not null and a.minted_at >= $2`,
      [ids, new Date(START).toISOString()]);
    const trusted = links.filter((l) => l.source === 'chain_rpc' || l.source === 'issuer_api' || (l.source === 'vendor_field' && l.bound !== null && Number(l.bound) >= 0));
    const coinsOfPost = new Map<string, { address: string; symbol: string | null; mintedMs: number }[]>();
    for (const l of trusted) coinsOfPost.set(l.item_id, [...(coinsOfPost.get(l.item_id) ?? []), { address: l.address, symbol: l.symbol, mintedMs: toMs(l.minted_at) ?? 0 }]);
    const coinAddresses = [...new Set(trusted.map((l) => l.address))];
    const caps = await db.query<{ address: string; taken_at: Date; cap: number }>(
      `select address, taken_at, market_cap_usd as cap from public.market_reading
        where chain = 'solana' and address = any($1::text[]) and market_cap_usd is not null and taken_at >= $2 order by address, taken_at`,
      [coinAddresses, new Date(START - 2 * HOUR).toISOString()]);
    const capsOf = new Map<string, { at: number; cap: number }[]>();
    for (const c of caps) capsOf.set(c.address, [...(capsOf.get(c.address) ?? []), { at: toMs(c.taken_at) ?? 0, cap: Number(c.cap) }]);
    const buys = await db.query<{ mint: string; at: Date }>(`select mint, settled_at as at from public.trade where kind = 'buy' and status = 'confirmed' and settled_at >= $1`, [new Date(START - HOUR).toISOString()]);
    console.error(`read: ${all.length} posts, ${obs.length} readings, ${trusted.length} coin links (${coinAddresses.length} coins), ${caps.length} cap readings`);

    /* ── the replay ── */
    let asOf = START;
    let previous: { id: string; members: string[]; anchor: string; shown: boolean }[] = [];
    const visible = (r: NarrativePostRow): boolean => {
      const found = toMs(itemOf.get(r.itemId)?.first_seen_at) ?? Infinity;
      return found <= asOf && (judgedAt.get(r.itemId) ?? Infinity) <= asOf;
    };
    const repo = {
      candidates: async (sinceMs: number) => all.filter((r) => r.atMs >= sinceMs && visible(r)),
      vectors: (i: readonly string[], space: string, kind: 'post' | 'picture') => real.vectors(i, space, kind),
      reach: async (i: readonly string[], sinceMs: number) => {
        const points = new Map<string, { atMs: number; reach: number }[]>();
        const latest = new Map<string, number>();
        for (const id of i) {
          const upTo = (readings.get(id) ?? []).filter((x) => x.atMs <= asOf);
          const last = upTo[upTo.length - 1];
          if (last !== undefined) latest.set(id, last.reach);
          points.set(id, upTo.filter((x) => x.atMs >= sinceMs));
        }
        return { points, latest };
      },
      open: async () => previous.map((n) => ({ id: n.id, members: n.members, anchor: n.anchor, shown: n.shown, firstShownAtMs: null, postsChangedAtMs: 0, title: null, titlePosts: null })),
      calls: async () => calls.filter((c) => c.atMs <= asOf),
      setTitle: async () => {},
    };
    const grouper = narrativeGrouper({
      repo: repo as never,
      save: async () => false,
      block: async () => ({ cutoff: block?.cutoff ?? null, chosenOn: block?.cutoffModel ?? null }),
      titler: null,
      embed: null,
      keepVectors: async () => false,
      meter: inMemoryMeter({ dailyCapUsd: 0, softStop: 1, now: () => Date.now() }),
      mode: 'dry',
      policy: P,
      postSpace: POST_SPACE,
      log: quiet,
      now: () => asOf as Millis,
    });
    const byId = new Map(all.map((r) => [r.itemId, r] as const));
    const nameOf = (n: Shown): string => {
      const t = titles.get(n.id);
      if (t !== undefined && t !== null) return t;
      const names = new Map<string, number>();
      for (const m of n.members) {
        const x = byId.get(m)?.proposedName?.trim();
        if (x) names.set(x, (names.get(x) ?? 0) + 1);
      }
      return [...names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? n.id;
    };

    type Row = { id: string; name: string; posts: number; trend: TrendFacts; gained24: number | null; gained1: number | null };
    const snapshots: { at: number; trending: string[]; mostViewed: string[]; gained: string[]; rows: Map<string, Row>; members: Map<string, readonly string[]> }[] = [];
    let shown: Shown[] = [];
    let t0 = Date.now();
    for (let t = START; t <= NOW; t += RANK_MS) {
      if ((t - START) % REGROUP_MS === 0) {
        asOf = t;
        const g = await grouper.group();
        if (typeof g === 'string') throw new Error(g);
        previous = g.pass.narratives.map((n) => ({ id: n.id, members: [...n.members], anchor: n.anchor, shown: n.shown }));
        shown = g.pass.narratives.filter((n) => n.shown).map((n) => ({ id: n.id, members: n.members }));
      }
      const rows = new Map<string, Row>();
      const subjects = shown.map((n) => {
        const posts = n.members.map((m) => {
          const it = itemOf.get(m);
          const reach: MemberReach = { postedAtMs: byId.get(m)?.atMs ?? null, points: (readings.get(m) ?? []).filter((x) => x.atMs <= t) };
          return { authorKey: it?.author_key ?? m, sourceKey: it?.source ?? '', foundAtMs: toMs(it?.first_seen_at), reach };
        });
        const found = posts.map((p) => p.foundAtMs).filter((x): x is number => x !== null);
        const foundAtMs = found.length === 0 ? null : Math.min(...found);
        /* A checked coin as the live frame has it: one its posts prove, launched by now. */
        const coin = n.members.flatMap((m) => coinsOfPost.get(m) ?? []).filter((c) => c.mintedMs <= t).sort((a, b) => a.mintedMs - b.mintedMs)[0];
        let trendCoin: TrendCoin | null = null;
        if (coin !== undefined) {
          const cs = capsOf.get(coin.address) ?? [];
          const at = (edge: number) => [...cs].reverse().find((c) => c.at <= edge && c.at > edge - HOUR)?.cap ?? null;
          trendCoin = { capAtStart: at(t - HOUR), capNow: at(t), buys: buys.filter((b) => b.mint === coin.address && (toMs(b.at) ?? 0) > t - HOUR && (toMs(b.at) ?? 0) <= t).length };
        }
        const input = { posts, foundAtMs, coin: trendCoin };
        const facts = trendFacts(input, t, HOUR);
        const members = posts.map((p) => p.reach);
        rows.set(n.id, { id: n.id, name: nameOf(n), posts: n.members.length, trend: facts, gained24: reachGained(members, t - 24 * HOUR, t).value, gained1: facts.gained });
        return { id: n.id, facts, foundAtMs };
      });
      const byNum = (key: (r: Row) => number | null) => [...rows.values()].filter((r) => key(r) !== null).sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0)).map((r) => r.id);
      snapshots.push({ at: t, trending: [...trendOrder(subjects, P)], mostViewed: byNum((r) => r.gained24), gained: byNum((r) => r.gained1), rows, members: new Map(shown.map((n) => [n.id, n.members] as const)) });
      if (Date.now() - t0 > 30_000) {
        console.error(`  at ${new Date(t).toISOString()} (${snapshots.length} snapshots)`);
        t0 = Date.now();
      }
    }

    /* ── the report ── */
    const fmt = (n: number | null) => (n === null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));
    const clock = (ms: number) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const L: string[] = [];
    L.push(`# Trending narratives backtest`, '');
    if (Object.keys(tried).length > 0) L.push(`Trend weights tried instead of the policy's: ${JSON.stringify(tried)}`, '');
    L.push(`Replayed ${clock(START)} to ${clock(NOW)} (UK time), ${DAYS} days. Regrouped every ${REGROUP_MS / 60_000} minutes with the runner's own grouping as of each moment, ranked every ${RANK_MS / 60_000} minutes from readings up to that moment. Written ${new Date(NOW).toISOString()}.`, '');
    L.push('**How the narratives were formed:** as the CURRENT grouping would have formed them from stored data (the narrative tables keep no history). At each moment only the posts we had found and judged by then, and their readings up to then; but each post\'s newest judge answer, the owner\'s post calls and the cutoff are today\'s.', '');
    L.push('Columns: **Trending 1h** (the new default), **Most viewed 24h** (views gained in the last 24 hours), **Gained 1h** (plain views gained in the last hour, the old order). Each cell: name, views gained in its own window, new posts in the last hour.', '');

    /* Snapshots every 6 hours on the UK clock. */
    const sixHours = snapshots.filter((s) => {
      const d = new Date(s.at);
      const h = Number(d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }));
      return h % 6 === 0 && d.getUTCMinutes() < RANK_MS / 60_000;
    });
    for (const s of sixHours) {
      L.push(`## ${clock(s.at)}`, '', `${s.rows.size} narratives shown.`, '', '| # | Trending 1h | Most viewed 24h | Gained 1h |', '|---|---|---|---|');
      for (let i = 0; i < TOP; i++) {
        const cell = (id: string | undefined, which: 'trend' | '24' | '1') => {
          if (id === undefined) return '';
          const r = s.rows.get(id);
          if (r === undefined) return id;
          const g = which === '24' ? r.gained24 : r.gained1;
          return `${r.name.replace(/\|/g, '/').slice(0, 28)} (${fmt(g)}${which === '24' ? ' 24h' : ' 1h'}, ${r.trend.newPosts} new)`;
        };
        L.push(`| ${i + 1} | ${cell(s.trending[i], 'trend')} | ${cell(s.mostViewed[i], '24')} | ${cell(s.gained[i], '1')} |`);
      }
      L.push('');
    }

    /* ── lead on coined narratives ── */
    const firstIn = (list: 'trending' | 'mostViewed' | 'gained', ids: (s: (typeof snapshots)[number]) => string | null): number | null => {
      for (const s of snapshots) {
        const id = ids(s);
        if (id !== null && s[list].slice(0, TOP).includes(id)) return s.at;
      }
      return null;
    };
    const coinNarratives = new Map<string, { address: string; symbol: string | null; mintedMs: number; posts: Set<string> }>();
    for (const [post, cs] of coinsOfPost) for (const c of cs) {
      const have = coinNarratives.get(c.address) ?? { ...c, posts: new Set<string>() };
      have.posts.add(post);
      coinNarratives.set(c.address, have);
    }
    /* For each coin: the narrative holding one of its posts at each moment, if any; first coin per narrative only. */
    const rowsOut: { name: string; symbol: string; minted: number; shownAt: number | null; trend: number | null; viewed: number | null; gained: number | null }[] = [];
    const seenNarrative = new Set<string>();
    for (const c of [...coinNarratives.values()].sort((a, b) => a.mintedMs - b.mintedMs)) {
      const at = (s: (typeof snapshots)[number]): string | null => {
        for (const [id, ms] of s.members) if (ms.some((m) => c.posts.has(m))) return id;
        return null;
      };
      const firstShown = snapshots.find((s) => at(s) !== null);
      if (firstShown === undefined || firstShown.at > c.mintedMs) continue; // the narrative was not shown before its coin
      const nid = at(firstShown) ?? '';
      if (seenNarrative.has(nid)) continue;
      seenNarrative.add(nid);
      rowsOut.push({
        name: firstShown.rows.get(nid)?.name ?? nid,
        symbol: c.symbol ?? c.address.slice(0, 6),
        minted: c.mintedMs,
        shownAt: firstShown.at,
        trend: firstIn('trending', at),
        viewed: firstIn('mostViewed', at),
        gained: firstIn('gained', at),
      });
    }
    const min = (a: number | null, b: number) => (a === null ? null : Math.round((b - a) / 60_000));
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length === 0 ? null : s.length % 2 === 1 ? (s[(s.length - 1) / 2] ?? null) : ((s[s.length / 2 - 1] ?? 0) + (s[s.length / 2] ?? 0)) / 2;
    };
    const both = rowsOut.filter((r) => r.trend !== null && r.viewed !== null);
    const earlier = both.map((r) => Math.round(((r.viewed ?? 0) - (r.trend ?? 0)) / 60_000));
    const beforeCoin = (k: 'trend' | 'viewed' | 'gained') => rowsOut.filter((r) => r[k] !== null && (r[k] ?? 0) < r.minted).length;
    L.push('## Narratives that later got a coin', '');
    L.push(`${rowsOut.length} narratives were shown before a coin naming one of their posts launched (launch time on the chain's clock or the live notice's).`, '');
    L.push(`- In Trending 1h's top 10 before the coin: ${beforeCoin('trend')} of ${rowsOut.length}; Most viewed 24h: ${beforeCoin('viewed')}; Gained 1h: ${beforeCoin('gained')}.`);
    const lead = (k: 'trend' | 'viewed' | 'gained') => median(rowsOut.filter((r) => r[k] !== null && (r[k] ?? 0) < r.minted).map((r) => Math.round((r.minted - (r[k] ?? 0)) / 60_000)));
    L.push(`- Median minutes in the top 10 before the coin launched, over those that were: Trending 1h ${lead('trend') ?? '—'}, Most viewed 24h ${lead('viewed') ?? '—'}, Gained 1h ${lead('gained') ?? '—'}.`);
    L.push(`- Of the ${both.length} that reached both top 10s, Trending had it first in ${earlier.filter((x) => x > 0).length}, the same moment in ${earlier.filter((x) => x === 0).length}, later in ${earlier.filter((x) => x < 0).length}. Median: Trending ${median(earlier) ?? '—'} minutes earlier than Most viewed.`);
    const differ = earlier.filter((x) => x !== 0);
    L.push(`- Where the two differ (${differ.length}): median ${median(differ) ?? '—'} minutes, Trending earlier by ${differ.filter((x) => x > 0).join(', ') || 'none'}; later by ${differ.filter((x) => x < 0).map((x) => -x).join(', ') || 'none'}.`);
    L.push(`- Never in Most viewed's top 10 but in Trending's: ${rowsOut.filter((r) => r.trend !== null && r.viewed === null).length}; the other way round: ${rowsOut.filter((r) => r.trend === null && r.viewed !== null).length}.`, '');
    L.push('Minutes before the coin launched (negative: after it). "—": never in that top 10 in the replay.', '');
    L.push('| narrative | coin | launched | first shown | Trending 1h | Most viewed 24h | Gained 1h | Trending earlier than Most viewed by |', '|---|---|---|---|---|---|---|---|');
    for (const r of rowsOut) {
      const d = r.trend !== null && r.viewed !== null ? `${Math.round((r.viewed - r.trend) / 60_000)} min` : '—';
      L.push(`| ${r.name.replace(/\|/g, '/').slice(0, 30)} | $${r.symbol} | ${clock(r.minted)} | ${min(r.shownAt, r.minted)} | ${min(r.trend, r.minted) ?? '—'} | ${min(r.viewed, r.minted) ?? '—'} | ${min(r.gained, r.minted) ?? '—'} | ${d} |`);
    }
    const text = L.join('\n') + '\n';
    if (OUT !== '') writeFileSync(OUT, text);
    console.log(text.slice(0, 4000));
  });
} finally {
  await pool.end();
}
