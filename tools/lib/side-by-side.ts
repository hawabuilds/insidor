/**
 * X AND TIKTOK SIDE BY SIDE — the owner's number table (2026-10-16: "every report and the number
 * table get X and TikTok side by side … Target: TikTok within 2x of X on every number in 1 week.
 * Each re-tune, tell me the biggest gap and what you're changing to close it").
 *
 * One function computes every row for both sources over the same window, and one prints it, so the
 * re-tune's summary (tools/retune.ts), the number table (tools/name-report.ts) and the 3-day review
 * (tools/tiktok-sources.ts) never disagree:
 *
 *   found          median minutes from a post going up to our first sight of it
 *   on For You     median minutes from going up to For You, and the slowest 10% (90th percentile)
 *   For You / hour posts first shown on For You, per hour
 *   junk           the owner's "Not a meme" taps per 100 posts For You showed
 *   coin matching  the owner's coin calls: right / wrong
 *   before coin    coined posts For You showed before their first coin (%), and the median lead
 *   training set   (TikTok) coined videos in the set, and its learned bar, tags and sounds
 *
 * ★ A NUMBER WE CANNOT COUNT IS A DASH WITH ITS REASON, never 0: no post shown is "— (none shown)",
 * not "0 minutes". The gap is only measured where both sides have a number.
 *
 * What breaks if changed carelessly: both columns must be read by the same query with the source
 * as the only difference. A TikTok number from another path is not "within 2x" of anything.
 */

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { CURRENT_COIN_CALLS, type Db } from '../../store/src/index.ts';
import { composeSet, learn, readingsOf, type Learned } from './coined-videos.ts';
import { leadRows, summarise } from './lead-time.ts';

export const SOURCES = ['x', 'tiktok'] as const;
type Source = (typeof SOURCES)[number];

export interface SourceNumbers {
  readonly foundMedianMin: number | null;
  readonly fypMedianMin: number | null;
  readonly fypP90Min: number | null;
  readonly fypShown: number;
  readonly fypPerHour: number;
  readonly notTaps: number;
  readonly junkPer100: number | null;
  readonly coinRight: number;
  readonly coinWrong: number;
  readonly coined: number;
  readonly shownFirst: number;
  readonly shownFirstPct: number | null;
  readonly medianLeadMin: number | null;
}

export interface SideBySide {
  readonly days: number;
  readonly bySource: Record<Source, SourceNumbers>;
  /** The TikTok training set and what it teaches; null when it could not be read. */
  readonly set: Learned | null;
}

const round = (x: number | null) => (x === null ? null : Math.round(x));

/** Every number, both sources, the last `days` days. Free: database reads only. */
export async function sideBySide(db: Db, days: number, p: Policy = DEFAULT_POLICY, opts: { readonly withSet?: boolean } = {}): Promise<SideBySide> {
  const since = new Date(Date.now() - days * 86_400_000);
  const q = async <T>(sql: string): Promise<T[]> => db.query<T & { source: string }>(sql, [since]);
  const found = await q<{ source: string; med: number | null }>(
    `select i.source, percentile_cont(0.5) within group (order by extract(epoch from i.first_seen_at - i.posted_at) / 60) as med
       from public.item i where i.first_seen_at >= $1 and i.posted_at is not null and i.posted_at <= i.first_seen_at and i.source in ('x', 'tiktok') group by 1`);
  const fyp = await q<{ source: string; n: number; med: number | null; p90: number | null }>(
    `select i.source, count(*)::int as n,
            percentile_cont(0.5) within group (order by extract(epoch from fp.first_shown_at - i.posted_at) / 60) as med,
            percentile_cont(0.9) within group (order by extract(epoch from fp.first_shown_at - i.posted_at) / 60) as p90
       from public.feed_post fp join public.item i on i.item_id = fp.item_id
      where fp.feed_id = 'fyp' and fp.first_shown_at >= $1 and i.source in ('x', 'tiktok') group by 1`);
  const taps = await q<{ source: string; n: number }>(
    `select split_part(item_id, ':', 1) as source, count(distinct item_id)::int as n from internal.owner_feedback
      where subject_kind = 'post' and verdict = 'not' and created_at >= $1 group by 1`);
  const calls = await q<{ source: string; right: number; wrong: number }>(
    `select split_part(c.item_id, ':', 1) as source, count(*) filter (where c.verdict = 'right')::int as right, count(*) filter (where c.verdict = 'wrong')::int as wrong
       from (${CURRENT_COIN_CALLS}) c where c.created_at >= $1 group by 1`).catch(() => [] as { source: string; right: number; wrong: number }[]);
  const lead = summarise(await leadRows(db, since));
  const hours = days * 24;
  const of = (s: Source): SourceNumbers => {
    const f = fyp.find((r) => r.source === s);
    const shown = f?.n ?? 0;
    const not = taps.find((r) => r.source === s)?.n ?? 0;
    const c = calls.find((r) => r.source === s);
    const l = lead.find((r) => r.source === s);
    return {
      foundMedianMin: round(found.find((r) => r.source === s)?.med ?? null),
      fypMedianMin: round(f?.med ?? null), fypP90Min: round(f?.p90 ?? null),
      fypShown: shown, fypPerHour: shown / hours,
      notTaps: not, junkPer100: shown === 0 ? null : (100 * not) / shown,
      coinRight: c?.right ?? 0, coinWrong: c?.wrong ?? 0,
      coined: l?.coined ?? 0, shownFirst: l?.shownFirst ?? 0,
      shownFirstPct: l === undefined || l.coined === 0 ? null : (100 * l.shownFirst) / l.coined,
      medianLeadMin: round(l?.medianLeadMin ?? null),
    };
  };
  let set: Learned | null = null;
  if (opts.withSet !== false) {
    try {
      const rows = await composeSet(db, p);
      set = learn(rows, await readingsOf(db, rows.map((r) => r.itemId)), p);
    } catch {
      set = null;
    }
  }
  return { days, bySource: { x: of('x'), tiktok: of('tiktok') }, set };
}

/* ── the gap ─────────────────────────────────────────────────────────────────────────────────── */

export interface Gap {
  readonly metric: string;
  /** How many times worse TikTok is than X on it (1 = level; the target is ≤ 2). */
  readonly times: number;
  readonly x: string;
  readonly tiktok: string;
  /** What moves this number, and what is being changed for it. */
  readonly lever: string;
}

const LEVERS: Record<string, string> = {
  found: 'finding: the trending feed trial, learned tags, sounds and creators searched newest first, the 20–60 minute age band (the finding helper\'s ScrapeCreators move)',
  fypMedian: 'the speed bar: the learned bar from coined videos once enough had early readings, and the young re-reads that give it readings under two hours',
  fypP90: 'the late check and the re-reads at 6 and 50 minutes, so slow growers are read again before they age out',
  fypPerHour: 'more videos found young (the trending feed, learned words) and the speed bar',
  junk: 'the judge: short-video precedents first and the short-video gate on the re-tune',
  matching: 'the namer: short-video examples first, and the training set\'s coins as examples',
  shownFirst: 'finding earlier and the speed bar: a video is only ahead of its coin if For You shows it first',
  lead: 'finding earlier and the speed bar',
};

const ratio = (worse: number | null, better: number | null, lowerIsBetter: boolean): number | null => {
  if (worse === null || better === null) return null;
  if (lowerIsBetter) return better <= 0 ? (worse <= 0 ? 1 : null) : worse / better;
  return worse <= 0 ? (better <= 0 ? 1 : Number.POSITIVE_INFINITY) : better / worse;
};

/** Each comparable number's gap, worst first. A number one side cannot count is left out, and said. */
export function gaps(t: SideBySide): readonly Gap[] {
  const x = t.bySource.x;
  const k = t.bySource.tiktok;
  const right = (s: SourceNumbers) => (s.coinRight + s.coinWrong === 0 ? null : s.coinRight / (s.coinRight + s.coinWrong));
  const rows: [string, string, number | null, number | null, boolean, (s: SourceNumbers) => string][] = [
    ['found', 'found (median minutes after going up)', k.foundMedianMin, x.foundMedianMin, true, (s) => mins(s.foundMedianMin)],
    ['fypMedian', 'on For You (median minutes)', k.fypMedianMin, x.fypMedianMin, true, (s) => mins(s.fypMedianMin)],
    ['fypP90', 'on For You (slowest 10%)', k.fypP90Min, x.fypP90Min, true, (s) => mins(s.fypP90Min)],
    ['fypPerHour', 'For You posts an hour', k.fypPerHour, x.fypPerHour, false, (s) => s.fypPerHour.toFixed(1)],
    ['junk', 'junk (Not a meme per 100 shown)', k.junkPer100, x.junkPer100, true, (s) => per100(s)],
    ['matching', 'coin matching (share right)', right(k), right(x), false, (s) => `${s.coinRight} / ${s.coinWrong}`],
    ['shownFirst', 'coined shown before the coin (%)', k.shownFirstPct, x.shownFirstPct, false, (s) => pctOf(s)],
    ['lead', 'median lead (minutes)', k.medianLeadMin, x.medianLeadMin, false, (s) => mins(s.medianLeadMin)],
  ];
  return rows
    .flatMap(([key, metric, tk, xv, lower, show]) => {
      const times = ratio(tk, xv, lower);
      return times === null ? [] : [{ metric, times, x: show(x), tiktok: show(k), lever: LEVERS[key] ?? '' }];
    })
    .sort((a, b) => b.times - a.times);
}

/* ── printing ────────────────────────────────────────────────────────────────────────────────── */

const mins = (m: number | null) => (m === null ? '— (none)' : `${m} min`);
const per100 = (s: SourceNumbers) => (s.junkPer100 === null ? '— (none shown)' : `${s.junkPer100.toFixed(1)} (${s.notTaps} of ${s.fypShown})`);
const pctOf = (s: SourceNumbers) => (s.shownFirstPct === null ? '— (none coined)' : `${s.shownFirstPct < 10 ? s.shownFirstPct.toFixed(1) : Math.round(s.shownFirstPct)}% (${s.shownFirst} of ${s.coined})`);

/** The table as lines: one row per number, X then TikTok, the set's lines, and the biggest gap. */
export function sideBySideLines(t: SideBySide, p: Policy = DEFAULT_POLICY): readonly string[] {
  const x = t.bySource.x;
  const k = t.bySource.tiktok;
  const row = (name: string, a: string, b: string) => `${name.padEnd(36)} ${a.padEnd(26)} ${b}`;
  const out = [
    `X and TikTok, the last ${t.days} days`,
    row('', 'X', 'TikTok'),
    row('found: median after going up', mins(x.foundMedianMin), mins(k.foundMedianMin)),
    row('on For You: median', mins(x.fypMedianMin), mins(k.fypMedianMin)),
    row('on For You: slowest 10%', mins(x.fypP90Min), mins(k.fypP90Min)),
    row('For You posts an hour', `${x.fypPerHour.toFixed(1)} (${x.fypShown})`, `${k.fypPerHour.toFixed(1)} (${k.fypShown})`),
    row('junk: Not a meme per 100 shown', per100(x), per100(k)),
    row('coin matching: right / wrong', `${x.coinRight} / ${x.coinWrong}`, `${k.coinRight} / ${k.coinWrong}`),
    row('coined shown before the coin', pctOf(x), pctOf(k)),
    row('median lead time', mins(x.medianLeadMin), mins(k.medianLeadMin)),
  ];
  const s = t.set;
  if (s === null) out.push('TikTok training set: — (could not be read)');
  else {
    const bar = s.bar.proposed === null ? `in use ${p.rising.shortVideoSpeedBar.earlyReach.toLocaleString('en')} in 2 h or ${p.rising.shortVideoSpeedBar.fastReachPerMinute}/min; none learned yet (${s.bar.why})` : `learned ${s.bar.proposed.earlyReach.toLocaleString('en')} in 2 h or ${s.bar.proposed.fastReachPerMinute}/min (in use ${p.rising.shortVideoSpeedBar.earlyReach.toLocaleString('en')} / ${p.rising.shortVideoSpeedBar.fastReachPerMinute})`;
    out.push(`TikTok training set: ${s.size} coined videos, words for ${s.withWords}`);
    out.push(`  bar: ${bar}`);
    out.push(`  tags: ${s.tags.map((w) => `${w.value} (${w.posts})`).join(', ') || '— (none on 2 or more coined videos)'}`);
    out.push(`  sounds: ${s.sounds.map((w) => `${w.title ?? w.value} (${w.posts})`).join(', ') || '— (none on 2 or more coined videos)'}`);
  }
  const g = gaps(t);
  const worst = g[0];
  out.push(worst === undefined ? 'biggest gap: — (no number both sides can count)' : `biggest gap: ${worst.metric}, TikTok ${worst.tiktok} against X ${worst.x} (${Number.isFinite(worst.times) ? `${worst.times.toFixed(1)}x` : 'none on TikTok'}; target 2x). Changing: ${worst.lever}`);
  const over = g.filter((x2) => x2.times > 2).length;
  out.push(`numbers more than 2x behind X: ${over} of ${g.length} comparable`);
  return out;
}
