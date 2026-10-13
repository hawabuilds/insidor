/**
 * `node --experimental-strip-types eval/src/gold/run-recall.ts`
 *
 * THE GOLD SET'S RECALL REPORT: of the posts the founders say started a coin, how many would live
 * discovery at today's settings have caught, and how many minutes after each was posted? Writes
 * recall-report.md beside this file.
 *
 * Offline: it reads the frozen gold set and recall-evidence.json, which tools/recall-check.ts
 * `gold-fetch` wrote (each origin post read again, and the settings as measured from the live
 * database on that day). Re-run that to re-measure; re-run this to re-render.
 *
 * ★ THE CHANGES IT PRICES ARE CHOSEN ON THE TUNING HALF. Each candidate change is scored on the
 * tuning coins' misses; the held-out coins are reported once, beside the headline, and never used
 * to rank a change — the rule coin-origins.ts states for every threshold chosen on this set.
 *
 * What breaks if changed carelessly: the report is a MODEL of discovery (eval/src/recall/model.ts
 * states its one big assumption, the growth curve) — not a record of it. The gold coins predate
 * live discovery, so nothing here was observed; the daily check (internal.recall_check) is the
 * observed counterpart and is what to trust when the two disagree.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { goldCoins, type GoldCoin } from './coin-origins.ts';
import { median, verdict, type DiscoverySettings, type LaneSetting, type PostFacts, type Verdict } from '../recall/model.ts';

interface Evidence {
  readonly readAt: string;
  readonly readPostsAt: string;
  readonly settings: DiscoverySettings;
  readonly measured: {
    readonly baseFloors: Readonly<Record<string, number>>;
    readonly lanes: readonly { lane: string; found: number; medianAgeMin: number | null; p95AgeMin: number | null; passGapMin: number | null }[];
    readonly growthPairs: number;
    readonly configuredWindowMin: Readonly<Record<string, number>>;
  };
  readonly posts: Readonly<Record<string, (PostFacts & { readonly postedAt: number | null }) | null>>;
}

const FILE = new URL('./recall-report.md', import.meta.url);
const ev = JSON.parse(readFileSync(new URL('./recall-evidence.json', import.meta.url), 'utf8')) as Evidence;
const S = ev.settings;

/* ── what a day of X search costs, for pricing a change ─────────────────────────────────────── */

/* What X bills per post returned, and a result page's size (Policy.feed.pageLimit, as rendered
   into the query): the slow lane's three pages are sixty posts. */
const USD_PER_POST = 0.000_15;
const PAGE_POSTS = 20;
const MIN_PER_DAY = 24 * 60;
/* A slower growth curve, to show how much the headline rests on the fitted one: most viral posts
   keep collecting approvals for days, and our own fit sees only their first hours. */
const SLOW_GROWTH = 3;

/* ── one post, one verdict ──────────────────────────────────────────────────────────────────── */

type Reason = 'not_on_x' | 'deleted' | 'not_in_search' | 'under_floor' | 'between_checks';
interface Row {
  readonly coin: GoldCoin;
  readonly postId: string | null;
  readonly facts: (PostFacts & { readonly postedAt: number | null }) | null;
  readonly v: Verdict | { readonly kind: 'missed'; readonly reason: Reason };
}

const originPosts = goldCoins().filter((c) => c.origin.kind === 'post');

function judge(settings: DiscoverySettings): Row[] {
  return originPosts.map((coin) => {
    const o = coin.origin;
    if (o.kind !== 'post' || o.platform !== 'x') return { coin, postId: null, facts: null, v: { kind: 'missed', reason: 'not_on_x' } };
    const facts = ev.posts[o.postId] ?? null;
    if (facts === null) return { coin, postId: o.postId, facts: null, v: { kind: 'missed', reason: 'deleted' } };
    return { coin, postId: o.postId, facts, v: verdict(facts, settings) };
  });
}

const reasonOf = (r: Row): Reason | null => (r.v.kind === 'missed' ? r.v.reason : null);
const caughtOf = (rows: readonly Row[]) => rows.filter((r) => r.v.kind === 'caught');
const xRows = (rows: readonly Row[]) => rows.filter((r) => r.coin.origin.kind === 'post' && r.coin.origin.platform === 'x');
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(0)}% (${n} of ${d})`);
const mins = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} min`);
const delays = (rows: readonly Row[]) => caughtOf(rows).flatMap((r) => (r.v.kind === 'caught' ? [r.v.delayMin] : []));

const base = judge(S);
const tune = base.filter((r) => r.coin.split === 'tune');
const held = base.filter((r) => r.coin.split === 'holdout');
const slow = judge({ ...S, tauMin: S.tauMin * SLOW_GROWTH });
/* The query as it was before 2026-10-13, which also left replies out: the comparison the change rests on. */
const withReplies = judge({ ...S, excludeReplies: true });

const REASONS: readonly Reason[] = ['under_floor', 'not_in_search', 'between_checks', 'deleted', 'not_on_x'];
const breakdown = (rows: readonly Row[]) => REASONS.map((k) => `${k} ${rows.filter((r) => reasonOf(r) === k).length}`).join(', ');

/* ── candidate changes, each priced ─────────────────────────────────────────────────────────── */

const lane = (s: DiscoverySettings, name: string) => s.lanes.find((l) => l.lane === name) as LaneSetting;
const withLane = (s: DiscoverySettings, name: string, patch: Partial<LaneSetting>): DiscoverySettings => ({
  ...s,
  lanes: s.lanes.map((l) => (l.lane === name ? { ...l, ...patch } : l)),
});
const slowLane = lane(S, 'slow');
const slowMeasured = ev.measured.lanes.find((l) => l.lane === 'slow');
/* How many minutes of a post's age one page of the slow lane covers: its results span from the
   youngest post over the floor to its reach, and the median sits about half way, so a page
   covers about (reach − median) × 2 / pages. More pages extend the reach by that much each. */
const slowPages = 3;
const minPerSlowPage = slowMeasured?.medianAgeMin == null ? null : ((slowLane.reachMin - slowMeasured.medianAgeMin) * 2) / slowPages;
const slowPassesPerDay = MIN_PER_DAY / slowLane.everyMin;

interface Change {
  readonly name: string;
  readonly how: string;
  readonly settings: DiscoverySettings;
  /** Extra X spend a day at worst (every page full), in dollars. */
  readonly extraUsdPerDay: number;
  readonly costNote: string;
}

const changes: Change[] = [];
if (minPerSlowPage !== null) {
  for (const extra of [3, 6]) {
    const reach = Math.min(slowLane.reachMin + extra * minPerSlowPage, ev.measured.configuredWindowMin['slow'] ?? Infinity);
    changes.push({
      name: `slow lane: ${slowPages + extra} pages instead of ${slowPages}`,
      how: `reach ${slowLane.reachMin.toFixed(0)} → ~${reach.toFixed(0)} min of a post's age (each page about ${minPerSlowPage.toFixed(0)} min, measured)`,
      settings: withLane(S, 'slow', { reachMin: reach }),
      extraUsdPerDay: extra * PAGE_POSTS * slowPassesPerDay * USD_PER_POST,
      costNote: `${extra} more pages × ${slowPassesPerDay} passes a day × ${PAGE_POSTS} posts`,
    });
  }
}
changes.push({
  name: 'slow lane every 5 min instead of 15',
  how: 'same reach, a third of the wait between passes',
  settings: withLane(S, 'slow', { everyMin: 5 }),
  extraUsdPerDay: slowPages * PAGE_POSTS * (MIN_PER_DAY / 5 - slowPassesPerDay) * USD_PER_POST,
  costNote: `${slowPages} pages × ${MIN_PER_DAY / 5 - slowPassesPerDay} more passes a day × ${PAGE_POSTS} posts`,
});
changes.push({
  name: 'slow lane floor 500 → 250, 6 pages',
  how: 'half the floor; the extra pages keep the reach where it is (assumed)',
  settings: withLane(S, 'slow', { floor: Math.round(slowLane.floor / 2) }),
  extraUsdPerDay: 3 * PAGE_POSTS * slowPassesPerDay * USD_PER_POST,
  costNote: `3 more pages × ${slowPassesPerDay} passes × ${PAGE_POSTS} posts`,
});
/* What a pass returns for posts with no words (X tags them zxx), measured with the main lanes'
   floors over one ten-minute window on 2026-10-13: 1 post at the 'all' floor, 0 at the media
   floor, against 18 for English at the media floor. One sample — enough to say the volume is
   small, not to say how small. Priced as an extra lane at one post per pass (each call bills at
   least one post), the dearer of the two ways to ask. */
const ZXX_POSTS_PER_PASS = 1;
const mainPassesPerDay = MIN_PER_DAY / lane(S, 'all').everyMin;
changes.push({
  name: 'catch-all also accepts posts with no words (lang:zxx beside lang:en)',
  how: 'a picture or video with no text is tagged zxx, not en, so `lang:en` drops it — some of the biggest origin posts are exactly that',
  settings: { ...S, langs: [...(S.langs ?? []), 'zxx'] },
  extraUsdPerDay: ZXX_POSTS_PER_PASS * mainPassesPerDay * USD_PER_POST,
  costNote: `${ZXX_POSTS_PER_PASS} post a pass (measured once) × ${mainPassesPerDay.toFixed(0)} main passes a day`,
});
changes.push({
  name: 'no language filter at all',
  how: 'also Spanish, Russian, Thai… origin posts',
  settings: { ...S, langs: null },
  extraUsdPerDay: Number.NaN,
  costNote: 'not priced: every language is several times the English volume; at fixed targets the floors would rise and English posts near the floor would be lost, which this model does not see',
});
const all = lane(S, 'all');
changes.push({
  name: 'main lanes look back 20 min instead of 10',
  how: `floor scales with the window (Policy.feed.fullWindowMin), so all ${all.floor} → ${all.floor * 2}, media ${lane(S, 'media').floor} → ${lane(S, 'media').floor * 2}`,
  settings: { ...S, lanes: S.lanes.map((l) => (l.lane === 'slow' ? l : { ...l, reachMin: l.reachMin * 2, floor: l.floor * 2 })) },
  extraUsdPerDay: 0,
  costNote: 'none at the lanes’ targets (the doubled floor holds posts per pass)',
});

const scored = changes
  .map((c) => {
    const rows = judge(c.settings);
    const gainTune = caughtOf(rows.filter((r) => r.coin.split === 'tune')).length - caughtOf(tune).length;
    const gainHeld = caughtOf(rows.filter((r) => r.coin.split === 'holdout')).length - caughtOf(held).length;
    return { ...c, gainTune, gainHeld, perDollar: c.extraUsdPerDay === 0 ? Infinity : gainTune / c.extraUsdPerDay };
  })
  /* Priced changes first, by what they catch on the tuning half and then by cost; an unpriced one
     cannot be the cheapest, so it goes last whatever it catches. */
  .sort((a, b) => Number(Number.isNaN(a.extraUsdPerDay)) - Number(Number.isNaN(b.extraUsdPerDay)) || b.gainTune - a.gainTune || a.extraUsdPerDay - b.extraUsdPerDay);

/* ── the report ─────────────────────────────────────────────────────────────────────────────── */

const iso = (ms: number | null) => (ms === null ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' '));
const handle = (c: GoldCoin) => (c.origin.kind === 'post' ? (/\.com\/([^/]+)\//.exec(c.origin.url)?.[1] ?? '—') : '—');

function postRow(r: Row): string {
  const f = r.facts;
  const launched = Date.parse(r.coin.createdAt);
  const delay = r.v.kind === 'caught' ? r.v.delayMin : null;
  const before = delay === null || f?.postedAt == null ? '—' : `${((launched - (f.postedAt + delay * 60_000)) / 60_000).toFixed(0)}`;
  const slowV = slow.find((s) => s.coin.id === r.coin.id)?.v;
  const platform = r.coin.origin.kind === 'post' ? r.coin.origin.platform : '—';
  return `| ${r.coin.id} | ${r.coin.split} | ${r.coin.ticker.replace(/\|/g, '/')} | ${platform} | ${handle(r.coin)} | ${iso(f?.postedAt ?? null)} | ${f?.approvals ?? '—'} | ${f?.lang ?? '—'} | ${f === null ? '—' : f.hasMedia ? 'yes' : 'no'} | ${f === null ? '—' : f.isRebroadcast ? 'repost' : f.isReply ? 'reply' : 'original'} | ${r.v.kind === 'caught' ? `caught (${r.v.lane})` : r.v.reason} | ${mins(delay)} | ${before} | ${slowV === undefined ? '—' : slowV.kind === 'caught' ? 'caught' : slowV.reason} |`;
}

const laneRows = S.lanes.map((l) => {
  const m = ev.measured.lanes.find((x) => x.lane === l.lane);
  return `| ${l.lane} | ${l.floor} (base ${ev.measured.baseFloors[l.lane] ?? '—'}) | ${ev.measured.configuredWindowMin[l.lane] ?? '—'} min | ${l.reachMin} min | ${m?.medianAgeMin == null ? '—' : m.medianAgeMin.toFixed(1)} min | ${l.everyMin} min | ${l.mediaOnly ? 'yes' : 'no'} | ${m?.found ?? 0} |`;
});

const xAll = xRows(base);
const best = scored[0];
const md = `# Gold-set recall of live discovery

Rendered by \`eval/src/gold/run-recall.ts\` from \`recall-evidence.json\` (settings measured ${ev.readAt.slice(0, 16).replace('T', ' ')} UTC, posts read ${ev.readPostsAt.slice(0, 16).replace('T', ' ')} UTC by \`tools/recall-check.ts gold-fetch\`). A model of today's settings applied to the founders' origin posts — the gold coins launched before live discovery ran, so none of this was observed. The daily check (\`tools/recall-check.ts status\`) is the observed counterpart.

## Headline

| | caught | median delay after posting |
|---|---|---|
| X origin posts, tuning half | ${pct(caughtOf(xRows(tune)).length, xRows(tune).length)} | ${mins(median(delays(xRows(tune))))} |
| X origin posts, held out (read once, not used to rank changes) | ${pct(caughtOf(xRows(held)).length, xRows(held).length)} | ${mins(median(delays(xRows(held))))} |
| X origin posts, all | ${pct(caughtOf(xAll).length, xAll.length)} | ${mins(median(delays(xAll)))} |
| every origin post (TikTok and Instagram count as misses) | ${pct(caughtOf(base).length, base.length)} | ${mins(median(delays(base)))} |
| X origin posts, all, if approvals grew ${SLOW_GROWTH}× slower | ${pct(caughtOf(xRows(slow)).length, xRows(slow).length)} | ${mins(median(delays(xRows(slow))))} |

Misses, X posts: ${breakdown(xAll)}. Every origin post: ${breakdown(base)}.

Caught before the coin launched: ${caughtOf(xAll).filter((r) => r.v.kind === 'caught' && r.facts?.postedAt != null && r.facts.postedAt + r.v.delayMin * 60_000 < Date.parse(r.coin.createdAt)).length} of the ${caughtOf(xAll).length} caught X posts.

## Today's settings, as the model uses them

| lane | approvals floor sent | window asked | reach measured | median age found | every | media only | posts found |
|---|---|---|---|---|---|---|---|
${laneRows.join('\n')}

- Language: ${S.langs === null ? 'any' : S.langs.map((l) => `\`lang:${l}\``).join(' or ')}; ${S.excludeReplies ? 'replies and plain reposts left out' : 'plain reposts left out (`-filter:retweets`); replies and quote posts are searched'}. Leaving replies out as well, as the query did before 2026-10-13, catches ${pct(caughtOf(xRows(withReplies)).length, xRows(withReplies).length)}. No keyword term runs: the runner's pass logs show only the catch-all lanes, so a post is found by its approvals alone, never by what it says.
- **Floor sent** is the stored base floor (internal.feed_floor) scaled to the lane's window (core \`effectiveFloor\`); it adapts after every pass toward the day's budget, so it moves over the day.
- **Reach measured** is the 95th percentile of the age at which the lane first found its posts (internal.item_found_by), capped at the window it asks for. The slow lane asks for ${ev.measured.configuredWindowMin['slow'] ?? '—'} minutes, but it takes ${slowPages} pages of ${PAGE_POSTS} posts newest first, and those fill within the first ~${slowLane.reachMin.toFixed(0)} minutes: a post that crosses ${slowLane.floor} approvals later than that is never returned.
- **Every** is the median gap between passes that found something (main lanes) or the policy cadence (slow lane).
- **Growth.** Approvals at age t are assumed to be \`final × (1 − e^(−t/τ))\`, with the count read now as final and τ = ${S.tauMin} min fitted to ${ev.measured.growthPairs} live posts' first and last readings. A post is caught at the first pass after it crosses a lane's floor (taken as half a pass later), if that is still within the lane's reach. The ${SLOW_GROWTH}× slower row shows how much rests on τ.
- Replies are detected by the text opening with a mention (the read post carries no reply flag); \`zxx\` is X's language for a post with no words. Evidence read before 2026-10-13 recorded one flag for "reply or repost"; it is read as a reply, as this report always labelled it — a coin's origin is the post people saw, and a repost's link opens the original under its own author.

## Cheapest change that catches the most misses

Ranked on the tuning half's X posts (${xRows(tune).length - caughtOf(xRows(tune)).length} missed there). Extra cost is the worst case at $${USD_PER_POST} a post returned.

| change | what it does | extra caught, tuning | extra caught, held out | extra X cost a day (worst) | cost basis |
|---|---|---|---|---|---|
${scored.map((c) => `| ${c.name} | ${c.how} | ${c.gainTune} | ${c.gainHeld} | ${Number.isNaN(c.extraUsdPerDay) ? 'not priced' : `$${c.extraUsdPerDay.toFixed(2)}`} | ${c.costNote} |`).join('\n')}

${best === undefined ? '' : `Best on the tuning half: **${best.name}** — ${best.gainTune} more caught for $${best.extraUsdPerDay.toFixed(2)} a day at worst.`} Not applied.

## Every origin post

Delay is minutes from posting to the first pass that would return it; "before launch" is minutes from then to the coin's first transaction (negative: after). The last column is the verdict if approvals grew ${SLOW_GROWTH}× slower.

| coin | split | ticker | platform | account | posted (UTC) | approvals now | lang | picture | kind | verdict | delay | before launch | slow growth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${base.map(postRow).join('\n')}
`;

writeFileSync(FILE, md);
console.log(md.split('## Today')[0]);
console.log(`written to ${FILE.pathname}`);
